/* Cosmetic equipment prototype. Each slot is stored independently per class.
 * Visual-only items are unlocked for testing; loot and combat stats are separate.
 */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberEquipment=api;})(typeof window!=='undefined'?window:null,function(root){
  'use strict';
  const key='ember.equipment.v1';
  const slots=Object.freeze([
    {id:'helmet',name:'Шлем',icon:'helm'},
    {id:'armor',name:'Броня',icon:'armor'},
    {id:'weapon',name:'Оружие',icon:'sword'},
    {id:'shield',name:'Щит',icon:'shield'},
    {id:'cape',name:'Плащ',icon:'cape'},
    {id:'boots',name:'Обувь',icon:'boots'}
  ].map(Object.freeze));
  // Helms/armor use original LPC pose overlays; swords/shields are fully recomposed native LPC sheets.
  const supportedSlots=Object.freeze(['helmet','armor','weapon','shield']);
  const catalog=Object.freeze({
    helmet:Object.freeze([
      {id:'none',name:'Без шлема',detail:'Открытая голова',tone:'#78867d'},
      {id:'iron',name:'Бацинет LPC',detail:'Оригинальный LPC · 5 анимаций',tone:'#a3b5bb'},
      {id:'royal',name:'Большой шлем LPC',detail:'Оригинальный LPC · 5 анимаций',tone:'#d4a955'}
    ].map(Object.freeze)),
    armor:Object.freeze([
      {id:'basic',name:'Походная одежда',detail:'Начальный наряд',tone:'#806f59'},
      {id:'iron',name:'Пластинчатая броня LPC',detail:'Оригинальный LPC · 5 анимаций',tone:'#9eabb1'},
      {id:'royal',name:'Легионерская броня LPC',detail:'Оригинальный LPC · 5 анимаций',tone:'#c2a04c'}
    ].map(Object.freeze)),
    weapon:Object.freeze([
      {id:'basic',name:'Начальный меч',detail:'Исходный LPC-меч',tone:'#b1aca4'},
      {id:'steel',name:'Серебряный меч LPC',detail:'Оригинальный LPC · серебро',tone:'#d2e0dd'},
      {id:'ember',name:'Золотой меч LPC',detail:'Оригинальный LPC · золото',tone:'#dcab37'}
    ].map(Object.freeze)),
    shield:Object.freeze([
      {id:'basic',name:'Деревянный щит',detail:'Исходный LPC-щит',tone:'#7a6149'},
      {id:'steel',name:'Стальной щит LPC',detail:'Анимированный heater · стальная палитра',tone:'#9cbdcb'},
      {id:'royal',name:'Королевский щит LPC',detail:'Анимированный heater · красный и золото',tone:'#d1a44d'}
    ].map(Object.freeze)),
    cape:Object.freeze([
      {id:'none',name:'Без плаща',detail:'Без дополнительного плаща',tone:'#737b69'},
      {id:'red',name:'Багряный плащ',detail:'Тёмно-красная ткань',tone:'#a74348'},
      {id:'purple',name:'Сумеречный плащ',detail:'Фиолетовая ткань',tone:'#7b5ba4'}
    ].map(Object.freeze)),
    boots:Object.freeze([
      {id:'basic',name:'Дорожные сапоги',detail:'Исходная обувь',tone:'#81634b'},
      {id:'iron',name:'Стальные поножи',detail:'Серебряные накладки',tone:'#adbdc4'},
      {id:'royal',name:'Рыцарские сапоги',detail:'Золотая отделка',tone:'#d0a04c'}
    ].map(Object.freeze))
  });
  const defaults=Object.freeze(Object.fromEntries(slots.map(slot=>[slot.id,catalog[slot.id][0].id])));
  function normalizeLook(input){
    const out={};
    for(const slot of slots){
      const selected=input?.[slot.id];
      out[slot.id]=supportedSlots.includes(slot.id)&&catalog[slot.id].some(item=>item.id===selected)?selected:defaults[slot.id];
    }
    return out;
  }
  function normalize(value){
    const byClass={};
    if(value?.version===1&&value.byClass&&typeof value.byClass==='object'){
      for(const id of ['sword','bow','wand'])byClass[id]=normalizeLook(value.byClass[id]);
    }
    return {version:1,byClass};
  }
  function createStore(options={}){
    const classId=['sword','bow','wand'].includes(options.classId)?options.classId:'sword';
    let storage=options.storage;
    if(storage===undefined)try{storage=root?.localStorage;}catch{storage=null;}
    const listeners=new Set();
    function read(){
      try{
        const raw=storage?.getItem?.(key);
        return normalize(raw?JSON.parse(raw):null);
      }catch{return normalize(null);}
    }
    let current=read();
    function state(){
      return {...normalizeLook(current.byClass[classId])};
    }
    function equip(slot,id){
      if(classId!=='sword')return {ok:false,reason:'class'};
      if(!Object.prototype.hasOwnProperty.call(catalog,slot)||!catalog[slot].some(item=>item.id===id))return {ok:false,reason:'invalid'};
      if(!supportedSlots.includes(slot))return {ok:false,reason:'unsupported'};
      const fresh=read();
      const before=normalizeLook(fresh.byClass[classId]);
      if(before[slot]===id)return {ok:true,unchanged:true,state:{...before}};
      const next={...before,[slot]:id};
      fresh.byClass[classId]=next;
      try{
        if(typeof storage?.setItem!=='function')throw Error('Storage unavailable');
        storage.setItem(key,JSON.stringify(fresh));
      }catch{return {ok:false,reason:'storage'};}
      current=fresh;
      for(const callback of [...listeners])try{callback({...next},slot,id);}catch{}
      return {ok:true,unchanged:false,state:{...next}};
    }
    function subscribe(callback){
      if(typeof callback!=='function')throw new TypeError('Invalid listener');
      listeners.add(callback);return ()=>listeners.delete(callback);
    }
    return Object.freeze({classId,enabled:classId==='sword',getState:state,equip,subscribe});
  }
  return Object.freeze({slots,catalog,defaults,supportedSlots,key,normalizeLook,createStore});
});
