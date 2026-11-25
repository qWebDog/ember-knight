'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dist=path.resolve(__dirname,'../dist');
const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
const clean=value=>JSON.parse(JSON.stringify(value));

// Parse the actual static markup and run the actual panel/store. This minimal
// DOM supplies selection, text, attributes and native-disabled click behavior;
// it intentionally makes no claims about browser layout or painting.
class Element {
 constructor(tag,attrs={}){this.tagName=tag;this.attrs={...attrs};this.content=[];this.parentElement=null;this.listeners={};
  this.dataset=new Proxy({}, {get:(_,key)=>this.getAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))??undefined,set:(_,key,value)=>{this.setAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);return true;}});
  this.classList={contains:name=>this.classNames().includes(name),toggle:(name,on)=>{const names=new Set(this.classNames());if(on===undefined)on=!names.has(name);if(on)names.add(name);else names.delete(name);this.attrs.class=[...names].join(' ');return on;}};
 }
 classNames(){return (this.attrs.class||'').split(/\s+/).filter(Boolean);}
 get textContent(){return this.content.map(child=>typeof child==='string'?child:child.textContent).join('');}
 set textContent(value){this.content=[String(value)];}
 get children(){return this.content.filter(child=>child instanceof Element);}
 get disabled(){return Object.hasOwn(this.attrs,'disabled');}set disabled(value){if(value)this.attrs.disabled='';else delete this.attrs.disabled;}
 get hidden(){return Object.hasOwn(this.attrs,'hidden');}set hidden(value){if(value)this.attrs.hidden='';else delete this.attrs.hidden;}
 setAttribute(name,value){this.attrs[name]=String(value);}getAttribute(name){return this.attrs[name]??null;}
 addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(item=>item!==fn);}
 click(){if(this.disabled)return;for(const fn of [...(this.listeners.click||[])])fn({type:'click',target:this,currentTarget:this,preventDefault(){}});}
 matches(selector){
  const attrs=[...selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']*)["']?)?\]/g)];
  if(attrs.some(([,name,value])=>this.getAttribute(name)===null||(value!==undefined&&this.getAttribute(name)!==value)))return false;
  const rest=selector.replace(/\[[^\]]*\]/g,'');
  const id=rest.match(/#([\w-]+)/)?.[1];if(id&&this.getAttribute('id')!==id)return false;
  if([...rest.matchAll(/\.([\w-]+)/g)].some(([,name])=>!this.classList.contains(name)))return false;
  const tag=rest.match(/^[\w-]+/)?.[0];return !tag||this.tagName===tag;
 }
 querySelectorAll(selector){
  const result=[],alternatives=selector.split(',').map(part=>part.trim().split(/\s+/));
  const match=(element,parts)=>{if(!element.matches(parts.at(-1)))return false;let ancestor=element.parentElement;for(let index=parts.length-2;index>=0;index--){while(ancestor&&!ancestor.matches(parts[index]))ancestor=ancestor.parentElement;if(!ancestor)return false;ancestor=ancestor.parentElement;}return true;};
  const visit=element=>{for(const child of element.children){if(alternatives.some(parts=>match(child,parts)))result.push(child);visit(child);}};visit(this);return result;
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function parseHTML(source){
 const document=new Element('document'),stack=[document],voidTags=new Set(['meta','link','input','img','br','hr','source','wbr']);
 for(const token of source.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]*>|[^<]+/g)||[]){
  if(token.startsWith('<!'))continue;
  if(token.startsWith('</')){const tag=token.match(/^<\/([\w-]+)/)?.[1];for(let index=stack.length-1;index>0;index--)if(stack[index].tagName===tag){stack.length=index;break;}continue;}
  if(!token.startsWith('<')){stack.at(-1).content.push(token);continue;}
  const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const attrs={};
  for(const match of token.slice(tag.length+1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[match[1]]=match[2]??match[3]??match[4]??'';
  const element=new Element(tag,attrs);element.parentElement=stack.at(-1);stack.at(-1).content.push(element);if(!voidTags.has(tag)&&!token.endsWith('/>'))stack.push(element);
 }
 return document;
}
function createPanel({gold=0,levels={},saved,legacyGold,blocked=false,heroLevel=7,classId='sword'}={}){
 const document=parseHTML(html),root=document.querySelector('#skills-panel');assert.ok(root,'real index must contain the skill panel');
 const storage=new Map();if(saved||legacyGold===undefined)storage.set('ember.progress.v1',JSON.stringify(saved||{version:1,gold,levels:{power:0,vitality:0,tempo:0,...levels}}));if(legacyGold!==undefined)storage.set('ember.test.gold.v1',String(legacyGold));
 const storageAPI={getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(blocked)throw new Error('storage blocked');storage.set(key,String(value));}};
 const window={},context=vm.createContext({window});
 for(const name of ['progression.js','skills-ui.js'])vm.runInContext(fs.readFileSync(path.join(dist,name),'utf8'),context,{filename:name});
 const store=window.EmberProgression.createStore({storage:storageAPI,classId}),controller=window.EmberSkillPanel.mount({root,store,heroLevel,classId});
 const node=selector=>{const found=root.querySelector(selector);assert.ok(found,`missing real panel node ${selector}`);return found;};
 return {root,node,store,controller,storage,clickSkill:id=>node(`[data-skill-id="${id}"]`).click(),upgrade:()=>node('#skill-upgrade').click()};
}

