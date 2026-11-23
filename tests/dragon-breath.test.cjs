'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const dragon=require('../dist/dragon.js');
const combat=require('../dist/combat.js');

function bossFight({wolfHp=70}={}){
 const b=combat.createBattle({
   heroWeapon:'bow',heroProjectile:'arrow',dragonBossEnabled:true,
   companionEnabled:true,companionMaxHp:wolfHp,heroDamage:1,heroMaxHp:1200
 });
 // Skip only the existing three waves using the legitimate wolf attack API.
 for(const wave of [['archer1'],['archer2','archer3'],['orc']]){
   for(const id of wave){
     const events=b.companionStrike(id,500);
     assert.ok(events.some(e=>e.type==='death'&&e.id===id));
   }
   b.advance(combat.intermissionDuration);
 }
 assert.equal(b.state.waveIndex,3);
 assert.equal(b.state.enemies[0].id,'dragon');
 return b;
}
const available={enemyCanAttack:{dragon:true},enemyCanAttackHero:{dragon:true}};

test('red dragon produces exactly five timed mouth breaths in each salvo',()=>{
 const b=bossFight();
 assert.deepEqual([combat.dragonBreath.bursts,combat.dragonBreath.spacing,combat.dragonBreath.damage],
   [5,.26,3]);
 const emitted=b.advance(4.2,available);
 const casts=emitted.filter(e=>e.type==='cast'&&e.sourceId==='dragon');
 assert.equal(casts.length,5);
 assert.deepEqual(casts.map(e=>e.burstIndex),[0,1,2,3,4]);
 for(const cast of casts){
   assert.equal(cast.breath,true);
   assert.equal(cast.projectile,'breath','dragon must not throw a standard magic projectile');
   assert.equal(cast.magic,'fire');
   assert.equal(cast.targetId,'companion');
   assert.equal(cast.burstCount,5);
   assert.equal(Number((cast.impactAt-cast.at).toFixed(2)),.21);
 }
 for(let i=1;i<casts.length;i++)
   assert.equal(Number((casts[i].at-casts[i-1].at).toFixed(2)),.26);
 const hits=emitted.filter(e=>e.type==='attack'&&e.sourceId==='dragon');
 assert.equal(hits.length,5);
 assert.ok(hits.every(e=>e.breath&&e.damage===3&&e.targetId==='companion'));
 assert.equal(b.state.companion.hp,55);
 assert.equal(b.state.hero.hp,1200);
 assert.equal(b.state.reward,20,'dragon fire does not grant kill rewards');
});
test('dragon re-aims later flame pulses after the wolf dies, without ghost damage',()=>{
 const b=bossFight({wolfHp:6});
 const emitted=b.advance(4.2,available);
 const casts=emitted.filter(e=>e.type==='cast'&&e.sourceId==='dragon');
 assert.equal(casts.length,5);
 assert.deepEqual(casts.map(e=>e.targetId),['companion','companion','hero','hero','hero']);
 assert.equal(b.state.companion.hp,0);
 assert.equal(b.state.enemyTargetId,'hero');
 assert.equal(b.state.hero.hp,1191);
 assert.equal(emitted.filter(e=>e.type==='death'&&e.id==='companion').length,1);
 assert.equal(emitted.filter(e=>e.type==='attack'&&e.sourceId==='dragon').length,5);
});
test('pausing dragon during breath freezes pending pulses and fire impacts',()=>{
 const b=bossFight();
 const opened=b.advance(2.8,available);
 assert.equal(opened.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,1);
 const time=b.state.elapsed;
 b.pause();
 assert.deepEqual(b.advance(10,available),[]);
 assert.equal(b.state.elapsed,time);
 b.resume();
 const resumed=b.advance(1.4,available);
 assert.equal(resumed.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,4);
 assert.equal(resumed.filter(e=>e.type==='attack'&&e.sourceId==='dragon').length,5);
 assert.equal(b.state.companion.hp,55);
});
test('dragon mouth is anchored to native frame pixels and follows rendered responsive canvas',()=>{
 const desktop={left:300,top:70,width:164,height:128.8};
 const frame=dragon.frameAt(0,'attack','left');
 assert.equal(frame.frame,12);
 const mouth=dragon.mouthAt(desktop,frame);
 assert.equal(mouth.x,300+39*164/205);
 assert.equal(mouth.y,70+94*128.8/161);
 assert.ok(mouth.x<desktop.left+desktop.width*.3);
 const other=dragon.mouthAt(desktop,dragon.frameAt(.35,'attack','left'));
 assert.notDeepEqual(other,mouth,'animated head shifts the flame origin');
 const mobile=dragon.mouthAt({left:150,top:20,width:82,height:64.4},frame);
 assert.equal(Number((mobile.x-150).toFixed(2)),Number(((mouth.x-300)/2).toFixed(2)));
 const flipped=dragon.mouthAt(desktop,{...frame,direction:'right'});
 assert.ok(flipped.x>desktop.left+desktop.width*.6);
});
test('dragon flame salvo does not alter the existing non-dragon spell and bow behavior',()=>{
 const base=combat.createBattle({heroWeapon:'bow',heroProjectile:'arrow',heroDamage:1});
 const tick=base.getArrowSchedule()[0].at;
 base.advance(2.4);
 assert.equal(tick,1.2);
 assert.equal(base.getArrowSchedule()[0].at,3.6);
 const boss=bossFight();
 boss.advance(4.2,available);
 const casts=boss.getArrowSchedule().filter(s=>s.sourceId==='hero');
 assert.equal(casts.length,1);
 assert.equal(casts[0].targetId,'dragon');
 assert.equal(casts[0].at,9.0);
});
