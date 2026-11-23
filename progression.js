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
    Object.freeze({id:'sorcery', branch:'attack', name:'Сила стихий', description:'Каждый уровень добавляет 2 к урону заклинаний огня и льда.', maxLevel:5, icon:'flame'}),
    Object.freeze({id:'barrier', branch:'defense', name:'Магический барьер', description:'Каждый уровень добавляет 20 к максимальному здоровью мага.', maxLevel:5, icon:'skill-shield'}),
    Object.freeze({id:'channel', branch:'control', name:'Поток маны', description:'Каждый уровень ускоряет сотворение заклинаний на 5%.', maxLevel:5, icon:'bolt'})
  ]);
  function emptyMageLevels() { return {sorcery:0, barrier:0, channel:0}; }
  function emptyState() {
    return {version:1, gold:0, levels:{power:0, vitality:0, tempo:0}};
  }
  function copy(state) {
    const snapshot = {version:1, gold:state.gold, levels:{...state.levels}};
    if (state.mageLevels) snapshot.mageLevels = {...state.mageLevels};
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
      for (const item of mageCatalog) state.mageLevels[item.id] = normalizeRank(value.mageLevels[item.id]);
    }
    return state;
  }
  function stats(state, classId = 'sword') {
    const mage = classId === 'wand', levels = mage ? state.mageLevels || emptyMageLevels() : state.levels;
    return {
      heroDamage:12 + 2 * levels[mage ? 'sorcery' : 'power'],
      heroMaxHp:200 + 20 * levels[mage ? 'barrier' : 'vitality'],
      heroAttackSpeed:1 + .05 * levels[mage ? 'channel' : 'tempo']
    };
  }
  function quoteState(state, id, classId = 'sword') {
    const item = (classId === 'wand' ? mageCatalog : catalog).find(entry => entry.id === id);
    if (!item) return {id, level:0, maxLevel:0, cost:null, canBuy:false, reason:'unknown'};
    const level = classId === 'wand' ? (state.mageLevels?.[id] || 0) : state.levels[id];
    if (level >= item.maxLevel) return {id, level, maxLevel:item.maxLevel, cost:null, canBuy:false, reason:'max'};
    const cost = 10 + 10 * level;
    return {id, level, maxLevel:item.maxLevel, cost, canBuy:state.gold >= cost, reason:state.gold >= cost ? null : 'coins'};
  }
  function createStore(options = {}) {
    const classId = options.classId === 'wand' ? 'wand' : 'sword';
    const activeCatalog = classId === 'wand' ? mageCatalog : catalog;
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
      const levels = classId === 'wand' ? (next.mageLevels ||= emptyMageLevels()) : next.levels;
      levels[id] += 1;
      return commit(next, {type:'purchase', id, level:levels[id], classId, spent:offer.cost}, offer.cost) || result(false, 'storage', fresh);
    }
    function awardGold(amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0) return result(false, 'invalid', current, 0, 0);
      let fresh;
      try { fresh = readState(); } catch { return result(false, 'storage', current, 0, 0); }
      const awarded = Math.min(amount, maxGold - fresh.gold);
      const next = copy(fresh);
      next.gold += awarded;
      return commit(next, {type:'gold', amount:awarded}, 0, awarded) || result(false, 'storage', fresh, 0, 0);
    }
    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
    return {classId, catalog:activeCatalog, getState, getStats, quote, purchase, awardGold, subscribe};
  }
  return {catalog, mageCatalog, createStore, storageKey, legacyGoldKey, maxGold};
});
