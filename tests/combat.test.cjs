'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createBattle:createDefaultBattle,intermissionDuration} = require('../dist/combat.js');

// Focused mechanic regressions retain the original three-enemy party as a
// test-local encounter fixture, retaining its original archer cadence. Production default-wave behavior is tested below.
const focusedEncounter = [{id:'orc',type:'orc'},{id:'archer',type:'archer'},{id:'mage',type:'mage'}];
function encounterFixture(waves,{slowFlight=false,legacyArcher=true,closeInterval}={}) {
  const fs=require('node:fs'),vm=require('node:vm');
  let source=fs.readFileSync(require.resolve('../dist/combat.js'),'utf8');
  const declaration=/  const waveTemplates = \[\n[\s\S]*?\n  \];/;
  assert.ok(declaration.test(source));
  source=source.replace(declaration,'  const waveTemplates = '+JSON.stringify(waves)+';');
  if(legacyArcher){const anchor="archer:{name:'Скелет-лучник',maxHp:60,damage:7,interval:1.8,armor:0,projectile:'arrow'}";assert.ok(source.includes(anchor));source=source.replace(anchor,anchor.replace('interval:1.8','interval:3.1'));}
  if(slowFlight){const anchor='flightDuration:.48';assert.ok(source.includes(anchor));source=source.replace(anchor,'flightDuration:2.4');}
  if(closeInterval!==undefined){const anchor='const CLOSE_MAGIC_INTERVAL = .8 * TICKS;';assert.ok(source.includes(anchor));source=source.replace(anchor,'const CLOSE_MAGIC_INTERVAL = '+closeInterval+' * TICKS;');}
  const context={module:{exports:{}}};vm.runInNewContext(source,context,{filename:'combat-encounter-fixture.js'});
  const create=context.module.exports.createBattle;
  // Return ordinary host objects so assertions compare data, not VM prototypes.
  return options=>{
    const battle=create(options),snapshot=()=>JSON.parse(JSON.stringify(battle.getState()));
    return {getState:snapshot,get state(){return snapshot();},advance:(...args)=>JSON.parse(JSON.stringify(battle.advance(...args))),pause:()=>JSON.parse(JSON.stringify(battle.pause())),resume:()=>JSON.parse(JSON.stringify(battle.resume())),restart:()=>JSON.parse(JSON.stringify(battle.restart())),updateHeroStats:stats=>JSON.parse(JSON.stringify(battle.updateHeroStats(stats)))};
  };
}
const createBattle=encounterFixture([focusedEncounter]);

