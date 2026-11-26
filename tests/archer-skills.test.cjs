'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {createBattle}=require('../dist/combat.js');
test('trained archer emits poison and piercing arrows and applies scheduled damage',()=>{const b=createBattle({heroWeapon:'bow',heroProjectile:'arrow',heroDamage:1,heroMaxHp:10000,archer_poison:5,archer_piercing:5});const e=b.advance(20);assert.ok(e.some(x=>x.type==='attack'&&x.arrowType==='poison'&&!x.dot));assert.ok(e.some(x=>x.type==='attack'&&x.arrowType==='piercing'));assert.ok(e.some(x=>x.type==='attack'&&x.arrowType==='poison'&&x.dot));});
test('wolf bond increases maximum HP and Beast Fury leaves incoming damage unchanged',()=>{const b=createBattle({heroWeapon:'bow',heroProjectile:'arrow',companionEnabled:true,companionMaxHp:100,archer_wolfBond:4,archer_guardian:5});assert.equal(b.state.companion.maxHp,160);const e=b.advance(2);assert.ok(e.some(x=>x.type==='attack'&&x.targetId==='companion'&&Math.abs(x.damage-7)<.01));});

test('Special arrow preview is pure and agrees with its attack, including queued arrow types',()=>{const b=createBattle({heroWeapon:'bow',heroProjectile:'arrow',heroDamage:1,heroMaxHp:10000,archer_poison:5,archer_piercing:5,archer_explosive:5,archer_barbed:5});for(let i=0;i<12;i++){const shot=b.getArrowSchedule().find(x=>x.sourceId==='hero');assert.deepEqual(b.getArrowSchedule().find(x=>x.sourceId==='hero'),shot);const e=b.advance(shot.at-b.state.elapsed);const attack=e.find(x=>x.type==='attack'&&x.sourceId==='hero'&&!x.dot);assert.ok(attack);assert.equal(attack.arrowType,shot.arrowType);}});
test('Approved archer atlas is a transparent 8 by 4 frame PNG',()=>{const png=require('node:fs').readFileSync(require('node:path').join(__dirname,'../dist/assets/projectiles/archer-arrow-sprites-v1.png'));assert.equal(png.readUInt32BE(16),256);assert.equal(png.readUInt32BE(20),128);assert.ok(png.includes(Buffer.from('tRNS')));});

test('Double shot schedule previews two arrows and emits two distinct hits on the same live target',()=>{const b=createBattle({heroWeapon:'bow',heroProjectile:'arrow',heroDamage:2,heroMaxHp:10000,archer_doubleShot:5});for(let i=1;i<=8;i++){const shot=b.getArrowSchedule().find(x=>x.sourceId==='hero');assert.equal(!!shot.double,i%4===0);const e=b.advance(shot.at-b.state.elapsed).filter(x=>x.type==='attack'&&x.sourceId==='hero'&&!x.dot);assert.equal(e.length,i%4===0?2:1);if(shot.double){assert.equal(e[0].targetId,e[1].targetId);assert.equal(e[0].at,e[1].at);assert.equal(e[1].extraArrow,true);assert.equal(e[1].damage,1.2);}}});
test('Arrow rain previews and emits nine separate fast shots at rank V',()=>{const b=createBattle({heroWeapon:'bow',heroProjectile:'arrow',heroDamage:1,heroMaxHp:10000,archer_arrowRain:5});let rain=[];for(let i=0;i<40&&rain.length<9;i++){const shot=b.getArrowSchedule().find(x=>x.sourceId==='hero');const e=b.advance(shot.at-b.state.elapsed);const attack=e.find(x=>x.type==='attack'&&x.sourceId==='hero'&&!x.dot);if(shot.rainIndex){assert.equal(shot.rainIndex,rain.length+1);assert.equal(attack.rainIndex,shot.rainIndex);assert.equal(shot.rainCount,9);assert.equal(shot.animationDuration,.5);rain.push(attack.at);}}assert.equal(rain.length,9);for(let i=1;i<9;i++)assert.ok(Math.abs(rain[i]-rain[i-1]-.65)<1e-6);});

test('bleed timer uses real combat ticks and counts only active bleeding effects',()=>{
 const b=createBattle({heroWeapon:'bow',heroProjectile:'arrow',heroDamage:1,heroMaxHp:10000,companionEnabled:true,companionMaxHp:1000,archer_rendingBite:5,archer_barbed:5});
 const target=b.state.targetId;
 for(let i=0;i<3;i++)b.companionStrike(target,1);
 assert.deepEqual(b.state.enemies[0].bleeding,{count:1,remaining:4,duration:4,endsAt:4});
 b.advance(.5);assert.equal(b.state.enemies[0].bleeding.remaining,3.5);
 b.pause();b.advance(2);assert.equal(b.state.enemies[0].bleeding.remaining,3.5);b.resume();
 for(let i=0;i<3;i++)b.companionStrike(target,1);
 assert.equal(b.state.enemies[0].bleeding.count,2);assert.equal(b.state.enemies[0].bleeding.remaining,4);
 b.advance(2.5);assert.ok(b.state.enemies[0].bleeding.count>=2);
 b.advance(1.5);assert.ok(b.state.enemies[0].bleeding.count<=1,'expired wolf bleeds are removed');
 b.companionStrike(target,1000);assert.equal(b.state.enemies.find(e=>e.id===target).bleeding,undefined);
});
test('poison never produces a bleeding badge',()=>{
 const b=createBattle({heroWeapon:'bow',heroProjectile:'arrow',heroDamage:1,heroMaxHp:10000,archer_poison:5});
 b.advance(3);assert.equal(b.state.enemies[0].bleeding,undefined);
});
