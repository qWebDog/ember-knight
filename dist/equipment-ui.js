/* Independent wearable items in the lower game panel.
 * Native LPC assets must be loaded before a new cosmetic choice is saved.
 */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberEquipmentUI=api;})(typeof window!=='undefined'?window:null,function(host){
  'use strict';
  function mount({root,store,getSprite,loadItem,paintItem,paintBack,paintHero,paintIcon,onEquip,outfitColor='sand'}={}){
    if(!root||!store||!host?.EmberEquipment)throw new TypeError('Equipment panel and store required');
    const data=host.EmberEquipment;
    const catalogue=data.catalogForClass(store.classId);
    const enabledSlots=data.supportedForClass(store.classId);
    const $=selector=>root.querySelector(selector);
    const items=$('#equipment-items'),preview=$('#equipment-preview'),dyePanel=$('#equipment-dyes');
    const slotNodes=[...root.querySelectorAll('[data-equipment-slot]')];
    const classes={sword:'ВОИН',bow:'ЛУЧНИК',wand:'МАГ'};
    let selected=null,destroyed=false,busy=false;
    const handlers=[];
    const listen=(el,type,fn)=>{el.addEventListener(type,fn);handlers.push(()=>el.removeEventListener(type,fn));};
    $('[data-equipment-class]').textContent=classes[store.classId]||'ГЕРОЙ';
    root.dataset.supported=String(store.enabled);
    const unsupported=$('#equipment-unsupported');
    if(unsupported)unsupported.hidden=store.enabled;
    function message(text){$('[data-equipment-message]').textContent=text;}
    function paintPreview(){
      if(destroyed||!preview||typeof getSprite!=='function')return;
      const descriptor=getSprite();
      if(!descriptor?.image)return;
      const ctx=preview.getContext('2d');
      if(!ctx)return;
      preview.width=64;preview.height=64;
      ctx.imageSmoothingEnabled=false;
      ctx.clearRect(0,0,64,64);
      const row=2;
      const pose={equipped:store.getState(),colors:store.getColors(),row,frame:0,kind:'idle',tile:64,origin:0};
      paintHero?.(ctx,pose);
      preview.setAttribute('aria-label','Текущий облик героя спереди');
    }
    function createItemButton(item,current){
      const slot=selected;
      const button=items.ownerDocument.createElement('button');
      button.type='button';
      button.className='equipment-item'+(current===item.id?' is-equipped':'');
      button.setAttribute('data-equipment-item',item.id);
      button.setAttribute('aria-pressed',String(current===item.id));
      button.disabled=!store.enabled||busy||!enabledSlots.includes(slot);
      const artwork=items.ownerDocument.createElement('span');
      artwork.className='equipment-item-art';
      if(slot==='companion'){
        // Crop the original 640×384 LPC sheet with CSS rather than shrinking
        // the entire atlas into a nearly invisible thumbnail.
        const sprite=items.ownerDocument.createElement('span');
        sprite.className=item.id==='wolf'?'companion-item-wolf':'companion-item-empty';
        sprite.setAttribute('aria-hidden','true');
        artwork.append(sprite);
      }else{
        const icon=items.ownerDocument.createElement('canvas');
        icon.width=icon.height=64;icon.className='equipment-item-image';icon.setAttribute('aria-hidden','true');
        paintIcon?.(icon.getContext('2d'),slot,item.id,store.getColor(slot,item.id));
        artwork.append(icon);
      }
      const label=items.ownerDocument.createElement('span');
      label.className='equipment-item-copy';
      const name=items.ownerDocument.createElement('strong');name.textContent=item.name;
      label.append(name);
      button.append(artwork,label);
      button.setAttribute('aria-label',item.name+(current===item.id?' (надето)':''));
      button.addEventListener('click',async()=>{
        if(destroyed||busy||!store.enabled||!enabledSlots.includes(slot))return;
        if(store.getState()[slot]===item.id){message(slot==='companion'?'Этот компаньон уже выбран.':'Этот предмет уже надет.');return;}
        busy=true;message(slot==='companion'?'Готовим компаньона…':'Готовим новый предмет…');render();
        try{
          await loadItem?.(slot,item.id,store.getColors({...store.getState(),[slot]:item.id}));
          if(destroyed)return;
          const result=store.equip(slot,item.id);
          if(result.ok){
            message(slot==='companion'?'Компаньон: '+item.name+'.':'Предмет «'+item.name+'» надет. Анимации обновлены.');
            onEquip?.(result.state,slot,item.id);
          }else message(result.reason==='storage'?'Не удалось сохранить экипировку.':'Предмет недоступен.');
        }catch{
          if(!destroyed)message(slot==='companion'?'Не удалось загрузить волка. Выбор не изменён.':'Не удалось загрузить новый предмет. Выбор не изменён.');
        }finally{busy=false;if(!destroyed)render();}
      });
      return button;
    }
    function renderDyes(equipped){
      if(!dyePanel)return;
      const slot=selected,id=equipped[slot];
      const visible=data.dyeSlots.includes(slot)&&id!=='none';
      dyePanel.hidden=!visible;
      if(!visible){dyePanel.replaceChildren();return;}
      const palette=host.EmberEquipmentDye?.palette||[];
      dyePanel.replaceChildren(...palette.map(item=>{
        const button=items.ownerDocument.createElement('button');
        button.type='button';button.className='equipment-dye';
        button.style.backgroundColor=item.hex;
        button.setAttribute('aria-label','Цвет: '+item.name);
        button.setAttribute('title',item.name);
        button.setAttribute('aria-pressed',String(store.getColor(slot,id)===item.id));
        button.disabled=busy;
        button.addEventListener('click',async()=>{
          if(destroyed||busy||store.getColor(slot,id)===item.id)return;
          busy=true;message('Применяем цвет…');render();
          try{
            const nextColors=store.getColors(store.getState(),slot,item.id);
            await loadItem?.(slot,id,nextColors);
            if(destroyed)return;
            const result=store.setColor(slot,item.id,id);
            if(result.ok){
              message('Цвет «'+item.name+'» применён.');
              onEquip?.(store.getState(),slot,id);
            }else message('Не удалось сохранить выбранный цвет.');
          }catch{
            if(!destroyed)message('Не удалось применить цвет.');
          }finally{busy=false;if(!destroyed)render();}
        });
        return button;
      }));
    }
    function render(){
      if(destroyed)return;
      const equipped=store.getState();
      for(const button of slotNodes){
        const slot=button.dataset.equipmentSlot;
        const current=catalogue[slot]?.find(item=>item.id===equipped[slot]);
        if(!current)continue;
        button.classList.toggle('is-active',selected===slot);
        button.setAttribute('aria-pressed',String(selected===slot));
        button.querySelector('[data-equipment-slot-name]').textContent=current.name;
        const label=button.querySelector('strong');
        if(label)label.textContent=data.slotLabel(store.classId,slot);
        button.disabled=!store.enabled||busy||!enabledSlots.includes(slot);
      }
      root.dataset.selected=selected||'';
      const inventory=$('.equipment-inventory');if(inventory)inventory.hidden=!selected;
      const category=data.slots.find(item=>item.id===selected);
      $('[data-equipment-category]').textContent=selected?(data.slotLabel(store.classId,selected)||category?.name||'Экипировка'):'';
      items.replaceChildren(...(selected?(catalogue[selected]||[]).map(item=>createItemButton(item,equipped[selected])):[]));
      renderDyes(equipped);
      paintPreview();
    }
    function open(){if(destroyed)return;selected=null;if(!busy)message('');render();}
    function select(slot){
      if(destroyed||busy||!enabledSlots.includes(slot)||!store.enabled)return false;
      selected=slot;render();return true;
    }
    for(const button of slotNodes)listen(button,'click',()=>select(button.dataset.equipmentSlot));
    const unsubscribe=store.subscribe(()=>{if(!destroyed)render();});
    render();
    return {render,select,open,refreshPreview:render,getDirection:()=>2,destroy(){
      if(destroyed)return;destroyed=true;unsubscribe();
      for(const remove of handlers)remove();
    }};
  }
  return Object.freeze({mount});
});
