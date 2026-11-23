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
test('helmet, armor, weapon, shield and native cape are enabled; boots await assets',()=>{
  assert.deepEqual(slots.map(s=>s.id),['helmet','armor','weapon','shield','cape','boots']);
  assert.deepEqual(supportedSlots,['helmet','armor','weapon','shield','cape']);
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
  assert.equal(store.equip('cape','red').reason,'invalid');
  assert.equal(store.equip('boots','iron').reason,'unsupported');
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
test('Archer and Mage have independent LPC inventory saves and four active class slots',()=>{
  const memory=storage(),warrior=createStore({storage:memory,classId:'sword'});
  warrior.equip('helmet','royal');
  const ranger=createStore({storage:memory,classId:'bow'});
  const mage=createStore({storage:memory,classId:'wand'});
  assert.equal(ranger.enabled,true);assert.equal(mage.enabled,true);
  assert.equal(ranger.equip('helmet','iron').ok,true);
  assert.equal(ranger.equip('weapon','ember').ok,true);
  assert.equal(ranger.equip('shield','royal').ok,true);
  assert.equal(mage.equip('armor','royal').ok,true);
  assert.equal(mage.equip('weapon','steel').ok,true);
  assert.equal(mage.equip('shield','steel').ok,true);
  assert.equal(ranger.getState().helmet,'iron');
  assert.equal(ranger.getState().weapon,'ember');
  assert.equal(mage.getState().armor,'royal');
  assert.equal(mage.getState().shield,'steel');
  assert.equal(warrior.getState().helmet,'royal');
  assert.equal(warrior.getState().weapon,'basic');
  const after=createStore({storage:memory,classId:'bow'});
  assert.equal(after.getState().shield,'royal');
  assert.equal(mage.equip('cape','solid').ok,true);
  assert.equal(mage.getState().cape,'solid');
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
test('armor, native shield foreground, helmet and sword obey original LPC zPos order',async()=>{
  const requested=[];
  const viewer=art.create({loadImage:async src=>{
    requested.push(src);
    // Foreground assets are generated by the Pages builder. The stand-alone
    // unit workflow can exercise identical geometry without binary outputs.
    if(src.includes('/front-layers/')){
      const mode=src.split('/').at(-1).replace('.png','');
      const g=art.poses[mode];
      return {src,width:g.frames*g.tile,height:4*g.tile,
        naturalWidth:g.frames*g.tile,naturalHeight:4*g.tile};
    }
    const file=fs.readFileSync(path.join(dist,src));
    return {src,width:file.readUInt32BE(16),height:file.readUInt32BE(20),
      naturalWidth:file.readUInt32BE(16),naturalHeight:file.readUInt32BE(20)};
  }});
  const worn={...defaults,helmet:'iron',armor:'royal',weapon:'ember',shield:'steel'};
  await viewer.prepareLook(worn);
  assert.equal(requested.length,20,'four selected parts, five native poses each');
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
    assert.equal(viewer.draw(ctx,{...pose,equipped:worn}),4);
    assert.deepEqual(calls.map(c=>c.src.includes('/front-layers/')?
      c.src.split('/front-layers/')[1].split('/')[0]:
      c.src.split('/lpc/')[1].split('/')[0]),
    ['armor','shield','helmet','weapon']);
    assert.ok(calls[0].src.endsWith('/armor/royal/'+mode+'.png'));
    assert.ok(calls[1].src.endsWith('/shield/steel/'+mode+'.png'));
    assert.ok(calls[2].src.endsWith('/helmet/iron/'+mode+'.png'));
    assert.ok(calls[3].src.endsWith('/weapon/ember/'+mode+'.png'));
    assert.deepEqual(calls[0].geometry,[frame*64,row*64,64,64,origin,origin,64,64]);
    assert.deepEqual(calls[1].geometry,[frame*pose.tile,row*pose.tile,pose.tile,pose.tile,0,0,pose.tile,pose.tile]);
    assert.deepEqual(calls[2].geometry,[frame*64,row*64,64,64,origin,origin,64,64]);
    assert.deepEqual(calls[3].geometry,[frame*pose.tile,row*pose.tile,pose.tile,pose.tile,0,0,pose.tile,pose.tile]);
  }
  assert.equal(viewer.draw({drawImage(){throw Error('Unexpected');}},{row:2,frame:0,tile:64,kind:'idle',equipped:defaults}),0);
  assert.equal(viewer.draw({drawImage(){throw Error('Unexpected');}},{row:4,frame:0,tile:64,kind:'walk',equipped:worn}),0);
  await viewer.prepareLook(worn);
  assert.equal(requested.length,20,'native sprite sheets are cached');
});
test('shield repaints above armor, without changing sword when only armor is selected',async()=>{
  const viewer=art.create({loadImage:async src=>{
    const mode=src.split('/').at(-1).replace('.png',''),g=art.poses[mode];
    const tile=src.includes('/front-layers/')?g.tile:64;
    return {src,naturalWidth:g.frames*tile,naturalHeight:4*tile};
  }});
  await viewer.prepareLook({...defaults,armor:'iron'});
  const draws=[];
  assert.equal(viewer.draw({drawImage:(img)=>draws.push(img.src)},
    {equipped:{...defaults,armor:'iron'},kind:'block',row:2,frame:0,tile:64,origin:0}),3);
  assert.deepEqual(draws.map(x=>x.includes('/front-layers/')?
    x.split('/front-layers/')[1].split('/')[0]:x.split('/lpc/')[1].split('/')[0]),
    ['armor','shield','weapon']);
});
test('generated foreground LPC atlases exist and have original 64/128px layout',()=>{
  if(process.env.EMBER_SWORD_PACKS_BUILT!=='1')return;
  for(const slot of ['weapon','shield']){
    for(const id of slot==='weapon'?['basic','steel','ember']:['basic','steel','royal']){
      for(const [mode,geometry] of Object.entries(art.poses)){
        const f=path.join(dist,art.imagePath(slot,id,mode)),png=fs.readFileSync(f);
        assert.equal(png.subarray(1,4).toString(),'PNG',f);
        assert.equal(png.readUInt32BE(16),geometry.frames*geometry.tile,f);
        assert.equal(png.readUInt32BE(20),4*geometry.tile,f);
      }
    }
  }
});
test('the game uses native LPC animation atlases, not synthetic equipment drawings',()=>{
  const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
  const game=fs.readFileSync(path.join(dist,'game.js'),'utf8');
  const renderer=fs.readFileSync(path.join(dist,'equipment-art.js'),'utf8');
  assert.match(html,/id="equipment-panel"[^>]*hidden/);
  assert.equal((html.match(/data-equipment-slot="(?:helmet|armor|weapon|shield|cape|boots)"/g)||[]).length,6);
  assert.match(game,/equipmentArt\.draw\(ctx,gearPose\)/);
  assert.match(game,/variant:attacking\?\(actor\.animation\?\.variant\|\|'slash'\)/);
  assert.match(game,/equipmentArt\.prepareLook\(equipment\.getState\(\)\)/);
  assert.doesNotMatch(renderer,/fillRect\(|lineTo\(/);
  assert.match(renderer,/ctx\.drawImage\(image,col\*frameSize,row\*frameSize/);
  assert.match(renderer,/if\(withArmor\)drawLayer\('shield',worn\.shield\)/);
  assert.match(renderer,/if\(withArmor\|\|withHelmet\)drawLayer\('weapon',worn\.weapon\)/);
});
