'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {createStore,talentCatalog}=require('../dist/progression.js');const {createBattle}=require('../dist/combat.js');
function memory(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}}
test('mage talent points, unlocked tiers, three-slot cap, persistence and paid reset',()=>{const storage=memory();let s=createStore({storage,classId:'wand',heroLevel:20});assert.equal(talentCatalog.length,15);assert.equal(s.getTalents().points,4);assert.equal(s.changeTalent('learn','absolute').ok,false);for(const id of ['shock','revenge','doubleEcho','ash'])assert.equal(s.changeTalent('learn',id).ok,true);for(const id of ['shock','revenge','doubleEcho'])assert.equal(s.changeTalent('toggle',id).ok,true);assert.equal(s.changeTalent('toggle','ash').reason,'full');s=createStore({storage,classId:'wand',heroLevel:20});assert.equal(s.getTalents().equipped.length,3);assert.equal(s.changeTalent('reset').ok,false);s.awardGold(100);assert.equal(s.changeTalent('reset').ok,true);assert.equal(s.getTalents().points,4);assert.equal(s.getState().gold,0);});
test('mage earns experience atomically with gold, other classes cannot learn mage talents',()=>{const storage=memory(),s=createStore({storage,classId:'wand',heroLevel:4});for(let i=0;i<10;i++)s.awardGold(5,10);assert.equal(s.getTalents().level,5);assert.equal(s.getTalents().points,1);assert.equal(s.getState().gold,50);assert.equal(createStore({storage,classId:'bow'}).changeTalent('learn','shock').reason,'class');});
test('talent loadout is queued until next wave and reflection damages attacker',()=>{const b=createBattle({heroWeapon:'wand',heroProjectile:'magic',heroSphereRank:5,heroMaxHp:2000,heroDamage:1,heroTalents:['revenge']});b.setTalents(['vampirism']);assert.deepEqual(b.state.activeTalents,['revenge']);const e=b.advance(2);assert.ok(e.some(x=>x.projectile==='reflection'&&x.damage===1.75));b.restart();assert.deepEqual(b.state.activeTalents,['vampirism']);});
test('every fourth echo produces a second projectile without recursively echoing',()=>{const b=createBattle({heroWeapon:'wand',heroProjectile:'magic',heroDamage:1,heroMaxHp:10000,heroEchoRank:5,heroTalents:['doubleEcho']});const e=b.advance(12);const shots=e.filter(x=>x.type==='cast'&&x.echo);assert.ok(shots.some(x=>x.castId.endsWith(':echo:2')));assert.equal(shots.filter(x=>x.castId.endsWith(':echo:2')).length,1);});

test('Talent tab opens without selecting a talent, preserves equipped slots, and clears only visual selection on reopen',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const store=createStore({storage:memory(),classId:'wand',heroLevel:10});
 store.changeTalent('learn','shock');store.changeTalent('toggle','shock');
 const nodes=new Map();
 function element(id){if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',hidden:false,disabled:false,querySelectorAll(){return [...this.innerHTML.matchAll(/data-(id|slot)="([^"]+)"/g)].map(match=>({dataset:{[match[1]]:match[2]}})).map(button=>{this.buttons??=[];this.buttons.push(button);return button;});}});return nodes.get(id);}
 const window={EmberProgression:{talentCatalog}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../dist/talents-ui.js'),'utf8'),{window});
 const panel=window.EmberTalentPanel.mount({root:{querySelector:s=>element(s.slice(1))},store,battle:{getState:()=>({activeTalents:['shock']})}});
 assert.ok(!element('talent-grid').innerHTML.includes('aria-pressed="true"'));
 assert.equal(element('talent-name').hidden,true);assert.equal(element('talent-action').hidden,true);
 element('talent-grid').buttons.find(b=>b.dataset.id==='revenge').onclick();
 assert.equal(element('talent-name').textContent,'Возмездие');assert.equal(element('talent-action').hidden,false);
 panel.render();assert.equal(element('talent-name').textContent,'Возмездие');
 panel.open();assert.ok(!element('talent-grid').innerHTML.includes('aria-pressed="true"'));assert.equal(element('talent-action').hidden,true);
 assert.deepEqual(store.getTalents().equipped,['shock']);assert.ok(element('talent-slots').innerHTML.includes('Термический шок'));
});
