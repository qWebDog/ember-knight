/* Persistent gold and starter upgrades. No battle or DOM dependencies. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EmberProgression = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';
  const storageKey = 'ember.progress.v1';
  const legacyGoldKey = 'ember.test.gold.v1';
  const maxGold = 999999999;
  const catalog = Object.freeze([
    Object.freeze({id:'power', branch:'attack', name:'Сила удара', description:'Каждый уровень добавляет 2 к урону героя.', maxLevel:5, icon:'swords'}),
    Object.freeze({id:'vitality', branch:'defense', name:'Стойкость', description:'Каждый уровень добавляет 20 к максимальному здоровью.', maxLevel:5, icon:'shield'}),
    Object.freeze({id:'tempo', branch:'control', name:'Натиск', description:'Каждый уровень ускоряет атаки на 5%.', maxLevel:5, icon:'bolt'})
  ]);
  // Mage upgrades are class-specific. Warrior data stays in the original
  // levels field so existing saves retain their exact ranks and wallet.
  const mageCatalog = Object.freeze([
    Object.freeze({id:'sorcery', branch:'attack', name:'Сила стихий', description:'Каждый уровень добавляет 2 к урону заклинаний огня и льда.', maxLevel:5, icon:'mage-elements'}),
    Object.freeze({id:'barrier', branch:'defense', name:'Магический барьер', description:'Каждый уровень добавляет 20 к максимальному здоровью мага.', maxLevel:5, icon:'skill-shield'}),
    Object.freeze({id:'channel', branch:'control', name:'Поток маны', description:'Каждый уровень ускоряет сотворение заклинаний на 5%.', maxLevel:5, icon:'mage-mana'}),
    Object.freeze({id:'strongBurn',branch:'attack',name:'Сильный ожог',description:'Продлевает горение и усиливает его урон.',maxLevel:5,icon:'flame',requires:'sorcery'}),
    Object.freeze({id:'protectiveSphere',branch:'defense',name:'Защитная сфера',description:'Поглощает урон до разрушения. Восстанавливается в начале нового боя.',maxLevel:5,icon:'mage-sphere',requires:'barrier'}),
    Object.freeze({id:'iceShards',branch:'attack',name:'Ледяные осколки',description:'Дополнительный залп после ледяного заклинания.',maxLevel:5,icon:'mage-ice',requires:'sorcery'}),
    Object.freeze({"id":"fusion","branch":"attack","name":"Слияние стихий","description":"Огонь и лёд вызывают термошок или паровой взрыв: +4 урона за уровень.","maxLevel":5,"icon":"mage-fusion","requires":["strongBurn","iceShards"]}),
    Object.freeze({"id":"chaos","branch":"attack","name":"Стихийный хаос","description":"Каждая третья реакция наносит всем врагам +5 урона за уровень.","maxLevel":5,"icon":"mage-chaos","requires":"fusion"}),
    Object.freeze({"id":"absorption","branch":"defense","name":"Поглощение","description":"За убийство восстанавливается 4 прочности сферы за уровень, в том числе после разрушения.","maxLevel":5,"icon":"mage-absorb","requires":"protectiveSphere"}),
    Object.freeze({"id":"rebirth","branch":"defense","name":"Перерождение","description":"Один раз за бой спасает от гибели и восстанавливает 10% здоровья за уровень.","maxLevel":5,"icon":"mage-rebirth","requires":"absorption"}),
    Object.freeze({"id":"echo","branch":"control","name":"Эхо заклинаний","description":"Каждые 10 очков резонанса повторяют заклинание с 50% урона; +1 очко за уровень за каждый каст.","maxLevel":5,"icon":"mage-echo","requires":"channel"}),
    Object.freeze({"id":"overload","branch":"control","name":"Перегрузка","description":"Усиленный удар +50% урона с частотой 8% за уровень (предсказуемая накопительная шкала).","maxLevel":5,"icon":"mage-overload","requires":"echo"}),
    Object.freeze({"id":"archmage","branch":"control","name":"Архимаг","description":"После каждых 6 обычных заклинаний следующие 3 интервала сокращаются на 10% + 5% за уровень.","maxLevel":5,"icon":"mage-archmage","requires":"overload"})
  ]);
  const archerCatalog = Object.freeze([
    Object.freeze({id:'marksmanship', branch:'attack', name:'Меткий выстрел', description:'Каждый уровень добавляет 2 к урону стрел лучника.', maxLevel:5, icon:'skill-bow'}),
    Object.freeze({id:'endurance', branch:'defense', name:'Выносливость', description:'Каждый уровень добавляет 20 к максимальному здоровью лучника.', maxLevel:5, icon:'skill-shield'}),
    Object.freeze({id:'quickdraw', branch:'control', name:'Быстрая тетива', description:'Каждый уровень увеличивает скорость стрельбы на 5%.', maxLevel:5, icon:'bolt'})
  ]);
  const talentCatalog=Object.freeze([{"id":"shock","name":"Термический шок","description":"Реакция огня и льда наносит соседним врагам 50% урона реакции.","requires":"fusion","icon":"mage-fusion","level":5,"branch":0},{"id":"revenge","name":"Возмездие","description":"25% поглощённого сферой урона возвращается нападающему.","requires":"protectiveSphere","icon":"mage-sphere","level":5,"branch":1},{"id":"doubleEcho","name":"Двойной резонанс","description":"Каждое четвёртое эхо выпускает дополнительный снаряд.","requires":"echo","icon":"mage-echo","level":5,"branch":2},{"id":"ash","name":"Пепел","description":"Горящий погибший враг поджигает ближайшего противника.","requires":"","icon":"flame","level":10,"branch":0},{"id":"lastStand","name":"Последний рубеж","description":"Разрушение сферы отбрасывает соседних врагов ближнего боя.","requires":"protectiveSphere","icon":"mage-sphere","level":10,"branch":1},{"id":"chainEcho","name":"Цепное эхо","description":"Эхо направляется в ближайшего другого противника, если он есть.","requires":"echo","icon":"mage-echo","level":10,"branch":2},{"id":"permafrost","name":"Вечная мерзлота","description":"Огонь не снимает действующую заморозку.","requires":"","icon":"mage-ice","level":15,"branch":0},{"id":"regeneration","name":"Регенерация","description":"После 3 секунд без урона восстанавливает 5% прочности сферы в секунду. Не воскрешает разбитую сферу.","requires":"protectiveSphere","icon":"mage-absorb","level":15,"branch":1},{"id":"timeWarp","name":"Искажение времени","description":"Перегрузка сокращает интервал до следующего заклинания на 50%.","requires":"overload","icon":"mage-overload","level":15,"branch":2},{"id":"storm","name":"Стихийная буря","description":"Попадание основного заклинания по замороженному врагу поражает соседей ледяными осколками.","requires":"iceShards","icon":"mage-ice","level":20,"branch":0},{"id":"vampirism","name":"Магический вампиризм","description":"Убийство восстанавливает 5% максимального здоровья.","requires":"","icon":"mage-absorb","level":20,"branch":1},{"id":"powerStack","name":"Накопление силы","description":"Эхо усиливает следующее основное заклинание на 20%.","requires":"echo","icon":"mage-mana","level":20,"branch":2},{"id":"cataclysm","name":"Катаклизм","description":"Каждый третий стихийный хаос вызывает дополнительный взрыв такой же силы.","requires":"chaos","icon":"mage-chaos","level":25,"branch":0},{"id":"immortality","name":"Бессмертие","description":"После перерождения маг не получает урон 2 секунды.","requires":"rebirth","icon":"mage-rebirth","level":25,"branch":1},{"id":"absolute","name":"Абсолютная магия","description":"Во время действия Архимага каждое основное заклинание вызывает эхо.","requires":"archmage","icon":"mage-archmage","level":25,"branch":2}].map(Object.freeze));
  const talentResetCost=100;
  function talentData(value){
    const xp=Number.isSafeInteger(value?.xp)?Math.max(0,Math.min(9800,value.xp)):0;
    const learned=[...new Set(Array.isArray(value?.learned)?value.learned:[])].filter(id=>talentCatalog.some(t=>t.id===id));
    const equipped=[...new Set(Array.isArray(value?.equipped)?value.equipped:[])].filter(id=>learned.includes(id)).slice(0,3);
    return {xp,learned,equipped};
  }
  function emptyMageLevels() { return {sorcery:0, barrier:0, channel:0}; }
  function emptyArcherLevels() { return {marksmanship:0, endurance:0, quickdraw:0}; }
  function emptyState() {
    return {version:1, gold:0, levels:{power:0, vitality:0, tempo:0}};
  }
  function copy(state) {
    const snapshot = {version:1, gold:state.gold, levels:{...state.levels}};
    if (state.mageLevels) snapshot.mageLevels = {...state.mageLevels};
    if (state.archerLevels) snapshot.archerLevels = {...state.archerLevels};
    if(state.mageTalents)snapshot.mageTalents=talentData(state.mageTalents);
    return snapshot;
  }
  function normalizeRank(value) {
    return Number.isFinite(value) ? Math.max(0, Math.min(5, Math.floor(value))) : 0;
  }
  function normalize(value) {
    const state = emptyState();
    if (!value || value.version !== 1) return state;
    state.gold = Number.isSafeInteger(value.gold) ? Math.max(0, Math.min(maxGold, value.gold)) : 0;
    for (const item of catalog) state.levels[item.id] = normalizeRank(value.levels?.[item.id]);
    if (value.mageLevels && typeof value.mageLevels === 'object' && !Array.isArray(value.mageLevels)) {
      state.mageLevels = emptyMageLevels();
      for (const item of mageCatalog) {const rank=normalizeRank(value.mageLevels[item.id]);if(!item.requires||rank>0)state.mageLevels[item.id]=rank;}
    }
    if (value.archerLevels && typeof value.archerLevels === 'object' && !Array.isArray(value.archerLevels)) {
      state.archerLevels = emptyArcherLevels();
      for (const item of archerCatalog) state.archerLevels[item.id] = normalizeRank(value.archerLevels[item.id]);
    }
    if(value.mageTalents)state.mageTalents=talentData(value.mageTalents);
    return state;
  }
  function classCatalog(classId) {
    return classId === 'wand' ? mageCatalog : classId === 'bow' ? archerCatalog : catalog;
  }
  function stats(state, classId = 'sword') {
    const levels = classId === 'wand' ? state.mageLevels || emptyMageLevels()
      : classId === 'bow' ? state.archerLevels || emptyArcherLevels() : state.levels;
    const ids = classId === 'wand' ? ['sorcery','barrier','channel']
      : classId === 'bow' ? ['marksmanship','endurance','quickdraw'] : ['power','vitality','tempo'];
    return {
      heroDamage:12 + 2 * levels[ids[0]],
      heroMaxHp:200 + 20 * levels[ids[1]],
      heroAttackSpeed:1 + .05 * levels[ids[2]],
      ...(classId==='wand'&&levels.strongBurn?{heroBurnRank:levels.strongBurn}:{}),
      ...(classId==='wand'&&levels.protectiveSphere?{heroSphereRank:levels.protectiveSphere}:{}),
      ...(classId==='wand'&&levels.iceShards?{heroShardRank:levels.iceShards}:{}),
      ...(classId==='wand'&&levels.fusion?{heroFusionRank:levels.fusion}:{}),
      ...(classId==='wand'&&levels.chaos?{heroChaosRank:levels.chaos}:{}),
      ...(classId==='wand'&&levels.absorption?{heroAbsorptionRank:levels.absorption}:{}),
      ...(classId==='wand'&&levels.rebirth?{heroRebirthRank:levels.rebirth}:{}),
      ...(classId==='wand'&&levels.echo?{heroEchoRank:levels.echo}:{}),
      ...(classId==='wand'&&levels.overload?{heroOverloadRank:levels.overload}:{}),
      ...(classId==='wand'&&levels.archmage?{heroArchmageRank:levels.archmage}:{})
    };
  }
  function quoteState(state, id, classId = 'sword') {
    const item = classCatalog(classId).find(entry => entry.id === id);
    if (!item) return {id, level:0, maxLevel:0, cost:null, canBuy:false, reason:'unknown'};
    const level = classId === 'wand' ? (state.mageLevels?.[id] || 0)
      : classId === 'bow' ? (state.archerLevels?.[id] || 0) : state.levels[id];
    if (level >= item.maxLevel) return {id, level, maxLevel:item.maxLevel, cost:null, canBuy:false, reason:'max'};
    // Purchased ranks survive changed prerequisites (including old ice-shard saves).
    const requirements=item.requires?[].concat(item.requires):[];
    if(!level&&requirements.some(key=>(state.mageLevels?.[key]||0)<3))return {id,level,maxLevel:item.maxLevel,cost:null,canBuy:false,reason:'locked',requires:item.requires};
    const cost = (item.requires?20:10) + 10 * level;
    return {id, level, maxLevel:item.maxLevel, cost, canBuy:state.gold >= cost, reason:state.gold >= cost ? null : 'coins'};
  }
  function createStore(options = {}) {
    const classId = ['sword','bow','wand'].includes(options.classId) ? options.classId : 'sword';
    const activeCatalog = classCatalog(classId);
    const baseLevel=Number.isInteger(options.heroLevel)?Math.max(1,Math.min(99,options.heroLevel)):1;
    let storage;
    try { storage = options.storage === undefined ? root?.localStorage : options.storage; } catch {}
    const listeners = new Set();
    let current = emptyState();

    function readState() {
      if (!storage || typeof storage.getItem !== 'function') throw new Error('Storage unavailable');
      const raw = storage.getItem(storageKey);
      // Any existing canonical record is authoritative, including corrupt data.
      // Falling back to its older mirror could restore coins already spent.
      if (raw !== null && raw !== undefined) {
        try { return normalize(JSON.parse(raw)); } catch { return emptyState(); }
      }
      const legacy = storage.getItem(legacyGoldKey);
      const amount = typeof legacy === 'string' && legacy.trim() !== '' ? Number(legacy) : NaN;
      const state = emptyState();
      if (Number.isSafeInteger(amount) && amount >= 0 && amount <= maxGold) state.gold = amount;
      return state;
    }
    try { current = readState(); } catch {}

    function result(ok, reason, state = current, spent = 0, awarded) {
      const value = {ok, reason, state:copy(state), stats:stats(state,classId), spent};
      if (awarded !== undefined) value.awarded = awarded;
      return value;
    }
    function commit(next, change, spent = 0, awarded) {
      // Gold and all ranks are written together before exposing any local change.
      try {
        if (typeof storage?.setItem !== 'function') throw new Error('Storage unavailable');
        storage.setItem(storageKey, JSON.stringify(next));
      } catch { return null; }
      current = next;
      const committed = result(true, null, next, spent, awarded);
      try { storage.setItem(legacyGoldKey, String(next.gold)); } catch {}
      for (const listener of [...listeners]) {
        try { listener(copy(next), {...change}); } catch {}
      }
      return committed;
    }
    function getState() { return copy(current); }
    function getStats() { return stats(current,classId); }
    function quote(id) { return quoteState(current,id,classId); }
    function purchase(id) {
      if (!activeCatalog.some(item => item.id === id)) return result(false, 'unknown');
      let fresh;
      try { fresh = readState(); } catch { return result(false, 'storage'); }
      const offer = quoteState(fresh,id,classId);
      if (!offer.canBuy) return result(false, offer.reason, fresh);
      const next = copy(fresh);
      next.gold -= offer.cost;
      const levels = classId === 'wand' ? (next.mageLevels ||= emptyMageLevels())
        : classId === 'bow' ? (next.archerLevels ||= emptyArcherLevels()) : next.levels;
      levels[id] = (levels[id]||0)+1;
      return commit(next, {type:'purchase', id, level:levels[id], classId, spent:offer.cost}, offer.cost) || result(false, 'storage', fresh);
    }
    function awardGold(amount,xp=0) {
      if (!Number.isSafeInteger(amount) || amount <= 0) return result(false, 'invalid', current, 0, 0);
      let fresh;
      try { fresh = readState(); } catch { return result(false, 'storage', current, 0, 0); }
      const awarded = Math.min(amount, maxGold - fresh.gold);
      const next = copy(fresh);
      next.gold += awarded;
      if(classId==='wand'&&Number.isSafeInteger(xp)&&xp>0){next.mageTalents=talentData(next.mageTalents);next.mageTalents.xp=Math.min(9800,next.mageTalents.xp+xp);}
      return commit(next, {type:'gold', amount:awarded}, 0, awarded) || result(false, 'storage', fresh, 0, 0);
    }
    function talentView(state=current){
      const data=talentData(state.mageTalents),level=Math.min(99,baseLevel+Math.floor(data.xp/100));
      return {...data,level,points:Math.max(0,Math.min(15,Math.floor(level/5))-data.learned.length),xpToNext:level===99?0:100-data.xp%100,resetCost:talentResetCost};
    }
    function changeTalent(action,id){
      if(classId!=='wand')return result(false,'class');
      let fresh;try{fresh=readState();}catch{return result(false,'storage');}
      const view=talentView(fresh),item=talentCatalog.find(t=>t.id===id),next=copy(fresh),data=next.mageTalents=talentData(fresh.mageTalents);
      let spent=0;
      if(action==='learn'){
        if(!item||view.level<item.level||view.points<1||data.learned.includes(id))return result(false,'locked',fresh);
        data.learned.push(id);
      }else if(action==='toggle'){
        if(!data.learned.includes(id))return result(false,'locked',fresh);
        if(data.equipped.includes(id))data.equipped=data.equipped.filter(x=>x!==id);
        else{if(data.equipped.length>=3)return result(false,'full',fresh);data.equipped.push(id);}
      }else if(action==='reset'){
        if(!data.learned.length||fresh.gold<talentResetCost)return result(false,'coins',fresh);
        spent=talentResetCost;next.gold-=spent;data.learned=[];data.equipped=[];
      }else return result(false,'unknown',fresh);
      return commit(next,{type:'talents',action,id},spent)||result(false,'storage',fresh);
    }
    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
    return {classId, catalog:activeCatalog, getState, getStats, quote, purchase, awardGold, subscribe,getTalents:()=>talentView(),changeTalent};
  }
  return {catalog, mageCatalog, archerCatalog, createStore, storageKey, legacyGoldKey, maxGold,talentCatalog};
});
