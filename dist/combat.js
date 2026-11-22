/* Deterministic idle combat. Active time uses microsecond ticks; no wall clock or DOM. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EmberCombat = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const TICKS = 1000000;
  const HERO_INTERVAL = 1.2 * TICKS;
  const COUNTER_DELAY = .3 * TICKS;
  const COUNTER_DURATION = .36 * TICKS;
  const magicTiming = Object.freeze({appearDuration:.42,flightDuration:.48,impactDuration:.42});
  const MAGIC_DELAY = Math.round((magicTiming.appearDuration + magicTiming.flightDuration) * TICKS);
  const swordSteps = [
    {variant:'halfslash', interval:1.05 * TICKS, animationDuration:.56, heavy:false},
    {variant:'slash', interval:1.2 * TICKS, animationDuration:.66, heavy:false},
    {variant:'backslash', interval:1.35 * TICKS, animationDuration:.91, heavy:true}
  ];
  const templates = [
    {id:'orc', name:'Орк-щитоносец', maxHp:100, damage:6, interval:2.4, armor:3, projectile:'melee'},
    {id:'archer', name:'Скелет-лучник', maxHp:60, damage:7, interval:3.1, armor:0, projectile:'arrow'},
    {id:'mage', name:'Могильный колдун', maxHp:65, damage:10, interval:3.8, armor:0, projectile:'magic'}
  ];
  function positive(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
  function createBattle(options = {}) {
    const config = {
      name:typeof options.heroName === 'string' && options.heroName.trim() ? options.heroName.trim() : 'Странник',
      maxHp:positive(options.heroMaxHp, 200), damage:positive(options.heroDamage, 12),
      projectile:['melee','arrow','magic'].includes(options.heroProjectile) ? options.heroProjectile : 'melee',
      magic:['fire','ice'].includes(options.heroMagic) ? options.heroMagic : 'fire'
    };
    // A contradictory ranged projectile never enables shield mechanics.
    const sword = options.heroWeapon === 'sword' && config.projectile === 'melee';
    let phase, elapsed, remainder, hero, enemies, nextHero, nextEnemies, reward;
    let comboIndex, meleeHits, heroBusyUntil, pendingCounters, pendingImpacts;
    function getState() {
      const target = enemies.find(enemy => enemy.hp > 0);
      return {
        phase, elapsed:elapsed / TICKS, hero:{...hero},
        enemies:enemies.map(enemy => ({...enemy, alive:enemy.hp > 0})),
        targetId:target ? target.id : null,
        defeatedCount:enemies.filter(enemy => enemy.hp <= 0).length, reward
      };
    }
    function restart() {
      phase = 'running'; elapsed = 0; remainder = 0; reward = 0;
      hero = {id:'hero', name:config.name, hp:config.maxHp, maxHp:config.maxHp, damage:config.damage};
      enemies = templates.map(enemy => ({...enemy, hp:enemy.maxHp}));
      comboIndex = 0; meleeHits = 0; heroBusyUntil = 0; pendingCounters = []; pendingImpacts = [];
      nextHero = sword ? swordSteps[0].interval : HERO_INTERVAL;
      nextEnemies = enemies.map(enemy => Math.round(enemy.interval * TICKS));
      return getState();
    }
    function pause() {
      if (phase === 'running') phase = 'paused';
      return getState();
    }
    function resume() {
      if (phase === 'paused') phase = 'running';
      return getState();
    }
    function reserveCounter(targetId) {
      let candidate = Math.max(elapsed + COUNTER_DELAY, heroBusyUntil);
      // Regular attacks retain their cadence. Fit the counter between their animations,
      // including the long heavy backslash, and any already reserved counter.
      for (;;) {
        const reserved = pendingCounters.find(counter => candidate < counter.at + COUNTER_DURATION && candidate + COUNTER_DURATION > counter.at);
        if (reserved) { candidate = reserved.at + COUNTER_DURATION; continue; }
        let regularAt = nextHero, index = comboIndex;
        while (regularAt + swordSteps[index].animationDuration * TICKS <= candidate) {
          index = (index + 1) % swordSteps.length;
          regularAt += swordSteps[index].interval;
        }
        if (candidate + COUNTER_DURATION <= regularAt) break;
        candidate = Math.max(candidate, regularAt + swordSteps[index].animationDuration * TICKS);
      }
      pendingCounters.push({targetId, at:Math.round(candidate)});
      pendingCounters.sort((a,b) => a.at - b.at);
    }
    function advance(seconds, availability = {}) {
      const events = [];
      if (phase !== 'running' || !Number.isFinite(seconds) || seconds <= 0) return events;
      const heroCanAttack = availability?.heroCanAttack !== false;
      const orcCanAttack = availability?.orcCanAttack !== false;
      const delta = seconds * TICKS + remainder;
      const ticks = Math.min(Number.MAX_SAFE_INTEGER - elapsed, Math.round(delta));
      remainder = Number.isFinite(delta) ? delta - ticks : 0;
      const until = elapsed + ticks;
      function advanceClock(time) {
        const passed = time - elapsed;
        // Range gates freeze only that actor's remaining cooldown. Ranged enemies
        // and the battle clock keep advancing, including between new counter events.
        if (!heroCanAttack) {
          nextHero += passed;
          heroBusyUntil += passed;
          pendingCounters.forEach(counter => { counter.at += passed; });
        }
        if (!orcCanAttack) enemies.forEach((enemy,index) => { if (enemy.id === 'orc') nextEnemies[index] += passed; });
        elapsed = time;
      }
      function hit(sourceId, target, damage, projectile, metadata) {
        target.hp = Math.max(0, target.hp - damage);
        events.push({type:'attack', sourceId, targetId:target.id, damage, hp:target.hp, at:elapsed / TICKS, projectile, ...metadata});
        if (target.hp === 0) {
          events.push({type:'death', id:target.id, at:elapsed / TICKS});
          pendingCounters = pendingCounters.filter(counter => counter.targetId !== target.id);
          pendingImpacts = pendingImpacts.filter(impact => impact.targetId !== target.id);
        }
      }
      function end(result) {
        phase = result; pendingCounters = []; pendingImpacts = [];
        reward = result === 'victory' ? 25 : 0;
        events.push({type:'end', result, reward, at:elapsed / TICKS});
      }
      function cast(sourceId,target,damage,magic) {
        const castAt = elapsed / TICKS;
        const impactTick = elapsed + MAGIC_DELAY;
        const castId = `${sourceId}:${elapsed}`;
        events.push({type:'cast',sourceId,targetId:target.id,projectile:'magic',magic,at:castAt,...magicTiming,impactAt:impactTick / TICKS,castId});
        pendingImpacts.push({sourceId,targetId:target.id,damage,magic,at:impactTick,castAt,castId});
        // Hero-origin impacts win ties against enemy-origin impacts; launch order
        // remains stable for multiple shots from the same side.
        pendingImpacts.sort((a,b) => a.at-b.at || Number(b.sourceId==='hero')-Number(a.sourceId==='hero'));
      }
      while (phase === 'running') {
        let next = heroCanAttack ? nextHero : Infinity;
        if (heroCanAttack && pendingCounters.length) next = Math.min(next, pendingCounters[0].at);
        if (pendingImpacts.length) next = Math.min(next,pendingImpacts[0].at);
        enemies.forEach((enemy, index) => {
          if (enemy.hp > 0 && (enemy.id !== 'orc' || orcCanAttack)) next = Math.min(next, nextEnemies[index]);
        });
        if (next > until) break;
        advanceClock(next);
        // Tie policy: regular hero action, counters, magic impacts (hero first), then living enemies.
        if (heroCanAttack && nextHero === next) {
          const target = enemies.find(enemy => enemy.hp > 0);
          const step = sword ? swordSteps[comboIndex] : null;
          const damage = config.damage * (step?.heavy ? 1.5 : 1);
          const metadata = step ? {variant:step.variant, comboStep:comboIndex + 1, heavy:step.heavy, animationDuration:step.animationDuration, counter:false} : undefined;
          if (config.projectile === 'magic') cast('hero',target,Math.max(1,damage-target.armor),config.magic);
          else hit('hero', target, Math.max(1, damage - target.armor), config.projectile, metadata);
          if (sword) {
            heroBusyUntil = elapsed + step.animationDuration * TICKS;
            comboIndex = (comboIndex + 1) % swordSteps.length;
            nextHero += swordSteps[comboIndex].interval;
          } else nextHero += HERO_INTERVAL;
          if (enemies.every(enemy => enemy.hp === 0)) { end('victory'); break; }
        }
        while (heroCanAttack && pendingCounters.length && pendingCounters[0].at === next) {
          const counter = pendingCounters.shift();
          const target = enemies.find(enemy => enemy.id === counter.targetId && enemy.hp > 0);
          if (!target || hero.hp <= 0) continue;
          heroBusyUntil = elapsed + COUNTER_DURATION;
          hit('hero', target, Math.max(1, config.damage - target.armor), 'melee', {variant:'halfslash',comboStep:0,heavy:false,animationDuration:COUNTER_DURATION / TICKS,counter:true});
          if (enemies.every(enemy => enemy.hp === 0)) { end('victory'); break; }
        }
        if (phase !== 'running') break;
        while (pendingImpacts.length && pendingImpacts[0].at === next) {
          const impact = pendingImpacts.shift();
          const target = impact.targetId === 'hero' ? hero : enemies.find(enemy => enemy.id === impact.targetId);
          if (!target || target.hp <= 0) continue;
          // A launched spell is independent of its caster's life and range readiness.
          hit(impact.sourceId,target,impact.damage,'magic',{magic:impact.magic,impact:true,castAt:impact.castAt,castId:impact.castId});
          if (hero.hp === 0) { end('defeat'); break; }
          if (enemies.every(enemy => enemy.hp === 0)) { end('victory'); break; }
        }
        if (phase !== 'running') break;
        for (let index = 0; index < enemies.length; index++) {
          const enemy = enemies[index];
          if (enemy.hp <= 0 || nextEnemies[index] !== next || (enemy.id === 'orc' && !orcCanAttack)) continue;
          let damage = enemy.damage, blocked = false;
          if (sword && enemy.projectile === 'melee' && ++meleeHits % 2 === 0) {
            const blockedDamage = damage * .5;
            damage -= blockedDamage; blocked = true;
            events.push({type:'block',sourceId:enemy.id,targetId:'hero',blockedDamage,at:elapsed / TICKS});
          }
          if (enemy.projectile === 'magic') cast(enemy.id,hero,damage,'shadow');
          else hit(enemy.id, hero, damage, enemy.projectile);
          nextEnemies[index] += Math.round(enemy.interval * TICKS);
          if (hero.hp === 0) { end('defeat'); break; }
          if (blocked) reserveCounter(enemy.id);
        }
      }
      if (phase === 'running') advanceClock(until);
      return events;
    }
    restart();
    return {getState, advance, pause, resume, restart, get state() { return getState(); }};
  }
  return {createBattle,magicTiming};
});
