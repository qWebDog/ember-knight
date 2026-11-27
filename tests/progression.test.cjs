'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {catalog,createStore,storageKey,legacyGoldKey,maxGold} = require('../dist/progression.js');

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  const writes = [];
  return {data, writes,
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { writes.push([key,String(value)]); data.set(key,String(value)); }
  };
}
function canonical(gold, levels = {}) {
  return JSON.stringify({version:1,gold,levels:{power:0,vitality:0,tempo:0,...levels}});
}

test('UMD works in a browser without DOM and the catalog exposes all three branches', () => {
  const window = {localStorage:memoryStorage()};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/progression.js'),'utf8'), {window});
  assert.equal(typeof window.EmberProgression.createStore, 'function');
  assert.equal(window.EmberProgression.createStore().awardGold(10).ok, true);
  assert.deepEqual(catalog.map(item => [item.id,item.branch,item.name,item.maxLevel]), [
    ['power','attack','Сила удара',5],['vitality','defense','Стойкость',5],['tempo','control','Натиск',5],['shieldBash','defense','Удар щитом',5],['swordThrust','attack','Колющий удар',5],['swordOverhead','attack','Удар сверху',5],['swordDouble','attack','Двойной удар',5],['swordCleave','attack','Круговое рассечение',5],['swordMaster','attack','Мастер меча',5]
  ]);
  assert.ok(Object.isFrozen(catalog) && catalog.every(Object.isFrozen));
});

test('legacy migration waits for a transaction and each purchase commits coins and rank atomically', () => {
  const storage = memoryStorage({[legacyGoldKey]:'50'});
  const store = createStore({storage});
  assert.deepEqual(store.getState(), {version:1,gold:50,levels:{power:0,vitality:0,tempo:0}});
  assert.equal(storage.writes.length, 0);
  const events = [];
  store.subscribe((state,change) => {
    events.push([state,change,JSON.parse(storage.data.get(storageKey))]);
  });
  const result = store.purchase('power');
  assert.equal(result.ok, true); assert.equal(result.spent, 10);
  assert.deepEqual(result.state, {version:1,gold:40,levels:{power:1,vitality:0,tempo:0}});
  assert.deepEqual(result.stats, {heroDamage:14,heroMaxHp:200,heroAttackSpeed:1});
  assert.deepEqual(storage.writes.map(([key]) => key), [storageKey,legacyGoldKey]);
  assert.deepEqual(JSON.parse(storage.writes[0][1]), result.state);
  assert.equal(events.length, 1); assert.equal(events[0][1].type, 'purchase'); assert.equal(events[0][1].id, 'power');
  assert.deepEqual(events[0][2],result.state,'canonical state is committed before notification');
  assert.equal(createStore({storage}).getState().levels.power, 1);
});

test('prices increase through five levels and max or unaffordable purchases never write or charge', () => {
  const storage = memoryStorage({[storageKey]:canonical(150)}), store = createStore({storage});
  for (const cost of [10,20,30,40,50]) {
    assert.equal(store.quote('power').cost, cost);
    const bought = store.purchase('power'); assert.equal(bought.ok,true); assert.equal(bought.spent,cost);
  }
  assert.deepEqual(store.quote('power'), {id:'power',level:5,maxLevel:5,cost:null,canBuy:false,reason:'max'});
  const state = store.getState(), count = storage.writes.length;
  assert.equal(store.purchase('power').reason, 'max');
  assert.equal(store.purchase('vitality').reason, 'coins');
  assert.equal(store.purchase('constructor').reason, 'unknown');
  assert.equal(store.quote('missing').reason, 'unknown');
  assert.equal(storage.writes.length,count); assert.deepEqual(store.getState(),state);
});

test('all three bonuses restore from canonical state and returned snapshots cannot mutate the store', () => {
  const storage = memoryStorage({[storageKey]:canonical(90,{power:2,vitality:3,tempo:4})});
  const store = createStore({storage});
  assert.deepEqual(store.getStats(), {heroDamage:16,heroMaxHp:260,heroAttackSpeed:1.2});
  const snapshot = store.getState(); snapshot.gold = 999; snapshot.levels.power = 5;
  assert.equal(store.getState().gold,90); assert.equal(store.getState().levels.power,2);
  const bought = store.purchase('tempo'); bought.state.levels.tempo=0; bought.stats.heroDamage=999;
  assert.equal(store.getState().levels.tempo,5); assert.equal(store.getStats().heroDamage,16);
});

