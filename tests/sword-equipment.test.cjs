'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const library=require('../dist/sword-equipment.js');
const {catalog,supportedSlots,createStore}=require('../dist/equipment.js');
const dist=path.join(__dirname,'../dist');

test('swords and shields are independent, with native palette variants',()=>{
  assert.ok(supportedSlots.includes('weapon')&&supportedSlots.includes('shield'));
  assert.deepEqual(catalog.weapon.map(o=>o.id),['basic','steel','ember']);
  assert.deepEqual(catalog.shield.map(o=>o.id),['basic','steel','royal']);
  const data=new Map(),storage={
    getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v))
  };
  const s=createStore({storage,classId:'sword'});
  assert.equal(s.equip('weapon','ember').ok,true);
  assert.equal(s.equip('shield','steel').ok,true);
  assert.equal(s.getState().weapon,'ember');
  assert.equal(s.getState().shield,'steel');
  assert.equal(s.equip('weapon','basic').ok,true);
  assert.equal(s.getState().shield,'steel');
});

test('all warrior action poses resolve to original or fully composed LPC image',()=>{
  const cfg={skin:'light',color:'sand',standardPath:p=>'standard/'+p+'.png'};
  const names=Object.keys(library.poses);
  assert.deepEqual(names,['walk','attack','halfslash','backslash','block']);
  for(const pose of names){
    assert.equal(library.path({...cfg,look:{weapon:'basic',shield:'basic'},pose}),
      'standard/'+pose+'.png');
    assert.equal(library.path({...cfg,look:{weapon:'steel',shield:'royal'},pose}),
      'assets/equipment/sword-packs/sand/light-steel-royal-'+pose+'.png');
    assert.equal(library.path({...cfg,look:{weapon:'ember',shield:'basic'},pose}),
      'assets/equipment/sword-packs/sand/light-ember-basic-'+pose+'.png');
  }
  assert.throws(()=>library.path({...cfg,look:{weapon:'gold',shield:'basic'},pose:'walk'}));
  assert.throws(()=>library.path({...cfg,look:{weapon:'basic',shield:'basic'},pose:'spin'}));
});

test('all five poses load atomically, validate dimensions and remain cached',async()=>{
  const paths=[];
  const loader=library.create({
    skin:'olive',color:'purple',
    standardPath:pose=>'original/'+pose+'.png',
    async loadImage(src){
      paths.push(src);
      const pose=Object.keys(library.poses).find(id=>src.endsWith('/'+id+'.png')||src.endsWith('-'+id+'.png'));
      const {frames,tile}=library.poses[pose];
      return {src,naturalWidth:frames*tile,naturalHeight:4*tile};
    }
  });
  const gear={weapon:'steel',shield:'royal'},images=await loader.load(gear);
  assert.equal(Object.keys(images).length,5);
  assert.equal(paths.length,5);
  assert.ok(paths.every(p=>p.includes('olive-steel-royal-')));
  assert.strictEqual(await loader.load(gear),images);
  assert.equal(paths.length,5);
  const defaultGear={weapon:'basic',shield:'basic'};
  await loader.load(defaultGear);
  assert.equal(paths.length,10);
  assert.ok(paths.slice(5).every(p=>p.startsWith('original/')));
});

test('failed animation load is not exposed as a partial equipment change',async()=>{
  let failures=0;
  const loader=library.create({skin:'amber',color:'blue',
    standardPath:p=>p,loadImage:async src=>{
      if(src.endsWith('backslash.png')&&failures++===0)throw Error('network failed');
      const id=Object.keys(library.poses).find(p=>src.endsWith('-'+p+'.png')||src===p);
      const meta=library.poses[id];
      return {src,naturalWidth:meta.frames*meta.tile,naturalHeight:meta.tile*4};
    }
  });
  await assert.rejects(loader.load({weapon:'ember',shield:'basic'}));
  const second=await loader.load({weapon:'ember',shield:'basic'});
  assert.equal(Object.keys(second).length,5);
});

test('the battle replaces original sword/sheild sprites rather than overlaying duplicates',()=>{
  const game=fs.readFileSync(path.join(dist,'game.js'),'utf8');
  const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
  const builder=fs.readFileSync(path.join(__dirname,'../scripts/build-equipment-variants.py'),'utf8');
  assert.match(html,/src="sword-equipment.js"/);
  assert.match(game,/swordEquipment\.load\(nextLook\)/);
  assert.match(game,/equipmentArt\?\.prepareLook\(nextLook\)/);
  assert.match(game,/applySwordSprites\(loadedSwordSprites\)/);
  assert.match(game,/swordSprites\?\.walk/);
  assert.match(builder,/ImageChops\.difference\(baseline, default\)/);
  assert.match(builder,/weapon\/sword\/arming\/attack_/);
  assert.match(builder,/shield\/heater\/original/);
  assert.doesNotMatch(builder,/mirror|flip\(/);
});

test('generated native full-composite sheets match required dimensions after build',()=>{
  if(process.env.EMBER_SWORD_PACKS_BUILT!=='1')return;
  const names=Object.keys(library.poses);
  for(const skin of ['light','black'])for(const color of ['sand','purple']){
    for(const choice of [{weapon:'steel',shield:'basic'},{weapon:'basic',shield:'royal'},
      {weapon:'ember',shield:'steel'}]){
      for(const pose of names){
        const url=library.path({skin,color,look:choice,pose,
          standardPath:p=>'wrong/original/'+p+'.png'});
        const png=fs.readFileSync(path.join(dist,url));
        assert.equal(png.subarray(1,4).toString(),'PNG');
        const meta=library.poses[pose];
        assert.equal(png.readUInt32BE(16),meta.frames*meta.tile,url);
        assert.equal(png.readUInt32BE(20),4*meta.tile,url);
      }
    }
  }
});