test('read-only bow schedule exposes exact hit ticks without changing damage or attack cadence',()=>{
 const bow=createDefaultBattle({heroProjectile:'arrow',heroWeapon:'bow'});
 const initial=bow.getArrowSchedule();
 assert.deepEqual(initial.map(e=>[e.sourceId,e.targetId,e.at,e.animationDuration]),
   [['hero','archer1',1.2,.9],['archer1','hero',1.8,.6]]);
 assert.equal(bow.state.elapsed,0,'reading future bow shots cannot advance combat');
 assert.equal(bow.advance(1.2).filter(e=>e.type==='attack'&&e.sourceId==='hero')[0].at,1.2);
 assert.equal(bow.state.enemies[0].hp,48);
 assert.deepEqual(bow.getArrowSchedule().map(e=>[e.sourceId,e.at]),
   [['hero',2.4],['archer1',1.8]]);
 bow.advance(.6);
 assert.equal(bow.state.hero.hp,193);
 assert.deepEqual(bow.getArrowSchedule().map(e=>[e.sourceId,e.at]),
   [['hero',2.4],['archer1',3.6]]);
 bow.pause();assert.equal(bow.getArrowSchedule()[0].at,2.4);
 bow.restart();assert.equal(bow.getArrowSchedule()[0].at,1.2);
});
test('focused unarmed encounter retains its timing and grants five gold per kill with no terminal bonus', () => {
  const battle = createBattle();
  const events = battle.advance(100);
  const state = battle.getState();
  assert.equal(state.phase, 'victory');
  assert.ok(state.elapsed >= 25 && state.elapsed <= 35);
  assert.ok(state.hero.hp / state.hero.maxHp >= .25 && state.hero.hp / state.hero.maxHp <= .35);
  assert.equal(state.defeatedCount, 3);
  assert.equal(state.targetId, null);
  assert.equal(state.reward, 15);
  assert.deepEqual(events.filter(event => event.type === 'end'), [{type:'end', result:'victory', reward:0,totalReward:15,at:state.elapsed}]);
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


test('starter weapons keep their projectile and reward, with magic damage delayed until impact',()=>{
 for(const projectile of ['arrow','magic','melee']){const b=createBattle({heroProjectile:projectile});const events=b.advance(100);assert.ok(events.filter(e=>e.sourceId==='hero'&&['attack','cast'].includes(e.type)&&!e.dot).every(e=>e.projectile===projectile));assert.equal(b.state.hero.hp,projectile==='magic'?68:58);assert.equal(b.state.elapsed,projectile==='magic'?24.9:27.6);assert.equal(b.state.phase,'victory');assert.equal(b.state.reward,15);}
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
  assert.equal(whole.state.phase,'victory'); assert.equal(whole.state.reward,15);
  assert.equal(expected.filter(event=>event.type==='end').length,1);
  const finished=whole.state;whole.pause();whole.resume();
  assert.deepEqual(whole.advance(100),[]); assert.deepEqual(whole.state,finished);
});

test('unarmed and non-magic ranged weapons keep the old timeline and never gain shield or sword combo metadata', () => {
  const reference=createBattle();reference.advance(100);
  for(const options of [{},{heroWeapon:'bow',heroProjectile:'arrow'},{heroWeapon:'wand',heroProjectile:'magic'},{heroWeapon:'sword',heroProjectile:'arrow'}]){
    const battle=createBattle(options),events=battle.advance(100);
    if(options.heroProjectile==='magic'){assert.equal(battle.state.phase,'victory');assert.equal(battle.state.elapsed,24.9);assert.equal(battle.state.hero.hp,68);}else assert.deepEqual(battle.state,reference.state);
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
  assert.deepEqual(approach.filter(event=>event.type==='attack').map(event=>[event.sourceId,event.at]),[['archer',3.1]]);
  assert.ok(approach.some(event=>event.type==='cast'&&event.sourceId==='mage'&&event.at===3.8&&event.impactAt===4.7));
  assert.equal(battle.state.phase,'running');assert.equal(battle.state.elapsed,4);
  assert.equal(battle.state.hero.hp,193);assert.equal(battle.state.enemies[0].hp,100);
  const travelling=battle.advance(1.19);
  assert.ok(!travelling.some(event=>event.sourceId==='hero'||event.sourceId==='orc'),'remaining melee cooldowns start from contact rather than firing a backlog');
  assert.ok(travelling.some(event=>event.type==='attack'&&event.sourceId==='mage'&&event.at===4.7));
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
  assert.equal(heroOnly.state.hero.hp,193,'the shadow spell is still travelling at four seconds');
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

test('hero fire and ice cast through appear and flight before applying one matching impact', () => {
  for (const magic of ['fire','ice']) {
    const battle=createBattle({heroProjectile:'magic',heroMagic:magic});
    const launch=battle.advance(1.2);
    const cast=launch.find(event=>event.type==='cast'&&event.sourceId==='hero');
    assert.ok(cast);assert.equal(cast.magic,magic);assert.equal(cast.targetId,'orc');
    assert.deepEqual([cast.at,cast.appearDuration,cast.flightDuration,cast.impactDuration,cast.impactAt],[1.2,.42,.48,.42,2.1]);
    assert.equal(battle.state.enemies[0].hp,100,'launch has no damage');
    assert.deepEqual(battle.advance(.899999),[]);assert.equal(battle.state.enemies[0].hp,100);
    const impact=battle.advance(.000001).find(event=>event.type==='attack');
    assert.ok(impact);assert.equal(impact.at,2.1);assert.equal(impact.hp,91);assert.equal(impact.magic,magic);assert.equal(impact.impact,true);
    assert.equal(impact.castAt,cast.at);assert.equal(impact.castId,cast.castId);assert.equal(impact.projectile,'magic');
    assert.equal(battle.state.enemies[0].hp,91);
  }
});

test('NPC mage always launches shadow and cannot damage before its impact phase', () => {
  const battle=createBattle({heroMagic:'ice'});
  const launch=battle.advance(3.8), cast=launch.find(event=>event.type==='cast'&&event.sourceId==='mage');
  assert.ok(cast);assert.equal(cast.magic,'shadow');assert.equal(cast.at,3.8);assert.equal(cast.impactAt,4.7);
  assert.equal(battle.state.hero.hp,187,'only the orc and archer have damaged the hero');
  assert.ok(!launch.some(event=>event.type==='attack'&&event.sourceId==='mage'));
  assert.deepEqual(battle.advance(.899999),[]);assert.equal(battle.state.hero.hp,187);
  const impact=battle.advance(.000001).find(event=>event.type==='attack');
  assert.equal(impact.sourceId,'mage');assert.equal(impact.magic,'shadow');assert.equal(impact.impact,true);assert.equal(impact.at,4.7);assert.equal(impact.hp,177);
});

test('player magic accepts only fire or ice and uses immutable shared timing values', () => {
  const {magicTiming}=require('../dist/combat.js');
  assert.deepEqual(magicTiming,{appearDuration:.42,flightDuration:.48,impactDuration:.42});
  assert.ok(Object.isFrozen(magicTiming));
  for(const invalid of [undefined,'shadow','arcane','../fire',null]){
    const battle=createBattle({heroProjectile:'magic',heroMagic:invalid});
    const cast=battle.advance(1.2).find(event=>event.type==='cast');assert.equal(cast.magic,'fire');
  }
});

test('in-flight magic advances independently of range readiness, while real pause and restart freeze or clear it', () => {
  const battle=createBattle({heroProjectile:'magic',heroMagic:'ice'});
  battle.advance(1.2);const paused=battle.pause();
  assert.deepEqual(battle.advance(100,{heroCanAttack:true}),[]);assert.deepEqual(battle.state,paused);
  battle.resume();
  const impact=battle.advance(.9,{heroCanAttack:false,orcCanAttack:false}).find(event=>event.type==='attack');
  assert.equal(impact.at,2.1);assert.equal(impact.magic,'ice');assert.equal(battle.state.enemies[0].hp,91);
  const restarted=createBattle({heroProjectile:'magic',heroMagic:'fire'});restarted.advance(1.2);restarted.restart();
  assert.deepEqual(restarted.advance(.9),[]);assert.equal(restarted.state.enemies[0].hp,100);
  const fresh=restarted.advance(.3);assert.equal(fresh.filter(event=>event.type==='cast').length,1);
  const freshImpact=restarted.advance(.9).filter(event=>event.type==='attack');assert.equal(freshImpact.length,1);assert.equal(freshImpact[0].at,2.1);
});

// Test-only encounter fixtures vary data, not combat logic or application API.
// The shipped encounter targets its only mage last, and .9 s flight is shorter
// than hero cadence, so two general queue branches are otherwise unreachable.
function magicEncounterFixture({mageFirst=false,slowFlight=false}={}) {
  const units=focusedEncounter.map(unit=>({...unit}));
  if(mageFirst)units.sort((a,b)=>Number(b.type==='mage')-Number(a.type==='mage'));
  return encounterFixture([units],{slowFlight});
}

test('a shadow already launched still impacts after the mage dies while other enemies remain alive', () => {
  const createFixture=magicEncounterFixture({mageFirst:true});
  const battle=createFixture({heroWeapon:'sword',heroDamage:15});
  const events=JSON.parse(JSON.stringify(battle.advance(4.7)));
  const cast=events.find(event=>event.type==='cast'&&event.sourceId==='mage');
  const death=events.find(event=>event.type==='death'&&event.id==='mage');
  const impact=events.find(event=>event.type==='attack'&&event.sourceId==='mage'&&event.impact);
  assert.equal(cast.at,3.8);assert.equal(death.at,4.65);assert.equal(impact.at,4.7);assert.equal(impact.magic,'shadow');
  assert.equal(impact.castId,cast.castId);assert.equal(battle.state.phase,'running');
  assert.ok(battle.state.enemies.some(enemy=>enemy.id!=='mage'&&enemy.hp>0));
});

test('multiple queued spells aimed at a dead target are discarded without duplicate deaths or rewards', () => {
  const createFixture=magicEncounterFixture({slowFlight:true});
  const battle=createFixture({heroProjectile:'magic',heroMagic:'fire',heroDamage:200});
  const events=JSON.parse(JSON.stringify(battle.advance(100)));
  assert.ok(events.filter(event=>event.type==='cast'&&event.sourceId==='hero'&&event.targetId==='orc').length>=3);
  assert.equal(events.filter(event=>event.type==='attack'&&event.sourceId==='hero'&&event.targetId==='orc').length,1);
  assert.equal(events.filter(event=>event.type==='death'&&event.id==='orc').length,1);
  assert.equal(events.filter(event=>event.type==='end').length,1);assert.equal(battle.state.reward,15);
  assert.deepEqual(JSON.parse(JSON.stringify(battle.advance(100))),[]);
});

test('terminal victory and defeat clear outstanding spells before they can apply late damage', () => {
  const victory=createBattle({heroWeapon:'sword',heroDamage:70});
  const won=victory.advance(100), shadow=won.find(event=>event.type==='cast'&&event.sourceId==='mage');
  assert.ok(shadow);assert.equal(shadow.impactAt,4.7);assert.equal(victory.state.elapsed,4.65);assert.equal(victory.state.phase,'victory');
  assert.ok(!won.some(event=>event.type==='attack'&&event.castId===shadow.castId));
  assert.deepEqual(victory.advance(100),[]);assert.equal(victory.state.reward,15);
  const defeat=createBattle({heroProjectile:'magic',heroDamage:500,heroMaxHp:1});
  const lost=defeat.advance(100), late=lost.find(event=>event.type==='cast'&&event.sourceId==='hero'&&event.targetId==='archer');
  assert.ok(late);assert.equal(late.impactAt,3.3);assert.equal(defeat.state.elapsed,3.1);assert.equal(defeat.state.phase,'defeat');
  assert.ok(!lost.some(event=>event.type==='attack'&&event.castId===late.castId));assert.deepEqual(defeat.advance(100),[]);
});

test('simultaneous magic impacts retain hero priority and launch cadence stays independent of flight', () => {
  const battle=createBattle({heroProjectile:'magic',heroMagic:'ice',heroDamage:1,heroMaxHp:10000});
  const events=battle.advance(23.7);
  const heroCasts=events.filter(event=>event.type==='cast'&&event.sourceId==='hero');
  assert.deepEqual(heroCasts.slice(0,4).map(event=>event.at),[1.2,2.4,3.6,4.8]);
  assert.deepEqual(events.filter(event=>event.type==='attack'&&event.impact&&event.at===23.7).map(event=>event.sourceId),['hero','mage']);
});

test('magic launch, impact and range-gated flight queues are invariant to elapsed chunk size', () => {
  const schedule=[
    [1.2,{heroCanAttack:true,orcCanAttack:false}],
    [2.83,{heroCanAttack:false,orcCanAttack:false}],
    [4.57,{heroCanAttack:true,orcCanAttack:true}],
    [.73,{heroCanAttack:false,orcCanAttack:true}],
    [100,{}]
  ];
  function run(magic,pattern){
    const battle=createBattle({heroProjectile:'magic',heroMagic:magic,heroMaxHp:1000}),events=[];let index=0;
    for(const [seconds,gates] of schedule){
      if(!pattern){events.push(...battle.advance(seconds,gates));continue;}
      let remaining=Math.round(seconds*1000000);
      while(remaining>0){const ticks=Math.min(remaining,pattern[index++%pattern.length]);events.push(...battle.advance(ticks/1000000,gates));remaining-=ticks;}
    }
    return {battle,events};
  }
  for(const magic of ['fire','ice']){
    const whole=run(magic),small=run(magic,[100000]),irregular=run(magic,[37000,63000]);
    assert.deepEqual(small.events,whole.events);assert.deepEqual(irregular.events,whole.events);
    assert.deepEqual(small.battle.state,whole.battle.state);assert.deepEqual(irregular.battle.state,whole.battle.state);
    assert.equal(whole.battle.state.phase,'victory');
  }
});

test('default encounter exposes only one wave at a time: one archer, two archers, then one orc', () => {
  assert.equal(intermissionDuration,1.4);
  const battle=createDefaultBattle();
  assert.deepEqual(battle.state.enemies.map(enemy=>[enemy.id,enemy.type,enemy.hp]),[['archer1','archer',60]]);
  assert.deepEqual([battle.state.waveIndex,battle.state.waveNumber,battle.state.waveCount,battle.state.completedWaves,battle.state.totalEnemies],[0,1,3,0,4]);
  const first=battle.advance(6);
  assert.equal(battle.state.phase,'intermission');assert.equal(battle.state.reward,5);assert.equal(battle.state.defeatedCount,1);
  assert.equal(battle.state.intermissionRemaining,intermissionDuration);
  assert.deepEqual(battle.state.enemies.map(enemy=>enemy.id),['archer1']);assert.equal(battle.state.targetId,null);
  assert.ok(first.some(event=>event.type==='wave_clear'&&event.waveNumber===1&&event.at===6));
  assert.deepEqual(battle.advance(1.399999),[]);assert.equal(battle.state.waveNumber,1);
  const spawned=battle.advance(.000001).find(event=>event.type==='wave');
  assert.ok(spawned);assert.equal(spawned.at,7.4);assert.equal(spawned.waveNumber,2);
  assert.deepEqual(spawned.enemies.map(enemy=>[enemy.id,enemy.type]),[['archer2','archer'],['archer3','archer']]);
  assert.equal(battle.state.hero.hp,179,'hero health carries across the boundary');
  spawned.enemies[0].hp=-999;assert.equal(battle.state.enemies[0].hp,60,'wave event snapshots do not expose engine state');
  const rest=battle.advance(100), third=rest.find(event=>event.type==='wave'&&event.waveNumber===3);
  assert.deepEqual(third.enemies.map(enemy=>[enemy.id,enemy.type]),[['orc','orc']]);
  assert.equal(battle.state.phase,'victory');assert.equal(battle.state.completedWaves,3);assert.equal(battle.state.totalDefeated,4);
  assert.deepEqual(battle.state.enemies.map(enemy=>enemy.id),['orc']);
});

test('default four kills grant exactly twenty gold immediately and terminal victory grants no extra bonus', () => {
  const battle=createDefaultBattle(),events=battle.advance(100);
  const deaths=events.filter(event=>event.type==='death'&&event.id!=='hero');
  assert.deepEqual(deaths.map(event=>[event.id,event.reward,event.totalReward]),[['archer1',5,5],['archer2',5,10],['archer3',5,15],['orc',5,20]]);
  assert.equal(new Set(deaths.map(event=>event.id)).size,4);
  assert.deepEqual(events.filter(event=>event.type==='wave_clear').map(event=>event.waveNumber),[1,2,3]);
  const end=events.filter(event=>event.type==='end');assert.equal(end.length,1);assert.equal(end[0].reward,0);assert.equal(end[0].totalReward,20);
  assert.equal(battle.state.reward,20);assert.equal(battle.state.defeatedCount,4);assert.equal(battle.state.totalEnemies,4);
  const final=battle.state;assert.deepEqual(battle.advance(100),[]);battle.pause();battle.resume();assert.deepEqual(battle.state,final);
});

test('kill rewards survive defeat even when the next wave has only been partly defeated', () => {
  for(const [maxHp,expectedReward,expectedKills] of [[29,5,1],[64,10,2]]){
    const battle=createDefaultBattle({heroMaxHp:maxHp}),events=battle.advance(100);
    assert.equal(battle.state.phase,'defeat');assert.equal(battle.state.hero.hp,0);
    assert.equal(battle.state.reward,expectedReward);assert.equal(battle.state.totalDefeated,expectedKills);assert.equal(battle.state.waveNumber,2);
    const paid=events.filter(event=>event.type==='death'&&event.reward>0);
    assert.equal(paid.length,expectedKills);assert.ok(paid.every(event=>event.reward===5));
    const heroDeath=events.find(event=>event.type==='death'&&event.id==='hero');assert.equal(heroDeath.reward,0);assert.equal(heroDeath.totalReward,expectedReward);
    assert.deepEqual(events.at(-1),{type:'end',result:'defeat',reward:0,totalReward:expectedReward,at:battle.state.elapsed});
    assert.deepEqual(battle.advance(100),[]);
    const reset=battle.restart();assert.equal(reset.hero.hp,maxHp);assert.equal(reset.reward,0);assert.equal(reset.waveNumber,1);assert.equal(reset.totalDefeated,0);
  }
});

test('pause and resume preserve an exact intermission remainder and no actors attack during its 1.4 seconds', () => {
  const battle=createDefaultBattle();battle.advance(6.2);
  assert.equal(battle.state.phase,'intermission');assert.equal(battle.state.intermissionRemaining,1.2);
  const paused=battle.pause();assert.equal(paused.phase,'paused');assert.equal(paused.intermissionRemaining,1.2);
  assert.deepEqual(battle.advance(50),[]);assert.deepEqual(battle.state,paused);
  assert.equal(battle.resume().phase,'intermission');
  assert.deepEqual(battle.advance(1.199999),[]);assert.equal(battle.state.waveNumber,1);
  assert.equal(battle.state.intermissionRemaining,.000001);
  const events=battle.advance(.000001);assert.equal(events.length,1);assert.equal(events[0].type,'wave');assert.equal(events[0].at,7.4);
  assert.equal(battle.state.hero.hp,179);assert.equal(battle.state.phase,'running');
});

test('new wave timers and sword combo reset at spawn while hero health and earned gold carry over', () => {
  const battle=createDefaultBattle({heroWeapon:'sword'}),events=battle.advance(100);
  const spawns=[{at:0,waveNumber:1},...events.filter(event=>event.type==='wave')];
  for(const spawn of spawns){
    const nextSpawn=spawns.find(other=>other.waveNumber===spawn.waveNumber+1);
    const first=events.find(event=>event.type==='attack'&&event.sourceId==='hero'&&!event.counter&&event.at>spawn.at&&(!nextSpawn||event.at<nextSpawn.at));
    assert.ok(first);assert.equal(Math.round((first.at-spawn.at)*1000000),1050000);assert.equal(first.variant,'halfslash');assert.equal(first.comboStep,1);
  }
  const orcSpawn=spawns.find(event=>event.waveNumber===3);
  const orcHits=events.filter(event=>event.type==='attack'&&event.sourceId==='orc');
  assert.equal(Math.round((orcHits[0].at-orcSpawn.at)*1000000),2400000);assert.equal(orcHits[0].damage,6);
  assert.equal(orcHits[1].damage,3);assert.equal(events.filter(event=>event.type==='block')[0].at,orcHits[1].at);
  assert.equal(battle.state.reward,20);assert.equal(battle.state.hero.hp,105);
});

test('wave boundaries clear old magic flights instead of applying damage to the next wave', () => {
  const createFixture=encounterFixture([focusedEncounter,[{id:'nextArcher',type:'archer'}]]);
  const battle=createFixture({heroWeapon:'sword',heroDamage:70});
  const cleared=battle.advance(4.65),spell=cleared.find(event=>event.type==='cast'&&event.sourceId==='mage');
  assert.ok(spell);assert.equal(spell.impactAt,4.7);assert.equal(battle.state.phase,'intermission');assert.equal(battle.state.reward,15);
  const hp=battle.state.hero.hp;
  const transition=battle.advance(1.4);assert.equal(battle.state.hero.hp,hp);assert.deepEqual(transition.map(event=>event.type),['wave']);
  assert.equal(transition[0].at,6.05);assert.deepEqual(battle.state.enemies.map(enemy=>enemy.id),['nextArcher']);
  const tail=battle.advance(100);assert.ok(!tail.some(event=>event.castId===spell.castId));
  assert.equal(battle.state.phase,'victory');assert.equal(battle.state.reward,20);assert.equal(battle.state.hero.hp,hp);
});

test('wave boundaries discard queued sword counters and old regular cadence before resetting the next combo', () => {
  const createFixture=encounterFixture([[{id:'orc',type:'orc'}],[{id:'nextArcher',type:'archer'}]]);
  const battle=createFixture({heroWeapon:'sword',heroDamage:8.75,heroMaxHp:1000});
  const events=battle.advance(17.9);
  assert.ok(events.some(event=>event.type==='block'&&event.at===14.4));
  assert.ok(events.some(event=>event.type==='wave_clear'&&event.at===15.45));
  const spawn=events.find(event=>event.type==='wave');assert.equal(spawn.at,16.85);
  assert.ok(!events.some(event=>event.counter&&event.at>=15.45));
  const next=events.find(event=>event.type==='attack'&&event.sourceId==='hero'&&event.at>15.45);
  assert.equal(next.at,17.9);assert.equal(next.targetId,'nextArcher');assert.equal(next.comboStep,1);assert.equal(next.variant,'halfslash');
});

test('archers keep firing during an approach and range gates do not stall an intermission spawn', () => {
  const battle=createDefaultBattle();
  const approach=battle.advance(4,{heroCanAttack:false,orcCanAttack:false});
  assert.deepEqual(approach.filter(event=>event.type==='attack').map(event=>[event.sourceId,event.at]),[['archer1',1.8],['archer1',3.6]]);
  assert.equal(battle.state.hero.hp,186);assert.equal(battle.state.enemies[0].hp,60);assert.equal(battle.state.elapsed,4);
  assert.equal(battle.advance(1.2)[0].at,5.2);
  const separate=createDefaultBattle();separate.advance(6);
  const spawn=separate.advance(1.4,{heroCanAttack:false,orcCanAttack:false});assert.equal(spawn[0].type,'wave');assert.equal(spawn[0].at,7.4);
  assert.equal(separate.advance(1.2)[0].at,8.6);
});

test('default waves, per-kill rewards and intermissions are invariant to large, fixed and irregular advances', () => {
  const schedule=[[2.13,{heroCanAttack:false,orcCanAttack:false}],[3.17,{}],[1.37,{heroCanAttack:false}],[100,{}]];
  function run(options,pattern){
    const battle=createDefaultBattle({...options,heroMaxHp:1000}),events=[];let index=0;
    for(const [seconds,gates] of schedule){
      if(!pattern){events.push(...battle.advance(seconds,gates));continue;}
      let remaining=Math.round(seconds*1000000);
      while(remaining>0){const ticks=Math.min(remaining,pattern[index++%pattern.length]);events.push(...battle.advance(ticks/1000000,gates));remaining-=ticks;}
    }
    return {battle,events};
  }
  for(const options of [{},{heroWeapon:'sword'},{heroProjectile:'magic',heroMagic:'ice'}]){
    const whole=run(options),small=run(options,[100000]),irregular=run(options,[37000,63000]);
    assert.deepEqual(small.events,whole.events);assert.deepEqual(irregular.events,whole.events);
    assert.deepEqual(small.battle.state,whole.battle.state);assert.deepEqual(irregular.battle.state,whole.battle.state);
    assert.equal(whole.battle.state.phase,'victory');assert.equal(whole.battle.state.reward,20);assert.equal(whole.battle.state.completedWaves,3);
    assert.equal(whole.events.filter(event=>event.type==='death'&&event.reward===5).length,4);
  }
});

test('default restart restores only wave one and clears previous wave, health, reward and projectile state', () => {
  const battle=createDefaultBattle({heroProjectile:'magic',heroMagic:'ice'});
  const initial=battle.state;battle.advance(100);assert.equal(battle.state.phase,'victory');
  assert.deepEqual(battle.restart(),initial);
  const fresh=battle.advance(1.2);assert.equal(fresh.length,1);assert.equal(fresh[0].type,'cast');assert.equal(fresh[0].magic,'ice');assert.equal(fresh[0].targetId,'archer1');
  assert.equal(battle.state.reward,0);assert.equal(battle.state.completedWaves,0);
});

test('production skeletons fire every 1.8 seconds with a 0.6-second attack pose and unchanged damage', () => {
  const battle=createDefaultBattle({heroDamage:1,heroMaxHp:1000});
  const events=battle.advance(5.4);
  const shots=events.filter(event=>event.type==='attack'&&event.sourceId==='archer1');
  assert.deepEqual(shots.map(event=>[event.at,event.damage,event.projectile,event.animationDuration]),[[1.8,7,'arrow',.6],[3.6,7,'arrow',.6],[5.4,7,'arrow',.6]]);
  assert.equal(battle.state.enemies[0].interval,1.8);assert.equal(battle.state.hero.hp,979);
  assert.ok(events.filter(event=>event.type==='attack'&&event.sourceId==='hero').every(event=>event.animationDuration===.66),'player basic pose does not inherit NPC skeleton speed');
});

test('close-range fire and ice use the same faster launch, flight and cast cadence', () => {
  const {closeMagicTiming}=require('../dist/combat.js');
  assert.deepEqual(closeMagicTiming,{appearDuration:.18,flightDuration:.12,impactDuration:.42});assert.ok(Object.isFrozen(closeMagicTiming));
  for(const magic of ['fire','ice']){
    const options={heroProjectile:'magic',heroMagic:magic,heroDamage:1,heroMaxHp:1000};
    const near=createDefaultBattle(options),far=createDefaultBattle(options);
    const nearEvents=near.advance(4,{heroCloseRange:true}),farEvents=far.advance(4,{heroCloseRange:false});
    const casts=nearEvents.filter(event=>event.type==='cast'&&event.sourceId==='hero');
    assert.deepEqual(casts.map(event=>event.at),[1.2,2,2.8,3.6]);
    assert.ok(casts.every(event=>event.magic===magic&&event.appearDuration===.18&&event.flightDuration===.12&&event.impactDuration===.42&&event.animationDuration===.36&&event.castInterval===.8));
    assert.deepEqual(nearEvents.filter(event=>event.impact&&event.sourceId==='hero').map(event=>event.at),[1.5,2.3,3.1,3.9]);
    assert.deepEqual(farEvents.filter(event=>event.type==='cast'&&event.sourceId==='hero').map(event=>event.at),[1.2,2.4,3.6]);
    assert.ok(farEvents.filter(event=>event.type==='cast').every(event=>event.appearDuration===.42&&event.flightDuration===.48&&event.animationDuration===.66&&event.castInterval===1.2));
    assert.equal(near.state.enemies[0].hp,magic==='fire'?50:56);assert.equal(far.state.enemies[0].hp,magic==='fire'?54:58);
  }
});

test('contact changes apply at the next launch without retiming existing flights or granting an instant extra cast', () => {
  const battle=createDefaultBattle({heroProjectile:'magic',heroDamage:1,heroMaxHp:1000}),events=[];
  events.push(...battle.advance(1.2,{heroCloseRange:false}));
  const first=events.find(event=>event.type==='cast');assert.equal(first.impactAt,2.1);
  events.push(...battle.advance(.4,{heroCloseRange:true}));assert.equal(battle.state.enemies[0].hp,60);
  events.push(...battle.advance(.5,{heroCloseRange:true}));assert.equal(battle.state.enemies[0].hp,59);
  const oldImpact=events.find(event=>event.impact&&event.castId===first.castId);assert.equal(oldImpact.at,2.1);
  events.push(...battle.advance(.3,{heroCloseRange:true}));
  const close=events.find(event=>event.type==='cast'&&event.sourceId==='hero'&&event.at===2.4);assert.equal(close.impactAt,2.7);assert.equal(close.castInterval,.8);
  events.push(...battle.advance(.3,{heroCloseRange:false}));
  assert.ok(events.some(event=>event.impact&&event.castId===close.castId&&event.at===2.7));
  events.push(...battle.advance(.5,{heroCloseRange:false}));
  const distant=events.find(event=>event.type==='cast'&&event.sourceId==='hero'&&event.at===3.2);assert.equal(distant.impactAt,4.1);assert.equal(distant.castInterval,1.2);
  events.push(...battle.advance(1.2,{heroCloseRange:true}));
  assert.deepEqual(events.filter(event=>event.type==='cast'&&event.sourceId==='hero').map(event=>event.at),[1.2,2.4,3.2,4.4]);
  assert.ok(events.some(event=>event.impact&&event.castId===distant.castId&&event.at===4.1));
});

test('close-range flag never speeds up player bow, sword, basic attacks or NPC shadow magic', () => {
  for(const options of [{},{heroProjectile:'arrow'},{heroWeapon:'sword'}]){
    const near=createDefaultBattle(options),far=createDefaultBattle(options);
    assert.deepEqual(near.advance(100,{heroCloseRange:true}),far.advance(100,{heroCloseRange:false}));
    assert.deepEqual(near.state,far.state);
  }
  const fixture=createBattle({heroProjectile:'magic',heroDamage:1,heroMaxHp:10000});
  const npc=fixture.advance(4,{heroCloseRange:true}).find(event=>event.type==='cast'&&event.sourceId==='mage');
  assert.ok(npc);assert.equal(npc.magic,'shadow');assert.equal(npc.appearDuration,.42);assert.equal(npc.flightDuration,.48);assert.equal(npc.impactDuration,.42);assert.equal(npc.animationDuration,.66);assert.equal(npc.castInterval,3.8);
  for(const flag of [undefined,false,1,'true']){
    const battle=createDefaultBattle({heroProjectile:'magic',heroDamage:1,heroMaxHp:1000});
    assert.ok(battle.advance(2.4,{heroCloseRange:flag}).filter(event=>event.type==='cast').every(event=>event.castInterval===1.2),'only an actual true contact flag enables the fast mode');
  }
});

test('close magic respects readiness and real pause, while restart resets its first launch timer', () => {
  const battle=createDefaultBattle({heroProjectile:'magic',heroMagic:'ice',heroDamage:1,heroMaxHp:1000});
  const cast=battle.advance(1.2,{heroCloseRange:true}).find(event=>event.type==='cast');assert.equal(cast.impactAt,1.5);
  const paused=battle.pause();assert.deepEqual(battle.advance(50,{heroCloseRange:true}),[]);assert.deepEqual(battle.state,paused);
  battle.resume();
  const impact=battle.advance(.3,{heroCloseRange:false,heroCanAttack:false}).find(event=>event.impact);assert.equal(impact.at,1.5);assert.equal(impact.magic,'ice');
  const next=battle.advance(.8,{heroCloseRange:true}).find(event=>event.type==='cast'&&event.sourceId==='hero');assert.equal(next.at,2.3);assert.equal(next.castInterval,.8);
  battle.restart();assert.equal(battle.state.reward,0);assert.equal(battle.state.waveNumber,1);
  assert.deepEqual(battle.advance(.8,{heroCloseRange:true}),[]);
  const fresh=battle.advance(.4,{heroCloseRange:true}).find(event=>event.type==='cast');assert.equal(fresh.at,1.2);assert.equal(fresh.impactAt,1.5);
});

test('piecewise close-range magic tempo stays deterministic across frames, readiness gates and waves', () => {
  const schedule=[[1.2,{}],[.53,{heroCloseRange:true}],[1.07,{heroCloseRange:true,heroCanAttack:false}],[2.31,{heroCloseRange:true}],[.79,{heroCloseRange:false}],[100,{}]];
  function run(magic,pattern){
    const battle=createDefaultBattle({heroProjectile:'magic',heroMagic:magic,heroMaxHp:1000}),events=[];let index=0;
    for(const [seconds,gates] of schedule){
      if(!pattern){events.push(...battle.advance(seconds,gates));continue;}
      let remaining=Math.round(seconds*1000000);
      while(remaining>0){const ticks=Math.min(remaining,pattern[index++%pattern.length]);events.push(...battle.advance(ticks/1000000,gates));remaining-=ticks;}
    }
    return {battle,events};
  }
  for(const magic of ['fire','ice']){
    const whole=run(magic),small=run(magic,[100000]),irregular=run(magic,[37000,63000]);
    assert.deepEqual(small.events,whole.events);assert.deepEqual(irregular.events,whole.events);
    assert.deepEqual(small.battle.state,whole.battle.state);assert.deepEqual(irregular.battle.state,whole.battle.state);
    assert.equal(whole.battle.state.phase,'victory');assert.equal(whole.battle.state.reward,20);assert.equal(whole.battle.state.completedWaves,3);
  }
});

test('elemental statuses are applied only by a living-target hero impact, never a launch, lethal hit or NPC shadow', () => {
  const {statusTiming}=require('../dist/combat.js');
  assert.deepEqual(statusTiming,{duration:.5,burnTickInterval:.25,burnDamage:1});assert.ok(Object.isFrozen(statusTiming));
  for(const [magic,type] of [['fire','burn'],['ice','freeze']]){
    const battle=createDefaultBattle({heroProjectile:'magic',heroMagic:magic});
    assert.equal(battle.state.enemies[0].status,null);
    const launch=battle.advance(1.2);assert.ok(!launch.some(event=>event.type==='status'));assert.equal(battle.state.enemies[0].status,null);
    const events=battle.advance(.9),status=events.find(event=>event.type==='status');
    assert.deepEqual(status,{type:'status',status:type,sourceId:'hero',targetId:'archer1',at:2.1,duration:.5,endsAt:2.6});
    assert.deepEqual(battle.state.enemies[0].status,{type,startedAt:2.1,endsAt:2.6});
    const lethal=createDefaultBattle({heroProjectile:'magic',heroMagic:magic,heroDamage:500});
    const killed=lethal.advance(2.1);assert.ok(!killed.some(event=>event.type==='status'));assert.equal(lethal.state.enemies[0].status,null);
  }
  const npc=createBattle({heroDamage:1,heroMaxHp:1000}),events=npc.advance(5);
  assert.ok(events.some(event=>event.type==='attack'&&event.magic==='shadow'));
  assert.ok(!events.some(event=>event.type==='status'));assert.ok(npc.state.enemies.every(enemy=>enemy.status===null));
});

test('burn preserves the normal hit and deals exactly two unarmored one-damage ticks before expiry', () => {
  const createFixture=encounterFixture([[{id:'orc',type:'orc'}]]);
  const battle=createFixture({heroProjectile:'magic',heroMagic:'fire'});
  const events=battle.advance(2.1),impact=events.find(event=>event.impact);
  assert.equal(impact.damage,9);assert.equal(impact.hp,91);
  assert.deepEqual(battle.state.enemies[0].status,{type:'burn',startedAt:2.1,endsAt:2.6});
  const ticks=battle.advance(.5,{heroCanAttack:false,orcCanAttack:false}).filter(event=>event.dot);
  assert.deepEqual(ticks.map(event=>[event.at,event.damage,event.hp,event.projectile,event.magic]),[[2.35,1,90,'burn','fire'],[2.6,1,89,'burn','fire']]);
  assert.ok(ticks.every(event=>event.sourceId==='hero'&&event.targetId==='orc'&&!event.impact&&!event.animationDuration));
  assert.equal(battle.state.enemies[0].status,null);
  assert.ok(!battle.advance(.2,{heroCanAttack:false,orcCanAttack:false}).some(event=>event.dot));
});

test('a burn kill grants five gold once and clears its effect, queued spell and wave before the next spawn', () => {
  const battle=createDefaultBattle({heroProjectile:'magic',heroMagic:'fire',heroDamage:58});
  const events=battle.advance(2.6),death=events.find(event=>event.type==='death');
  assert.ok(events.some(event=>event.dot&&event.at===2.6&&event.hp===0));
  assert.deepEqual(death,{type:'death',id:'archer1',unitType:'archer',reward:5,totalReward:5,at:2.6});
  assert.equal(events.filter(event=>event.type==='death').length,1);assert.equal(battle.state.reward,5);assert.equal(battle.state.phase,'intermission');
  assert.equal(battle.state.enemies[0].status,null);assert.equal(battle.state.totalDefeated,1);
  const spawn=battle.advance(1.4);assert.deepEqual(spawn.map(event=>event.type),['wave']);assert.equal(spawn[0].at,4);
  assert.ok(battle.state.enemies.every(enemy=>enemy.hp===60&&enemy.status===null));
  const rest=battle.advance(100);assert.equal(battle.state.reward,20);assert.equal(battle.state.phase,'victory');
  assert.ok(!rest.some(event=>event.targetId==='archer1'));assert.equal(rest.filter(event=>event.type==='end').length,1);
  assert.equal(rest.find(event=>event.type==='end').reward,0);
});

test('freeze safely copies its status, pauses the remaining enemy cooldown and survives a real pause', () => {
  const battle=createDefaultBattle({heroProjectile:'magic',heroMagic:'ice',heroDamage:1,heroMaxHp:1000});
  battle.advance(2.1);const snapshot=battle.state;
  assert.deepEqual(snapshot.enemies[0].status,{type:'freeze',startedAt:2.1,endsAt:2.6});
  snapshot.enemies[0].status.endsAt=999;snapshot.enemies[0].status.type='burn';
  assert.deepEqual(battle.state.enemies[0].status,{type:'freeze',startedAt:2.1,endsAt:2.6});
  const paused=battle.pause();assert.deepEqual(battle.advance(100),[]);assert.deepEqual(battle.state,paused);
  battle.resume();
  const thaw=battle.advance(.5,{heroCanAttack:false});assert.ok(!thaw.some(event=>event.sourceId==='archer1'));
  assert.equal(battle.state.enemies[0].status,null);
  const later=battle.advance(1.5,{heroCanAttack:false});
  assert.deepEqual(later.filter(event=>event.type==='attack'&&event.sourceId==='archer1').map(event=>event.at),[4.1]);
  assert.equal(battle.state.hero.hp,986,'only the attacks at 1.8 and 4.1 have landed');
});

test('ice suppresses a ready attack at impact and permits one attack exactly at thaw, without a backlog', () => {
  const createFixture=encounterFixture([[{id:'archer',type:'archer',interval:1.5}]],{legacyArcher:false});
  const battle=createFixture({heroProjectile:'magic',heroMagic:'ice',heroDamage:1,heroMaxHp:1000});
  const impact=battle.advance(1.5,{heroCloseRange:true});
  assert.ok(impact.some(event=>event.type==='status'&&event.status==='freeze'));
  assert.ok(!impact.some(event=>event.type==='attack'&&event.sourceId==='archer'));
  const thaw=battle.advance(.5,{heroCanAttack:false,heroCloseRange:true});
  assert.deepEqual(thaw.filter(event=>event.type==='attack'&&event.sourceId==='archer').map(event=>event.at),[2]);
  assert.equal(battle.state.enemies[0].status,null);
  assert.ok(!battle.advance(.2,{heroCanAttack:false}).some(event=>event.sourceId==='archer'));
});

test('refreshing freeze extends to the latest impact rather than stacking half-second copies', () => {
  const createFixture=encounterFixture([[{id:'archer',type:'archer'}]],{legacyArcher:false,closeInterval:.25});
  const battle=createFixture({heroProjectile:'magic',heroMagic:'ice',heroDamage:1,heroMaxHp:1000});
  battle.advance(1.45,{heroCloseRange:true});
  const both=battle.advance(.3,{heroCanAttack:false,heroCloseRange:true});
  assert.deepEqual(both.filter(event=>event.type==='status').map(event=>[event.at,event.endsAt]),[[1.5,2],[1.75,2.25]]);
  assert.deepEqual(battle.state.enemies[0].status,{type:'freeze',startedAt:1.75,endsAt:2.25});
  const throughThaw=battle.advance(.5,{heroCanAttack:false});
  assert.ok(!throughThaw.some(event=>event.sourceId==='archer'));assert.equal(battle.state.enemies[0].status,null);
  const resumed=battle.advance(.3,{heroCanAttack:false});
  assert.deepEqual(resumed.filter(event=>event.type==='attack'&&event.sourceId==='archer').map(event=>event.at),[2.55]);
});

test('a burn tick tied with reapplication happens before refresh, with one ticking effect instead of stacked copies', () => {
  const createFixture=encounterFixture([[{id:'archer',type:'archer'}]],{legacyArcher:false,closeInterval:.25});
  const battle=createFixture({heroProjectile:'magic',heroMagic:'fire',heroDamage:1,heroMaxHp:1000});
  battle.advance(1.45,{heroCloseRange:true});
  const both=battle.advance(.3,{heroCanAttack:false,heroCloseRange:true});
  const tied=both.filter(event=>event.at===1.75);
  assert.deepEqual(tied.map(event=>event.type==='attack'&&event.dot?'dot':event.type==='attack'&&event.impact?'impact':event.type),['dot','impact','status']);
  assert.deepEqual(battle.state.enemies[0].status,{type:'burn',startedAt:1.75,endsAt:2.25});
  const tail=battle.advance(.75,{heroCanAttack:false});
  const dots=[...both,...tail].filter(event=>event.dot);
  assert.deepEqual(dots.map(event=>event.at),[1.75,2,2.25]);
  assert.equal(battle.state.enemies[0].hp,55);assert.equal(battle.state.enemies[0].status,null);
});

test('out-of-range and frozen time hold an enemy cooldown once for their union rather than twice', () => {
  const createFixture=encounterFixture([[{id:'orc',type:'orc'}]]);
  const battle=createFixture({heroProjectile:'magic',heroMagic:'ice',heroDamage:1,heroMaxHp:1000});
  battle.advance(1.2,{orcCanAttack:false,heroCloseRange:true});
  const held=battle.advance(.8,{orcCanAttack:false,heroCanAttack:false,heroCloseRange:true});
  assert.ok(held.some(event=>event.type==='status'&&event.status==='freeze'));assert.equal(battle.state.enemies[0].status,null);
  const resumed=battle.advance(2.4,{heroCanAttack:false});
  assert.deepEqual(resumed.filter(event=>event.type==='attack'&&event.sourceId==='orc').map(event=>event.at),[4.4]);
});

test('freezing a caster does not pause a shadow projectile that was already in flight', () => {
  const createFixture=magicEncounterFixture({mageFirst:true});
  const battle=createFixture({heroProjectile:'magic',heroMagic:'ice',heroDamage:1,heroMaxHp:1000});
  const before=battle.advance(5.8),cast=before.find(event=>event.type==='cast'&&event.sourceId==='mage');
  assert.ok(cast);assert.equal(cast.at,5.3);assert.equal(cast.impactAt,6.2);
  assert.deepEqual(battle.state.enemies.find(enemy=>enemy.id==='mage').status,{type:'freeze',startedAt:5.7,endsAt:6.2});
  const after=battle.advance(.4),impact=after.find(event=>event.type==='attack'&&event.castId===cast.castId);
  assert.ok(impact);assert.equal(impact.at,6.2);assert.equal(impact.magic,'shadow');
});

test('restart and terminal defeat clear effects and prevent any remaining burn damage or delayed freeze cooldown', () => {
  const burning=encounterFixture([[{id:'orc',type:'orc'}]])({heroProjectile:'magic',heroMagic:'fire',heroMaxHp:5});
  const defeat=burning.advance(2.4);assert.equal(burning.state.phase,'defeat');assert.equal(burning.state.enemies[0].status,null);
  assert.deepEqual(defeat.filter(event=>event.dot).map(event=>event.at),[2.35]);assert.deepEqual(burning.advance(100),[]);
  const frozen=createDefaultBattle({heroProjectile:'magic',heroMagic:'ice',heroDamage:1,heroMaxHp:1000});
  frozen.advance(2.1);assert.ok(frozen.state.enemies[0].status);
  const reset=frozen.restart();assert.equal(reset.elapsed,0);assert.ok(reset.enemies.every(enemy=>enemy.status===null));
  const fresh=frozen.advance(1.8,{heroCanAttack:false});
  assert.deepEqual(fresh.filter(event=>event.type==='attack').map(event=>[event.sourceId,event.at]),[['archer1',1.8]]);
});

test('status ticks, refreshes, expiry and range-gated freezes remain deterministic across chunk sizes', () => {
  const createFixture=encounterFixture([[{id:'archer',type:'archer'}],[{id:'orc',type:'orc'}]],{legacyArcher:false,closeInterval:.25});
  const schedule=[[1.45,{heroCloseRange:true}],[.3,{heroCloseRange:true,heroCanAttack:false}],[.25,{heroCanAttack:false,orcCanAttack:false}],[1.17,{heroCloseRange:true}],[.63,{heroCanAttack:false}],[300,{}]];
  function run(magic,pattern){
    const battle=createFixture({heroProjectile:'magic',heroMagic:magic,heroDamage:3,heroMaxHp:1000}),events=[];let index=0;
    for(const [seconds,gates] of schedule){
      if(!pattern){events.push(...battle.advance(seconds,gates));continue;}
      let remaining=Math.round(seconds*1000000);
      while(remaining>0){const ticks=Math.min(remaining,pattern[index++%pattern.length]);events.push(...battle.advance(ticks/1000000,gates));remaining-=ticks;}
    }
    return {battle,events};
  }
  for(const magic of ['fire','ice']){
    const whole=run(magic),small=run(magic,[100000]),irregular=run(magic,[37000,63000]);
    assert.deepEqual(small.events,whole.events);assert.deepEqual(irregular.events,whole.events);
    assert.deepEqual(small.battle.state,whole.battle.state);assert.deepEqual(irregular.battle.state,whole.battle.state);
    assert.equal(whole.battle.state.phase,'victory');assert.equal(whole.battle.state.reward,10);
    assert.ok(whole.battle.state.enemies.every(enemy=>enemy.status===null));
  }
});

test('live hero stats preserve remaining cooldown, paused phase and current HP without granting an immediate strike', () => {
  const battle=createDefaultBattle();battle.advance(.6);battle.pause();
  const updated=battle.updateHeroStats({heroDamage:14,heroMaxHp:220,heroAttackSpeed:1.25});
  assert.equal(updated.phase,'paused');assert.equal(updated.elapsed,.6);
  assert.deepEqual(updated.hero,{id:'hero',name:'Странник',hp:200,maxHp:220,damage:14,attackSpeed:1.25});
  assert.deepEqual(battle.advance(100),[]);assert.deepEqual(battle.state,updated);
  battle.resume();assert.deepEqual(battle.advance(.479999),[]);
  const first=battle.advance(.000001);assert.equal(first.length,1);
  assert.deepEqual([first[0].at,first[0].damage,first[0].animationDuration],[1.08,14,.528]);
  const rest=battle.advance(.96);
  assert.deepEqual(rest.filter(event=>event.type==='attack').map(event=>[event.sourceId,event.at]),[['archer1',1.8],['hero',2.04]]);
});

test('stat updates never heal or revive, clamp HP only downward and persist for a full restart', () => {
  const battle=createDefaultBattle();battle.advance(1.8);assert.equal(battle.state.hero.hp,193);
  assert.equal(battle.updateHeroStats({heroMaxHp:240}).hero.hp,193);
  assert.equal(battle.updateHeroStats({heroMaxHp:150}).hero.hp,150);
  assert.equal(battle.updateHeroStats({heroMaxHp:260}).hero.hp,150);
  assert.equal(battle.restart().hero.hp,260);
  const fallen=createDefaultBattle({heroMaxHp:1});fallen.advance(1.8);
  const upgraded=fallen.updateHeroStats({heroMaxHp:240,heroDamage:16,heroAttackSpeed:1.25});
  assert.equal(upgraded.phase,'defeat');assert.equal(upgraded.hero.hp,0);assert.deepEqual(fallen.advance(100),[]);
  const fresh=fallen.restart();assert.equal(fresh.hero.hp,240);assert.equal(fresh.hero.maxHp,240);assert.equal(fresh.hero.attackSpeed,1.25);
  const first=fallen.advance(.96).find(event=>event.sourceId==='hero');assert.equal(first.damage,16);assert.equal(first.at,.96);
});

test('attack speed validates the five upgrade ranks and invalid stat updates retain existing configuration', () => {
  for(const value of [undefined,null,0,-1,.9,NaN,Infinity,'1.2'])assert.equal(createDefaultBattle({heroAttackSpeed:value}).state.hero.attackSpeed,1);
  const battle=createDefaultBattle({heroAttackSpeed:5});assert.equal(battle.state.hero.attackSpeed,1.25);
  const saved=battle.updateHeroStats({heroDamage:14,heroMaxHp:220,heroAttackSpeed:1.1});
  for(const value of [null,0,-1,.9,NaN,Infinity,'1.2']){
    assert.deepEqual(battle.updateHeroStats({heroDamage:0,heroMaxHp:-1,heroAttackSpeed:value}),saved);
  }
  assert.deepEqual(battle.updateHeroStats(),saved);assert.deepEqual(battle.updateHeroStats(null),saved);
  saved.hero.damage=900;assert.equal(battle.state.hero.damage,14);
});

test('speed changes retain range-held cooldown progress and do not alter an active intermission', () => {
  const battle=createDefaultBattle({heroProjectile:'arrow',heroDamage:1,heroMaxHp:1000});
  battle.advance(.6);battle.advance(2,{heroCanAttack:false});
  battle.updateHeroStats({heroAttackSpeed:1.25});assert.deepEqual(battle.advance(.479999),[]);
  const released=battle.advance(.000001);assert.equal(released.length,1);assert.equal(released[0].at,3.08);assert.equal(released[0].animationDuration,.72);
  const separate=createDefaultBattle();separate.advance(6.2);separate.pause();
  const updated=separate.updateHeroStats({heroAttackSpeed:1.25});
  assert.equal(updated.phase,'paused');assert.equal(updated.intermissionRemaining,1.2);
  separate.resume();const spawn=separate.advance(1.2);assert.equal(spawn.length,1);assert.equal(spawn[0].at,7.4);
  const attack=separate.advance(.96).find(event=>event.sourceId==='hero');assert.equal(attack.at,8.36);
});

test('a live power or tempo purchase affects new casts while already launched damage and travel stay locked', () => {
  const battle=createDefaultBattle({heroProjectile:'magic',heroMagic:'fire'});
  const oldCast=battle.advance(1.2)[0];battle.advance(.1);
  battle.updateHeroStats({heroDamage:20,heroAttackSpeed:1.25});
  const beforeImpact=battle.advance(.799999);assert.ok(!beforeImpact.some(event=>event.impact));
  const hit=battle.advance(.000001).find(event=>event.impact);
  assert.equal(hit.castId,oldCast.castId);assert.equal(hit.at,2.1);assert.equal(hit.damage,12);
  const nextCast=battle.advance(.08).find(event=>event.type==='cast');
  assert.deepEqual([nextCast.at,nextCast.castInterval,nextCast.animationDuration,nextCast.impactAt],[2.18,.96,.528,3.08]);
  assert.deepEqual([nextCast.appearDuration,nextCast.flightDuration,nextCast.impactDuration],[.42,.48,.42]);
  const later=battle.advance(.9),newHit=later.find(event=>event.impact&&event.castId===nextCast.castId);
  assert.equal(newHit.damage,20);assert.equal(newHit.at,3.08);
  assert.deepEqual(later.filter(event=>event.dot).map(event=>[event.at,event.damage]),[[2.35,1],[2.6,1]]);
});

test('hero tempo scales close and far cast poses and cooldowns while elemental effects and NPC timing remain fixed', () => {
  for(const magic of ['fire','ice'])for(const close of [false,true]){
    const battle=createDefaultBattle({heroProjectile:'magic',heroMagic:magic,heroAttackSpeed:1.25,heroDamage:1,heroMaxHp:1000});
    const events=battle.advance(1.86,{heroCloseRange:close}),cast=events.find(event=>event.type==='cast');
    assert.deepEqual([cast.at,cast.castInterval,cast.animationDuration],[.96,close?.64:.96,close?.288:.528]);
    assert.deepEqual([cast.appearDuration,cast.flightDuration,cast.impactDuration],[close?.18:.42,close?.12:.48,.42]);
    const status=events.find(event=>event.type==='status');assert.equal(status.at,close?1.26:1.86);assert.equal(status.duration,.5);assert.equal(status.endsAt,close?1.76:2.36);
  }
  const npc=createBattle({heroProjectile:'arrow',heroAttackSpeed:1.25,heroDamage:1,heroMaxHp:1000});
  const events=npc.advance(3.8),mage=events.find(event=>event.type==='cast'&&event.sourceId==='mage');
  assert.deepEqual([mage.at,mage.animationDuration,mage.castInterval,mage.impactAt],[3.8,.66,3.8,4.7]);
  assert.deepEqual(events.filter(event=>event.sourceId==='hero').map(event=>[event.at,event.animationDuration]),[[.96,.72],[1.92,.72],[2.88,.72]]);
  const skeleton=createDefaultBattle({heroProjectile:'arrow',heroAttackSpeed:1.25,heroDamage:1,heroMaxHp:1000});
  assert.deepEqual(skeleton.advance(3.6).filter(event=>event.sourceId==='archer1').map(event=>[event.at,event.animationDuration]),[[1.8,.6],[3.6,.6]]);
});

test('a paused tempo change rescales a pending sword counter and active swing without adding a counter or shifting enemy cadence', () => {
  const fixture=encounterFixture([[{id:'orc',type:'orc'}]]),battle=fixture({heroWeapon:'sword',heroDamage:1,heroMaxHp:1000});
  const before=battle.advance(4.9);assert.equal(before.filter(event=>event.type==='block').length,1);assert.ok(!before.some(event=>event.counter));
  battle.pause();battle.updateHeroStats({heroDamage:14,heroAttackSpeed:1.25});assert.deepEqual(battle.advance(100),[]);battle.resume();
  assert.deepEqual(battle.advance(.247999),[]);
  const counter=battle.advance(.000001).find(event=>event.counter);
  assert.deepEqual([counter.at,counter.damage,counter.animationDuration],[5.148,11,.288]);
  const after=battle.advance(2.1),regular=after.find(event=>event.sourceId==='hero'&&!event.counter);
  assert.deepEqual([regular.at,regular.variant,regular.comboStep,regular.animationDuration],[5.66,'slash',2,.528]);
  assert.ok(counter.at+counter.animationDuration<=regular.at);
  assert.deepEqual(after.filter(event=>event.sourceId==='orc').map(event=>event.at),[7.2]);
});

test('scaled sword reaction delay and all combo poses reserve nonoverlapping slots through repeated live speed changes', () => {
  const slowOrc=encounterFixture([[{id:'orc',type:'orc',interval:3.5}]]),fast=slowOrc({heroWeapon:'sword',heroDamage:1,heroAttackSpeed:1.25,heroMaxHp:1000});
  const fixed=fast.advance(7.24),counter=fixed.find(event=>event.counter);
  assert.deepEqual([counter.at,counter.animationDuration],[7.24,.288]);
  const fixture=encounterFixture([[{id:'orc',type:'orc'}]]),battle=fixture({heroWeapon:'sword',heroDamage:1,heroMaxHp:1000}),attacks=[],blocks=[];
  let previousSpeed=1;
  for(const [duration,speed]of [[4.9,1.05],[4.8,1.1],[4.8,1.15],[4.8,1.2],[4.8,1.25],[4.8,1.05],[4.8,1.25],[10,null]]){
    const events=battle.advance(duration);attacks.push(...events.filter(event=>event.sourceId==='hero'&&event.type==='attack'));blocks.push(...events.filter(event=>event.type==='block'));
    if(speed!==null){
      const now=battle.state.elapsed,last=attacks.at(-1);
      if(last&&last.at+last.animationDuration>now)last.animationDuration=now-last.at+Math.round((last.at+last.animationDuration-now)*1000000*previousSpeed/speed)/1000000;
      battle.updateHeroStats({heroAttackSpeed:speed});previousSpeed=speed;
    }
  }
  for(let i=1;i<attacks.length;i++)assert.ok(attacks[i-1].at+attacks[i-1].animationDuration<=attacks[i].at+1e-9,`sword pose at ${attacks[i-1].at} overlaps ${attacks[i].at}`);
  assert.ok(attacks.some(event=>event.heavy));assert.ok(attacks.filter(event=>event.counter).length>3);
  assert.ok(attacks.filter(event=>event.counter).length<=blocks.length);
});

test('live stat updates remain deterministic through gates, pause, waves and irregular frame sizes for every weapon', () => {
  const schedule=[[.6,{}, {heroDamage:6,heroMaxHp:1020,heroAttackSpeed:1.05}], [4.3,{heroCanAttack:false,orcCanAttack:false},{heroAttackSpeed:1.1}], [3.7,{heroCloseRange:true},{heroDamage:8,heroAttackSpeed:1.15}], [5.1,{}, {heroAttackSpeed:1.25}], [150,{},null]];
  function run(options,pattern){
    const battle=createDefaultBattle({...options,heroDamage:4,heroMaxHp:1000}),events=[];let index=0;
    for(const [seconds,gates,stats]of schedule){
      if(!pattern)events.push(...battle.advance(seconds,gates));
      else{let remaining=Math.round(seconds*1000000);while(remaining>0){const ticks=Math.min(remaining,pattern[index++%pattern.length]);events.push(...battle.advance(ticks/1000000,gates));remaining-=ticks;}}
      if(stats){battle.pause();battle.updateHeroStats(stats);assert.deepEqual(battle.advance(20),[]);battle.resume();}
    }
    return{state:battle.state,events};
  }
  for(const options of [{},{heroWeapon:'sword'},{heroProjectile:'arrow'},{heroProjectile:'magic',heroMagic:'fire'},{heroProjectile:'magic',heroMagic:'ice'}]){
    const whole=run(options),small=run(options,[100000]),irregular=run(options,[37000,63000]);
    assert.deepEqual(small,whole);assert.deepEqual(irregular,whole);assert.equal(whole.state.phase,'victory');assert.equal(whole.state.reward,20);
  }
});

test('Archer wolf bite is an independent engine event and never shifts arrow timing',()=>{
 const battle=createDefaultBattle({heroWeapon:'bow',heroProjectile:'arrow',companionEnabled:true});
 const nextShot=battle.getArrowSchedule().find(e=>e.sourceId==='hero').at;
 assert.equal(nextShot,1.2);
 const wolf=battle.companionStrike('archer1',7);
 assert.equal(wolf.length,1);
 assert.deepEqual([wolf[0].type,wolf[0].sourceId,wolf[0].targetId,wolf[0].projectile,wolf[0].damage],
   ['attack','companion','archer1','bite',7]);
 assert.equal(battle.state.enemies[0].hp,53);
 assert.equal(battle.getArrowSchedule().find(e=>e.sourceId==='hero').at,nextShot);
 const events=battle.advance(1.2);
 assert.equal(events.filter(e=>e.type==='attack'&&e.sourceId==='hero').length,1);
 assert.equal(events.find(e=>e.sourceId==='hero').at,1.2);
 assert.equal(battle.state.enemies[0].hp,41);
 assert.equal(battle.getArrowSchedule().find(e=>e.sourceId==='hero').at,2.4);
 battle.pause();
 assert.deepEqual(battle.companionStrike('archer1',7),[]);
 assert.equal(battle.state.enemies[0].hp,41);
 battle.resume();
 assert.equal(battle.setCompanionEnabled(false),false);
 assert.deepEqual(battle.companionStrike('archer1',7),[]);
 assert.equal(battle.state.enemies[0].hp,41);
});
test('Wolf cannot be activated for Warrior or Mage or while Archer has not equipped it',()=>{
 for(const options of [{heroWeapon:'sword',heroProjectile:'melee'},
   {heroWeapon:'wand',heroProjectile:'magic',heroMagic:'ice'},
   {heroWeapon:'bow',heroProjectile:'arrow'}]){
   const battle=createDefaultBattle({...options,companionEnabled:false});
   assert.deepEqual(battle.companionStrike('archer1',9),[]);
   const allowed=battle.setCompanionEnabled(true);
   assert.equal(allowed,options.heroWeapon==='bow');
   if(allowed){assert.equal(battle.companionStrike('invalid',9).length,0);
     assert.equal(battle.companionStrike('archer1',NaN).length,0);
     assert.equal(battle.companionStrike('archer1',-3).length,0);}
   else assert.deepEqual(battle.companionStrike('archer1',9),[]);
 }
});
test('Wolf kills enemies once, advances waves, preserves rewards and never duplicates victory',()=>{
 const battle=createDefaultBattle({heroWeapon:'bow',heroProjectile:'arrow',companionEnabled:true});
 let a=battle.companionStrike('archer1',100);
 assert.deepEqual(a.map(e=>e.type),['attack','death','wave_clear']);
 assert.equal(battle.state.phase,'intermission');
 assert.equal(battle.state.reward,5);assert.equal(battle.state.completedWaves,1);
 assert.deepEqual(battle.companionStrike('archer1',100),[]);
 battle.advance(intermissionDuration);
 assert.equal(battle.state.phase,'running');assert.equal(battle.state.waveIndex,1);
 a=battle.companionStrike('archer2',100);
 assert.deepEqual(a.map(e=>e.type),['attack','death']);
 a=battle.companionStrike('archer3',100);
 assert.deepEqual(a.map(e=>e.type),['attack','death','wave_clear']);
 assert.equal(battle.state.reward,15);
 battle.advance(intermissionDuration);
 assert.equal(battle.state.waveIndex,2);
 a=battle.companionStrike('orc',100);
 assert.equal(a[0].damage,97,'wolf bite respects armor on the Orc');
 assert.deepEqual(a.map(e=>e.type),['attack','death','wave_clear','end']);
 assert.equal(battle.state.phase,'victory');
 assert.equal(battle.state.reward,20);
 assert.equal(battle.state.defeatedCount,4);
 assert.deepEqual(battle.companionStrike('orc',100),[]);
 assert.deepEqual(battle.advance(10),[]);
});
