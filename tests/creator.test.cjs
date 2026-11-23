'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../dist');
const html=fs.readFileSync(path.join(root,'create.html'),'utf8');
function harness({saved=null,blocked=false}={}){
 const nodes=new Map(),pending=[],storage=new Map(saved?[['ember.character.v1',JSON.stringify(saved)]]:[]);
 class E{
  constructor(key){this.key=key;this.dataset={};this.attrs={};this.handlers={};this.hidden=false;this.disabled=false;this.open=false;this.style={setProperty(k,v){this[k]=v}};this.draws=[];this.width=64;this.height=64;this.clientWidth=350;this.clientHeight=320;this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,v)=>v?this.classes.add(x):this.classes.delete(x)};}
  addEventListener(t,f){(this.handlers[t]??=[]).push(f)} dispatch(t,e={}){for(const f of this.handlers[t]||[])f({preventDefault(){},...e})} click(){if(!this.disabled)this.dispatch('click')}
  setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]??null}removeAttribute(k){delete this.attrs[k]}
  querySelector(s){return node(this.key+' '+s)}querySelectorAll(){return [node(this.key+' .dialog-close'),node(this.key+' .dialog-action')]}
  set src(v){this.attrs.src=v;assert.ok(fs.existsSync(path.join(root,v)),v)}get src(){return this.attrs.src}
  focus(){}setPointerCapture(id){this.capture=id}hasPointerCapture(id){return this.capture===id}releasePointerCapture(){this.capture=null}
  getBoundingClientRect(){return {left:0,top:0,right:400,bottom:400}}showModal(){this.open=true}close(){this.open=false}
  getContext(){return {clearRect(){},drawImage:(im,x,y,w,h,...destination)=>{assert.ok(x>=0&&y>=0&&x+w<=im.width&&y+h<=im.height,`invalidcrop${im.src}:${[x,y,w,h]}`);this.draws.push({src:im.src,crop:[x,y,w,h],destination})}}}
 }
 function node(k){if(!nodes.has(k))nodes.set(k,new E(k));return nodes.get(k)}
 const groups={
  '.skin-option':[...html.matchAll(/data-skin="([^"]+)"/g)].map(([,id])=>{let n=node('skin:'+id);n.dataset.skin=id;return n}),
  '[data-weapon]':['sword','bow','wand'].map(id=>{let n=node('weapon:'+id);n.dataset.weapon=id;return n}),
  '[data-magic]':['fire','ice'].map(id=>{let n=node('magic:'+id);n.dataset.magic=id;return n}),
  '[data-outfit-color]':['sand','forest','blue','red','purple','gray'].map(id=>{let n=node('color:'+id);n.dataset.outfitColor=id;return n}),
  '[data-go-step]':[0,1,2].map(i=>{let n=node('progress:'+i);n.dataset.goStep=String(i);return n}),
  '[data-step]':[0,1,2].map(i=>{let n=node('panel:'+i);n.dataset.step=String(i);return n}),
  dialog:['#info-dialog','#success-dialog','#credits-dialog'].map(node)
 };
 const document={querySelector:node,querySelectorAll:s=>{assert.ok(groups[s],s);return groups[s]},documentElement:node('html'),hidden:false};
 class Im{set src(v){this.path=v;const b=fs.readFileSync(path.join(root,v));this.width=b.readUInt32BE(16);this.height=b.readUInt32BE(20);pending.push(this)}get src(){return this.path}}
 const window={innerHeight:700,location:{href:''},visualViewport:{height:700,addEventListener(){}},addEventListener(){},matchMedia:()=>({matches:false})};
 const context=vm.createContext({window,document,Image:Im,ResizeObserver:class{constructor(cb){this.cb=cb}observe(){this.cb()}},getComputedStyle:()=>({getPropertyValue:()=>88}),setInterval(){},localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(blocked)throw Error('blocked');storage.set(k,v)}}});
 vm.runInContext(fs.readFileSync(path.join(root,'loadouts.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
 async function flush(){for(let i=0;i<15;i++)await Promise.resolve()}
 async function load(){await flush();while(pending.length){pending.shift().onload();await flush()}}
 return {node,groups,storage,load,window};
}
test('creation follows skin→weapon→clothing color and saves the single matching outfit',async()=>{
 const ui=harness();assert.equal(ui.node('#create-button').disabled,true);await ui.load();
 ui.node('skin:brown').click();await ui.load();ui.node('#create-button').click();await ui.load();
 assert.equal(ui.node('#step-title').textContent,'Начальное оружие');ui.node('weapon:bow').click();await ui.load();
 assert.equal(ui.node('#hero').width,128);assert.equal(ui.node('#hero').style.width,'200%');
 ui.node('#create-button').click();await ui.load();assert.equal(ui.node('#fixed-outfit-name').textContent,'Странник');
 ui.node('color:red').click();await ui.load();ui.node('#create-button').click();
 const saved=JSON.parse(ui.storage.get('ember.character.v1'));assert.deepEqual([saved.skin,saved.weapon,saved.outfit,saved.outfitColor],['brown','bow','wanderer','red']);assert.deepEqual(saved.equipment,['bow','wanderer']);
 assert.equal(ui.node('#success-dialog').open,true);assert.match(ui.node('#saved-loadout').textContent,/Странник.*Бордовый/);
 ui.node('#start-adventure').click();assert.equal(ui.window.location.href,'./');
});
test('Mage stays half display size but retains all native 64px sprite detail; other classes unchanged',async()=>{
 const ui=harness();await ui.load();
 const canvas=ui.node('#hero');
 // Step 1 (skin) still uses the original unmodified sprite.
 assert.deepEqual(canvas.draws.at(-1).destination,[0,0,64,64]);
 ui.node('#create-button').click();await ui.load();
 for(const [kind,tile,origin] of [
   ['sword',64,0],['bow',128,32],['wand',64,0],
   ['sword',64,0],['wand',64,0],['bow',128,32]
 ]){
   ui.node('weapon:'+kind).click();await ui.load();
   const draw=canvas.draws.at(-1);
   assert.equal(canvas.width,tile);assert.equal(canvas.height,tile);
   assert.deepEqual(draw.crop.slice(2),[tile,tile]);
   assert.deepEqual(draw.destination,[0,0,tile,tile],
     kind+' must draw the source sprite at full native pixel resolution');
   if(kind==='wand'){
     assert.equal(canvas.style.width,'50%');
     assert.equal(canvas.style.height,'50%');
     assert.equal(canvas.style.left,'25%');
     assert.equal(canvas.style.top,'50%');
     // Mage canvas is 50% tall and starts at 50%: bottom aligned to stage.
     assert.equal(parseFloat(canvas.style.top)+parseFloat(canvas.style.height),100);
   }else{
     assert.equal(canvas.style.width,`${tile/64*100}%`);
     assert.equal(canvas.style.height,`${tile/64*100}%`);
     assert.equal(canvas.style.left,`${-origin/64*100}%`);
     assert.equal(canvas.style.top,`${-origin/64*100}%`);
   }
 }
 assert.ok(html.includes('src="app.js?v=20261123-mage-ground-8"'),
   'force mobile browser to load the full-resolution Mage preview');
});
test('all eighteen weapon and clothing-color choices preview, rotate and retain the independent skin',async()=>{
 const sets={sword:'militia',bow:'wanderer',wand:'acolyte'};
 for(const [weapon,outfit]of Object.entries(sets))for(const color of ['sand','forest','blue','red','purple','gray']){
  const ui=harness();await ui.load();ui.node('skin:black').click();await ui.load();ui.node('#create-button').click();await ui.load();
  ui.node('weapon:'+weapon).click();await ui.load();if(weapon==='wand')ui.node('magic:fire').click();ui.node('#create-button').click();await ui.load();ui.node('color:'+color).click();await ui.load();
  ui.node('#scene').dispatch('keydown',{key:'ArrowRight'});
  const draw=ui.node('#hero').draws.at(-1);assert.ok(draw.src.endsWith(`${weapon}/${outfit}/${color}/black-walk.png`));assert.equal(draw.crop[1],weapon==='bow'?384:192);
  ui.node('#create-button').click();const saved=JSON.parse(ui.storage.get('ember.character.v1'));assert.deepEqual([saved.weapon,saved.outfit,saved.outfitColor,saved.skin],[weapon,outfit,color,'black']);
 }
});
test('legacy wardrobe migrates on save and back navigation preserves color, name, level and creation time',async()=>{
 const ui=harness({saved:{version:1,skin:'amber',weapon:'wand',outfit:'adept',name:'Рыцарь',level:7,createdAt:'old'}});await ui.load();
 assert.equal(ui.node('skin:light').attrs['aria-checked'],'true');assert.ok(ui.node('#hero').draws.at(-1).src.endsWith('/light.png'));
 assert.equal(JSON.parse(ui.storage.get('ember.character.v1')).skin,'amber','skin migration waits for explicit save');
 assert.equal(JSON.parse(ui.storage.get('ember.character.v1')).outfit,'adept','no eager write on load');
 ui.node('#create-button').click();await ui.load();assert.equal(ui.node('weapon:wand').attrs['aria-checked'],'true');ui.node('#create-button').click();await ui.load();
 assert.equal(ui.node('color:blue').attrs['aria-checked'],'true');assert.equal(ui.node('#fixed-outfit-name').textContent,'Послушник');
 ui.node('color:gray').click();await ui.load();ui.node('progress:0').click();await ui.load();
 ui.node('progress:2').click();await ui.load();assert.equal(ui.node('color:gray').attrs['aria-checked'],'true');ui.node('#create-button').click();
 const saved=JSON.parse(ui.storage.get('ember.character.v1'));assert.deepEqual([saved.name,saved.level,saved.createdAt,saved.skin,saved.outfit,saved.outfitColor],['Рыцарь',7,'old','light','acolyte','gray']);assert.deepEqual(saved.equipment,['wand','acolyte']);
});
test('each weapon remembers its own clothing color during edits',async()=>{
 const ui=harness();await ui.load();ui.node('#create-button').click();await ui.load();ui.node('#create-button').click();await ui.load();
 ui.node('color:red').click();await ui.load();ui.node('#back-button').click();await ui.load();ui.node('weapon:bow').click();await ui.load();ui.node('#create-button').click();await ui.load();assert.equal(ui.node('color:forest').attrs['aria-checked'],'true');
 ui.node('color:gray').click();await ui.load();ui.node('#back-button').click();await ui.load();ui.node('weapon:sword').click();await ui.load();ui.node('#create-button').click();await ui.load();assert.equal(ui.node('color:red').attrs['aria-checked'],'true');
});
test('a stale asynchronous image cannot replace the newest selection; storage failure reports no success',async()=>{
 const ui=harness({blocked:true});ui.node('skin:brown').click();await ui.load();assert.ok(ui.node('#hero').draws.at(-1).src.endsWith('/brown.png'));
 ui.node('#create-button').click();await ui.load();ui.node('#create-button').click();await ui.load();ui.node('#create-button').click();
 assert.equal(ui.storage.has('ember.character.v1'),false);assert.equal(ui.node('#success-dialog').open,false);assert.equal(ui.node('#info-dialog').open,true);
});
test('only three canonical skin choices are selectable while all six clothing colors remain available',async()=>{
 const ui=harness();await ui.load();
 assert.deepEqual(ui.groups['.skin-option'].map(button=>button.dataset.skin),['light','brown','black']);
 assert.equal(ui.groups['[data-outfit-color]'].length,6);
 for(const [id,label] of [['light','Светлый'],['brown','Смуглый'],['black','Тёмный']])assert.match(html,new RegExp(`data-skin="${id}" aria-label="${label}"`));
 for(const id of ['amber','olive','bronze'])assert.ok(!html.includes(`data-skin="${id}"`));
 ui.node('skin:light').dispatch('keydown',{key:'End'});await ui.load();assert.equal(ui.node('skin:black').attrs['aria-checked'],'true');
 ui.node('skin:black').dispatch('keydown',{key:'ArrowRight'});await ui.load();assert.equal(ui.node('skin:light').attrs['aria-checked'],'true');
 ui.node('skin:light').dispatch('keydown',{key:'ArrowRight'});await ui.load();assert.equal(ui.node('skin:brown').attrs['aria-checked'],'true');
});
test('all six saved skin IDs restore their kit intact and migrate skin only when the player saves',async()=>{
 const migration={light:'light',amber:'light',olive:'brown',bronze:'brown',brown:'brown',black:'black'};
 const kits=[['sword','militia'],['bow','wanderer'],['wand','acolyte']];
 let index=0;
 for(const [skin,canonical] of Object.entries(migration)){
  const [weapon,outfit]=kits[index++%kits.length];
  const original={version:1,skin,weapon,outfit,outfitColor:'gray',name:'Ветеран',level:9,class:'knight',equipment:weapon==='sword'?['sword','shield',outfit]:[weapon,outfit],createdAt:'original-date'};
  const ui=harness({saved:original});await ui.load();
  assert.deepEqual(JSON.parse(ui.storage.get('ember.character.v1')),original,'opening the creator must not rewrite the saved record');
  assert.equal(ui.node('skin:'+canonical).attrs['aria-checked'],'true');
  ui.node('#create-button').click();await ui.load();assert.equal(ui.node('weapon:'+weapon).attrs['aria-checked'],'true');
  ui.node('#create-button').click();await ui.load();assert.equal(ui.node('color:gray').attrs['aria-checked'],'true');
  ui.node('#create-button').click();
  const saved=JSON.parse(ui.storage.get('ember.character.v1'));
  assert.deepEqual([saved.skin,saved.name,saved.level,saved.class,saved.weapon,saved.outfit,saved.outfitColor,saved.createdAt],[canonical,original.name,9,'knight',weapon,outfit,'gray','original-date']);
  assert.deepEqual(saved.equipment,original.equipment,'skin migration must retain the chosen equipment');
 }
});


test('a new wand user must explicitly choose fire or ice before leaving the weapon step',async()=>{
 const ui=harness();await ui.load();ui.node('#create-button').click();await ui.load();
 ui.node('weapon:wand').click();await ui.load();
 assert.equal(ui.node('#magic-school').hidden,false);
 assert.equal(ui.node('#create-button').disabled,true);
 assert.equal(ui.node('magic:fire').attrs['aria-checked'],'false');
 assert.equal(ui.node('magic:ice').attrs['aria-checked'],'false');
 assert.equal(ui.node('magic:fire').tabIndex,0,'unselected radio group remains keyboard reachable');
 assert.equal(ui.node('magic:ice').tabIndex,-1);
 ui.node('#create-button').click();assert.equal(ui.node('#step-title').textContent,'Начальное оружие');
 ui.node('magic:fire').click();assert.equal(ui.node('#create-button').disabled,false);assert.match(ui.node('#preview-summary').textContent,/Огонь/);
 ui.node('#create-button').click();await ui.load();ui.node('#create-button').click();
 const saved=JSON.parse(ui.storage.get('ember.character.v1'));assert.equal(saved.magic,'fire');assert.match(ui.node('#saved-loadout').textContent,/Огонь/);
});

test('ice selection supports keyboard input, survives weapon switching and saves only on a wand',async()=>{
 const ui=harness();await ui.load();ui.node('#create-button').click();await ui.load();ui.node('weapon:wand').click();await ui.load();
 ui.node('magic:fire').dispatch('keydown',{key:'ArrowRight'});
 assert.equal(ui.node('magic:ice').attrs['aria-checked'],'true');assert.match(ui.node('#magic-choice-name').textContent,/Ледяное/);
 ui.node('weapon:bow').click();await ui.load();assert.equal(ui.node('#magic-school').hidden,true);assert.equal(ui.node('#create-button').disabled,false);
 ui.node('weapon:wand').click();await ui.load();assert.equal(ui.node('magic:ice').attrs['aria-checked'],'true');
 ui.node('#create-button').click();await ui.load();ui.node('#create-button').click();
 assert.equal(JSON.parse(ui.storage.get('ember.character.v1')).magic,'ice');assert.match(ui.node('#saved-loadout').textContent,/Лёд/);
 const sword=harness({saved:JSON.parse(ui.storage.get('ember.character.v1'))});await sword.load();sword.node('#create-button').click();await sword.load();sword.node('weapon:sword').click();await sword.load();sword.node('#create-button').click();await sword.load();sword.node('#create-button').click();
 assert.ok(!Object.hasOwn(JSON.parse(sword.storage.get('ember.character.v1')),'magic'),'a non-mage record must not retain a stale spell school');
});

test('legacy wand defaults to fire, valid ice restores, and NPC shadow never becomes a player choice',async()=>{
 for(const [original,expected]of [[undefined,'fire'],['shadow','fire'],['wrong','fire'],['fire','fire'],['ice','ice']]){
  const saved={version:1,skin:'brown',weapon:'wand',outfit:'acolyte',outfitColor:'purple',name:'Маг',magic:original};
  const ui=harness({saved});await ui.load();assert.deepEqual(JSON.parse(ui.storage.get('ember.character.v1')),JSON.parse(JSON.stringify(saved)),'opening creator does not eagerly write defaults');
  ui.node('#create-button').click();await ui.load();assert.equal(ui.node('magic:'+expected).attrs['aria-checked'],'true');assert.equal(ui.node('#create-button').disabled,false);
  ui.node('#create-button').click();await ui.load();ui.node('#create-button').click();assert.equal(JSON.parse(ui.storage.get('ember.character.v1')).magic,expected);
 }
 assert.deepEqual([...html.matchAll(/data-magic="([^"]+)"/g)].map(([,id])=>id),['fire','ice']);assert.ok(!html.includes('data-magic="shadow"'));
});

test('progress navigation cannot bypass a missing required magic selection',async()=>{
 const ui=harness();await ui.load();ui.node('#create-button').click();await ui.load();ui.node('#create-button').click();await ui.load();
 ui.node('#back-button').click();await ui.load();ui.node('weapon:wand').click();await ui.load();
 assert.equal(ui.node('progress:2').disabled,true);ui.node('progress:2').click();assert.equal(ui.node('#step-title').textContent,'Начальное оружие');
 ui.node('magic:ice').click();assert.equal(ui.node('progress:2').disabled,false);ui.node('progress:2').click();await ui.load();assert.equal(ui.node('#step-title').textContent,'Цвет наряда');
 ui.node('#create-button').click();assert.equal(JSON.parse(ui.storage.get('ember.character.v1')).magic,'ice');
});
