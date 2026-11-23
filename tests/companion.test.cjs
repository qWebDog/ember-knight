'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const wolf=require('../dist/companion.js');
const gear=require('../dist/equipment.js');
const dist=path.resolve(__dirname,'../dist');
function harness(){
 const save=new Map(),store=gear.createStore({classId:'bow',storage:{
  getItem:key=>save.get(key)||null,
  setItem:(key,value)=>save.set(key,String(value))
 }});
 const draws=[],ctx={clearRect(){},drawImage:(...args)=>draws.push(args)};
 const canvas={width:64,height:64,getContext:()=>ctx};
 const element={hidden:true,dataset:{},style:{setProperty(name,value){this[name]=value}},
  querySelector:selector=>selector==='canvas'?canvas:null};
 const loadPaths=[];
 const art={src:wolf.path,width:640,height:384};
 const actor=wolf.create({element,store,loadImage:async src=>{loadPaths.push(src);return art;}});
 return {draws,ctx,canvas,element,actor,store,loadPaths};
}
test('wolf includes the original 640×384 CC BY 4.0 atlas and attribution',()=>{
 const file=fs.readFileSync(path.join(dist,wolf.path));
 assert.equal(file.subarray(1,4).toString(),'PNG');
 assert.equal(file.readUInt32BE(16),640);
 assert.equal(file.readUInt32BE(20),384);
 assert.ok(file.length>80000);
 const credits=fs.readFileSync(path.join(dist,'assets/companions/CREDITS.md'),'utf8');
 assert.match(credits,/Redshrike/);
 assert.match(credits,/William.Thompsonj/);
 assert.match(credits,/creativecommons.org\/licenses\/by\/4.0/);
 assert.equal(wolf.sprite.tile,64);
});
test('wolf uses individually cropped half-height side strips, never two animation rows at once',()=>{
 assert.deepEqual(wolf.frameAt(0,false,false,3),{
  sx:320,sy:56,sw:64,sh:40,dx:0,dy:24,dw:64,dh:40,mode:'idle',frame:0
 });
 assert.deepEqual(wolf.frameAt(.1,true,false,3),{
  sx:384,sy:96,sw:64,sh:32,dx:0,dy:32,dw:64,dh:32,mode:'walk',frame:1
 });
 assert.equal(wolf.frameAt(.1,true,false,1).sy,288,'left walk has its own native row');
 assert.equal(wolf.frameAt(.4,true,false,3).sx,576,'walk cycle includes fifth frame');
 assert.equal(wolf.frameAt(.5,true,false,3).sx,320,'walk cycle loops seamlessly');
 assert.equal(wolf.frameAt(.5,true,true,3).sy,56,'reduced motion uses standing pose');
 for(const side of ['right','left'])for(const name of ['idle','walk','run','bite','howl','die']){
  const direction=side==='right'?3:1,rect=wolf.frameAt(99,false,false,direction,name);
  assert.ok(rect.sx>=0&&rect.sy>=0&&rect.sx+rect.sw<=640&&rect.sy+rect.sh<=384,side+' '+name);
  assert.equal(rect.dy+rect.dh,64,'every action stands on the same ground plane');
 }
 assert.equal(wolf.frameAt(.25,false,false,3,'run').sy,128);
 assert.equal(wolf.frameAt(.25,false,false,3,'bite').sy,160);
 assert.equal(wolf.frameAt(.5,false,false,3,'howl').sy,56);
 assert.equal(wolf.frameAt(9,false,false,3,'die').frame,3,'death freezes on the final frame');
 assert.equal(wolf.frameAt(9,false,false,1,'die').sy,192);
 assert.equal(wolf.frameAt(9,false,false,1,'bite').sy,352);
});
test('companion follows the hero, faces right and left, and stands still when not moving',async()=>{
 const h=harness();await h.actor.load();
 assert.equal(h.actor.loaded(),true);
 assert.equal(h.actor.render({time:.125,x:120}),false);
 assert.equal(h.element.hidden,true);
 assert.equal(h.store.equip('companion','wolf').ok,true);
 assert.equal(h.actor.render({time:0,x:160,heroSize:64,depth:4,laneStep:9,moving:true,alive:true}),true);
 assert.equal(h.element.style.left,'106.88px');
 assert.equal(h.element.style['--lane-offset'],'9px');
 assert.deepEqual(h.draws.at(-1).slice(1),[320,96,64,32,0,32,64,32]);
 h.actor.render({time:.1,x:170,direction:1,heroSize:64,depth:4,laneStep:9,moving:true});
 assert.deepEqual(h.draws.at(-1).slice(1),[384,288,64,32,0,32,64,32]);
 assert.equal(h.element.dataset.facing,'left');
 h.actor.render({time:.2,x:185,moving:false,direction:3});
 assert.deepEqual(h.draws.at(-1).slice(1),[320,56,64,40,0,24,64,40]);
 const count=h.draws.length;
 h.actor.render({time:.3,x:185,moving:false,direction:3});
 assert.equal(h.draws.length,count,'stationary wolf does not walk in place');
 h.actor.render({time:5.4,x:185,moving:false,direction:3});
 assert.equal(h.element.dataset.motion,'howl','after resting the wolf howls occasionally');
 h.actor.render({time:6.9,x:185,moving:false,direction:3});
 assert.equal(h.element.dataset.motion,'idle','howl ends and standing pose returns');
 assert.equal(h.actor.render({time:7,x:185,alive:false}),false);
 assert.equal(h.element.hidden,true);
 assert.equal(h.store.equip('companion','none').ok,true);
 assert.equal(h.actor.render({time:8}),false);
});
test('companion fall uses its one-shot death animation without altering gameplay',async()=>{
 const h=harness();await h.actor.load();h.store.equip('companion','wolf');
 assert.equal(h.actor.render({time:12,action:'die',actionAge:.375,alive:false}),true);
 assert.deepEqual(h.draws.at(-1).slice(1),[512,0,64,32,0,32,64,32]);
 assert.equal(h.element.dataset.motion,'die');
 h.actor.render({time:20,action:'die',actionAge:20,alive:false});
 assert.equal(h.draws.length,1,'death pose stays on its last frame once it ends');
});
test('equipment portrait preserves side and front/back wolf proportions',async()=>{
 const h=harness();await h.actor.load();
 assert.equal(h.actor.paintPreview(h.ctx,{row:2}),false);
 h.store.equip('companion','wolf');
 assert.equal(h.actor.paintPreview(h.ctx,{row:2}),true);
 assert.deepEqual(h.draws.at(-1).slice(1),[5,65,23,63,44,30,12,30]);
 assert.equal(h.actor.paintPreview(h.ctx,{row:0}),true);
 assert.deepEqual(h.draws.at(-1).slice(1),[163,65,23,63,44,30,12,30]);
 assert.equal(h.actor.paintPreview(h.ctx,{row:1}),true);
 assert.deepEqual(h.draws.at(-1).slice(1),[320,248,64,40,35,40,29,18]);
 assert.equal(h.actor.paintPreview(h.ctx,{row:3}),true);
 assert.deepEqual(h.draws.at(-1).slice(1),[320,56,64,40,35,40,29,18]);
 const savedCount=h.loadPaths.length;await h.actor.load();
 assert.equal(h.loadPaths.length,savedCount,'sprite loading is cached');
});
test('failed sprite load leaves companion selection unchanged and cannot block the battle',async()=>{
 const saved=new Map(),store=gear.createStore({classId:'wand',storage:{getItem:key=>saved.get(key)||null,setItem:(key,val)=>saved.set(key,String(val))}});
 const element={querySelector:()=>({getContext:()=>({clearRect(){},drawImage(){}})}),style:{setProperty(){}},hidden:true};
 const actor=wolf.create({element,store,loadImage:async()=>{throw Error('offline')}});
 await assert.rejects(actor.load(),/offline/);
 assert.equal(actor.loaded(),false);
 assert.equal(store.getState().companion,'none');
 assert.equal(actor.render({x:100}),false);
});
test('game invokes the corrected wolf animation controller and exposes class companion slot',()=>{
 const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
 const js=fs.readFileSync(path.join(dist,'game.js'),'utf8');
 const ui=fs.readFileSync(path.join(dist,'equipment-ui.js'),'utf8');
 const css=fs.readFileSync(path.join(dist,'equipment.css'),'utf8');
 assert.match(html,/data-equipment-slot="companion"/);
 assert.doesNotMatch(html,/data-equipment-slot="boots"/);
 assert.match(html,/id="companion-wolf"/);
 assert.match(html,/src="companion.js\?v=wolf-return-2"/);
 assert.match(js,/companion\?\.render\(/);
 assert.match(js,/direction:walkDirection/);
 assert.match(js,/action:wolfFallen\|\|wolfDefeatedWithHero\?'die':null/);
 assert.match(js,/if\(slot==='companion'\)/);
 assert.match(ui,/paintCompanion\?\.\(ctx,pose\)/);
 assert.match(css,/background:url\('assets\/companions\/wolf\.png'\) -160px -28px\/320px 192px/);
});

test('Archer wolf runs to the enemy before starting its own timed bite',async()=>{
 const h=harness();await h.actor.load();h.store.equip('companion','wolf');
 const target={id:'archer1',x:460,width:64,depth:2,hp:60};
 let hit=null,time=0,sawRun=false,sawBite=false;
 for(let i=0;i<80&&!hit;i++,time=Math.round((time+.1)*1000)/1000){
   hit=h.actor.advance({dt:.1,time,phase:'running',heroX:150,heroSize:64,heroDepth:3,target});
   const pose=h.actor.getPose();
   sawRun ||= pose.motion==='run';sawBite ||= pose.motion==='bite';
   h.actor.render({time,x:150,heroSize:64,laneStep:8});
 }
 assert.equal(sawRun,true);assert.equal(sawBite,true);
 assert.deepEqual(hit,{targetId:'archer1',damage:7});
 assert.ok(time>2.0,'wolf cannot strike from Archer spawn position');
 assert.ok(Math.abs(h.actor.getPose().depth-target.depth)<.05);
 const before=h.actor.getPose();
 assert.equal(h.actor.advance({dt:.1,time,phase:'paused',heroX:150,heroSize:64,heroDepth:3,target}),null);
 assert.equal(h.actor.getPose().x,before.x);
 const aborted=h.actor.advance({dt:.1,time:time+.1,phase:'running',heroX:150,heroSize:64,heroDepth:3,target:null});
 assert.equal(aborted,null,'a dead target never receives a second bite');
 assert.equal(h.actor.getPose().biteTarget,null);
 let returned=false;
 for(let n=0;n<40;n++){
   h.actor.advance({dt:.1,time:time+.2+n*.1,phase:'intermission',heroX:150,heroSize:64,heroDepth:3});
   if(Math.abs(h.actor.getPose().x-(150-64*.83))<1.1){returned=true;break;}
 }
 assert.equal(returned,true,'wolf runs back to Archer after the wave');
 h.actor.reset();assert.equal(h.actor.getPose().x,null);
 h.store.equip('companion','none');
 assert.equal(h.actor.advance({dt:3,time:15,heroX:150,target}),null);
 assert.equal(h.actor.render({time:15,x:150}),false);
});

test('Wolf is unusable on Warrior and Mage even from migrated save data',async()=>{
 for(const classId of ['sword','wand']){
   const saved=new Map([['ember.equipment.v1',JSON.stringify({version:1,byClass:{[classId]:{companion:'wolf'}}})]]);
   const store=gear.createStore({classId,storage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)}});
   const element={hidden:true,style:{setProperty(){}},dataset:{},querySelector:()=>({getContext:()=>({clearRect(){},drawImage(){}})})};
   const wolfActor=wolf.create({element,store,loadImage:async()=>({width:640,height:384})});
   await wolfActor.load();
   assert.equal(store.getState().companion,'none');
   assert.equal(store.equip('companion','wolf').ok,false);
   assert.equal(wolfActor.advance({dt:1,time:1,heroX:150,target:{id:'archer1',x:250,width:64,depth:2,hp:60}}),null);
   assert.equal(wolfActor.render({time:1,x:150}),false);
 }
});