test('the actual panel selects three distinct branches and exposes only the available warrior tab',()=>{
 const ui=createPanel({gold:30});assert.equal(ui.node('.skills-title p').textContent.trim(),'ВОИН');assert.equal(ui.node('[data-skill-hero-level]').textContent,'7');assert.equal(ui.node('[data-skill-gold]').textContent,'30');
 const cases=[['power','attack','Сила удара','+2 к урону'],['vitality','defense','Стойкость','+20 к максимуму здоровья'],['tempo','control','Натиск','+5% к скорости атаки']];
 for(const [id,branch,name,benefit]of cases){ui.clickSkill(id);assert.equal(ui.root.dataset.selected,id);assert.equal(ui.node('#skill-detail').dataset.branch,branch);assert.equal(ui.node('[data-skill-name]').textContent,name);assert.match(ui.node('[data-skill-benefit]').textContent,new RegExp(benefit.replace(/[+%]/g,'\\$&')));assert.equal(ui.node('#skill-upgrade').dataset.upgrade,id);assert.equal(ui.node('[data-skill-price]').textContent,'10');assert.equal(ui.node('[data-skill-rank]').textContent,'Уровень 0/5');for(const [other]of cases)assert.equal(ui.node(`[data-skill-id="${other}"]`).getAttribute('aria-pressed'),String(other===id));}
 const future=ui.root.querySelectorAll('[data-skill-future]');assert.equal(future.length,6);for(const node of future){assert.equal(node.disabled,true);assert.match(node.getAttribute('aria-label'),/скоро/i);node.click();}assert.equal(ui.root.dataset.selected,'tempo');
 const tabs=ui.root.querySelectorAll('[data-skill-tab]');assert.equal(tabs.length,3);assert.equal(tabs[0].getAttribute('aria-current'),'page');assert.deepEqual(tabs.slice(1).map(tab=>tab.disabled),[true,true]);
 assert.equal(ui.controller.select('shadow'),false);assert.equal(ui.root.dataset.selected,'tempo');
});

test('earned gold unlocks the correct purchase and rank, price and wallet restore from one committed save',()=>{
 const ui=createPanel({legacyGold:9});ui.clickSkill('tempo');assert.equal(ui.node('#skill-upgrade').disabled,true);assert.match(ui.node('[data-skill-upgrade-label]').textContent,/Не хватает/);const before=clean(ui.store.getState());ui.upgrade();assert.deepEqual(clean(ui.store.getState()),before);assert.equal(ui.storage.has('ember.progress.v1'),false);
 assert.equal(ui.store.awardGold(1).ok,true);assert.equal(ui.node('[data-skill-gold]').textContent,'10');assert.equal(ui.node('#skill-upgrade').disabled,false);ui.upgrade();
 assert.equal(ui.node('[data-skill-gold]').textContent,'0');assert.equal(ui.node('[data-skill-id="tempo"]').dataset.level,'1');assert.equal(ui.node('[data-skill-id="tempo"]').querySelector('[data-skill-node-rank]').textContent,'1/5');assert.equal(ui.node('[data-skill-rank]').textContent,'Уровень 1/5');assert.equal(ui.node('[data-skill-price]').textContent,'20');assert.equal(ui.node('#skill-upgrade').disabled,true);assert.equal(ui.store.getStats().heroAttackSpeed,1.05);assert.match(ui.node('[data-skill-message]').textContent,/Потрачено 10 монет/);
 const saved=JSON.parse(ui.storage.get('ember.progress.v1'));assert.deepEqual(saved,{version:1,gold:0,levels:{power:0,vitality:0,tempo:1}});assert.equal(ui.storage.get('ember.test.gold.v1'),'0');
 const restored=createPanel({saved});restored.clickSkill('tempo');assert.equal(restored.node('[data-skill-rank]').textContent,'Уровень 1/5');assert.equal(restored.node('[data-skill-gold]').textContent,'0');assert.equal(restored.node('[data-skill-price]').textContent,'20');assert.equal(restored.node('#skill-upgrade').disabled,true);
});

