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


test('starter ranged weapons emit their own projectile while preserving battle balance',()=>{
 for(const projectile of ['arrow','magic','melee']){const b=createBattle({heroProjectile:projectile});const events=b.advance(100);assert.ok(events.filter(e=>e.sourceId==='hero').every(e=>e.projectile===projectile));assert.equal(b.state.hero.hp,58);assert.equal(b.state.phase,'victory');}
});

test('sword opts into a deterministic three-hit combo with a heavier third hit before armor', () => {
  const battle = createBattle({heroWeapon:'sword'});
  const attacks = battle.advance(8).filter(event => event.type === 'attack' && event.sourceId === 'hero' && !event.counter);
  assert.deepEqual(attacks.slice(0,6).map(event => [event.at,event.variant,event.comboStep,event.heavy,event.damage,event.animationDuration]), [
    [1.05,'halfslash',1,false,9,.56], [2.25,'slash',2,false,9,.66], [3.6,'backslash',3,true,15,.91],
    [4.65,'halfslash',1,false,9,.56], [5.85,'slash',2,false,9,.66], [7.2,'backslash',3,true,15,.91]
  ]);
  assert.ok(attacks.every(event => event.projectile === 'melee' && event.counter === false));
});

test('shield blocks every second melee hit and counters without advancing or delaying the regular combo', () => {
  const battle = createBattle({heroWeapon:'sword'});
  const events = battle.advance(6.5);
  assert.deepEqual(events.filter(event => event.type === 'block'), [
    {type:'block',sourceId:'orc',targetId:'hero',blockedDamage:3,at:4.8}
  ]);
  assert.deepEqual(events.filter(event => event.type === 'attack' && event.sourceId === 'orc').map(event=>[event.at,event.damage]), [[2.4,6],[4.8,3]]);
  assert.ok(events.filter(event=>event.sourceId==='archer'&&event.type==='attack').every(event=>event.damage===7));
  assert.ok(events.filter(event=>event.sourceId==='mage'&&event.type==='attack').every(event=>event.damage===10));
  const counter = events.find(event => event.counter);
  assert.deepEqual([counter.sourceId,counter.targetId,counter.at,counter.damage,counter.variant,counter.comboStep,counter.heavy,counter.animationDuration], ['hero','orc',5.21,9,'halfslash',0,false,.36]);
  const afterCounter = events.find(event=>event.sourceId==='hero'&&!event.counter&&event.at>counter.at);
  assert.equal(afterCounter.at,5.85); assert.equal(afterCounter.comboStep,2);
});

test('sword counters reserve a free animation gap and never cut off a heavy or another regular attack', () => {
  const battle = createBattle({heroWeapon:'sword',heroDamage:1,heroMaxHp:10000});
  const events = battle.advance(40);
  const heroAttacks = events.filter(event => event.type === 'attack' && event.sourceId === 'hero');
  for (let i=1;i<heroAttacks.length;i++) {
    const before=heroAttacks[i-1], after=heroAttacks[i];
    assert.ok(before.at+before.animationDuration<=after.at+1e-9, `animation at ${before.at} overlaps ${after.at}`);
  }
  assert.ok(events.some(event=>event.type==='block'&&event.at===14.4));
  assert.ok(heroAttacks.some(event=>event.counter&&event.at===16.01), 'counter waits until the heavy and next halfslash have completed');
  assert.ok(heroAttacks.filter(event=>event.heavy).every(event=>event.variant==='backslash'&&event.animationDuration===.91));
});

test('sword pause preserves a pending counter and restart resets combo, shield count and queued counters', () => {
  const battle = createBattle({heroWeapon:'sword'});
  battle.advance(4.9); const paused=battle.pause();
  assert.deepEqual(battle.advance(100),[]); assert.deepEqual(battle.state,paused);
  battle.resume();
  const resumed=battle.advance(.31);
  assert.equal(resumed.filter(event=>event.counter).length,1); assert.equal(resumed.find(event=>event.counter).at,5.21);
  battle.advance(2); battle.restart();
  const repeated=battle.advance(6.5);
  assert.equal(repeated[0].at,1.05); assert.equal(repeated[0].comboStep,1);
  assert.deepEqual(repeated.filter(event=>event.type==='block').map(event=>event.at),[4.8]);
  assert.deepEqual(repeated.filter(event=>event.counter).map(event=>event.at),[5.21]);
});

test('sword never counters after death or against a blocker killed before its reserved counter slot', () => {
  const fragile=createBattle({heroWeapon:'sword',heroMaxHp:25,heroDamage:1});
  const fallen=fragile.advance(100);
  assert.equal(fragile.state.phase,'defeat'); assert.equal(fragile.state.hero.hp,0);
  assert.ok(fallen.some(event=>event.type==='block'&&event.at===4.8));
  assert.ok(!fallen.some(event=>event.counter));
  assert.deepEqual(fragile.advance(100),[]);
  const battle=createBattle({heroWeapon:'sword',heroDamage:8.75,heroMaxHp:1000});
  const events=battle.advance(17);
  assert.ok(events.some(event=>event.type==='block'&&event.at===14.4));
  assert.ok(events.some(event=>event.type==='death'&&event.id==='orc'&&event.at===15.45));
  assert.ok(!events.some(event=>event.counter&&event.targetId==='orc'&&event.at>=15.45));
});

