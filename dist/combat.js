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
  const CLOSE_MAGIC_INTERVAL = .8 * TICKS;
  const COUNTER_DELAY = .3 * TICKS;
  const COUNTER_DURATION = .36 * TICKS;
  const intermissionDuration = 1.4;
  const INTERMISSION = Math.round(intermissionDuration * TICKS);
  const KILL_REWARD = 5;
  const statusTiming = Object.freeze({duration:.5,burnTickInterval:.25,burnDamage:1});
  const STATUS_DURATION = Math.round(statusTiming.duration*TICKS);
  const BURN_INTERVAL = Math.round(statusTiming.burnTickInterval*TICKS);
  const magicTiming = Object.freeze({appearDuration:.42,flightDuration:.48,impactDuration:.42});
  const closeMagicTiming = Object.freeze({appearDuration:.18,flightDuration:.12,impactDuration:.42});
  const swordSteps = [
    {variant:'halfslash', interval:1.05 * TICKS, animationDuration:.56, heavy:false},
    {variant:'slash', interval:1.2 * TICKS, animationDuration:.66, heavy:false},
    {variant:'backslash', interval:1.35 * TICKS, animationDuration:.91, heavy:true}
  ];
  const archetypes = {
    orc:{name:'Орк-щитоносец',maxHp:100,damage:6,interval:2.4,armor:3,projectile:'melee'},
    archer:{name:'Скелет-лучник',maxHp:60,damage:7,interval:1.8,armor:0,projectile:'arrow'},
    mage:{name:'Могильный колдун',maxHp:65,damage:10,interval:3.8,armor:0,projectile:'magic'}
  };
  const waveTemplates = [
    [{id:'archer1',type:'archer'}],
    [{id:'archer2',type:'archer'},{id:'archer3',type:'archer'}],
    [{id:'orc',type:'orc'}]
  ];
  const totalEnemies = waveTemplates.reduce((count,wave) => count + wave.length,0);
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
    const sword = options.heroWeapon === 'sword' && config.projectile === 'melee';
    let phase, pausedFrom, elapsed, remainder, hero, enemies, nextHero, nextEnemies, reward;
    let comboIndex, meleeHits, heroBusyUntil, pendingCounters, pendingImpacts;
    let waveIndex, completedWaves, defeatedCount, nextWaveAt;
    function getState() {
      const target = enemies.find(enemy => enemy.hp > 0);
      const waiting = phase === 'intermission' || (phase === 'paused' && pausedFrom === 'intermission');
      return {
        phase, elapsed:elapsed / TICKS, hero:{...hero},
        enemies:enemies.map(enemy => ({...enemy,status:enemy.status ? {type:enemy.status.type,startedAt:enemy.status.startedAt/TICKS,endsAt:enemy.status.endsAt/TICKS} : null,alive:enemy.hp > 0})),
        targetId:target ? target.id : null,
        waveIndex,waveNumber:waveIndex+1,waveCount:waveTemplates.length,completedWaves,
        defeatedCount,totalDefeated:defeatedCount,totalEnemies,reward,
        intermissionRemaining:waiting ? Math.max(0,nextWaveAt-elapsed) / TICKS : 0
      };
    }
    function spawnWave(index) {
      waveIndex = index; phase = 'running'; pausedFrom = null; nextWaveAt = null;
      enemies = waveTemplates[index].map(unit => ({...archetypes[unit.type],...unit,hp:archetypes[unit.type].maxHp,status:null}));
      comboIndex = 0; meleeHits = 0; heroBusyUntil = elapsed; pendingCounters = []; pendingImpacts = [];
      nextHero = elapsed + (sword ? swordSteps[0].interval : HERO_INTERVAL);
      nextEnemies = enemies.map(enemy => elapsed + Math.round(enemy.interval * TICKS));
    }
    function restart() {
      elapsed = 0; remainder = 0; reward = 0; completedWaves = 0; defeatedCount = 0;
      hero = {id:'hero',name:config.name,hp:config.maxHp,maxHp:config.maxHp,damage:config.damage};
      spawnWave(0);
      return getState();
    }
    function pause() {
      if (phase === 'running' || phase === 'intermission') { pausedFrom = phase; phase = 'paused'; }
      return getState();
    }
    function resume() {
      if (phase === 'paused') { phase = pausedFrom || 'running'; pausedFrom = null; }
      return getState();
    }
    function reserveCounter(targetId) {
      let candidate = Math.max(elapsed + COUNTER_DELAY,heroBusyUntil);
      for (;;) {
        const reserved = pendingCounters.find(counter => candidate < counter.at + COUNTER_DURATION && candidate + COUNTER_DURATION > counter.at);
        if (reserved) { candidate = reserved.at + COUNTER_DURATION; continue; }
        let regularAt = nextHero,index = comboIndex;
        while (regularAt + swordSteps[index].animationDuration * TICKS <= candidate) {
          index = (index+1) % swordSteps.length; regularAt += swordSteps[index].interval;
        }
        if (candidate + COUNTER_DURATION <= regularAt) break;
        candidate = Math.max(candidate,regularAt + swordSteps[index].animationDuration * TICKS);
      }
      pendingCounters.push({targetId,at:Math.round(candidate)});
      pendingCounters.sort((a,b) => a.at-b.at);
    }
    function advance(seconds,availability = {}) {
      const events = [];
      if (!['running','intermission'].includes(phase) || !Number.isFinite(seconds) || seconds <= 0) return events;
      const heroCanAttack = availability?.heroCanAttack !== false;
      const orcCanAttack = availability?.orcCanAttack !== false;
      const delta = seconds * TICKS + remainder;
      const ticks = Math.min(Number.MAX_SAFE_INTEGER-elapsed,Math.round(delta));
      remainder = Number.isFinite(delta) ? delta-ticks : 0;
      const until = elapsed + ticks;
      function frozen(enemy) { return enemy.status?.type === 'freeze' && enemy.status.endsAt > elapsed; }
      function advanceClock(time) {
        const passed = time-elapsed;
        if (phase === 'running') {
          if (!heroCanAttack) {
            nextHero += passed; heroBusyUntil += passed;
            pendingCounters.forEach(counter => { counter.at += passed; });
          }
          enemies.forEach((enemy,index) => {
            // Freeze and out-of-range time overlap: hold the timer once for their union.
            if ((enemy.type === 'orc' && !orcCanAttack) || frozen(enemy)) nextEnemies[index] += passed;
          });
        }
        elapsed = time;
      }
      function hit(sourceId,target,damage,projectile,metadata) {
        target.hp = Math.max(0,target.hp-damage);
        events.push({type:'attack',sourceId,targetId:target.id,damage,hp:target.hp,at:elapsed/TICKS,projectile,...metadata});
        if (target.hp === 0) {
          const enemy = target.id !== 'hero';
          if (enemy) { defeatedCount++; reward += KILL_REWARD; target.status = null; }
          events.push({type:'death',id:target.id,unitType:target.type || 'hero',reward:enemy ? KILL_REWARD : 0,totalReward:reward,at:elapsed/TICKS});
          pendingCounters = pendingCounters.filter(counter => counter.targetId !== target.id);
          pendingImpacts = pendingImpacts.filter(impact => impact.targetId !== target.id);
        }
      }
      function end(result) {
        phase = result; pausedFrom = null; pendingCounters = []; pendingImpacts = []; nextWaveAt = null;
        enemies.forEach(enemy => { enemy.status = null; });
        // Rewards belong to individual deaths; terminal events never grant a second bonus.
        events.push({type:'end',result,reward:0,totalReward:reward,at:elapsed/TICKS});
      }
      function clearWave() {
        completedWaves++;
        pendingCounters = []; pendingImpacts = [];
        enemies.forEach(enemy => { enemy.status = null; });
        events.push({type:'wave_clear',waveIndex,waveNumber:waveIndex+1,at:elapsed/TICKS});
        if (waveIndex === waveTemplates.length-1) end('victory');
        else { phase = 'intermission'; nextWaveAt = elapsed + INTERMISSION; }
      }
      function applyStatus(target,magic) {
        const type = magic === 'fire' ? 'burn' : 'freeze';
        target.status = {type,sourceId:'hero',startedAt:elapsed,endsAt:elapsed+STATUS_DURATION,nextTick:elapsed+BURN_INTERVAL};
        events.push({type:'status',status:type,sourceId:'hero',targetId:target.id,at:elapsed/TICKS,duration:statusTiming.duration,endsAt:target.status.endsAt/TICKS});
      }
      function cast(sourceId,target,damage,magic) {
        const close = sourceId === 'hero' && availability?.heroCloseRange === true;
        const timing = close ? closeMagicTiming : magicTiming;
        const interval = sourceId === 'hero' ? close ? CLOSE_MAGIC_INTERVAL : HERO_INTERVAL : Math.round(enemies.find(enemy=>enemy.id===sourceId).interval*TICKS);
        const delay = Math.round((timing.appearDuration+timing.flightDuration)*TICKS);
        const castAt = elapsed/TICKS,impactTick = elapsed+delay,castId = `${sourceId}:${elapsed}`;
        events.push({type:'cast',sourceId,targetId:target.id,projectile:'magic',magic,at:castAt,...timing,impactAt:impactTick/TICKS,castId,animationDuration:close ? .36 : .66,castInterval:interval/TICKS});
        pendingImpacts.push({sourceId,targetId:target.id,damage,magic,at:impactTick,castAt,castId});
        pendingImpacts.sort((a,b) => a.at-b.at || Number(b.sourceId==='hero')-Number(a.sourceId==='hero'));
        return interval;
      }
      while (phase === 'running' || phase === 'intermission') {
        if (phase === 'intermission') {
          if (nextWaveAt > until) break;
          advanceClock(nextWaveAt); spawnWave(waveIndex+1);
          events.push({type:'wave',waveIndex,waveNumber:waveIndex+1,waveCount:waveTemplates.length,enemies:getState().enemies,at:elapsed/TICKS});
          continue;
        }
        let next = heroCanAttack ? nextHero : Infinity;
        if (heroCanAttack && pendingCounters.length) next = Math.min(next,pendingCounters[0].at);
        if (pendingImpacts.length) next = Math.min(next,pendingImpacts[0].at);
        enemies.forEach((enemy,index) => {
          if (enemy.hp <= 0) return;
          if ((enemy.type !== 'orc' || orcCanAttack) && !frozen(enemy)) next = Math.min(next,nextEnemies[index]);
          if (enemy.status) {
            next = Math.min(next,enemy.status.endsAt);
            if (enemy.status.type === 'burn') next = Math.min(next,enemy.status.nextTick);
          }
        });
        if (next > until) break;
        advanceClock(next);
        // Ties: hero action, counters, existing status ticks/expiry, impacts, then enemies.
        if (heroCanAttack && nextHero === next) {
          const target = enemies.find(enemy => enemy.hp > 0),step = sword ? swordSteps[comboIndex] : null;
          const damage = config.damage * (step?.heavy ? 1.5 : 1);
          const metadata = step ? {variant:step.variant,comboStep:comboIndex+1,heavy:step.heavy,animationDuration:step.animationDuration,counter:false} : undefined;
          const interval = config.projectile === 'magic' ? cast('hero',target,Math.max(1,damage-target.armor),config.magic) : HERO_INTERVAL;
          if (config.projectile !== 'magic') hit('hero',target,Math.max(1,damage-target.armor),config.projectile,metadata);
          if (sword) {
            heroBusyUntil = elapsed + step.animationDuration*TICKS;
            comboIndex = (comboIndex+1) % swordSteps.length; nextHero += swordSteps[comboIndex].interval;
          } else nextHero += interval;
          if (enemies.every(enemy => enemy.hp === 0)) { clearWave(); continue; }
        }
        while (heroCanAttack && pendingCounters.length && pendingCounters[0].at === next) {
          const counter = pendingCounters.shift(),target = enemies.find(enemy => enemy.id === counter.targetId && enemy.hp > 0);
          if (!target || hero.hp <= 0) continue;
          heroBusyUntil = elapsed + COUNTER_DURATION;
          hit('hero',target,Math.max(1,config.damage-target.armor),'melee',{variant:'halfslash',comboStep:0,heavy:false,animationDuration:COUNTER_DURATION/TICKS,counter:true});
          if (enemies.every(enemy => enemy.hp === 0)) { clearWave(); break; }
        }
        if (phase !== 'running') continue;
        // Resolve the previous burn tick before a same-tick impact refreshes it;
        // the second tick also lands before the effect expires at exactly .5 s.
        for (const enemy of enemies) {
          const status = enemy.status;
          if (!status || enemy.hp <= 0) continue;
          if (status.type === 'burn' && status.nextTick === next) {
            hit(status.sourceId,enemy,statusTiming.burnDamage,'burn',{magic:'fire',dot:true});
            if (enemy.status === status) status.nextTick += BURN_INTERVAL;
            if (enemies.every(unit => unit.hp === 0)) { clearWave(); break; }
          }
          if (enemy.status && enemy.status.endsAt <= next) enemy.status = null;
        }
        if (phase !== 'running') continue;
        while (pendingImpacts.length && pendingImpacts[0].at === next) {
          const impact = pendingImpacts.shift(),target = impact.targetId === 'hero' ? hero : enemies.find(enemy => enemy.id === impact.targetId);
          if (!target || target.hp <= 0) continue;
          hit(impact.sourceId,target,impact.damage,'magic',{magic:impact.magic,impact:true,castAt:impact.castAt,castId:impact.castId});
          if (impact.sourceId === 'hero' && target.id !== 'hero' && target.hp > 0 && ['fire','ice'].includes(impact.magic)) applyStatus(target,impact.magic);
          if (hero.hp === 0) { end('defeat'); break; }
          if (enemies.every(enemy => enemy.hp === 0)) { clearWave(); break; }
        }
        if (phase !== 'running') continue;
        for (let index=0;index<enemies.length;index++) {
          const enemy = enemies[index];
          if (enemy.hp <= 0 || nextEnemies[index] !== next || (enemy.type === 'orc' && !orcCanAttack) || frozen(enemy)) continue;
          let damage = enemy.damage,blocked = false;
          if (sword && enemy.projectile === 'melee' && ++meleeHits % 2 === 0) {
            const blockedDamage = damage*.5; damage -= blockedDamage; blocked = true;
            events.push({type:'block',sourceId:enemy.id,targetId:'hero',blockedDamage,at:elapsed/TICKS});
          }
          if (enemy.projectile === 'magic') cast(enemy.id,hero,damage,'shadow');
          else hit(enemy.id,hero,damage,enemy.projectile,enemy.type === 'archer' ? {animationDuration:.6} : undefined);
          nextEnemies[index] += Math.round(enemy.interval*TICKS);
          if (hero.hp === 0) { end('defeat'); break; }
          if (blocked) reserveCounter(enemy.id);
        }
      }
      if (phase === 'running' || phase === 'intermission') advanceClock(until);
      return events;
    }
    restart();
    return {getState,advance,pause,resume,restart,get state(){return getState();}};
  }
  return {createBattle,magicTiming,closeMagicTiming,statusTiming,intermissionDuration};
});