test('a maximum rank cannot charge again and locked future skills never change the save',()=>{
 const ui=createPanel({gold:1000,levels:{power:4}});ui.clickSkill('power');assert.equal(ui.node('[data-skill-price]').textContent,'50');ui.upgrade();assert.equal(ui.store.getState().gold,950);assert.equal(ui.node('[data-skill-id="power"]').dataset.level,'5');assert.equal(ui.node('[data-skill-rank]').textContent,'Уровень 5/5');assert.match(ui.node('[data-skill-benefit]').textContent,/\+10 к урону · Максимум/);assert.equal(ui.node('#skill-upgrade').disabled,true);assert.equal(ui.node('[data-skill-price-wrap]').hidden,true);assert.equal(ui.node('[data-skill-upgrade-label]').textContent,'Максимум');
 const saved=ui.storage.get('ember.progress.v1');ui.upgrade();for(const node of ui.root.querySelectorAll('[data-skill-future]'))node.click();assert.equal(ui.storage.get('ember.progress.v1'),saved);assert.equal(ui.store.getState().gold,950);
});

test('failed storage keeps displayed coins and rank intact; destroying the panel removes subscriptions and handlers',()=>{
 const ui=createPanel({gold:20,blocked:true});ui.clickSkill('power');assert.equal(ui.node('#skill-upgrade').disabled,false);ui.upgrade();assert.equal(ui.store.getState().gold,20);assert.equal(ui.store.getState().levels.power,0);assert.equal(ui.node('[data-skill-gold]').textContent,'20');assert.equal(ui.node('[data-skill-rank]').textContent,'Уровень 0/5');assert.match(ui.node('[data-skill-message]').textContent,/Не удалось сохранить/);assert.equal(JSON.parse(ui.storage.get('ember.progress.v1')).gold,20);
 const live=createPanel({gold:20});live.controller.destroy();live.controller.destroy();live.store.awardGold(5);assert.equal(live.node('[data-skill-gold]').textContent,'20');live.clickSkill('tempo');live.upgrade();assert.equal(live.root.dataset.selected,'');assert.equal(live.store.getState().gold,25);assert.equal(live.store.getState().levels.power,0);assert.equal(live.controller.select('tempo'),false);
});

