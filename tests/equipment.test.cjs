'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {slots,catalog,defaults,key,createStore}=require('../dist/equipment.js');
const art=require('../dist/equipment-art.js');

function storage(seed={}){
  const map=new Map(Object.entries(seed));let writes=0;
  return {map,get writes(){return writes;},getItem:k=>map.get(k)??null,setItem(k,v){writes++;map.set(k,String(v));}};
}

test('equipment is six independent slots, with three distinct choices per slot',()=>{
  assert.deepEqual(slots.map(slot=>slot.id),['helmet','armor','weapon','shield','cape','boots']);
  for(const slot of slots){
    const items=catalog[slot.id];
    assert.equal(items.length,3);
    assert.equal(new Set(items.map(item=>item.id)).size,3);
    assert.equal(defaults[slot.id],items[0].id);
  }
});

test('equipping a helmet preserves five other slots and persists when reloaded',()=>{
  const memory=storage(),store=createStore({storage:memory,classId:'sword'}),events=[];
  store.subscribe((state,slot,id)=>events.push({state,slot,id}));
  assert.deepEqual(store.getState(),defaults);
  const helmet=store.equip('helmet','iron');
  assert.equal(helmet.ok,true);
  assert.deepEqual(store.getState(),{...defaults,helmet:'iron'});
  assert.equal(memory.writes,1);
  assert.equal(events.length,1);assert.equal(events[0].slot,'helmet');
  assert.equal(store.equip('armor','royal').ok,true);
  assert.deepEqual(store.getState(),{...defaults,helmet:'iron',armor:'royal'});
  const reboot=createStore({storage:memory,classId:'sword'});
  assert.deepEqual(reboot.getState(),{...defaults,helmet:'iron',armor:'royal'});
  assert.equal(store.equip('helmet','iron').unchanged,true);
  assert.equal(memory.writes,2,'equipping the same item again must not write');
});

test('wardrobe changes do not spend coins or alter character or progression saves',()=>{
  const character='{"version":1,"weapon":"sword"}',progress='{"version":1,"gold":150,"levels":{}}';
  const memory=storage({'ember.character.v1':character,'ember.progress.v1':progress});
  const store=createStore({storage:memory,classId:'sword'});
  for(const [slot,id]of [['helmet','royal'],['cape','purple'],['weapon','ember'],['shield','steel'],['boots','royal']]){
    assert.equal(store.equip(slot,id).ok,true);
  }
  assert.equal(memory.map.get('ember.character.v1'),character);
  assert.equal(memory.map.get('ember.progress.v1'),progress);
  assert.equal(JSON.parse(memory.map.get(key)).byClass.sword.cape,'purple');
});

test('class data is separate and unsupported class choices are disabled for now',()=>{
  const memory=storage(),warrior=createStore({storage:memory,classId:'sword'});
  warrior.equip('helmet','royal');
  const ranger=createStore({storage:memory,classId:'bow'});
  const mage=createStore({storage:memory,classId:'wand'});
  assert.equal(ranger.enabled,false);assert.equal(mage.enabled,false);
  assert.equal(ranger.equip('helmet','iron').reason,'class');
  assert.equal(mage.equip('weapon','steel').ok,false);
  assert.equal(warrior.getState().helmet,'royal');
  assert.equal(ranger.getState().helmet,'none');
});

test('unknown item, unavailable storage and corrupt states are safe',()=>{
  const memory=storage({[key]:'invalid-json'});
  const store=createStore({storage:memory,classId:'sword'});
  assert.deepEqual(store.getState(),defaults);
  assert.equal(store.equip('helmet','not-a-helm').reason,'invalid');
  assert.equal(memory.writes,0);
  const inaccessible={getItem(){return null;},setItem(){throw Error('blocked');}};
  const broken=createStore({storage:inaccessible,classId:'sword'});
  assert.equal(broken.equip('helmet','iron').reason,'storage');
  assert.equal(broken.getState().helmet,'none');
});

test('cosmetic renderer draws cape behind and item overlays in front without changing attack sprites',()=>{
  const calls=[];
  const ctx={save(){calls.push('save');},restore(){calls.push('restore');},translate(){},
    scale(){},fillRect(){calls.push('rect');},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){calls.push('fill');}};
  const pose={row:3,frame:2,kind:'attack',origin:32,tile:128,equipped:{
    helmet:'royal',armor:'iron',weapon:'ember',shield:'steel',cape:'red',boots:'iron'
  }};
  art.drawBack(ctx,pose);
  const back=calls.length;assert.ok(back>2);
  art.drawFront(ctx,pose);
  assert.ok(calls.length>back+10);
  assert.equal(calls.filter(x=>x==='save').length,calls.filter(x=>x==='restore').length);
  assert.doesNotThrow(()=>art.drawFront(ctx,{...pose,row:1,kind:'walk',frame:5}));
  assert.doesNotThrow(()=>art.drawFront(ctx,{...pose,equipped:defaults}));
});

test('the game has one independent equipment panel with six slots, and loads its dependencies',()=>{
  const dist=path.join(__dirname,'../dist');
  const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
  const game=fs.readFileSync(path.join(dist,'game.js'),'utf8');
  const css=fs.readFileSync(path.join(dist,'equipment.css'),'utf8');
  assert.match(html,/id="equipment-panel"[^>]*hidden/);
  assert.equal((html.match(/data-equipment-slot="(?:helmet|armor|weapon|shield|cape|boots)"/g)||[]).length,6);
  assert.match(html,/id="open-equipment-tab"/);
  assert.match(html,/id="back-skills-tab"/);
  for(const name of ['equipment.js','equipment-art.js','equipment-ui.js']){
    assert.ok(html.indexOf('src="'+name+'"')<html.indexOf('src="game.js"'));
  }
  assert.match(game,/showLowerPanel\('equipment'\)/);
  assert.match(game,/equipmentUI\?\.refreshPreview\(\)/);
  assert.match(game,/art\.drawBack\(ctx,pose\)/);
  assert.match(game,/art\.drawFront\(ctx,pose\)/);
  assert.match(css,/\.equipment-panel\[hidden\],\.skills-panel\[hidden\]/);
  assert.match(css,/overscroll-behavior-x:contain/);
});
