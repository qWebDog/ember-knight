'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createBattle} = require('../dist/combat.js');

test('normal unarmed battle wins in 25–35s, with about 30% health and one 25-gold reward', () => {
  const battle = createBattle();
  const events = battle.advance(100);
  const state = battle.getState();
  assert.equal(state.phase, 'victory');
  assert.ok(state.elapsed >= 25 && state.elapsed <= 35);
  assert.ok(state.hero.hp / state.hero.maxHp >= .25 && state.hero.hp / state.hero.maxHp <= .35);
  assert.equal(state.defeatedCount, 3);
  assert.equal(state.targetId, null);
  assert.equal(state.reward, 25);
  assert.deepEqual(events.filter(event => event.type === 'end'), [{type:'end', result:'victory', reward:25, at:state.elapsed}]);
  assert.ok(events.filter(event => event.type === 'attack').every(event => event.at >= 1 && event.hp >= 0));
  for (const [id, projectile] of [['orc','melee'],['archer','arrow'],['mage','magic']]) {
    assert.ok(events.some(event => event.sourceId === id && event.projectile === projectile));
  }
  assert.deepEqual(battle.advance(100), []);
  battle.pause(); battle.resume();
  assert.deepEqual(battle.getState(), state);
});

test('forced defeat emits hero death once, no reward and no later attacks', () => {
  const battle = createBattle({heroMaxHp:1});
  const events = battle.advance(100);
  assert.equal(battle.state.phase, 'defeat');
  assert.equal(battle.state.hero.hp, 0);
  assert.equal(battle.state.reward, 0);
  assert.equal(events.filter(event => event.type === 'death' && event.id === 'hero').length, 1);
  assert.equal(events.at(-1).type, 'end');
  assert.equal(events.at(-1).result, 'defeat');
  assert.deepEqual(battle.advance(100), []);
});

test('pause freezes elapsed and remaining attack timers; resume preserves the tie order', () => {
  const battle = createBattle();
  battle.advance(1.7);
  const paused = battle.pause();
  assert.deepEqual(battle.advance(50), []);
  assert.deepEqual(battle.getState(), paused);
  battle.resume();
  const attacks = battle.advance(.7).filter(event => event.type === 'attack');
  assert.deepEqual(attacks.map(event => [event.sourceId,event.at]), [['hero',2.4],['orc',2.4]]);
});

test('restart resets health, time, target, phase and reward while retaining hero configuration', () => {
  const options = {heroName:'Тестовый герой', heroMaxHp:260, heroDamage:15};
  const battle = createBattle(options);
  const initial = battle.getState();
  battle.advance(100);
  assert.equal(battle.state.phase, 'victory');
  assert.deepEqual(battle.restart(), initial);
  battle.advance(.8); battle.pause();
  assert.deepEqual(battle.restart(), initial);
  assert.equal(battle.advance(1.2)[0].sourceId, 'hero');
});

test('orc armor reduces hits and target advances immediately; dead enemies lose a tied attack', () => {
  const battle = createBattle();
  const first = battle.advance(1.2)[0];
  assert.equal(first.targetId, 'orc');
  assert.equal(first.damage, 9);
  assert.equal(first.hp, 91);
  const events = battle.advance(13.2);
  assert.ok(events.some(event => event.type === 'death' && event.id === 'orc' && event.at === 14.4));
  assert.ok(!events.some(event => event.sourceId === 'orc' && event.at === 14.4));
  assert.equal(battle.state.targetId, 'archer');
  assert.equal(battle.state.defeatedCount, 1);
  const next = battle.advance(1.2).find(event => event.sourceId === 'hero');
  assert.equal(next.targetId, 'archer');
  assert.equal(next.damage, 12);
  assert.deepEqual(battle.advance(100).filter(event => event.type === 'death').map(event => event.id), ['archer','mage']);
});

test('oversized, fixed-step and irregular-step advances produce identical events and final state', () => {
  const whole = createBattle(), small = createBattle(), irregular = createBattle();
  const expected = whole.advance(100);
  const smallEvents = [], irregularEvents = [];
  for (let i = 0; i < 1000; i++) smallEvents.push(...small.advance(.1));
  for (let i = 0; i < 1000; i++) irregularEvents.push(...irregular.advance(.037), ...irregular.advance(.063));
  assert.deepEqual(smallEvents, expected);
  assert.deepEqual(irregularEvents, expected);
  assert.deepEqual(small.state, whole.state);
  assert.deepEqual(irregular.state, whole.state);
  const snapshot = whole.getState();
  snapshot.hero.hp = 999; snapshot.enemies[0].hp = 999;
  assert.notEqual(whole.state.hero.hp, 999);
  assert.notEqual(whole.state.enemies[0].hp, 999);
});
