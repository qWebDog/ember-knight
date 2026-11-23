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
 const element={hidden:true,style:{setProperty(name,value){this[name]=value}},
  querySelector:selector=>selector==='canvas'?canvas:null};
 const loadPaths=[];
 const art={src:wolf.path,width:640,height:384};
 const actor=wolf.create({element,store,loadImage:async src=>{loadPaths.push(src);return art;}});
 return {draws,ctx,canvas,element,actor,store,loadPaths};
}
test('original commissioned CC BY 4.0 wolf sheet is embedded with proper attribution',()=>{
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
test('companion stays hidden unless selected, uses original frames, and follows the hero',async()=>{
 const h=harness();await h.actor.load();
 assert.equal(h.actor.loaded(),true);
 assert.equal(h.actor.render({time:.125,x:120}),false);
 assert.equal(h.element.hidden,true);
 assert.equal(h.store.equip('companion','wolf').ok,true);
 assert.equal(h.actor.render({time:0,x:160,heroSize:64,depth:4,laneStep:9,moving:true,alive:true}),true);
 assert.equal(h.element.hidden,false);
 assert.equal(h.element.style.left,'106.88px');
 assert.equal(h.element.style['--lane-offset'],'9px');
 assert.deepEqual(h.draws.at(-1).slice(1,5),[320,0,64,64]);
 h.actor.render({time:.125,x:170,heroSize:64,depth:4,laneStep:9,moving:true});
 assert.deepEqual(h.draws.at(-1).slice(1,5),[384,0,64,64]);
 const before=h.draws.length;
 h.actor.render({time:.125,x:185,heroSize:64,depth:4,laneStep:9,moving:true});
 assert.equal(h.draws.length,before,'paused active time freezes walk frame');
 h.actor.render({time:.5,x:185,moving:true,reducedMotion:true});
 assert.deepEqual(h.draws.at(-1).slice(1,5),[320,0,64,64]);
 assert.equal(h.actor.render({x:120,alive:false}),false);
 assert.equal(h.element.hidden,true);
 assert.equal(h.store.equip('companion','none').ok,true);
 assert.equal(h.actor.render({time:2}),false);
});
test('equipment portrait paints equipped wolf without modifying the class sprite',async()=>{
 const h=harness();await h.actor.load();
 assert.equal(h.actor.paintPreview(h.ctx,{row:2}),false);
 h.store.equip('companion','wolf');
 assert.equal(h.actor.paintPreview(h.ctx,{row:2}),true);
 assert.deepEqual(h.draws.at(-1).slice(1),[0,0,64,64,40,36,24,24]);
 assert.equal(h.actor.paintPreview(h.ctx,{row:1}),true);
 assert.deepEqual(h.draws.at(-1).slice(1),[320,0,64,64,40,36,24,24]);
 const savedCount=h.loadPaths.length;await h.actor.load();
 assert.equal(h.loadPaths.length,savedCount,'sprite loading is cached');
});
test('a failed sprite load never leaves partial equipment or rejects the battle itself',async()=>{
 const save=new Map(),store=gear.createStore({classId:'wand',storage:{getItem:key=>save.get(key)||null,setItem:(key,val)=>save.set(key,String(val))}});
 const element={querySelector:()=>({getContext:()=>({clearRect(){},drawImage(){}})}),style:{setProperty(){}},hidden:true};
 const actor=wolf.create({element,store,loadImage:async()=>{throw Error('offline')}});
 await assert.rejects(actor.load(),/offline/);
 assert.equal(actor.loaded(),false);
 assert.equal(store.getState().companion,'none');
 assert.equal(actor.render({x:100}),false);
});
test('battle scene and UI expose a dedicated companion without replacing the hero or stopping combat',()=>{
 const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
 const js=fs.readFileSync(path.join(dist,'game.js'),'utf8');
 const ui=fs.readFileSync(path.join(dist,'equipment-ui.js'),'utf8');
 assert.match(html,/data-equipment-slot="companion"/);
 assert.doesNotMatch(html,/data-equipment-slot="boots"/);
 assert.match(html,/id="companion-wolf"/);
 assert.match(html,/src="companion.js\?v=wolf-companion-1"/);
 assert.match(js,/companion\?\.render\(/);
 assert.match(js,/if\(slot==='companion'\)/);
 assert.match(ui,/paintCompanion\?\.\(ctx,pose\)/);
});
