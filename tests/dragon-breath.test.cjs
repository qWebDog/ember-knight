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

test('dragon swipes at living wolf without any fire, even across multiple attack cycles',()=>{
 const b=bossFight();
 const emitted=b.advance(5.6,available);
 const attacks=emitted.filter(e=>e.type==='attack'&&e.sourceId==='dragon');
 assert.equal(attacks.length,2);
 assert.ok(attacks.every(e=>e.targetId==='companion'&&e.projectile==='claw'
   &&e.dragonSwipe===true&&e.damage===12));
 assert.equal(emitted.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,0);
 assert.equal(emitted.filter(e=>e.breath).length,0);
 assert.equal(b.state.companion.hp,46);
 assert.equal(b.state.hero.hp,1200);
 assert.equal(b.state.reward,20);
});

test('dragon holds its physical attack until the wolf actually reaches melee distance',()=>{
 const b=bossFight();
 const far={enemyCanAttack:{dragon:false},enemyCanAttackHero:{dragon:true}};
 const stopped=b.advance(5.6,far);
 assert.equal(stopped.filter(e=>e.sourceId==='dragon').length,0);
 assert.equal(b.state.companion.hp,70);
 const reached=b.advance(2.8,available);
 assert.ok(reached.some(e=>e.type==='attack'&&e.projectile==='claw'
   &&e.targetId==='companion'));
 assert.equal(reached.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,0);
});

test('after defeating the wolf the dragon switches to five mouth-fire volleys against hero only',()=>{
 const b=bossFight({wolfHp:20});
 const swipes=b.advance(5.6,available);
 assert.equal(swipes.filter(e=>e.type==='attack'&&e.projectile==='claw').length,2);
 assert.equal(swipes.filter(e=>e.type==='death'&&e.id==='companion').length,1);
 assert.equal(swipes.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,0);
 assert.equal(b.state.companion.hp,0);
 assert.equal(b.state.enemyTargetId,'hero');
 const emitted=b.advance(4.3,available);
 const casts=emitted.filter(e=>e.type==='cast'&&e.sourceId==='dragon');
 assert.deepEqual([combat.dragonBreath.bursts,combat.dragonBreath.spacing,
   combat.dragonBreath.damage],[5,.26,3]);
 assert.equal(casts.length,5);
 assert.deepEqual(casts.map(e=>e.burstIndex),[0,1,2,3,4]);
 for(const cast of casts){
   assert.equal(cast.projectile,'breath');
   assert.equal(cast.magic,'fire');
   assert.equal(cast.targetId,'hero');
   assert.equal(cast.burstCount,5);
   assert.equal(Number((cast.impactAt-cast.at).toFixed(2)),.42);
 }
 for(let i=1;i<casts.length;i++)
   assert.equal(Number((casts[i].at-casts[i-1].at).toFixed(2)),.26);
 const hits=emitted.filter(e=>e.type==='attack'&&e.sourceId==='dragon');
 assert.equal(hits.length,5);
 assert.ok(hits.every(e=>e.breath&&e.damage===3&&e.targetId==='hero'));
 assert.equal(b.state.hero.hp,1185);
});

test('unequipped wolf also causes five flames directed only at hero',()=>{
 const b=bossFight();
 b.setCompanionEnabled(false);
 assert.equal(b.state.enemyTargetId,'hero');
 const emitted=b.advance(4.3,available);
 assert.equal(emitted.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,5);
 assert.ok(emitted.filter(e=>e.type==='attack'&&e.sourceId==='dragon')
   .every(e=>e.targetId==='hero'&&e.projectile==='magic'));
 assert.equal(emitted.some(e=>e.dragonSwipe),false);
});

test('pause during breathing holds all later cast and impact events',()=>{
 const b=bossFight();
 b.setCompanionEnabled(false);
 const first=b.advance(2.8,available);
 assert.equal(first.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,1);
 const elapsed=b.state.elapsed;
 b.pause();
 assert.deepEqual(b.advance(10,available),[]);
 assert.equal(b.state.elapsed,elapsed);
 b.resume();
 const continued=b.advance(1.7,available);
 assert.equal(continued.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,4);
 assert.equal(continued.filter(e=>e.type==='attack'&&e.sourceId==='dragon').length,5);
 assert.equal(b.state.hero.hp,1185);
});

test('killing dragon mid-breath cancels unreleased volleys and in-flight fire damage',()=>{
 const b=bossFight();
 b.setCompanionEnabled(false);
 const first=b.advance(2.8,available);
 assert.equal(first.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,1);
 b.updateHeroStats({heroDamage:500});
 const after=b.advance(.8,available);
 assert.ok(after.some(e=>e.type==='death'&&e.id==='dragon'));
 assert.equal(b.state.phase,'victory');
 const casts=first.concat(after).filter(e=>e.type==='cast'&&e.sourceId==='dragon');
 assert.ok(casts.length>1&&casts.length<5,'fire is cut short at dragon death');
 const hits=first.concat(after).filter(e=>e.type==='attack'&&e.sourceId==='dragon');
 assert.ok(hits.length<casts.length,'some flames were still travelling at death');
 const health=b.state.hero.hp;
 assert.deepEqual(b.advance(15,available),[],'no post-mortem casts or attacks');
 assert.equal(b.state.hero.hp,health,'no post-mortem damage');
 assert.equal(b.state.reward,25,'dragon kill is rewarded once');
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
 boss.setCompanionEnabled(false);
 boss.advance(4.3,available);
 const casts=boss.getArrowSchedule().filter(s=>s.sourceId==='hero');
 assert.equal(casts.length,1);
 assert.equal(casts[0].targetId,'dragon');
 assert.equal(casts[0].at,9.0);
});

test('five dragon fireballs form one finite volley with a clear pause before the next volley',()=>{
 const b=bossFight();b.setCompanionEnabled(false);
 let events=b.advance(5.5,available);
 const spells=events.filter(e=>e.type==='cast'&&e.sourceId==='dragon');
 assert.equal(spells.length,5,'exactly five independent launches in one attack cycle');
 assert.ok(spells.every(e=>e.breath&&e.magic==='fire'&&e.projectile==='breath'));
 assert.deepEqual(spells.map(e=>e.burstIndex),[0,1,2,3,4]);
 assert.equal(events.filter(e=>e.type==='attack'&&e.sourceId==='dragon').length,5);
 assert.equal(b.state.hero.hp,1185);
 assert.equal(b.advance(.09,available).filter(e=>e.sourceId==='dragon').length,0,
   'all five fireballs ended and there is a visible gap before the next salvo');
 events=b.advance(.21,available);
 assert.equal(events.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,1,
   'next volley is scheduled on a new distinct attack interval');
});
