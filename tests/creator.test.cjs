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
  getContext(){return {clearRect(){},drawImage:(im,x,y,w,h)=>{assert.ok(x>=0&&y>=0&&x+w<=im.width&&y+h<=im.height,`invalidcrop${im.src}:${[x,y,w,h]}`);this.draws.push({src:im.src,crop:[x,y,w,h]})}}}
 }
 function node(k){if(!nodes.has(k))nodes.set(k,new E(k));return nodes.get(k)}
 const groups={
  '.skin-option':['light','amber','olive','bronze','brown','black'].map(id=>{let n=node('skin:'+id);n.dataset.skin=id;return n}),
  '[data-weapon]':['sword','bow','wand'].map(id=>{let n=node('weapon:'+id);n.dataset.weapon=id;return n}),
  '[data-outfit-index]':[0,1,2].map(i=>{let n=node('outfit:'+i);n.dataset.outfitIndex=String(i);return n}),
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
test('creation follows skin→weapon→outfit, preserves selected skin, and saves complete equipment',async()=>{
 const ui=harness();assert.equal(ui.node('#create-button').disabled,true);await ui.load();
 ui.node('skin:brown').click();await ui.load();ui.node('#create-button').click();await ui.load();
 assert.equal(ui.node('#step-title').textContent,'Начальное оружие');ui.node('weapon:bow').click();await ui.load();
 assert.equal(ui.node('#hero').width,128);assert.equal(ui.node('#hero').style.width,'200%');
 ui.node('#create-button').click();await ui.load();ui.node('outfit:1').click();await ui.load();ui.node('#create-button').click();
 const saved=JSON.parse(ui.storage.get('ember.character.v1'));assert.deepEqual([saved.skin,saved.weapon,saved.outfit],['brown','bow','hunter']);assert.deepEqual(saved.equipment,['bow','hunter']);
 assert.equal(ui.node('#success-dialog').open,true);assert.match(ui.node('#saved-loadout').textContent,/Охотник/);
 ui.node('#start-adventure').click();assert.equal(ui.window.location.href,'./');
});
test('all nine outfits preview and rotate in the chosen skin and persist matching weapon',async()=>{
 const sets={sword:['militia','watchman','guard'],bow:['scout','hunter','ranger'],wand:['apprentice','acolyte','adept']};
 for(const [weapon,outfits]of Object.entries(sets))for(let i=0;i<3;i++){
  const ui=harness();await ui.load();ui.node('skin:black').click();await ui.load();ui.node('#create-button').click();await ui.load();
  ui.node('weapon:'+weapon).click();await ui.load();ui.node('#create-button').click();await ui.load();ui.node('outfit:'+i).click();await ui.load();
  ui.node('#scene').dispatch('keydown',{key:'ArrowRight'});
  const draw=ui.node('#hero').draws.at(-1);assert.ok(draw.src.endsWith(`${weapon}/${outfits[i]}/black-walk.png`));assert.equal(draw.crop[1],weapon==='bow'?384:192);
  ui.node('#create-button').click();const saved=JSON.parse(ui.storage.get('ember.character.v1'));assert.equal(saved.weapon,weapon);assert.equal(saved.outfit,outfits[i]);assert.equal(saved.skin,'black');
 }
});
test('back navigation and existing character restoration preserve prior outfit, name, level and creation time',async()=>{
 const ui=harness({saved:{version:1,skin:'amber',weapon:'wand',outfit:'acolyte',name:'Рыцарь',level:7,createdAt:'old'}});await ui.load();
 ui.node('#create-button').click();await ui.load();assert.equal(ui.node('weapon:wand').attrs['aria-checked'],'true');ui.node('#create-button').click();await ui.load();
 assert.equal(ui.node('outfit:1').attrs['aria-checked'],'true');ui.node('progress:0').click();await ui.load();ui.node('skin:olive').click();await ui.load();
 ui.node('progress:2').click();await ui.load();assert.equal(ui.node('outfit:1').attrs['aria-checked'],'true');ui.node('#create-button').click();
 const saved=JSON.parse(ui.storage.get('ember.character.v1'));assert.deepEqual([saved.name,saved.level,saved.createdAt,saved.skin,saved.outfit],['Рыцарь',7,'old','olive','acolyte']);
});
test('a stale asynchronous image cannot replace the newest selection; storage failure reports no success',async()=>{
 const ui=harness({blocked:true});ui.node('skin:amber').click();await ui.load();assert.ok(ui.node('#hero').draws.at(-1).src.endsWith('/amber.png'));
 ui.node('#create-button').click();await ui.load();ui.node('#create-button').click();await ui.load();ui.node('#create-button').click();
 assert.equal(ui.storage.has('ember.character.v1'),false);assert.equal(ui.node('#success-dialog').open,false);assert.equal(ui.node('#info-dialog').open,true);
});