test('present corrupt canonical data suppresses legacy reminting; bad fields normalize independently', () => {
  for (const record of ['broken','null','{}','{"version":1}','{"version":2,"gold":100}']) {
    const storage=memoryStorage({[storageKey]:record,[legacyGoldKey]:'100'}),store=createStore({storage});
    assert.equal(store.getState().gold,0,record);
    assert.equal(store.purchase('power').reason,'coins'); assert.equal(storage.writes.length,0);
    assert.equal(store.awardGold(5).state.gold,5,'stale legacy gold is never added');
  }
  const storage=memoryStorage({[storageKey]:JSON.stringify({version:1,gold:-7,levels:{power:2.9,vitality:999,tempo:'4',unknown:5},other:100})});
  assert.deepEqual(createStore({storage}).getState(),{version:1,gold:0,levels:{power:2,vitality:5,tempo:0}});
  assert.equal(createStore({storage:memoryStorage({[storageKey]:canonical(2.5)})}).getState().gold,0);
});

test('legacy migration accepts only a nonnegative safe integer in the supported range', () => {
  for (const raw of ['',' ','-1','2.5','NaN','Infinity','1000000000','9007199254740993']) {
    assert.equal(createStore({storage:memoryStorage({[legacyGoldKey]:raw})}).getState().gold,0,raw);
  }
  assert.equal(createStore({storage:memoryStorage({[legacyGoldKey]:String(maxGold)})}).getState().gold,maxGold);
});

test('a failed canonical write cannot unlock a skill, deduct coins, mirror gold or notify', () => {
  const storage=memoryStorage({[storageKey]:canonical(50),[legacyGoldKey]:'50'}),store=createStore({storage});
  const before=store.getState(); let calls=0, attempts=0;
  store.subscribe(() => calls++);
  storage.setItem=(key) => {attempts++;assert.equal(key,storageKey);throw Error('quota');};
  const bought=store.purchase('power');
  assert.equal(bought.ok,false);assert.equal(bought.reason,'storage');assert.equal(bought.spent,0);
  assert.deepEqual(store.getState(),before);assert.deepEqual(JSON.parse(storage.data.get(storageKey)),before);
  const award=store.awardGold(5);assert.equal(award.ok,false);assert.equal(award.awarded,0);
  assert.deepEqual(store.getState(),before);assert.equal(storage.data.get(legacyGoldKey),'50');assert.equal(calls,0);assert.equal(attempts,2);
});

test('read failures block transactions, while a legacy mirror failure does not roll back a canonical commit', () => {
  const unreadable={getItem(){throw Error('denied');},setItem(){assert.fail('must not write after failed read');}};
  const broken=createStore({storage:unreadable});assert.equal(broken.purchase('power').reason,'storage');assert.equal(broken.awardGold(5).reason,'storage');
  const storage=memoryStorage({[storageKey]:canonical(20)}),write=storage.setItem.bind(storage);
  storage.setItem=(key,value) => {if(key===legacyGoldKey)throw Error('mirror');write(key,value);};
  const store=createStore({storage});let events=0;store.subscribe(()=>events++);
  assert.equal(store.purchase('power').ok,true);assert.equal(store.getState().gold,10);
  assert.equal(JSON.parse(storage.data.get(storageKey)).levels.power,1);assert.equal(events,1);
});

test('null storage and a throwing browser localStorage getter stay safe and cannot grant session-only rewards', () => {
  const empty={version:1,gold:0,levels:{power:0,vitality:0,tempo:0}};
  const direct=createStore({storage:null});
  assert.deepEqual(direct.getState(),empty);
  assert.equal(direct.purchase('power').reason,'storage');assert.equal(direct.awardGold(5).reason,'storage');
  assert.deepEqual(direct.getState(),empty);
  const window={};Object.defineProperty(window,'localStorage',{get(){throw Error('denied');}});
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/progression.js'),'utf8'),{window});
  const browser=window.EmberProgression.createStore();
  assert.equal(browser.awardGold(5).reason,'storage');assert.equal(browser.getState().gold,0);
  assert.equal(browser.purchase('power').reason,'storage');
});

