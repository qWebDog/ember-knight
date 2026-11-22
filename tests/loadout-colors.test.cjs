'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalogue = require('../dist/loadouts.js');
const dist = path.resolve(__dirname, '../dist');
const skins = ['light','amber','olive','bronze','brown','black'];
const signature = Buffer.from([137,80,78,71,13,10,26,10]);

test('three weapons have exactly one fixed silhouette each and six independent clothing colors', () => {
  assert.deepEqual(catalogue.weapons.map(weapon => [weapon.id, weapon.outfits.map(outfit => [outfit.id,outfit.name])]), [
    ['sword',[['militia','Ополченец']]],
    ['bow',[['wanderer','Странник']]],
    ['wand',[['acolyte','Послушник']]]
  ]);
  assert.equal(catalogue.colors.length, 6);
  assert.equal(new Set(catalogue.colors.map(color => color.id)).size, 6);
  for (const color of catalogue.colors) {
    assert.ok(color.name);
    assert.match(color.swatch, /^#[\da-f]{6}$/i);
    assert.equal(catalogue.color(color.id), color);
  }
  for (const weapon of catalogue.weapons) assert.ok(catalogue.color(weapon.defaultColor));
});

test('all 108 weapon/color/skin combinations have unique paths and renderer-compatible PNG sheets', () => {
  const dimensions = {
    sword:{walk:[576,256],attack:[768,512],preview:[64,64]},
    bow:{walk:[1152,512],attack:[832,256],preview:[64,64]},
    wand:{walk:[576,256],attack:[384,256],preview:[64,64]}
  };
  const paths = new Set();
  let combinations = 0;
  for (const weapon of catalogue.weapons) for (const color of catalogue.colors) for (const skin of skins) {
    const choice = {weapon:weapon.id,outfit:weapon.outfits[0].id,outfitColor:color.id};
    for (const animation of ['walk','attack','preview']) {
      const relative = catalogue.path(choice,skin,animation);
      assert.equal(relative, `assets/characters/loadouts/${choice.weapon}/${choice.outfit}/${color.id}/${skin}-${animation}.png`);
      assert.ok(!paths.has(relative), `duplicate asset path: ${relative}`);
      paths.add(relative);
      const png = fs.readFileSync(path.join(dist,relative));
      assert.deepEqual(png.subarray(0,8), signature, relative);
      assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)], dimensions[weapon.id][animation], relative);
      if (animation !== 'preview') {
        const descriptor = weapon[animation];
        assert.deepEqual(dimensions[weapon.id][animation], [descriptor.tile*descriptor.frames,descriptor.tile*4]);
      }
    }
    combinations++;
  }
  assert.equal(combinations, 108);
  assert.equal(paths.size, 324);
});

test('legacy outfits normalize without input mutation, and valid explicit colors take precedence', () => {
  const cases = [
    ['sword','militia','militia','sand'],['sword','watchman','militia','blue'],['sword','guard','militia','red'],
    ['bow','scout','wanderer','forest'],['bow','hunter','wanderer','sand'],['bow','ranger','wanderer','forest'],
    ['wand','apprentice','acolyte','blue'],['wand','acolyte','acolyte','purple'],['wand','adept','acolyte','blue']
  ];
  for (const [weapon,oldOutfit,outfit,outfitColor] of cases) {
    const saved = Object.freeze({version:1,weapon,outfit:oldOutfit,skin:'black',name:'Старый герой',level:7,createdAt:'2026-11-20',equipment:Object.freeze([weapon,oldOutfit])});
    const before = JSON.stringify(saved);
    assert.deepEqual(catalogue.selection(saved), {weapon,outfit,outfitColor});
    for (const color of catalogue.colors) {
      const explicit = Object.freeze({...saved,outfitColor:color.id});
      assert.deepEqual(catalogue.selection(explicit), {weapon,outfit,outfitColor:color.id});
    }
    assert.equal(JSON.stringify(saved), before);
  }
  for (const weapon of catalogue.weapons) {
    assert.deepEqual(catalogue.selection({weapon:weapon.id,outfit:weapon.outfits[0].id}), {
      weapon:weapon.id,outfit:weapon.outfits[0].id,outfitColor:weapon.defaultColor
    });
  }
});