test('the panel stays in the lower viewport grid with compact portrait and landscape containment rules',()=>{
 const document=parseHTML(html),root=document.querySelector('#skills-panel');assert.ok(root.classList.contains('skills-panel'));assert.equal(root.parentElement.tagName,'main');assert.equal(root.querySelector('#scene-fade'),null);assert.equal(document.querySelector('.adventure').querySelector('#scene-fade').parentElement.tagName,'section');
 const css=fs.readFileSync(path.join(dist,'skills.css'),'utf8'),gameCSS=fs.readFileSync(path.join(dist,'game.css'),'utf8'),base=css.match(/\.skills-panel\{([^}]*)\}/)?.[1]||'';
 assert.match(base,/min-height:0/);assert.match(base,/overflow:hidden/);assert.match(base,/grid-template-rows:[^;]*minmax\(0,1fr\)/);assert.match(gameCSS,/\.game-screen\{[^}]*grid-template-rows:52% minmax\(0,1fr\)/);assert.match(gameCSS,/html\{[^}]*overflow:hidden/);assert.match(gameCSS,/body\{[^}]*overflow:hidden/);
 assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/@media\(orientation:portrait\) and \(max-height:700px\)/);assert.ok(/@media\(orientation:landscape\) and \(max-height:600px\)\{\s*\.skills-panel\{[^}]*grid-template-columns:minmax\(0,[\d.]+fr\) minmax\(0,[\d.]+fr\)/.test(css),'compact landscape must place the tree and detail in two flexible columns');assert.doesNotMatch(base,/overflow(?:-y)?:\s*(?:auto|scroll)/);const treeRules=[...css.matchAll(/\.skills-tree\{([^}]*)\}/g)].map(match=>match[1]).join(';');assert.match(treeRules,/overflow-y:auto/);assert.match(treeRules,/overflow-x:hidden/);assert.match(treeRules,/overscroll-behavior:contain/);
 const gameScript=html.search(/src="game\.js(?:\?[^"]*)?"/);
 assert.ok(gameScript>=0,'game script must be present');
 for(const dependency of ['progression.js?v=mage-talents-1','skills-ui.js?v=panel-selection-1']){
   const dependencyIndex=html.indexOf(`src="${dependency}"`);
   assert.ok(dependencyIndex>=0&&dependencyIndex<gameScript,
     'the dependencies must load before the game mounts the panel');
 }
});

test('Mage displays only Mage skills and its chosen branches can be bought independently',()=>{
 const ui=createPanel({classId:'wand',gold:60});
 assert.equal(ui.node('.skills-title p').textContent,'МАГ');
 assert.equal(ui.root.dataset.heroClass,'wand');
 assert.equal(ui.root.getAttribute('aria-label'),'Древо навыков: МАГ');
 const cases=[['sorcery','attack','Сила стихий','заклинаний'],['barrier','defense','Магический барьер','здоровья'],['channel','control','Поток маны','заклинаний']];
 for(const [id,branch,name,fragment]of cases){
  ui.clickSkill(id);assert.equal(ui.root.dataset.selected,id);
  assert.equal(ui.node('#skill-detail').dataset.branch,branch);
  assert.equal(ui.node('[data-skill-name]').textContent,name);
  assert.match(ui.node('[data-skill-benefit]').textContent,new RegExp(fragment));
  assert.equal(ui.node('#skill-upgrade').dataset.upgrade,id);
  ui.upgrade();assert.equal(ui.node(`[data-skill-id="${id}"]`).dataset.level,'1');
 }
 assert.equal(ui.store.getStats().heroDamage,14);
 assert.equal(ui.store.getStats().heroMaxHp,220);
 assert.equal(ui.store.getStats().heroAttackSpeed,1.05);
 assert.equal(ui.node('[data-skill-gold]').textContent,'30');
 assert.equal(ui.controller.select('power'),false);
 assert.equal(ui.root.querySelectorAll('[data-skill-future]').length,6);
 assert.match(ui.root.querySelectorAll('[data-skill-future]')[0].getAttribute('aria-label'),/Сильный ожог/);
 assert.deepEqual(ui.root.querySelectorAll('.skill-branch').map(node=>node.querySelector('h3').textContent),
   ['Стихии','Аркана','Мастерство']);
 assert.equal(ui.root.querySelectorAll('[data-skill-tab]').length,3);
 assert.equal(ui.root.querySelectorAll('[data-skill-tab]').filter(node=>!node.disabled).length,1);
 const saved=JSON.parse(ui.storage.get('ember.progress.v1'));
 assert.deepEqual(saved.mageLevels,{sorcery:1,barrier:1,channel:1});
 const restore=createPanel({classId:'wand',saved});
 assert.equal(restore.node('[data-skill-id="sorcery"]').dataset.level,'1');
 assert.equal(restore.node('[data-skill-id="barrier"]').dataset.level,'1');
 assert.equal(restore.node('[data-skill-id="channel"]').dataset.level,'1');
});