test('fresh transaction reads preserve coins and ranks written by another store', () => {
  const storage=memoryStorage({[storageKey]:canonical(100)}),first=createStore({storage}),second=createStore({storage});
  assert.equal(first.purchase('power').state.gold,90);
  const secondBuy=second.purchase('power');assert.equal(secondBuy.spent,20);assert.equal(secondBuy.state.levels.power,2);assert.equal(secondBuy.state.gold,70);
  assert.equal(first.awardGold(5).state.gold,75);
  const mixed=second.purchase('vitality');assert.equal(mixed.state.gold,65);assert.deepEqual(mixed.state.levels,{power:2,vitality:1,tempo:0});
  storage.data.set(storageKey,canonical(0,{power:2,vitality:1,tempo:0}));
  assert.equal(first.purchase('tempo').reason,'coins','a stale cached balance cannot authorize a free purchase');
  assert.equal(JSON.parse(storage.data.get(storageKey)).gold,0);
});

test('invalid awards do not write; safe large awards cap without overflowing', () => {
  const storage=memoryStorage({[storageKey]:canonical(maxGold-2)}),store=createStore({storage});
  for(const amount of [0,-1,1.5,NaN,Infinity,'5',Number.MAX_SAFE_INTEGER+1])assert.equal(store.awardGold(amount).reason,'invalid');
  assert.equal(storage.writes.length,0);
  const result=store.awardGold(Number.MAX_SAFE_INTEGER);assert.equal(result.ok,true);assert.equal(result.awarded,2);assert.equal(result.state.gold,maxGold);
  assert.equal(storage.data.get(legacyGoldKey),String(maxGold));
});

test('listeners receive isolated snapshots after commit, can unsubscribe, and cannot alter a transaction result reentrantly', () => {
  const storage=memoryStorage({[storageKey]:canonical(20)}),store=createStore({storage});
  let seen=0;const observations=[];
  const stop=store.subscribe((state,change)=>{state.levels.power=5;change.type='bad';throw Error('UI listener');});
  store.subscribe((state,change)=>{seen++;observations.push([state.levels.power,change.type]);});
  const stopNested=store.subscribe((state,change)=>{if(change.type==='purchase')store.awardGold(5);});
  const purchase=store.purchase('power');
  assert.equal(purchase.state.gold,10,'result captures this purchase before its subscriber awards gold');
  assert.equal(store.getState().gold,15);assert.equal(seen,2);
  assert.deepEqual(observations,[[1,'purchase'],[1,'gold']],'subscriber mutations cannot affect another subscriber');
  stop();stop();stopNested();store.awardGold(1);assert.equal(seen,3);
});

test('Mage progression is class-specific, combines independent branches, and preserves Warrior ranks and shared gold', () => {
 const storage=memoryStorage({[storageKey]:canonical(200,{power:3,vitality:1,tempo:2})});
 const mage=createStore({storage,classId:'wand'});
 assert.deepEqual(mage.catalog.map(item=>item.id),['sorcery','barrier','channel','strongBurn','protectiveSphere','iceShards','fusion','chaos','absorption','rebirth','echo','overload','archmage']);
 assert.deepEqual(mage.getStats(),{heroDamage:12,heroMaxHp:200,heroAttackSpeed:1});
 assert.equal(mage.quote('power').reason,'unknown');
 for(const id of ['sorcery','barrier','channel'])assert.equal(mage.purchase(id).ok,true);
 assert.deepEqual(mage.getStats(),{heroDamage:14,heroMaxHp:220,heroAttackSpeed:1.05});
 assert.equal(mage.getState().gold,170);
 const warrior=createStore({storage});
 assert.deepEqual(warrior.getStats(),{heroDamage:18,heroMaxHp:220,heroAttackSpeed:1.1});
 assert.equal(warrior.quote('sorcery').reason,'unknown');
 assert.deepEqual(warrior.getState().levels,{power:3,vitality:1,tempo:2});
 assert.deepEqual(warrior.getState().mageLevels,{sorcery:1,barrier:1,channel:1});
 assert.equal(warrior.purchase('power').ok,true);
 assert.equal(createStore({storage,classId:'wand'}).getStats().heroDamage,14);
 assert.equal(createStore({storage,classId:'wand'}).getState().gold,130);
});

