'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const data=require('../dist/equipment.js');
const dist=path.resolve(__dirname,'../dist');

test('all three classes have transparent LPC item portrait paths for every selectable item',()=>{
  let total=0;
  for(const classId of ['sword','bow','wand']){
    const catalog=data.catalogForClass(classId);
    for(const slot of ['helmet','armor','weapon','shield','cape']){
      for(const item of catalog[slot]){
        const src=data.itemIconPath(classId,slot,item.id,'forest');
        assert.match(src,new RegExp('^assets/equipment/icons/'+classId+'/'+slot+'/'));
        assert.match(src,/\.png$/);
        assert.doesNotMatch(src,/\.\.|\/\//);
        total++;
      }
    }
    for(const slot of ['companion'])assert.equal(
      data.itemIconPath(classId,slot,catalog[slot][0].id),null,
      'unavailable slots should not advertise fake item icons');
  }
  assert.equal(total,43);
  assert.equal(data.itemIconPath('invalid','helmet','basic'),null);
  assert.equal(data.itemIconPath('bow','helmet','fake'),null);
});

test('original shirt and hood colors track the currently selected hero outfit',()=>{
  for(const classId of ['sword','wand']){
    const slot='armor';
    const first=data.itemIconPath(classId,slot,'basic','sand');
    const other=data.itemIconPath(classId,slot,'basic','purple');
    assert.notEqual(first,other);
    assert.match(first,/\/basic\/sand\.png$/);
    assert.match(other,/\/basic\/purple\.png$/);
  }
  for(const classId of ['bow','wand']){
    assert.notEqual(
      data.itemIconPath(classId,'helmet','basic','sand'),
      data.itemIconPath(classId,'helmet','basic','red'));
  }
  assert.equal(data.itemIconPath('sword','helmet','iron','red'),
    data.itemIconPath('sword','helmet','iron','blue'));
  assert.match(data.itemIconPath('wand','armor','basic','bad-color'),/\/sand\.png$/);
});

test('item buttons contain only a real image and the name, never a color swatch or descriptive subtitle',()=>{
  const js=fs.readFileSync(path.join(dist,'equipment-ui.js'),'utf8');
  const css=fs.readFileSync(path.join(dist,'equipment.css'),'utf8');
  const game=fs.readFileSync(path.join(dist,'game.js'),'utf8');
  assert.match(js,/createElement\('img'\)/);
  assert.match(js,/image\.src=data\.itemIconPath\(store\.classId,slot,item\.id,outfitColor,store\.getColor\(slot,item\.id\)\)/);
  assert.match(js,/image\.alt=''/);
  assert.match(js,/name\.textContent=item\.name/);
  assert.doesNotMatch(js,/item\.tone|item\.detail|equipment-item-swatch|createElement\('small'\)/);
  assert.doesNotMatch(css,/equipment-item-swatch/);
  assert.match(css,/\.equipment-item-image\{[^}]*image-rendering:pixelated/);
  assert.match(css,/\.equipment-item-art\{/);
  assert.match(game,/outfitColor:loadout\?\.outfitColor\|\|'sand'/);
  assert.match(js,/store\.equip\(slot,item\.id\)/);
  assert.match(js,/aria-pressed/);
});

test('the Pages build generates nonempty transparent LPC portraits for every displayed item',()=>{
  if(process.env.EMBER_EQUIPMENT_ICONS_BUILT!=='1')return;
  const folder=path.join(dist,'assets/equipment/icons');
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
  assert.equal(manifest.iconSize,64);
  assert.equal(manifest.icons.length,531);
  const included=new Set();
  for(const row of manifest.icons){
    assert.ok(row.path.startsWith('assets/equipment/icons/'));
    assert.ok(!included.has(row.path),'duplicate item icon: '+row.path);
    included.add(row.path);
    const png=fs.readFileSync(path.join(dist,row.path));
    assert.equal(png.subarray(1,4).toString(),'PNG',row.path);
    assert.equal(png.readUInt32BE(16),64,row.path);
    assert.equal(png.readUInt32BE(20),64,row.path);
    assert.ok(png.length>150,'unexpected empty asset: '+row.path);
  }
  for(const cls of ['sword','bow','wand'])
    for(const slot of ['helmet','armor','weapon','shield','cape'])
      for(const item of data.catalogForClass(cls)[slot]){
        const ref=data.itemIconPath(cls,slot,item.id,'sand');
        assert.ok(included.has(ref),'missing item portrait: '+ref);
      }
});