test('Archer mounts a genuine independent three-branch tree with future nodes and persistent upgrades',()=>{
 const ui=createPanel({classId:'bow',gold:60});
 assert.equal(ui.node('.skills-title p').textContent,'ЛУЧНИК');
 assert.equal(ui.root.dataset.heroClass,'bow');
 assert.equal(ui.root.getAttribute('aria-label'),'Древо навыков: ЛУЧНИК');
 assert.equal(ui.root.querySelectorAll('[data-class-switch]').length,0);
 const cases=[['marksmanship','attack','Меткий выстрел','урону стрел'],['endurance','defense','Выносливость','здоровья'],['quickdraw','control','Быстрая тетива','стрельбы']];
 for(const [id,branch,name,fragment] of cases){
  ui.clickSkill(id);
  assert.equal(ui.root.dataset.selected,id);
  assert.equal(ui.node('#skill-detail').dataset.branch,branch);
  assert.equal(ui.node('[data-skill-name]').textContent,name);
  assert.match(ui.node('[data-skill-benefit]').textContent,new RegExp(fragment));
  assert.equal(ui.node('#skill-upgrade').dataset.upgrade,id);
  ui.upgrade();assert.equal(ui.node(`[data-skill-id="${id}"]`).dataset.level,'1');
 }
 assert.deepEqual(clean(ui.store.getStats()),{heroDamage:14,heroMaxHp:220,heroAttackSpeed:1.05});
 assert.equal(ui.node('[data-skill-gold]').textContent,'30');
 assert.equal(ui.controller.select('power'),false);
 assert.equal(ui.controller.select('sorcery'),false);
 assert.equal(ui.root.querySelectorAll('[data-skill-future]').length,6);
 assert.match(ui.root.querySelectorAll('[data-skill-future]')[0].getAttribute('aria-label'),/Пробивающая стрела/);
 assert.match(ui.root.querySelectorAll('[data-skill-future]')[5].getAttribute('aria-label'),/Прицельный залп/);
 assert.equal(ui.root.querySelectorAll('[data-skill-tab]').length,3);
 assert.equal(ui.root.querySelectorAll('[data-skill-tab]').filter(node=>!node.disabled).length,1);
 const saved=JSON.parse(ui.storage.get('ember.progress.v1'));
 assert.deepEqual(saved.archerLevels,{marksmanship:1,endurance:1,quickdraw:1});
 const restored=createPanel({classId:'bow',saved});
 assert.equal(restored.node('[data-skill-id="marksmanship"]').dataset.level,'1');
 assert.equal(restored.node('[data-skill-id="endurance"]').dataset.level,'1');
 assert.equal(restored.node('[data-skill-id="quickdraw"]').dataset.level,'1');
});


test('mage tier two nodes select locked details then become purchasable at rank three',()=>{
 const ui=createPanel({classId:'wand',gold:200});ui.clickSkill('protectiveSphere');assert.equal(ui.node('#skill-upgrade').disabled,true);assert.match(ui.node('[data-skill-benefit]').textContent,/III/);ui.clickSkill('barrier');for(let i=0;i<3;i++)ui.upgrade();ui.clickSkill('protectiveSphere');assert.equal(ui.node('#skill-upgrade').disabled,false);ui.upgrade();assert.equal(ui.store.getStats().heroSphereRank,1);
});

test('mage tree exposes all thirteen nodes and both elemental branches in attack',()=>{
 const ui=createPanel({classId:'wand',gold:1000});assert.equal(ui.root.querySelectorAll('[data-skill-id]').length,13);assert.equal(ui.node('[data-branch="attack"]').querySelectorAll('[data-skill-id]').length,5);ui.clickSkill('fusion');assert.match(ui.node('[data-skill-benefit]').textContent,/Сильный ожог.*Ледяные осколки/);assert.equal(ui.node('#skill-upgrade').disabled,true);
});