test('Mage upgrades fail safely without funds or storage and normalize invalid Mage ranks', () => {
 const storage=memoryStorage({[storageKey]:canonical(0,{power:1})});
 const mage=createStore({storage,classId:'wand'});
 assert.equal(mage.purchase('sorcery').reason,'coins');assert.equal(storage.writes.length,0);
 mage.awardGold(10);const saved=storage.data.get(storageKey);
 storage.setItem=()=>{throw new Error('full');};
 assert.equal(mage.purchase('sorcery').reason,'storage');
 assert.equal(storage.data.get(storageKey),saved);
 assert.equal(mage.getState().mageLevels,undefined);
 const corrupt=memoryStorage({[storageKey]:JSON.stringify({version:1,gold:80,levels:{power:2},mageLevels:{sorcery:50,barrier:-1,channel:'4',other:5}})});
 const normalized=createStore({storage:corrupt,classId:'wand'}).getState();
 assert.deepEqual(normalized.mageLevels,{sorcery:5,barrier:0,channel:0});
 assert.equal(createStore({storage:corrupt,classId:'wand'}).quote('sorcery').reason,'max');
});

test('Archer branch purchases change arrow stats and never borrow Warrior or Mage ranks',()=>{
 const saved={version:1,gold:200,levels:{power:4,vitality:3,tempo:2},mageLevels:{sorcery:2,barrier:2,channel:2}};
 const storage=memoryStorage({[storageKey]:JSON.stringify(saved)});
 const archer=createStore({storage,classId:'bow'});
 assert.equal(archer.catalog.length,15);assert.equal(archer.quote('piercing').reason,'locked');
 assert.deepEqual(archer.getStats(),{heroDamage:12,heroMaxHp:200,heroAttackSpeed:1});
 assert.equal(archer.quote('power').reason,'unknown');
 assert.equal(archer.quote('sorcery').reason,'unknown');
 for(const id of ['marksmanship','wolfBond','quickdraw'])assert.equal(archer.purchase(id).ok,true);
 assert.deepEqual(archer.getStats(),{heroDamage:14,heroMaxHp:200,heroAttackSpeed:1.05,archer_wolfBond:1});
 assert.equal(archer.getState().gold,170);
 const state=JSON.parse(storage.data.get(storageKey));
 assert.deepEqual(state.levels,saved.levels);
 assert.deepEqual(state.mageLevels,saved.mageLevels);
 assert.deepEqual(state.archerLevels,{marksmanship:1,endurance:0,quickdraw:1,wolfBond:1});
 assert.equal(createStore({storage,classId:'sword'}).getStats().heroDamage,20);
 assert.equal(createStore({storage,classId:'wand'}).getStats().heroDamage,16);
 assert.equal(createStore({storage,classId:'bow'}).quote('marksmanship').cost,20);
 assert.equal(createStore({storage,classId:'bow'}).purchase('marksmanship').ok,true);
 assert.equal(createStore({storage,classId:'bow'}).getStats().heroDamage,16);
 assert.equal(createStore({storage,classId:'wand'}).getState().gold,150);
});

test('Archer purchases retain previous saves and avoid charging on full ranks or failed writes',()=>{
 const storage=memoryStorage({[storageKey]:JSON.stringify({version:1,gold:75,levels:{power:2},archerLevels:{marksmanship:99,endurance:-2,quickdraw:'3',unknown:7}})});
 const archer=createStore({storage,classId:'bow'});
 assert.deepEqual(archer.getState().archerLevels,{marksmanship:5,endurance:0,quickdraw:0});
 assert.equal(archer.quote('marksmanship').reason,'max');
 assert.equal(archer.purchase('marksmanship').reason,'max');
 assert.equal(storage.writes.length,0);
 const before=storage.data.get(storageKey);
 storage.setItem=()=>{throw Error('quota');};
 assert.equal(archer.purchase('wolfBond').reason,'storage');
 assert.equal(storage.data.get(storageKey),before);
 assert.equal(archer.getState().gold,75);
 assert.equal(archer.getStats().heroMaxHp,200);
});

test('mage tier two requires rank three and persists each independent upgrade',()=>{
 const storage=memoryStorage({[storageKey]:canonical(1000,{})}),mage=createStore({storage,classId:'wand'});
 for(const [id,requires,stat] of [['strongBurn','sorcery','heroBurnRank'],['protectiveSphere','barrier','heroSphereRank'],['iceShards','sorcery','heroShardRank']]){if(mage.quote(requires).level<3)assert.equal(mage.purchase(id).reason,'locked');for(let i=mage.quote(requires).level;i<3;i++)assert.equal(mage.purchase(requires).ok,true);assert.equal(mage.purchase(id).ok,true);assert.equal(mage.getStats()[stat],1);assert.equal(createStore({storage,classId:'wand'}).getStats()[stat],1);}
});