test('wolf returns to a fixed Archer anchor instead of chasing the exit animation offscreen',async()=>{
 const h=harness();await h.actor.load();h.store.equip('companion','wolf');
 const target={id:'archer1',x:410,width:64,depth:4,hp:60};
 let time=0;
 for(let i=0;i<35;i++,time+=.1)
   h.actor.advance({dt:.1,time,phase:'running',heroX:150,anchorX:150,heroSize:64,heroDepth:3,target});
 assert.ok(h.actor.getPose().x>200,'wolf first travels toward the enemy');
 const home=150-64*.83;
 let furthest=-Infinity,returned=false;
 for(let i=0;i<40;i++,time+=.1){
   const exitingHeroX=250+i*35;
   h.actor.advance({dt:.1,time,phase:'intermission',heroX:exitingHeroX,
     anchorX:150,heroSize:64,heroDepth:3,target:null});
   const pose=h.actor.getPose();
   furthest=Math.max(furthest,pose.x);
   if(Math.abs(pose.x-home)<1)returned=true;
   h.actor.render({time,x:exitingHeroX,laneStep:8,heroSize:64,depth:3});
 }
 assert.equal(returned,true,'wolf reaches the genuine stationary Archer home');
 assert.ok(furthest<420,'it never follows the exiting hero thousands of pixels away');
 assert.ok(Math.abs(h.actor.getPose().x-home)<1,'wolf stays home after arrival');
 assert.equal(h.actor.getPose().motion,'idle');
 assert.equal(h.actor.getPose().facing,1,'returning wolf correctly faces left');
 assert.ok(Math.abs(h.actor.getPose().depth-3)<.01,'wolf returns to Archer lane too');
 assert.ok(Math.abs(Number.parseFloat(h.element.style.left)-home)<1,
   'rendered wolf x stays anchored while the hero crosses the wave fade');
});
test('wolf displays its head in front of the same-depth enemy during a bite',async()=>{
 const h=harness();await h.actor.load();h.store.equip('companion','wolf');
 const target={id:'orc',x:360,width:148,depth:4,hp:100};
 const contact=wolf.contact;
 assert.ok(contact.enemy>.5,'wolf must stop near the visible edge of a 2x Orc');
 const expected=target.x-target.width*contact.enemy-64*contact.companion;
 let time=0;
 for(let i=0;i<50&&h.actor.getPose().motion!=='bite';i++,time+=.1)
   h.actor.advance({dt:.1,time,phase:'running',heroX:130,
     anchorX:130,heroSize:64,heroDepth:3,target});
 const pose=h.actor.getPose();
 assert.equal(pose.motion,'bite');
 assert.ok(Math.abs(pose.x-expected)<=1,'the wolf stops before the enlarged Orc sprite');
 h.actor.render({time,heroSize:64,depth:3,laneStep:9});
 const wolfLayer=Number(h.element.style.zIndex);
 const enemyLayer=Math.round(100+(target.depth-1)*100);
 assert.ok(wolfLayer>enemyLayer,'attacking wolf must render above target at equal depth');
 assert.equal(h.element.dataset.motion,'bite');
 assert.equal(h.element.dataset.facing,'right');
 assert.ok(pose.x+64*.5<target.x-target.width*.5+18,
   'the wolf muzzle is not swallowed by the oversized enemy');
});
test('Orc uses a true double-size layout box across all responsive breakpoints',()=>{
 const css=fs.readFileSync(path.join(dist,'game.css'),'utf8');
 const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
 assert.match(css,/\.fighter\.enemy-one\[data-fighter="orc"\]\s*\{\s*width:calc\(var\(--enemy-size\) \* 2\);\s*height:calc\(var\(--enemy-size\) \* 2\)/);
 assert.match(html,/data-fighter="orc"/);
 const game=fs.readFileSync(path.join(dist,'game.js'),'utf8');
 assert.match(game,/window\.EmberCompanion\?\.contact/);
 assert.match(game,/anchorX:battlefield\.clientWidth/);
});