test('sword terminal state pays once and its block/counter timeline is independent of advance chunk size', () => {
  const whole=createBattle({heroWeapon:'sword'}),small=createBattle({heroWeapon:'sword'}),irregular=createBattle({heroWeapon:'sword'});
  const expected=whole.advance(100), smallEvents=[], irregularEvents=[];
  for(let i=0;i<1000;i++){smallEvents.push(...small.advance(.1));irregularEvents.push(...irregular.advance(.037),...irregular.advance(.063));}
  assert.deepEqual(smallEvents,expected);assert.deepEqual(irregularEvents,expected);
  assert.deepEqual(small.state,whole.state);assert.deepEqual(irregular.state,whole.state);
  assert.equal(whole.state.phase,'victory'); assert.equal(whole.state.reward,25);
  assert.equal(expected.filter(event=>event.type==='end').length,1);
  const finished=whole.state;whole.pause();whole.resume();
  assert.deepEqual(whole.advance(100),[]); assert.deepEqual(whole.state,finished);
});

test('unarmed and ranged weapons keep the old timeline and never gain shield or sword combo metadata', () => {
  const reference=createBattle();reference.advance(100);
  for(const options of [{},{heroWeapon:'bow',heroProjectile:'arrow'},{heroWeapon:'wand',heroProjectile:'magic'},{heroWeapon:'sword',heroProjectile:'arrow'}]){
    const battle=createBattle(options),events=battle.advance(100);
    assert.deepEqual(battle.state,reference.state);
    assert.ok(!events.some(event=>event.type==='block'||event.counter||event.variant||event.heavy));
    assert.equal(events.find(event=>event.sourceId==='hero').at,1.2);
  }
});

test('sword hero keeps first priority on a tied heavy strike and cancels the dead enemy attack', () => {
  const battle=createBattle({heroWeapon:'sword',heroDamage:16});
  const events=battle.advance(7.2);
  const tied=events.filter(event=>event.at===7.2);
  assert.equal(tied[0].type,'attack');assert.equal(tied[0].sourceId,'hero');assert.equal(tied[0].variant,'backslash');
  assert.ok(tied.some(event=>event.type==='death'&&event.id==='orc'));
  assert.ok(!tied.some(event=>event.sourceId==='orc'&&event.type==='attack'));
});

test('long-lived sword reservations across heavy animations also preserve chunk invariance', () => {
  const options={heroWeapon:'sword',heroDamage:1,heroMaxHp:10000};
  const whole=createBattle(options),stepped=createBattle(options),irregular=createBattle(options);
  const expected=whole.advance(40), smallEvents=[], irregularEvents=[];
  for(let i=0;i<400;i++){smallEvents.push(...stepped.advance(.1));irregularEvents.push(...irregular.advance(.037),...irregular.advance(.063));}
  assert.deepEqual(smallEvents,expected);assert.deepEqual(irregularEvents,expected);
  assert.deepEqual(stepped.state,whole.state);assert.deepEqual(irregular.state,whole.state);
  assert.deepEqual(stepped.advance(2),whole.advance(2), 'pending counter reservations remain the same beyond the compared interval');
});

test('ranged enemies shoot while hero and orc are out of melee range, without banking melee attacks', () => {
  const battle=createBattle();
  const approach=battle.advance(4,{heroCanAttack:false,orcCanAttack:false});
  assert.deepEqual(approach.filter(event=>event.type==='attack').map(event=>[event.sourceId,event.at]),[['archer',3.1],['mage',3.8]]);
  assert.equal(battle.state.phase,'running');assert.equal(battle.state.elapsed,4);
  assert.equal(battle.state.hero.hp,183);assert.equal(battle.state.enemies[0].hp,100);
  assert.deepEqual(battle.advance(1.19),[],'remaining melee cooldowns start from contact rather than firing a backlog');
  const first=battle.advance(.01);
  assert.deepEqual(first.map(event=>[event.sourceId,event.at]),[['hero',5.2]]);
  const next=battle.advance(1.2).filter(event=>event.type==='attack');
  assert.deepEqual(next.filter(event=>event.at===6.4).map(event=>event.sourceId),['hero','orc']);
});

test('range gates freeze only the selected actor and retain partially spent cooldowns and ties', () => {
  const battle=createBattle();battle.advance(1.7);
  const held=battle.advance(2,{heroCanAttack:false,orcCanAttack:false});
  assert.deepEqual(held.filter(event=>event.type==='attack').map(event=>[event.sourceId,event.at]),[['archer',3.1]]);
  const released=battle.advance(.7);
  assert.deepEqual(released.filter(event=>event.at===4.4).map(event=>event.sourceId),['hero','orc']);
  const heroOnly=createBattle();
  const events=heroOnly.advance(4,{orcCanAttack:false});
  assert.deepEqual(events.filter(event=>event.sourceId==='hero').map(event=>event.at),[1.2,2.4,3.6]);
  assert.ok(!events.some(event=>event.sourceId==='orc'));
  assert.equal(heroOnly.state.hero.hp,183);
  assert.equal(heroOnly.state.enemies[0].hp,73);
});

