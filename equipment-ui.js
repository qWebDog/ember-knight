/* Independent wearable items in the lower game panel.
 * Native LPC assets must be loaded before a new cosmetic choice is saved.
 */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberEquipmentUI=api;})(typeof window!=='undefined'?window:null,function(host){
  'use strict';
  function mount({root,store,getSprite,loadItem,paintItem,onEquip,outfitColor='sand'}={}){
    if(!root||!store||!host?.EmberEquipment)throw new TypeError('Equipment panel and store required');
    const data=host.EmberEquipment;
    const catalogue=data.catalogForClass(store.classId);
    const enabledSlots=data.supportedForClass(store.classId);
    const $=selector=>root.querySelector(selector);
    const items=$('#equipment-items'),preview=$('#equipment-preview'),portrait=$('.equipment-portrait');
    const slotNodes=[...root.querySelectorAll('[data-equipment-slot]')];
    const classes={sword:'ВОИН',bow:'ЛУЧНИК',wand:'МАГ'};
    let selected='helmet',destroyed=false,busy=false,orientation=0,gesture=null;
    // Universal LPC row order: back=0, left=1, front=2, right=3.
    // Rotation order is front -> left -> back -> right -> front.
    const directions=Object.freeze([{row:2,name:'спереди'},{row:1,name:'слева'},{row:0,name:'сзади'},{row:3,name:'справа'}]);
    const handlers=[];
    const listen=(el,type,fn)=>{el.addEventListener(type,fn);handlers.push(()=>el.removeEventListener(type,fn));};
    $('[data-equipment-class]').textContent=classes[store.classId]||'ГЕРОЙ';
    root.dataset.supported=String(store.enabled);
    const unsupported=$('#equipment-unsupported');
    if(unsupported)unsupported.hidden=store.enabled;
    function message(text){$('[data-equipment-message]').textContent=text;}
    function rotate(step){
      if(destroyed)return false;
      orientation=(orientation+step+directions.length)%directions.length;
      paintPreview();
      return true;
    }
    if(portrait){
      listen(portrait,'pointerdown',event=>{
        if(event.isPrimary===false||(event.pointerType==='mouse'&&event.button!==0)||gesture)return;
        gesture={id:event.pointerId,x:event.clientX,y:event.clientY};
        try{if(event.pointerId!==undefined)portrait.setPointerCapture?.(event.pointerId);}catch{}
      });
      listen(portrait,'pointerup',event=>{
        if(!gesture||gesture.id!==event.pointerId)return;
        const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
        gesture=null;
        if(Math.abs(dx)>=24&&Math.abs(dx)>Math.abs(dy)*1.2)rotate(dx<0?1:-1);
      });
      listen(portrait,'pointercancel',()=>{gesture=null;});
      listen(portrait,'lostpointercapture',()=>{gesture=null;});
      listen(portrait,'keydown',event=>{
        if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
        event.preventDefault?.();
        rotate(event.key==='ArrowLeft'?1:-1);
      });
    }
    function paintPreview(){
      if(destroyed||!preview||typeof getSprite!=='function')return;
      const descriptor=getSprite();
      if(!descriptor?.image)return;
      const ctx=preview.getContext('2d');
      if(!ctx)return;
      preview.width=64;preview.height=64;
      ctx.imageSmoothingEnabled=false;
      ctx.clearRect(0,0,64,64);
      const tile=descriptor.tile||64,origin=descriptor.origin||0,row=directions[orientation].row;
      ctx.drawImage(descriptor.image,origin,tile*row+origin,64,64,0,0,64,64);
      if(store.enabled)paintItem?.(ctx,{equipped:store.getState(),row,frame:0,kind:'idle',tile:64,origin:0});
      preview.setAttribute('aria-label','Текущий облик героя '+directions[orientation].name+'. Проведи влево или вправо для поворота.');
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
      const image=items.ownerDocument.createElement('img');
      image.className='equipment-item-image';
      image.src=data.itemIconPath(store.classId,slot,item.id,outfitColor);
      image.alt='';
      image.loading='lazy';
      image.decoding='async';
      artwork.append(image);
      const label=items.ownerDocument.createElement('span');
      label.className='equipment-item-copy';
      const name=items.ownerDocument.createElement('strong');name.textContent=item.name;
      label.append(name);
      button.append(artwork,label);
      button.setAttribute('aria-label',item.name+(current===item.id?' (надето)':''));
      button.addEventListener('click',async()=>{
        if(destroyed||busy||!store.enabled||!enabledSlots.includes(slot))return;
        if(store.getState()[slot]===item.id){message('Этот предмет уже надет.');return;}
        busy=true;message('Загружаем анимации LPC…');render();
        try{
          await loadItem?.(slot,item.id);
          if(destroyed)return;
          const result=store.equip(slot,item.id);
          if(result.ok){
            message('Предмет «'+item.name+'» надет. Анимации обновлены.');
            onEquip?.(result.state,slot,item.id);
          }else message(result.reason==='storage'?'Не удалось сохранить экипировку.':'Предмет недоступен.');
        }catch{
          if(!destroyed)message('Не удалось загрузить оригинальные LPC-спрайты. Выбор не изменён.');
        }finally{busy=false;if(!destroyed)render();}
      });
      return button;
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
      const category=data.slots.find(item=>item.id===selected);
      $('[data-equipment-category]').textContent=data.slotLabel(store.classId,selected)||category?.name||'Экипировка';
      items.replaceChildren(...catalogue[selected].map(item=>createItemButton(item,equipped[selected])));
      paintPreview();
    }
    function select(slot){
      if(destroyed||busy||!enabledSlots.includes(slot)||!store.enabled)return false;
      selected=slot;render();return true;
    }
    for(const button of slotNodes)listen(button,'click',()=>select(button.dataset.equipmentSlot));
    const unsubscribe=store.subscribe(()=>{if(!destroyed)render();});
    render();
    return {render,select,refreshPreview:paintPreview,getDirection:()=>directions[orientation].row,destroy(){
      if(destroyed)return;destroyed=true;unsubscribe();
      for(const remove of handlers)remove();
    }};
  }
  return Object.freeze({mount});
});