test('mage branch depth and parents match the progression catalog; only elements split and merge',()=>{
 const ui=createPanel({classId:'wand',gold:2000});
 const groups={attack:[['sorcery',0,''],['strongBurn',1,'sorcery'],['iceShards',1,'sorcery'],['fusion',2,'strongBurn iceShards'],['chaos',3,'fusion']],defense:[['barrier',0,''],['protectiveSphere',1,'barrier'],['absorption',2,'protectiveSphere'],['rebirth',3,'absorption']],control:[['channel',0,''],['echo',1,'channel'],['overload',2,'echo'],['archmage',3,'overload']]};
 for(const [branch,entries] of Object.entries(groups)){
  const group=ui.node('[data-branch="'+branch+'"]');
  assert.equal(group.querySelectorAll('[data-skill-id]').length,entries.length);
  for(const [id,depth,parents] of entries){
   const node=group.querySelector('[data-skill-id="'+id+'"]'),item=ui.store.catalog.find(x=>x.id===id);
   assert.equal(node.dataset.skillDepth,String(depth));
   assert.equal(node.dataset.skillRequires||'',parents);
   assert.equal([].concat(item.requires||[]).join(' '),parents);
   assert.equal(node.querySelector('use').getAttribute('href'),'#'+item.icon);
   assert.notEqual(item.icon,'bolt');
   assert.ok(html.includes('id="'+item.icon+'"'));
  }
 }
 ui.clickSkill('fusion');assert.equal(ui.node('[data-skill-benefit]').textContent,'Требуется: Сильный ожог III + Ледяные осколки III');
 for(const id of ['sorcery','strongBurn']){ui.clickSkill(id);for(let i=0;i<3;i++)ui.upgrade();}
 ui.clickSkill('fusion');assert.equal(ui.node('#skill-upgrade').disabled,true);
 ui.clickSkill('iceShards');for(let i=0;i<3;i++)ui.upgrade();
 ui.clickSkill('fusion');assert.equal(ui.node('#skill-upgrade').disabled,false);
 ui.clickSkill('chaos');assert.equal(ui.node('#skill-upgrade').disabled,true);
 ui.clickSkill('fusion');for(let i=0;i<3;i++)ui.upgrade();
 ui.clickSkill('chaos');assert.equal(ui.node('#skill-upgrade').disabled,false);
 for(const [ids] of [[['barrier','protectiveSphere','absorption','rebirth']],[['channel','echo','overload','archmage']]]){
  for(let i=0;i<ids.length-1;i++){ui.clickSkill(ids[i+1]);assert.equal(ui.node('#skill-upgrade').disabled,true);ui.clickSkill(ids[i]);for(let n=0;n<3;n++)ui.upgrade();ui.clickSkill(ids[i+1]);assert.equal(ui.node('#skill-upgrade').disabled,false);}
 }
});

test('All skill trees open unselected, keep ranks, and do not reselect on gold updates',()=>{for(const classId of ['sword','bow','wand']){const ui=createPanel({classId,gold:100});assert.equal(ui.root.dataset.selected,'');assert.equal(ui.node('#skill-detail').hidden,true);assert.equal(ui.node('#skill-upgrade').disabled,true);assert.equal(ui.root.querySelectorAll('[aria-pressed="true"]').length,0);const id=ui.store.catalog[0].id;ui.clickSkill(id);assert.equal(ui.node('#skill-detail').hidden,false);ui.upgrade();ui.controller.open();assert.equal(ui.root.dataset.selected,'');assert.equal(ui.node('#skill-detail').hidden,true);ui.store.awardGold(5);assert.equal(ui.root.dataset.selected,'');assert.equal(ui.store.quote(id).level,1);}});

test('Mage uses the approved transparent 13-cell battle-effect PNG atlas, with unique positions for all skills and matching detail art',()=>{
 const png=fs.readFileSync(path.join(dist,'assets/magic/mage-skill-icons-v1.png'));
 assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),416);assert.equal(png.readUInt32BE(20),32);assert.ok(png.includes(Buffer.from('tRNS')));
 const css=fs.readFileSync(path.join(dist,'skills.css'),'utf8');
 const ids=["sorcery","strongBurn","iceShards","fusion","chaos","barrier","protectiveSphere","absorption","rebirth","channel","echo","overload","archmage"];
 const ui=createPanel({classId:'wand',gold:100});
 for(const [i,id] of ids.entries()){assert.ok(css.includes('[data-skill-id="'+id+'"]'));assert.ok(css.includes('[data-selected="'+id+'"] .skill-detail-icon{--mage-icon-position:'+i*100/12+'%}'));ui.clickSkill(id);assert.equal(ui.root.dataset.selected,id);}
 assert.match(css,/background-size:1300% 100%/);assert.match(html,/skills\.css\?v=mage-icons-1/);
});
