'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dist=path.resolve(__dirname,'../dist');
const data=require('../dist/equipment.js');

const source=fs.readFileSync(path.join(dist,'equipment-ui.js'),'utf8');
const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
const css=fs.readFileSync(path.join(dist,'equipment.css'),'utf8');

function node(tag='div'){
  const events=new Map(),attrs=new Map();
  return {
    tag,events,attrs,children:[],style:{},dataset:{},className:'',textContent:'',
    classList:{toggle(){}},
    disabled:false,hidden:false,
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;},
    setAttribute(k,v){attrs.set(k,String(v));},
    getAttribute(k){return attrs.get(k)||null;},
    addEventListener(k,fn){if(!events.has(k))events.set(k,new Set());events.get(k).add(fn);},
    removeEventListener(k,fn){events.get(k)?.delete(fn);},
    fire(k,props={}){for(const fn of [...events.get(k)||[]])fn({type:k,...props});},
    click(){this.fire('click');}
  };
}
function setup(classId='sword'){
  const document={createElement:node};
  const map={
    '#equipment-items':node(),
    '#equipment-preview':node('canvas'),
    '.equipment-portrait':node(),
    '[data-equipment-class]':node(),
    '#equipment-unsupported':node(),
    '[data-equipment-message]':node(),
    '[data-equipment-category]':node()
  };
  map['#equipment-items'].ownerDocument=document;
  const portrait=map['.equipment-portrait'];
  portrait.captured=[];
  portrait.setPointerCapture=id=>portrait.captured.push(id);
  const canvas=map['#equipment-preview'];canvas.draws=[];
  canvas.getContext=()=>({
    imageSmoothingEnabled:true,
    clearRect(){},
    drawImage:(img,...dims)=>canvas.draws.push({src:img.src,dims})
  });
  const slotNodes=data.slots.map(slot=>{
    const btn=node('button');
    btn.dataset.equipmentSlot=slot.id;
    const name=node('span'),heading=node('strong');
    btn.querySelector=sel=>sel==='[data-equipment-slot-name]'?name:sel==='strong'?heading:null;
    return btn;
  });
  const root={
    dataset:{},
    querySelector:sel=>map[sel]||null,
    querySelectorAll:sel=>sel==='[data-equipment-slot]'?slotNodes:[]
  };
  const stored=new Map(),storage={
    getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,String(v))
  };
  const store=data.createStore({classId,storage});
  const sandbox={window:{EmberEquipment:data}};
  vm.runInNewContext(source,sandbox,{filename:'equipment-ui.js'});
  let overlayPoses=[];
  const image={src:'lpc-walk.png'};
  const tile=classId==='bow'?128:64;
  const controller=sandbox.window.EmberEquipmentUI.mount({
    root,store,getSprite:()=>({image,tile,origin:classId==='bow'?32:0}),
    loadItem:async()=>{},
    paintItem:(_ctx,pose)=>overlayPoses.push({...pose}),
    onEquip:()=>{},
    outfitColor:'forest'
  });
  function swipe(dx,dy,id=7){
    portrait.fire('pointerdown',{pointerId:id,isPrimary:true,pointerType:'touch',clientX:150,clientY:100});
    portrait.fire('pointerup',{pointerId:id,clientX:150+dx,clientY:100+dy});
  }
  return {controller,canvas,portrait,store,slotNodes,items:map['#equipment-items'],swipe,
    poses:()=>overlayPoses,root,cleanup:()=>controller.destroy()};
}

test('portrait displays real LPC front, left, back, right rows via horizontal swipes',()=>{
  for(const classId of ['sword','bow','wand']){
    const h=setup(classId);
    const rows=[2,1,0,3,2],size=classId==='bow'?128:64,origin=classId==='bow'?32:0;
    assert.equal(h.controller.getDirection(),rows[0]);
    assert.deepEqual(h.canvas.draws.at(-1).dims,[origin,2*size+origin,64,64,0,0,64,64]);
    for(let n=1;n<rows.length;n++){
      h.swipe(-43,2);
      assert.equal(h.controller.getDirection(),rows[n],classId+' rotation '+n);
      assert.deepEqual(h.canvas.draws.at(-1).dims,[origin,rows[n]*size+origin,64,64,0,0,64,64]);
      assert.equal(h.poses().at(-1).row,rows[n],'LPC equipment overlay matches base sprite row');
    }
    h.swipe(35,1);
    assert.equal(h.controller.getDirection(),3,'opposite swipe reverses rotation');
    assert.equal(h.canvas.getAttribute('aria-label')?.includes('справа'),true);
    assert.equal(h.canvas.width,64);assert.equal(h.canvas.height,64);
    assert.deepEqual(h.portrait.captured,[7,7,7,7,7]);
    h.cleanup();
  }
});