test('every sword color and skin has native short and reverse attacks with the same body anchor', () => {
  const sword = catalogue.weapon('sword');
  assert.deepEqual(Object.keys(sword.attacks), ['halfslash','slash','backslash']);
  for (const color of catalogue.colors) for (const skin of skins) {
    const choice = {weapon:'sword',outfit:'militia',outfitColor:color.id};
    for (const [variant,descriptor] of Object.entries(sword.attacks)) {
      const relative = catalogue.path(choice,skin,variant === 'slash' ? 'attack' : variant);
      const png = fs.readFileSync(path.join(dist,relative));
      assert.deepEqual(png.subarray(0,8), signature, relative);
      assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)], [descriptor.frames*128,512], relative);
      assert.equal(descriptor.tile,128);
      assert.equal(descriptor.origin,32);
      assert.equal(descriptor.frames,variant === 'backslash' ? 13 : 6);
    }
  }
  for (const weapon of ['bow','wand']) {
    const choice = {weapon,outfit:catalogue.weapon(weapon).outfits[0].id};
    assert.throws(() => catalogue.path(choice,'light','backslash'), /Invalid starter appearance/);
    assert.throws(() => catalogue.path(choice,'light','halfslash'), /Invalid starter appearance/);
  }
});

test('sword guard is an LPC pose and shields use native moving layers in every attack', () => {
  const sword=catalogue.weapon('sword');
  assert.deepEqual(sword.block,{tile:64,origin:0,frames:1});
  for(const color of catalogue.colors){
    const choice={weapon:'sword',outfit:'militia',outfitColor:color.id};
    const folder=path.join(dist,'assets/characters/loadouts/sword/militia',color.id);
    const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
    for(const animation of ['walk','attack','halfslash','backslash']){
      const shield=manifest[animation].layers.filter(layer=>layer.source.includes('/shield/'));
      assert.equal(shield.length,['walk','attack'].includes(animation)?2:4);
      for(const layer of shield){
        assert.ok(layer.source.includes('/shield/heater/original/'),'the original walk/slash family holds the shield on the offhand');
        assert.equal(layer.frameMode,'native','attack frames must never hold a standing shield');
        assert.ok(layer.source.endsWith(`/${animation==='attack'?'slash':animation}.png`));
      }
      assert.ok(!manifest[animation].layers.some(layer=>layer.frameMode.includes('standing')));
    }
    assert.equal(manifest.block.animation,'combat_idle');
    assert.ok(manifest.block.layers.every(layer=>layer.source.includes('/combat_idle')));
    assert.ok(manifest.block.layers.filter(layer=>layer.source.includes('/shield/')).every(layer=>layer.source.includes('/shield/heater/original/')));
    for(const skin of skins){
      const png=fs.readFileSync(path.join(dist,catalogue.path(choice,skin,'block')));
      assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[64,256]);
    }
  }
  for(const weapon of ['bow','wand'])assert.throws(()=>catalogue.path({weapon,outfit:catalogue.weapon(weapon).outfits[0].id},'light','block'),/Invalid starter appearance/);
  const css=fs.readFileSync(path.join(dist,'game.css'),'utf8');
  assert.doesNotMatch(css,/is-blocking\s*:{1,2}(?:before|after)/,'the shield must not be a CSS shape');
});

test('invalid selections, skins and animations cannot construct arbitrary asset paths', () => {
  const valid = {weapon:'bow',outfit:'wanderer',outfitColor:'forest'};
  for (const invalid of [null,{}, {weapon:'../../',outfit:'wanderer'}, {weapon:'bow',outfit:'../ranger'}, {weapon:'bow',outfit:'__proto__'}]) {
    assert.equal(catalogue.selection(invalid), null);
    assert.throws(() => catalogue.path(invalid,'light'), /Invalid starter appearance/);
  }
  for (const skin of ['../light','light.png','constructor',null]) assert.throws(() => catalogue.path(valid,skin), /Invalid starter appearance/);
  for (const animation of ['../walk','__proto__','attack.png',null]) assert.throws(() => catalogue.path(valid,'light',animation), /Invalid starter appearance/);
  assert.equal(catalogue.path({...valid,outfitColor:'../../secret'},'light'), catalogue.path(valid,'light'));
});
