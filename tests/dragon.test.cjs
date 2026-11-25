'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const dragon=require('../dist/dragon.js');
const {createBattle}=require('../dist/combat.js');
const dist=path.resolve(__dirname,'../dist');
test('all four original 820×644 red dragon sprite sheets are included without alteration',()=>{
 assert.equal(dragon.sheet.width,820);
 assert.equal(dragon.sheet.height,644);
 assert.equal(dragon.sheet.frameWidth,205);
 assert.equal(dragon.sheet.frameHeight,161);
 for(const file of Object.values(dragon.sheets)){
   const png=fs.readFileSync(path.join(dist,file));
   assert.equal(png.subarray(1,4).toString(),'PNG');
   assert.equal(png.readUInt32BE(16),820);
   assert.equal(png.readUInt32BE(20),644);
   assert.ok(png.length>120000,'original atlas must not be replaced with a thumbnail');
 }
 const credits=fs.readFileSync(path.join(dist,'assets/enemies/dragon/CREDITS.md'),'utf8');
 assert.match(credits,/Buko Studios/);
 assert.match(credits,/PlayCraft/);
 assert.match(credits,/by\/3.0/);
});
test('dragon controller addresses valid LPC-oriented original animation frames',async()=>{
 const atlas=Object.fromEntries(Object.keys(dragon.sheets).map(key=>[key,{width:820,height:644,src:key}]));
 const requests=[];
 const loaded=await dragon.load(async url=>{
   requests.push(url);
   const direction=Object.entries(dragon.sheets).find(([,path])=>path===url)[0];
   return atlas[direction];
 });
 assert.equal(requests.length,4);
 for(const direction of ['left','right','front','back']){
   for(const kind of ['fly','idle','attack','hit']){
     const frames=new Set();
     for(let i=0;i<40;i++){
       const frame=dragon.frameAt(i*.12,kind,direction);
       assert.equal(frame.direction,direction);
       assert.ok(frame.sx>=0&&frame.sy>=0);
       assert.ok(frame.sx+frame.sw<=820&&frame.sy+frame.sh<=644);
       assert.equal(frame.sw,205);assert.equal(frame.sh,161);
       frames.add(frame.frame);
     }
     assert.ok(frames.size>=1);
     if(kind==='fly')assert.ok(frames.size>=6,'the dragon should flap its wings');
   }
 }
 const drawCalls=[];
 const ctx={imageSmoothingEnabled:true,clearRect(){},
   drawImage(...args){drawCalls.push(args)}};
 const f=dragon.frameAt(.22,'fly','left');
 assert.equal(dragon.draw(ctx,loaded,f),true);
 assert.equal(drawCalls.length,1);
 assert.equal(drawCalls[0][0],loaded.left);
 assert.deepEqual(drawCalls[0].slice(1,5),[f.sx,f.sy,205,161]);
 await assert.rejects(dragon.load(async()=>({width:640,height:384})),/dimensions/);
});
test('the old three wave battle remains unchanged unless the boss is opted in',()=>{
 const normal=createBattle({heroWeapon:'bow',heroProjectile:'arrow'});
 assert.equal(normal.state.waveCount,3);
 assert.equal(normal.state.totalEnemies,4);
 assert.equal(normal.state.enemies[0].id,'archer1');
 const boss=createBattle({heroWeapon:'sword',dragonBossEnabled:true,heroDamage:500,heroMaxHp:1500});
 assert.equal(boss.state.waveCount,4);
 assert.equal(boss.state.totalEnemies,5);
 const all=boss.advance(250);
 assert.equal(boss.state.phase,'victory');
 assert.equal(boss.state.completedWaves,4);
 assert.equal(boss.state.defeatedCount,5);
 assert.equal(boss.state.reward,25);
 assert.ok(all.some(e=>e.type==='wave'&&e.waveNumber===4&&e.enemies[0].id==='dragon'));
 assert.ok(all.some(e=>e.type==='death'&&e.id==='dragon'&&e.reward===5));
 assert.equal(all.filter(e=>e.type==='death'&&e.id==='dragon').length,1);
 assert.deepEqual(all.filter(e=>e.type==='end').map(e=>e.totalReward),[25]);
});
test('red dragon strikes the wolf with claws rather than fire',()=>{
 const battle=createBattle({heroWeapon:'bow',heroProjectile:'arrow',
   companionEnabled:true,dragonBossEnabled:true,heroDamage:1,heroMaxHp:1500});
 for(const wave of [[['archer1']], [['archer2'],['archer3']], [['orc']]]){
   for(const [id] of wave)battle.companionStrike(id,1000);
   battle.advance(1.4);
 }
 assert.equal(battle.state.waveIndex,3);
 assert.equal(battle.state.enemies[0].id,'dragon');
 assert.equal(battle.state.enemyTargetId,'companion');
 const events=battle.advance(2.8,{enemyCanAttack:{dragon:true},orcCanAttack:true});
 assert.ok(events.some(e=>e.type==='attack'&&e.sourceId==='dragon'
   &&e.targetId==='companion'&&e.projectile==='claw'&&e.damage===24));
 assert.equal(events.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,0);
});
test('published HTML mounts dragon before game, adds boss actor, and scales atlas without slicing 64px tiles',()=>{
 const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
 const game=fs.readFileSync(path.join(dist,'game.js'),'utf8');
 const css=fs.readFileSync(path.join(dist,'game.css'),'utf8');
 assert.ok(html.includes('src="dragon.js?v=dragon-open-mouth-5"'));
 assert.ok(html.indexOf('src="dragon.js?v=dragon-open-mouth-5"')<html.indexOf('src="game.js?v=panel-selection-1"'));
 assert.ok(html.includes('data-fighter="dragon"'));
 assert.ok(html.includes('id="enemy-dragon"'));
 assert.ok(html.includes('1/4'));
 assert.match(game,/dragonBossEnabled:dragonBoss/);
 assert.match(game,/window\.EmberDragon\.frameAt/);
 assert.match(css,/enemy-dragon canvas/);
});