test('short taps, vertical motion, canceled or nonprimary pointers do not rotate',()=>{
  const h=setup();
  const first=h.canvas.draws.length;
  h.swipe(-20,0);h.swipe(0,65);h.swipe(-42,90);
  h.portrait.fire('pointerdown',{pointerId:12,isPrimary:false,clientX:50,clientY:100});
  h.portrait.fire('pointerup',{pointerId:12,clientX:0,clientY:100});
  h.portrait.fire('pointerdown',{pointerId:22,isPrimary:true,pointerType:'touch',clientX:90,clientY:100});
  h.portrait.fire('pointercancel',{pointerId:22});
  h.portrait.fire('pointerup',{pointerId:22,clientX:0,clientY:100});
  assert.equal(h.controller.getDirection(),2);
  assert.equal(h.canvas.draws.length,first);
  h.cleanup();
});

test('ArrowLeft and ArrowRight rotate the hero and prevent page scrolling',()=>{
  const h=setup('wand');
  let preventions=0;
  h.portrait.fire('keydown',{key:'ArrowLeft',preventDefault:()=>preventions++});
  assert.equal(h.controller.getDirection(),1);
  h.portrait.fire('keydown',{key:'ArrowRight',preventDefault:()=>preventions++});
  assert.equal(h.controller.getDirection(),2);
  h.portrait.fire('keydown',{key:'Tab',preventDefault:()=>preventions++});
  assert.equal(h.controller.getDirection(),2);
  assert.equal(preventions,2);
  h.cleanup();
});

test('selected hero angle is retained while selecting slots and equipping items',async()=>{
  const h=setup('sword');
  h.swipe(-45,0);h.swipe(-45,0);
  assert.equal(h.controller.getDirection(),0);
  const armourSlot=h.slotNodes.find(b=>b.dataset.equipmentSlot==='armor');
  armourSlot.click();
  assert.equal(h.controller.getDirection(),0);
  const iron=h.items.children.find(b=>b.attrs.get('data-equipment-item')==='iron');
  iron.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.store.getState().armor,'iron');
  assert.equal(h.controller.getDirection(),0);
  assert.equal(h.poses().at(-1).row,0);
  h.controller.refreshPreview();
  assert.equal(h.canvas.draws.at(-1).dims[1],0);
  h.cleanup();
});

test('portrait handlers are detached on destroy; swipe never changes combat or storage',()=>{
  const h=setup('bow');
  const before=h.store.getState(),last=h.canvas.draws.length;
  h.cleanup();h.swipe(-40,0);
  assert.equal(h.canvas.draws.length,last);
  assert.equal(h.controller.getDirection(),2);
  assert.deepEqual(h.store.getState(),before);
  assert.equal(h.portrait.events.get('pointerdown').size,0);
  assert.equal(h.portrait.events.get('pointerup').size,0);
  assert.equal(h.portrait.events.get('keydown').size,0);
});

test('actual game portrait hints afford swipes while allowing vertical scrolling on iPhone',()=>{
  assert.match(html,/class="equipment-portrait" tabindex="0" role="group"/);
  assert.match(html,/equipment-rotate-hint/);
  assert.match(css,/\.equipment-portrait\{[^}]*touch-action:pan-y/);
  assert.match(css,/\.equipment-portrait canvas\{[^}]*image-rendering:pixelated/);
  assert.match(html,/equipment-ui\.js\?v=wolf-companion-1/);
  assert.match(html,/equipment\.css\?v=wolf-animations-2/);
  assert.match(source,/pointercancel/);
  assert.match(source,/lostpointercapture/);
});

test('the sixth companion sector is selectable only for the Archer',()=>{
 for(const classId of ['sword','wand','bow']){
   const h=setup(classId),slot=h.slotNodes.find(el=>el.dataset.equipmentSlot==='companion');
   assert.ok(slot,'companion sector is present even when unavailable');
   assert.equal(slot.disabled,classId!=='bow');
   assert.equal(h.controller.select('companion'),classId==='bow');
   if(classId==='bow'){
     assert.deepEqual(h.items.children.map(node=>node.getAttribute('data-equipment-item')),['none','wolf']);
   }
   h.cleanup();
 }
});
