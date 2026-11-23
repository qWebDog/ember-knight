'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const gear=require('../dist/class-equipment.js');
const eq=require('../dist/equipment.js');
const dist=path.join(__dirname,'../dist');

function look(overrides={}){return {helmet:'basic',armor:'basic',weapon:'basic',shield:'basic',...overrides};}
function fullPath(kind,color,skin,pose,suffix){
  return path.join(dist,'assets/equipment/class-layers',kind,'base',color,skin,pose+'-'+suffix+'.png');
}
test('Archer gets original animated bow and quiver, Mage a wand and belt',()=>{
  const archer=eq.catalogForClass('bow'),mage=eq.catalogForClass('wand');
  assert.deepEqual(eq.supportedForClass('bow'),['helmet','armor','weapon','shield']);
  assert.deepEqual(eq.supportedForClass('wand'),['helmet','armor','weapon','shield']);
  assert.equal(eq.slotLabel('bow','shield'),'Колчан');
  assert.equal(eq.slotLabel('wand','shield'),'Пояс');
  assert.equal(eq.slotLabel('sword','shield'),'Щит');
  for(const items of [archer,mage]){
    for(const slot of ['helmet','armor','weapon','shield'])assert.equal(items[slot].length,3);
  }
  assert.match(archer.weapon[1].name,/лук/i);
  assert.match(mage.weapon[1].name,/палочка/i);
});

test('LPC layers preserve z-order and class-specific original pose dimensions',()=>{
  const bow=gear.paths({classId:'bow',skin:'olive',color:'forest',look:look({
    helmet:'iron',armor:'royal',weapon:'ember',shield:'steel'
  }),pose:'attack'});
  assert.equal(bow.length,8);
  assert.match(bow[0],/bow\/weapon\/ember\/attack-back\.png$/);
  assert.match(bow[1],/bow\/shield\/steel\/attack\.png$/);
  assert.match(bow[2],/bow\/base\/forest\/olive\/attack-under\.png$/);
  assert.match(bow[3],/bow\/armor\/royal\/attack\.png$/);
  assert.match(bow[4],/bow\/base\/forest\/olive\/attack-middle\.png$/);
  assert.match(bow[5],/bow\/base\/forest\/olive\/attack-head\.png$/);
  assert.match(bow[6],/bow\/helmet\/iron\/forest\/attack\.png$/);
  assert.match(bow[7],/bow\/weapon\/ember\/attack-front\.png$/);
  const mage=gear.paths({classId:'wand',skin:'light',color:'purple',look:look({
    helmet:'royal',armor:'iron',weapon:'steel',shield:'royal'
  }),pose:'walk'});
  assert.equal(mage.length,7);
  assert.match(mage[0],/wand\/base\/purple\/light\/walk-under\.png$/);
  assert.match(mage[1],/wand\/armor\/iron\/walk\.png$/);
  assert.match(mage[2],/wand\/base\/purple\/light\/walk-middle\.png$/);
  assert.match(mage[3],/wand\/shield\/royal\/walk\.png$/);
  assert.match(mage[4],/wand\/base\/purple\/light\/walk-head\.png$/);
  assert.match(mage[5],/wand\/helmet\/royal\/purple\/walk\.png$/);
  assert.match(mage[6],/wand\/weapon\/steel\/walk-front\.png$/);
  assert.deepEqual(gear.poses.bow,{walk:{frames:9,tile:128},attack:{frames:13,tile:64}});
  assert.deepEqual(gear.poses.wand,{walk:{frames:9,tile:64},attack:{frames:6,tile:64}});
});

test('default class gear uses original source instead of redundant overlays',async()=>{
  const got=[];
  const loader=gear.create({classId:'bow',skin:'light',color:'sand',
    standardPath:pose=>'existing-bow-'+pose+'.png',
    loadImage:async src=>{
      got.push(src);const p=src.endsWith('walk.png')?'walk':'attack',g=gear.poses.bow[p];
      return {src,naturalWidth:g.frames*g.tile,naturalHeight:4*g.tile};
    },
    canvasFactory:()=>{throw Error('Default appearance must not composite');}
  });
  const images=await loader.load(look());
  assert.equal(images.walk.src,'existing-bow-walk.png');
  assert.equal(images.attack.src,'existing-bow-attack.png');
  assert.equal(got.length,2);
});