test('range gating holds existing sword counters and counters created during the same gated advance', () => {
  const existing=createBattle({heroWeapon:'sword',heroMaxHp:1000});existing.advance(4.9);
  const approach=existing.advance(2,{heroCanAttack:false,orcCanAttack:false});
  assert.ok(!approach.some(event=>event.sourceId==='hero'||event.sourceId==='orc'));
  const resumed=existing.advance(.31);
  assert.deepEqual(resumed.filter(event=>event.counter).map(event=>[event.targetId,event.at]),[['orc',7.21]]);
  const created=createBattle({heroWeapon:'sword',heroMaxHp:1000});
  const held=created.advance(5,{heroCanAttack:false});
  assert.ok(held.some(event=>event.type==='block'&&event.at===4.8));
  assert.ok(!held.some(event=>event.sourceId==='hero'));
  const moreHeld=created.advance(1,{heroCanAttack:false,orcCanAttack:false});
  assert.ok(!moreHeld.some(event=>event.counter));
  const counter=created.advance(.3).find(event=>event.counter);
  assert.ok(counter,'a newly queued held counter resumes instead of being lost or firing out of range');
  assert.equal(counter.at,6.3);assert.equal(counter.targetId,'orc');
});

test('real pause still freezes the entire encounter and restart clears all gated cooldown shifts', () => {
  const battle=createBattle();battle.advance(4,{heroCanAttack:false,orcCanAttack:false});
  const paused=battle.pause();assert.deepEqual(battle.advance(100,{heroCanAttack:true}),[]);assert.deepEqual(battle.state,paused);
  battle.resume();const first=battle.advance(1.2).find(event=>event.sourceId==='hero');
  assert.equal(first.at,5.2);
  battle.restart();
  assert.equal(battle.state.elapsed,0);assert.equal(battle.state.hero.hp,200);
  const original=battle.advance(1.2);assert.equal(original[0].sourceId,'hero');assert.equal(original[0].at,1.2);
});

test('ranged damage can end the fight during approach and no gated attacker acts after terminal death', () => {
  const battle=createBattle({heroMaxHp:5});
  const events=battle.advance(20,{heroCanAttack:false,orcCanAttack:false});
  assert.equal(battle.state.phase,'defeat');assert.equal(battle.state.elapsed,3.1);assert.equal(battle.state.hero.hp,0);
  assert.deepEqual(events.filter(event=>event.type==='attack').map(event=>event.sourceId),['archer']);
  assert.equal(events.at(-1).type,'end');assert.deepEqual(battle.advance(100),[]);
});

test('changing range availability is invariant to frame chunk size, including held sword counter reservations', () => {
  const schedule=[
    [.7,{heroCanAttack:false,orcCanAttack:false}],
    [4.4,{heroCanAttack:false,orcCanAttack:true}],
    [.11,{heroCanAttack:true,orcCanAttack:false}],
    [.6,{heroCanAttack:true,orcCanAttack:true}],
    [3.17,{heroCanAttack:false,orcCanAttack:false}],
    [1.09,{heroCanAttack:true,orcCanAttack:false}],
    [4.33,{heroCanAttack:false,orcCanAttack:true}],
    [40,{heroCanAttack:true,orcCanAttack:true}]
  ];
  function run(options,pattern){
    const battle=createBattle(options),events=[];let index=0;
    for(const [seconds,gates] of schedule){
      if(!pattern){events.push(...battle.advance(seconds,gates));continue;}
      let remaining=Math.round(seconds*1000000);
      while(remaining>0){const ticks=Math.min(remaining,pattern[index++%pattern.length]);events.push(...battle.advance(ticks/1000000,gates));remaining-=ticks;}
    }
    return {battle,events};
  }
  for(const options of [{heroMaxHp:1000},{heroWeapon:'sword',heroDamage:8.75,heroMaxHp:1000}]){
    const whole=run(options),small=run(options,[100000]),irregular=run(options,[37000,63000]);
    assert.deepEqual(small.events,whole.events);assert.deepEqual(irregular.events,whole.events);
    assert.deepEqual(small.battle.state,whole.battle.state);assert.deepEqual(irregular.battle.state,whole.battle.state);
    assert.deepEqual(small.battle.advance(2),whole.battle.advance(2));
  }
});

test('range availability defaults remain compatible and only explicit false disables an actor', () => {
  const expected=createBattle().advance(6);
  for(const availability of [undefined,null,{}, {heroCanAttack:true,orcCanAttack:true},{heroCanAttack:0,orcCanAttack:'false'}]){
    const battle=createBattle();assert.deepEqual(battle.advance(6,availability),expected);
  }
});
