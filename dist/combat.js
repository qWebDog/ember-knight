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
      maxHp:positive(options.heroMaxHp, 200), damage:positive(options.heroDamage, 12)
    };
    let phase, elapsed, remainder, hero, enemies, nextHero, nextEnemies, reward;
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
      nextHero = HERO_INTERVAL;
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
    function advance(seconds) {
      const events = [];
      if (phase !== 'running' || !Number.isFinite(seconds) || seconds <= 0) return events;
      const delta = seconds * TICKS + remainder;
      const ticks = Math.min(Number.MAX_SAFE_INTEGER - elapsed, Math.round(delta));
      remainder = Number.isFinite(delta) ? delta - ticks : 0;
      const until = elapsed + ticks;
      function hit(sourceId, target, damage, projectile) {
        target.hp = Math.max(0, target.hp - damage);
        events.push({type:'attack', sourceId, targetId:target.id, damage, hp:target.hp, at:elapsed / TICKS, projectile});
        if (target.hp === 0) events.push({type:'death', id:target.id, at:elapsed / TICKS});
      }
      function end(result) {
        phase = result;
        reward = result === 'victory' ? 25 : 0;
        events.push({type:'end', result, reward, at:elapsed / TICKS});
      }
      while (phase === 'running') {
        let next = nextHero;
        enemies.forEach((enemy, index) => {
          if (enemy.hp > 0) next = Math.min(next, nextEnemies[index]);
        });
        if (next > until) break;
        elapsed = next;
        // Tie policy: hero first; then living enemies in orc/archer/mage order.
        if (nextHero === next) {
          const target = enemies.find(enemy => enemy.hp > 0);
          hit('hero', target, Math.max(1, hero.damage - target.armor), 'melee');
          nextHero += HERO_INTERVAL;
          if (enemies.every(enemy => enemy.hp === 0)) { end('victory'); break; }
        }
        for (let index = 0; index < enemies.length; index++) {
          const enemy = enemies[index];
          if (enemy.hp <= 0 || nextEnemies[index] !== next) continue;
          hit(enemy.id, hero, enemy.damage, enemy.projectile);
          nextEnemies[index] += Math.round(enemy.interval * TICKS);
          if (hero.hp === 0) { end('defeat'); break; }
        }
      }
      if (phase === 'running') elapsed = until;
      return events;
    }
    restart();
    return {getState, advance, pause, resume, restart, get state() { return getState(); }};
  }
  return {createBattle};
});