test('Archer and Mage equipment switches assemble complete native images once, never per animation frame',async()=>{
  for(const kind of ['bow','wand']){
    const calls=[],created=[];
    const canvasFactory=()=>{
      const canvas={width:0,height:0,src:'',getContext(){return {imageSmoothingEnabled:true,drawImage:(img,x,y)=>calls.push({src:img.src,x,y})};}};
      created.push(canvas);return canvas;
    };
    const loader=gear.create({classId:kind,skin:'brown',color:'red',
      canvasFactory,standardPath:pose=>'original-'+pose,
      loadImage:async src=>{
        const pose=src.includes('/walk-')||src.endsWith('/walk.png')||src.endsWith('walk-front.png')||src.endsWith('walk-back.png')?'walk':'attack';
        const meta=gear.poses[kind][pose];
        return {src,naturalWidth:meta.frames*meta.tile,naturalHeight:meta.tile*4};
      }
    });
    const outfit=look({armor:'royal',helmet:'iron',weapon:'steel',shield:'steel'});
    const images=await loader.load(outfit);
    assert.equal(created.length,2,'one composed atlas per existing animation');
    assert.equal(images.walk.width,gear.poses[kind].walk.frames*gear.poses[kind].walk.tile);
    assert.equal(images.attack.height,gear.poses[kind].attack.tile*4);
    assert.match(images.walk.src,/composed-lpc:/);
    assert.ok(calls.every(o=>o.x===0&&o.y===0),'no fixed image offsets');
    const initial=calls.length;
    assert.strictEqual(await loader.load(outfit),images,'cached atlas unchanged');
    assert.equal(calls.length,initial,'no redraw on frame advance');
  }
});

test('broken or missing LPC pose fails atomically and permits retry',async()=>{
  let failure=true,writes=0;
  const loader=gear.create({classId:'wand',skin:'olive',color:'blue',
    standardPath:p=>p,
    loadImage:async src=>{
      if(failure&&src.endsWith('/attack-front.png'))throw Error('Missing native pose');
      const p=src.includes('walk')?'walk':'attack',g=gear.poses.wand[p];
      return {src,naturalWidth:g.frames*g.tile,naturalHeight:g.tile*4};
    },
    canvasFactory:()=>({getContext:()=>({drawImage(){writes++;}})})
  });
  const appearance=look({weapon:'ember'});
  await assert.rejects(loader.load(appearance));
  failure=false;
  const images=await loader.load(appearance);
  assert.ok(images.walk&&images.attack);
  assert.ok(writes>0);
});

test('published class asset library contains every base and selected item frame',()=>{
  if(process.env.EMBER_CLASS_LAYERS_BUILT!=='1')return;
  for(const cls of ['bow','wand']){
    for(const color of ['sand','purple'])for(const skin of ['light','black']){
      for(const [pose,g]of Object.entries(gear.poses[cls])){
        for(const section of ['under','middle','head']){
          const file=fs.readFileSync(fullPath(cls,color,skin,pose,section));
          assert.equal(file.subarray(1,4).toString(),'PNG');
          assert.equal(file.readUInt32BE(16),g.frames*g.tile);
          assert.equal(file.readUInt32BE(20),4*g.tile);
        }
        for(const appearance of [look({helmet:'iron',armor:'royal',weapon:'ember',shield:'steel'}),
          look({helmet:'royal',armor:'iron',weapon:'steel',shield:'royal'})]){
          const sources=gear.paths({classId:cls,skin,color,look:appearance,pose});
          for(const src of sources){
            const file=fs.readFileSync(path.join(dist,src));
            assert.equal(file.subarray(1,4).toString(),'PNG',src);
            assert.equal(file.readUInt32BE(16),g.frames*g.tile,src);
            assert.equal(file.readUInt32BE(20),g.tile*4,src);
          }
        }
      }
    }
  }
});

test('battle and equipment panel route every class to the correct LPC engine',()=>{
  const source=fs.readFileSync(path.join(dist,'game.js'),'utf8');
  const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
  const ui=fs.readFileSync(path.join(dist,'equipment-ui.js'),'utf8');
  const builder=fs.readFileSync(path.join(__dirname,'../scripts/build-class-equipment.py'),'utf8');
  assert.match(html,/src="class-equipment.js"/);
  assert.match(source,/window\.EmberClassEquipment\.create/);
  assert.match(source,/classEquipment\.load\(nextLook\)/);
  assert.match(source,/applyClassSprites\(loadedClassSprites\)/);
  assert.match(ui,/data\.catalogForClass\(store\.classId\)/);
  assert.match(ui,/data\.slotLabel\(store\.classId,slot\)/);
  assert.match(builder,/ImageChops\.difference\(reconstructed,original\)/);
  assert.match(builder,/wandwalk/);
  assert.match(builder,/quiver\/\{anim\}/);
});
