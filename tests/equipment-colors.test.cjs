'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const gear=require('../dist/equipment.js');
const dye=require('../dist/equipment-dye.js');
const classArt=require('../dist/class-equipment.js');
const warriorArt=require('../dist/equipment-art.js');
const root=path.join(__dirname,'../dist');

function storage(){
  const values=new Map();
  return {values,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))};
}

test('helmet armor and cape have independent per-item colors per character class',()=>{
  const memory=storage();
  const w=gear.createStore({classId:'sword',storage:memory});
  const b=gear.createStore({classId:'bow',storage:memory});
  const m=gear.createStore({classId:'wand',storage:memory});
  assert.equal(w.getColor('armor','basic'),'original');
  assert.equal(w.setColor('armor','red').ok,true);
  assert.equal(w.setColor('helmet','blue','iron').ok,true);
  assert.equal(w.equip('cape','solid').ok,true);
  assert.equal(w.setColor('cape','forest').ok,true);
  assert.equal(w.getColor('armor','basic'),'red');
  assert.equal(w.getColor('helmet','iron'),'blue');
  assert.equal(w.getColors().cape,'forest');
  assert.equal(w.equip('armor','royal').ok,true);
  assert.equal(w.getColors().armor,'original');
  assert.equal(w.setColor('armor','gray').ok,true);
  assert.equal(w.equip('armor','basic').ok,true);
  assert.equal(w.getColors().armor,'red','switching armor restores its own dye');
  assert.equal(b.setColor('armor','purple','basic').ok,true);
  assert.equal(m.setColor('cape','sand','tattered').ok,true);
  assert.equal(gear.createStore({classId:'sword',storage:memory}).getColors().armor,'red');
  assert.equal(gear.createStore({classId:'bow',storage:memory}).getColors().armor,'purple');
  assert.equal(gear.createStore({classId:'wand',storage:memory}).getColors().cape,'sand');
  assert.equal(b.getColors().cape,'original');
  assert.equal(w.getColor('cape','solid'),'forest');
  const staged=w.getColors(w.getState(),'armor','blue');
  assert.equal(staged.armor,'blue');
  assert.equal(w.getColor('armor','basic'),'red','preloading does not save a dye');
});

test('no color picker or storage write is allowed for weapon shield companion or bare head',()=>{
  const memory=storage(),w=gear.createStore({classId:'sword',storage:memory});
  assert.deepEqual(gear.dyeSlots,['helmet','armor','cape']);
  for(const slot of ['weapon','shield','companion']){
    assert.equal(w.setColor(slot,'red').ok,false);
    assert.equal(w.getColor(slot),'original');
  }
  assert.equal(w.setColor('helmet','red','none').reason,'unsupported');
  assert.equal(w.setColor('cape','red','none').reason,'unsupported');
  assert.equal(w.setColor('armor','neon').reason,'invalid');
  assert.equal(memory.values.has(gear.dyeKey),false);
  const broken=gear.createStore({classId:'bow',storage:{
    getItem(){return null},setItem(){throw Error('blocked')}
  }});
  assert.equal(broken.setColor('armor','blue').reason,'storage');
  assert.equal(broken.getColors().armor,'original');
  assert.equal(gear.dyeIds.length,dye.palette.length);
});

test('legacy saved Archer/Mage appearances retain their original tattered capes',()=>{
  const previous={version:1,byClass:{bow:{helmet:'basic',armor:'basic',weapon:'basic',shield:'basic',cape:'none'},
    wand:{helmet:'basic',armor:'basic',weapon:'basic',shield:'basic',cape:'none'}}};
  const m=storage();m.setItem(gear.key,JSON.stringify(previous));
  assert.equal(gear.createStore({classId:'bow',storage:m}).getState().cape,'tattered');
  assert.equal(gear.createStore({classId:'wand',storage:m}).getState().cape,'tattered');
  assert.equal(gear.createStore({classId:'sword',storage:m}).getState().cape,'none');
});

test('native LPC dye renderer preserves source alpha, frame dimensions, and pixel sharpness',()=>{
  const calls=[];
  const source={width:2,height:1,src:'lpc.png',data:new Uint8ClampedArray([160,100,40,255,20,40,160,57])};
  let drawCount=0;
  const color=dye.create({canvasFactory:()=>({
    width:0,height:0,src:'',
    getContext(){return {
      imageSmoothingEnabled:true,drawImage(im){drawCount++;calls.push(im.src);this.src=im;},
      getImageData(){return {data:new Uint8ClampedArray(this.src.data)};},
      putImageData(pixels){this.result=pixels.data;}
    }}
  })});
  const changed=color.apply(source,'blue');
  assert.equal(changed.width,2);
  assert.equal(changed.height,1);
  assert.strictEqual(color.apply(source,'blue'),changed,'dyed animation cached');
  assert.strictEqual(color.apply(source,'original'),source);
  assert.equal(drawCount,1);
  assert.deepEqual(calls,['lpc.png']);
});

