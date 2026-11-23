/* Cosmetic equipment prototype. Each slot is stored independently per class.
 * Visual-only items are unlocked for testing; loot and combat stats are separate.
 */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberEquipment=api;})(typeof window!=='undefined'?window:null,function(root){
  'use strict';
  const key='ember.equipment.v1';
  const dyeKey='ember.equipment.colors.v1';
  const dyeSlots=Object.freeze(['helmet','armor','cape']);
  const dyeIds=Object.freeze(['original','sand','forest','blue','red','purple','gray']);
  const slots=Object.freeze([
    {id:'helmet',name:'Шлем',icon:'helm'},
    {id:'armor',name:'Броня',icon:'armor'},
    {id:'weapon',name:'Оружие',icon:'sword'},
    {id:'shield',name:'Щит',icon:'shield'},
    {id:'cape',name:'Плащ',icon:'cape'},
    {id:'boots',name:'Обувь',icon:'boots'}
  ].map(Object.freeze));
  // Helms/armor use original LPC pose overlays; swords/shields are fully recomposed native LPC sheets.
  const supportedSlots=Object.freeze(['helmet','armor','weapon','shield','cape']);
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
      {id:'tattered',name:'Потрёпанный плащ',detail:'LPC · полный набор анимаций',tone:'#a74348'},
      {id:'solid',name:'Прямой плащ',detail:'LPC · полный набор анимаций',tone:'#7b5ba4'}
    ].map(Object.freeze)),
    boots:Object.freeze([
      {id:'basic',name:'Дорожные сапоги',detail:'Исходная обувь',tone:'#81634b'},
      {id:'iron',name:'Стальные поножи',detail:'Серебряные накладки',tone:'#adbdc4'},
      {id:'royal',name:'Рыцарские сапоги',detail:'Золотая отделка',tone:'#d0a04c'}
    ].map(Object.freeze))
  });
  // Ranged/magic use the same four independent storage keys. The shield key
  // represents their class accessory (quiver or sash), never an off-hand shield.
  const rangerCatalog=Object.freeze({...catalog,
    cape:Object.freeze([
      {id:'tattered',name:'Дорожный плащ',tone:'#5c805c'},
      {id:'solid',name:'Прямой плащ',tone:'#af6c77'}
    ].map(Object.freeze)),
    helmet:Object.freeze([
      {id:'basic',name:'Лесной капюшон',detail:'Исходный LPC-капюшон',tone:'#61774d'},
      {id:'iron',name:'Бацинет',detail:'Родной LPC · walk и shoot',tone:'#a1b3bb'},
      {id:'royal',name:'Большой шлем',detail:'Родной LPC · walk и shoot',tone:'#bdad80'}
    ].map(Object.freeze)),
    armor:Object.freeze([
      {id:'basic',name:'Походная рубаха',detail:'Исходный наряд',tone:'#55726a'},
      {id:'iron',name:'Кожаная броня',detail:'LPC · walk и shoot',tone:'#7a6042'},
      {id:'royal',name:'Пластинчатая броня',detail:'LPC · walk и shoot',tone:'#9cb5bc'}
    ].map(Object.freeze)),
    weapon:Object.freeze([
      {id:'basic',name:'Светлый лук',detail:'Исходный LPC-лук',tone:'#bca67b'},
      {id:'steel',name:'Тёмный лук',detail:'Оригинальный LPC · dark',tone:'#594638'},
      {id:'ember',name:'Золотой лук',detail:'Оригинальный LPC · gold',tone:'#d8ae52'}
    ].map(Object.freeze)),
    shield:Object.freeze([
      {id:'basic',name:'Походный колчан',detail:'Исходный LPC-колчан',tone:'#78604a'},
      {id:'steel',name:'Тёмный колчан',detail:'Перекраска LPC-слоя',tone:'#52616f'},
      {id:'royal',name:'Алый колчан',detail:'Перекраска LPC-слоя',tone:'#ac5951'}
    ].map(Object.freeze))
  });
  const mageCatalog=Object.freeze({...catalog,
    cape:Object.freeze([
      {id:'tattered',name:'Плащ послушника',tone:'#8c69b0'},
      {id:'solid',name:'Прямой плащ',tone:'#af6c77'}
    ].map(Object.freeze)),
    helmet:Object.freeze([
      {id:'basic',name:'Капюшон послушника',detail:'Исходный LPC-капюшон',tone:'#75548c'},
      {id:'iron',name:'Синяя шляпа мага',detail:'Оригинальный LPC · blue',tone:'#6174a6'},
      {id:'royal',name:'Фиолетовая шляпа',detail:'Оригинальный LPC · purple',tone:'#8862b4'}
    ].map(Object.freeze)),
    armor:Object.freeze([
      {id:'basic',name:'Одеяние послушника',detail:'Исходная одежда',tone:'#8c6f98'},
      {id:'iron',name:'Кожаная защита',detail:'Оригинальный LPC-доспех',tone:'#80614f'},
      {id:'royal',name:'Магический жилет',detail:'Оригинальный LPC-жилет',tone:'#4d70a8'}
    ].map(Object.freeze)),
    weapon:Object.freeze([
      {id:'basic',name:'Простая палочка',detail:'Исходная LPC-палочка',tone:'#87634d'},
      {id:'steel',name:'Лазурная палочка',detail:'Перекраска LPC-слоя',tone:'#619ed0'},
      {id:'ember',name:'Янтарная палочка',detail:'Перекраска LPC-слоя',tone:'#cd963d'}
    ].map(Object.freeze)),
    shield:Object.freeze([
      {id:'basic',name:'Тёмный пояс',detail:'Исходный LPC-пояс',tone:'#504653'},
      {id:'steel',name:'Синий пояс',detail:'LPC · палитра navy',tone:'#526c9b'},
      {id:'royal',name:'Золотой пояс',detail:'LPC · палитра yellow',tone:'#d7ad54'}
    ].map(Object.freeze))
  });
  // Every item portrait is an actual transparent icon extracted from the
  // matching native LPC sprite layer during the Pages build.
  const iconColors=Object.freeze(['sand','forest','blue','red','purple','gray']);
  function itemIconPath(classId,slot,itemId,outfitColor='sand',dye='original'){
    if(!['sword','bow','wand'].includes(classId))return null;
    const itemCatalog=classId==='sword'?catalog:classId==='bow'?rangerCatalog:mageCatalog;
    if(!Object.prototype.hasOwnProperty.call(itemCatalog,slot)
      ||!itemCatalog[slot].some(item=>item.id===itemId))return null;
    if(!['helmet','armor','weapon','shield','cape'].includes(slot))return null;
    const colored=(slot==='armor'&&itemId==='basic'&&classId!=='bow')
      ||(slot==='helmet'&&itemId==='basic'&&classId!=='sword')
      ||(slot==='cape'&&itemId!=='none');
    const color=iconColors.includes(outfitColor)?outfitColor:'sand';
    if(dyeSlots.includes(slot)&&dyeIds.includes(dye)&&dye!=='original'
      &&itemId!=='none'){
      return 'assets/equipment/icons/dyes/'+classId+'/'+slot+'/'+itemId
        +(colored?'/'+color:'/')+dye+'.png';
    }
    return 'assets/equipment/icons/'+classId+'/'+slot+'/'+itemId
      +(colored?'/'+color:'')+'.png';
  }
  const catalogs=Object.freeze({sword:catalog,bow:rangerCatalog,wand:mageCatalog});
  const supportedByClass=Object.freeze({sword:supportedSlots,bow:Object.freeze(['helmet','armor','weapon','shield']),wand:Object.freeze(['helmet','armor','weapon','shield'])});
  const slotNames=Object.freeze({sword:Object.freeze({shield:'Щит'}),bow:Object.freeze({shield:'Колчан'}),wand:Object.freeze({shield:'Пояс'})});
  function catalogForClass(classId){return catalogs[classId]||catalog;}
  function supportedForClass(classId){return supportedByClass[classId]||supportedSlots;}
  function slotLabel(classId,slot){return slotNames[classId]?.[slot]||slots.find(item=>item.id===slot)?.name||slot;}
  const defaults=Object.freeze(Object.fromEntries(slots.map(slot=>[slot.id,catalog[slot.id][0].id])));
  function defaultsForClass(classId){const items=catalogForClass(classId);return Object.fromEntries(slots.map(slot=>[slot.id,items[slot.id][0].id]));}
  function normalizeLook(input,classId='sword'){
    const out={};
    const items=catalogForClass(classId),allowed=supportedForClass(classId);
    for(const slot of slots){
      const selected=input?.[slot.id];
      out[slot.id]=allowed.includes(slot.id)&&items[slot.id].some(item=>item.id===selected)?selected:items[slot.id][0].id;
    }
    return out;
  }
  function normalize(value){
    const byClass={};
    if(value?.version===1&&value.byClass&&typeof value.byClass==='object'){
      for(const id of ['sword','bow','wand'])byClass[id]=normalizeLook(value.byClass[id],id);
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
      return {...normalizeLook(current.byClass[classId],classId)};
    }
    function equip(slot,id){
      const items=catalogForClass(classId);
      if(!Object.prototype.hasOwnProperty.call(items,slot)||!items[slot].some(item=>item.id===id))return {ok:false,reason:'invalid'};
      if(!supportedForClass(classId).includes(slot))return {ok:false,reason:'unsupported'};
      const fresh=read();
      const before=normalizeLook(fresh.byClass[classId],classId);
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
    function getColor(slot,itemId=state()[slot]){
      if(!dyeSlots.includes(slot)||!catalogForClass(classId)[slot]?.some(x=>x.id===itemId))return 'original';
      try{
        const saved=JSON.parse(storage?.getItem?.(dyeKey)||'null');
        const color=saved?.byClass?.[classId]?.[slot]?.[itemId];
        return dyeIds.includes(color)?color:'original';
      }catch{return 'original';}
    }
    function getColors(look=state(),overrideSlot=null,overrideColor=null){
      return Object.fromEntries(dyeSlots.map(slot=>[slot,
        slot===overrideSlot&&dyeIds.includes(overrideColor)?overrideColor:getColor(slot,look[slot])
      ]));
    }
    function setColor(slot,color,itemId=state()[slot]){
      if(!dyeSlots.includes(slot)||!catalogForClass(classId)[slot]?.some(x=>x.id===itemId)||!dyeIds.includes(color))return {ok:false,reason:'invalid'};
      if((slot==='helmet'&&itemId==='none')||(slot==='cape'&&itemId==='none'))return {ok:false,reason:'unsupported'};
      if(getColor(slot,itemId)===color)return {ok:true,unchanged:true};
      try{
        const saved=JSON.parse(storage?.getItem?.(dyeKey)||'null');
        const next=saved&&typeof saved==='object'?saved:{version:1,byClass:{}};
        if(!next.byClass||typeof next.byClass!=='object')next.byClass={};
        const current=next.byClass[classId]||{};
        next.byClass[classId]={...current,[slot]:{...(current[slot]||{}),[itemId]:color}};
        next.version=1;
        if(typeof storage?.setItem!=='function')throw Error('Storage unavailable');
        storage.setItem(dyeKey,JSON.stringify(next));
      }catch{return {ok:false,reason:'storage'};}
      return {ok:true,unchanged:false};
    }
    function subscribe(callback){
      if(typeof callback!=='function')throw new TypeError('Invalid listener');
      listeners.add(callback);return ()=>listeners.delete(callback);
    }
    return Object.freeze({classId,enabled:true,getState:state,equip,getColor,getColors,setColor,subscribe});
  }
  return Object.freeze({slots,catalog,defaults,supportedSlots,catalogs,catalogForClass,supportedForClass,slotLabel,defaultsForClass,itemIconPath,key,dyeKey,dyeSlots,dyeIds,normalizeLook,createStore});
});
