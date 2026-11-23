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
    ['power','attack','Сила удара',5],['vitality','defense','Стойкость',5],['tempo','control','Натиск',5]
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