test('Archer and Mage cloaks render as separate front/back LPC layers and independent clothing dyes',async()=>{
  for(const cls of ['bow','wand']){
    const entries=[],art=classArt.create({
      classId:cls,skin:'light',color:'sand',
      canvasFactory:()=>({getContext(){return {drawImage(img){entries.push(img.src);}}}}),
      standardPath:p=>'original-'+p,
      dye:{apply:(img,c)=>({...img,src:'dyed:'+c+':'+img.src})},
      loadImage:async src=>{
        const pose=src.includes('attack')?'attack':'walk',g=classArt.poses[cls][pose];
        return {src,naturalWidth:g.frames*g.tile,naturalHeight:4*g.tile};
      }
    });
    const look={helmet:'iron',armor:'royal',weapon:'steel',shield:'basic',cape:'solid'};
    await art.load(look,{helmet:'red',armor:'blue',cape:'purple'});
    assert.ok(entries.some(x=>x.includes('/cape/solid/')&&x.includes('back.png')));
    assert.ok(entries.some(x=>x.includes('/cape/solid/')&&x.includes('front.png')));
    assert.ok(entries.some(x=>x.startsWith('dyed:red:')&&x.includes('/helmet/')));
    assert.ok(entries.some(x=>x.startsWith('dyed:blue:')&&x.includes('/armor/')));
    assert.ok(entries.some(x=>x.startsWith('dyed:purple:')&&x.includes('/cape/')));
    assert.ok(!entries.some(x=>x.startsWith('dyed:')&&x.includes('/weapon/')));
  }
});

test('Warrior cape back renders behind the full hero and front below shield/weapon',async()=>{
  const g=warriorArt.poses;
  const calls=[];
  const art=warriorArt.create({
    outfitColor:'forest',
    dye:{apply:(image,color)=>({...image,src:color+':'+image.src})},
    loadImage:async src=>{
      const pose=src.split('/').at(-1).replace(/-(bg|fg)\.png$|\.png$/,'');
      const meta=g[pose];if(!meta)throw Error('Unknown animation '+pose);
      const tile=src.includes('/lpc/cape/')?64:src.includes('/front-layers/')?meta.tile:64;
      return {src,naturalWidth:tile*meta.frames,naturalHeight:tile*4};
    }
  });
  const worn={helmet:'iron',armor:'royal',weapon:'ember',shield:'steel',cape:'solid'};
  await art.prepareLook(worn);
  const ctx={drawImage:(img)=>calls.push(img.src)};
  const pose={equipped:worn,colors:{helmet:'red',armor:'gray',cape:'blue'},row:2,frame:0,tile:64,kind:'idle',origin:0};
  assert.equal(art.drawBack(ctx,pose),1);
  assert.equal(art.draw(ctx,pose),5);
  assert.deepEqual(calls.map(x=>x.includes('/cape/')?'cape':x.includes('/armor/')?'armor':
    x.includes('/shield/')?'shield':x.includes('/helmet/')?'helmet':'weapon'),
    ['cape','armor','cape','shield','helmet','weapon']);
  assert.ok(calls[0].startsWith('blue:'));
  assert.ok(calls[2].startsWith('blue:'));
  assert.ok(calls[3].startsWith('assets/'),'shield unchanged by dye');
  assert.ok(calls[5].startsWith('assets/'),'weapon unchanged by dye');
});

test('color picker is restricted to headwear, armor and cape and only shows item names',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const ui=fs.readFileSync(path.join(root,'equipment-ui.js'),'utf8');
  const game=fs.readFileSync(path.join(root,'game.js'),'utf8');
  assert.match(html,/id="equipment-dyes"/);
  assert.match(html,/data-equipment-slot="cape" aria-pressed="false"><span/);
  assert.match(html,/equipment-dye\.js\?v=gear-dyes-1/);
  assert.match(ui,/data\.dyeSlots\.includes\(slot\)/);
  assert.match(ui,/image\.src=data\.itemIconPath/);
  assert.match(ui,/store\.setColor\(slot,item\.id,id\)/);
  assert.doesNotMatch(ui,/item\.detail/);
  assert.match(game,/equipmentArt\.drawBack\(ctx,gearPose\)/);
  assert.match(game,/equipment\.getColors\(\)/);
});
