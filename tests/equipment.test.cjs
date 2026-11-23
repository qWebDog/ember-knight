'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {slots,catalog,defaults,supportedSlots,key,createStore}=require('../dist/equipment.js');
const art=require('../dist/equipment-art.js');
const dist=path.resolve(__dirname,'../dist');
const animations={walk:9,slash:6,halfslash:6,backslash:13,combat_idle:1};
function storage(seed={}){
  const map=new Map(Object.entries(seed));let writes=0;
  return {map,get writes(){return writes;},getItem:k=>map.get(k)??null,setItem(k,v){writes++;map.set(k,String(v));}};
}
test('helmet, armor, weapon and shield are enabled; cape and boots await native animation assets',()=>{
  assert.deepEqual(slots.map(s=>s.id),['helmet','armor','weapon','shield','cape','boots']);
  assert.deepEqual(supportedSlots,['helmet','armor','weapon','shield']);
  for(const slot of slots){
    const items=catalog[slot.id];
    assert.equal(items.length,3);
    assert.equal(new Set(items.map(item=>item.id)).size,3);
    assert.equal(defaults[slot.id],items[0].id);
  }
});
test('each enabled slot equips independently and survives reloading',()=>{
  const memory=storage(),store=createStore({storage:memory,classId:'sword'});
  assert.deepEqual(store.getState(),defaults);
  assert.equal(store.equip('helmet','iron').ok,true);
  assert.equal(store.equip('armor','royal').ok,true);
  assert.deepEqual(store.getState(),{...defaults,helmet:'iron',armor:'royal'});
  assert.equal(memory.writes,2);
  assert.deepEqual(createStore({storage:memory,classId:'sword'}).getState(),store.getState());
  assert.equal(store.equip('helmet','iron').unchanged,true);
  assert.equal(memory.writes,2);
  assert.equal(store.equip('helmet','none').ok,true);
  assert.equal(store.getState().armor,'royal');
});
test('previous placeholder cape/boots are normalized out while real native sword/shield choices remain valid',()=>{
  const previous={version:1,byClass:{sword:{...defaults,helmet:'iron',armor:'royal',weapon:'ember',shield:'steel',cape:'red',boots:'royal'}}};
  const memory=storage({[key]:JSON.stringify(previous)});
  const store=createStore({storage:memory,classId:'sword'});
  assert.deepEqual(store.getState(),{...defaults,helmet:'iron',armor:'royal',weapon:'ember',shield:'steel'});
  for(const [slot,id]of [['cape','red'],['boots','iron']]){
    assert.equal(store.equip(slot,id).reason,'unsupported');
  }
  assert.equal(store.equip('weapon','steel').ok,true);
  assert.equal(store.equip('shield','royal').ok,true);
  assert.equal(memory.writes,2);
});
test('cosmetic data does not alter gold, progression or saved character',()=>{
  const char='{"version":1,"weapon":"sword"}',progress='{"version":1,"gold":150,"levels":{}}';
  const memory=storage({'ember.character.v1':char,'ember.progress.v1':progress});
  const store=createStore({storage:memory,classId:'sword'});
  assert.equal(store.equip('helmet','royal').ok,true);
  assert.equal(store.equip('armor','iron').ok,true);
  assert.equal(memory.map.get('ember.character.v1'),char);
  assert.equal(memory.map.get('ember.progress.v1'),progress);
  assert.equal(JSON.parse(memory.map.get(key)).byClass.sword.armor,'iron');
});
test('other classes remain selectable, but cannot fit warrior-only sprites',()=>{
  const memory=storage(),warrior=createStore({storage:memory,classId:'sword'});
  warrior.equip('helmet','royal');
  const ranger=createStore({storage:memory,classId:'bow'}),mage=createStore({storage:memory,classId:'wand'});
  assert.equal(ranger.enabled,false);assert.equal(mage.enabled,false);
  assert.equal(ranger.equip('helmet','iron').reason,'class');
  assert.equal(mage.equip('armor','royal').ok,false);
  assert.equal(warrior.getState().helmet,'royal');
});
test('storage failures never grant equipment and bad values are rejected',()=>{
  const memory=storage({[key]:'invalid-json'}),store=createStore({storage:memory,classId:'sword'});
  assert.deepEqual(store.getState(),defaults);
  assert.equal(store.equip('helmet','unknown').reason,'invalid');
  const denied=createStore({classId:'sword',storage:{getItem(){return null;},setItem(){throw Error('blocked');}}});
  assert.equal(denied.equip('helmet','iron').reason,'storage');
  assert.equal(denied.getState().helmet,'none');
});
test('native LPC image files are present and have compatible frames and four directions',()=>{
  for(const slot of ['helmet','armor'])for(const id of ['iron','royal'])for(const [animation,frames] of Object.entries(animations)){
    const relative=art.imagePath(slot,id,animation),full=path.join(dist,relative),png=fs.readFileSync(full);
    assert.equal(png.subarray(1,4).toString(),'PNG',relative);
    const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
    assert.equal(height,4*64,relative);
    assert.equal(width%64,0,relative);
    assert.ok(width>=frames*64,relative+' must contain '+frames+' cells');
  }
});
test('official LPC layers follow exact same frame, direction and 128px origin as warrior pose',async()=>{
  const requested=[];
  const viewer=art.create({loadImage:async src=>{
    requested.push(src);
    const file=fs.readFileSync(path.join(dist,src));
    return {src,width:file.readUInt32BE(16),height:file.readUInt32BE(20),naturalWidth:file.readUInt32BE(16),naturalHeight:file.readUInt32BE(20)};
  }});
  const worn={...defaults,helmet:'iron',armor:'royal'};
  await viewer.prepareLook(worn);
  assert.equal(requested.length,10,'5 animations for each selected item');
  const cases=[
    [{kind:'walk',variant:null,row:3,frame:5,tile:64,origin:0},'walk',5,3,0],
    [{kind:'attack',variant:'slash',row:1,frame:4,tile:128,origin:32},'slash',4,1,32],
    [{kind:'attack',variant:'halfslash',row:3,frame:2,tile:128,origin:32},'halfslash',2,3,32],
    [{kind:'attack',variant:'backslash',row:0,frame:12,tile:128,origin:32},'backslash',12,0,32],
    [{kind:'block',variant:null,row:2,frame:0,tile:64,origin:0},'combat_idle',0,2,0],
    [{kind:'idle',variant:null,row:2,frame:0,tile:64,origin:0},'walk',0,2,0]
  ];
  for(const [pose,mode,frame,row,origin] of cases){
    const calls=[];
    const ctx={drawImage:(img,...geometry)=>calls.push({src:img.src,geometry})};
    assert.equal(viewer.draw(ctx,{...pose,equipped:worn}),2);
    assert.equal(calls.length,2);
    assert.ok(calls[0].src.endsWith('/armor/royal/'+mode+'.png'));
    assert.ok(calls[1].src.endsWith('/helmet/iron/'+mode+'.png'));
    for(const call of calls)assert.deepEqual(call.geometry,[frame*64,row*64,64,64,origin,origin,64,64]);
  }
  assert.equal(viewer.draw({drawImage(){throw Error('Unexpected');}},{row:2,frame:0,tile:64,kind:'idle',equipped:defaults}),0);
  assert.equal(viewer.draw({drawImage(){throw Error('Unexpected');}},{row:4,frame:0,tile:64,kind:'walk',equipped:worn}),0);
  await viewer.prepareLook(worn);assert.equal(requested.length,10,'cached sheets should not reload');
});
test('the game uses native LPC animation atlases, not synthetic equipment drawings',()=>{
  const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
  const game=fs.readFileSync(path.join(dist,'game.js'),'utf8');
  const renderer=fs.readFileSync(path.join(dist,'equipment-art.js'),'utf8');
  assert.match(html,/id="equipment-panel"[^>]*hidden/);
  assert.equal((html.match(/data-equipment-slot="(?:helmet|armor|weapon|shield|cape|boots)"/g)||[]).length,6);
  assert.match(game,/equipmentArt\.draw\(ctx,pose\)/);
  assert.match(game,/variant:attacking\?\(actor\.animation\?\.variant\|\|'slash'\)/);
  assert.match(game,/equipmentArt\.prepareLook\(equipment\.getState\(\)\)/);
  assert.doesNotMatch(renderer,/fillRect\(|lineTo\(/);
  assert.match(renderer,/ctx\.drawImage\(image,col\*frameSize,row\*frameSize/);
});
