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
    {id:'companion',name:'Компаньон',icon:'paw'}
  ].map(Object.freeze));
  // Helms/armor use original LPC pose overlays; swords/shields are fully recomposed native LPC sheets.
  const supportedSlots=Object.freeze(['helmet','armor','weapon','shield','cape']);
  const archerSlots=Object.freeze([...supportedSlots,'companion']);
  // The original LPC catalogue is retired. Only newly drawn items are selectable.
  const items={
    sword:{helmet:['Стальной шлем с плюмажем','#b0b5bf'],armor:['Стальная кираса','#9da3b1'],weapon:['Стальной меч','#c6cbd4'],shield:['Рыцарский щит','#c4a15d'],cape:['Алый плащ','#a74348']},
    bow:{helmet:['Лесной капюшон','#61774d'],armor:['Кожаный нагрудник','#8c6745'],weapon:['Деревянный лук','#b38a56'],shield:['Колчан со стрелами','#78604a'],cape:['Лесной плащ','#5c805c']},
    wand:{helmet:['Шляпа мага','#666ca4'],armor:['Мантия мага','#726ba5'],weapon:['Кристальная палочка','#86c3ef'],shield:['Пояс мага','#817152'],cape:['Синий плащ','#6b70ac']}
  };
  function makeCatalog(classId){
    const result={};
    for(const [slot,[name,tone]] of Object.entries(items[classId])){
      result[slot]=Object.freeze([{id:'basic',name,tone,detail:'Новый отдельный слой EMBER'}, {id:'none',name:'Снять',tone:'#738476',detail:'Без предмета'}].map(Object.freeze));
    }
    result.companion=Object.freeze([{id:'none',name:'Без компаньона',tone:'#738476'},...(classId==='bow'?[{id:'wolf',name:'Боевой волк',tone:'#866653'}]:[])].map(Object.freeze));
    return Object.freeze(result);
  }
  const catalog=makeCatalog('sword'),rangerCatalog=makeCatalog('bow'),mageCatalog=makeCatalog('wand');
  function itemIconPath(){return null;} // thumbnails are rendered from the live PNG layer
  const catalogs=Object.freeze({sword:catalog,bow:rangerCatalog,wand:mageCatalog});
  const supportedByClass=Object.freeze({sword:supportedSlots,bow:archerSlots,wand:supportedSlots});
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
      if(itemId==='none')return {ok:false,reason:'unsupported'};
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
  return Object.freeze({slots,catalog,defaults,supportedSlots,archerSlots,catalogs,catalogForClass,supportedForClass,slotLabel,defaultsForClass,itemIconPath,key,dyeKey,dyeSlots,dyeIds,normalizeLook,createStore});
});