test('all advanced mage ranks persist, and old shard purchases survive migration',()=>{
 const storage=memoryStorage({[storageKey]:JSON.stringify({version:1,gold:10000,levels:{power:2},mageLevels:{sorcery:0,barrier:0,channel:3,iceShards:2}})}),mage=createStore({storage,classId:'wand'});
 assert.equal(mage.quote('iceShards').level,2);assert.equal(mage.quote('iceShards').canBuy,true);assert.equal(mage.getStats().heroShardRank,2);assert.equal(mage.quote('fusion').reason,'locked');
 for(const id of ['sorcery','barrier','channel','strongBurn','iceShards','protectiveSphere','fusion','absorption','echo','overload','chaos','rebirth','archmage'])for(let i=mage.quote(id).level;i<3;i++)assert.equal(mage.purchase(id).ok,true,id);
 const restored=createStore({storage,classId:'wand'});assert.equal(restored.getStats().heroArchmageRank,3);assert.equal(restored.getStats().heroFusionRank,3);assert.equal(restored.getState().levels.power,2);
});

test('Any two distinct special arrow types at rank III unlock Double Shot; preserve old endurance',()=>{const ids=['piercing','poison','explosive','barbed'];for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const storage=memoryStorage({[storageKey]:JSON.stringify({version:1,gold:1000,levels:{},archerLevels:{marksmanship:5,endurance:2,[ids[i]]:3,[ids[j]]:2}})});const a=createStore({storage,classId:'bow'});assert.equal(a.getStats().heroMaxHp,240);assert.equal(a.quote('doubleShot').reason,'locked');assert.equal(a.purchase(ids[j]).ok,true);assert.equal(a.quote('doubleShot').canBuy,true);assert.equal(a.purchase('doubleShot').ok,true);assert.equal(a.quote('arrowRain').reason,'locked');}});

test('Marksmanship V unlocks all four arrow types independently; prices and saves persist',()=>{for(const id of ['piercing','poison','explosive','barbed']){const storage=memoryStorage({[storageKey]:JSON.stringify({version:1,gold:1000,levels:{}})});const a=createStore({storage,classId:'bow'});for(let n=0;n<5;n++){for(const kind of ['piercing','poison','explosive','barbed']){assert.equal(a.quote(kind).reason,'locked');assert.equal(a.purchase(kind).ok,false);}assert.equal(a.purchase('marksmanship').ok,true);}for(const kind of ['piercing','poison','explosive','barbed'])assert.equal(a.quote(kind).canBuy,true);assert.equal(a.quote(id).cost,20);for(let n=1;n<=5;n++){assert.equal(a.purchase(id).ok,true);assert.equal(a.quote(id).level,n);}assert.equal(a.quote(id).reason,'max');assert.equal(a.quote('marksmanship').level,5);for(const other of ['piercing','poison','explosive','barbed'].filter(x=>x!==id))assert.equal(a.quote(other).level,0);assert.equal(a.getStats()['archer_'+id],5);assert.equal(a.getState().gold,650);assert.equal(createStore({storage,classId:'bow'}).quote(id).level,5);assert.equal(a.quote('guardian').reason,'locked');assert.equal(a.quote('retreat').reason,'locked');}});


test('sword mastery requires two distinct rank III techniques and persists',()=>{const ids=['swordThrust','swordOverhead','swordDouble','swordCleave'];for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const storage=memoryStorage({[storageKey]:JSON.stringify({version:1,gold:1000,levels:{power:3,[ids[i]]:3,[ids[j]]:2}})});const store=createStore({storage,classId:'sword'});assert.equal(store.quote('swordMaster').reason,'locked');assert.ok(store.purchase(ids[j]).ok);assert.ok(store.purchase('swordMaster').ok);assert.equal(store.getStats().warrior_swordMaster,1);assert.equal(createStore({storage,classId:'sword'}).getStats().warrior_swordMaster,1);assert.equal(createStore({storage,classId:'bow'}).getStats().warrior_swordMaster,undefined);}});
