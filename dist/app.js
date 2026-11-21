(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const catalogue = window.EmberLoadouts;
  const skins = [
    {id:'light',label:'Светлый',color:'#F9D5BA'},
    {id:'brown',label:'Смуглый',color:'#9C663E'},{id:'black',label:'Тёмный',color:'#603429'}
  ];
  const legacySkins={amber:'light',olive:'brown',bronze:'brown'};
  const key = 'ember.character.v1', canvas = $('#hero'), createButton = $('#create-button'), status = $('#status');
  const controls = [...document.querySelectorAll('.skin-option')];
  const weaponButtons = [...document.querySelectorAll('[data-weapon]')];
  const colorButtons = [...document.querySelectorAll('[data-outfit-color]')];
  const progressButtons = [...document.querySelectorAll('[data-go-step]')];
  const cache = new Map();
  let selected='light', weapon='sword', step=0, furthest=0, direction=2, frame=0, saved=null;
  let imageReady=false, loadingError=false, imageVersion=0, previewImage=null, previewDescriptor=null;
  const rememberedColors={sword:'sand',bow:'forest',wand:'purple'};
  const directionNames=['Вид сзади','Левый бок','Вид спереди','Правый бок'];
  const telegram=window.Telegram?.WebApp;
  try {telegram?.ready();telegram?.expand();telegram?.setHeaderColor('#111613');telegram?.setBackgroundColor('#111613');}catch{}
  try {
    const candidate=JSON.parse(localStorage.getItem(key));
    const restoredSkin=legacySkins[candidate?.skin]||candidate?.skin;
    if(candidate?.version===1&&skins.some(s=>s.id===restoredSkin)){
      saved=candidate;selected=restoredSkin;
      const choice=catalogue.selection(candidate);
      if(choice){weapon=choice.weapon;rememberedColors[weapon]=choice.outfitColor;}
    }
  }catch{}
  function choice(){return {weapon,outfit:catalogue.weapon(weapon).outfits[0].id,outfitColor:rememberedColors[weapon]};}
  function outfit(){return catalogue.weapon(weapon).outfits[0];}
  function haptic(){try{telegram?.HapticFeedback?.selectionChanged();}catch{}}
  function syncViewport(){
    const visible=window.visualViewport?.height||window.innerHeight;
    const tgHeight=telegram?.initData&&Number(telegram.viewportHeight);
    document.documentElement.style.setProperty('--app-height',`${Math.floor(tgHeight>0?Math.min(visible,tgHeight):visible)}px`);
  }
  window.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('resize',syncViewport);telegram?.onEvent?.('viewportChanged',syncViewport);syncViewport();
  function alignCharacter(){
    const scene=$('#scene'),stage=$('.sprite-stage');
    const bottom=Number(getComputedStyle(scene).getPropertyValue('--scene-bottom'))||122;
    const feet=Math.max(30,scene.clientHeight-bottom);
    const scale=Math.max(1,Math.min(5,Math.floor((feet-32)/47)));
    stage.style.width=`${scale*64}px`;stage.style.height=`${scale*64}px`;stage.style.top=`${feet-62*scale}px`;
    const artScale=Math.max(scene.clientWidth/760,feet/500,(scene.clientHeight-feet)/160);
    scene.style.backgroundSize=`${760*artScale}px ${660*artScale}px`;scene.style.backgroundPosition=`center ${feet-500*artScale}px`;
  }
  new ResizeObserver(alignCharacter).observe($('#scene'));alignCharacter();
  function getImage(path){
    if(!cache.has(path))cache.set(path,new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>{cache.delete(path);reject(new Error(path));};im.src=path;}));
    return cache.get(path);
  }
  function draw(){
    if(!previewImage||!previewDescriptor)return;
    const d=previewDescriptor,tile=d.tile||64,origin=d.origin||0,cell=step===0?frame:0;
    if(canvas.width!==tile){canvas.width=tile;canvas.height=tile;}
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,tile,tile);ctx.imageSmoothingEnabled=false;
    ctx.drawImage(previewImage,cell*tile,direction*tile,tile,tile,0,0,tile,tile);
    canvas.style.width=`${tile/64*100}%`;canvas.style.height=`${tile/64*100}%`;canvas.style.left=`${-origin/64*100}%`;canvas.style.top=`${-origin/64*100}%`;
    const description=step===0?'без экипировки':`${catalogue.weapon(weapon).name}, наряд ${outfit().name}, ${catalogue.color(rememberedColors[weapon]).name}`;
    canvas.setAttribute('aria-label',`Странник: ${description}. Цвет кожи: ${skins.find(s=>s.id===selected).label}. ${directionNames[direction]}.`);
  }
  function updateButton(){
    createButton.disabled=!imageReady&&!loadingError;
    createButton.querySelector('span').textContent=loadingError?'Повторить загрузку':!imageReady?'Загружаем героя…':step===0?'Далее':step===1?'Выбрать цвет':saved?'Сохранить героя':'Создать персонажа';
  }
  async function loadPreview(){
    const version=++imageVersion;imageReady=false;loadingError=false;updateButton();
    const path=step===0?`assets/characters/${selected}.png`:catalogue.path(choice(),selected,'walk');
    try {
      const image=await getImage(path);if(version!==imageVersion)return;
      previewImage=image;previewDescriptor=step===0?{tile:64,origin:0}:catalogue.weapon(weapon).walk;
      imageReady=true;draw();status.textContent=step===0?'Выбери оттенок кожи':`${catalogue.weapon(weapon).name}, ${outfit().name}`;
    }catch{if(version!==imageVersion)return;loadingError=true;status.textContent='Не удалось загрузить облик. Нажми «Повторить загрузку».';}
    updateButton();
  }
  function markRadios(buttons,isSelected){buttons.forEach(b=>{const yes=isSelected(b);b.setAttribute('aria-checked',String(yes));b.classList.toggle('selected',yes);b.tabIndex=yes?0:-1;});}
  function updateChoices(){
    markRadios(controls,b=>b.dataset.skin===selected);$('#skin-name').textContent=skins.find(s=>s.id===selected).label;
    markRadios(weaponButtons,b=>b.dataset.weapon===weapon);
    const item=catalogue.weapon(weapon);$('#weapon-description').textContent=item.description;
    markRadios(colorButtons,b=>b.dataset.outfitColor===rememberedColors[weapon]);
    $('#fixed-outfit-name').textContent=outfit().name;$('#outfit-description').textContent=outfit().description;
    $('#outfit-color-name').textContent=catalogue.color(rememberedColors[weapon]).name;
    const label=step===0?'Выбери цвет кожи':`${outfit().name} · ${catalogue.color(rememberedColors[weapon]).name}`;
    $('#preview-summary').textContent=label;$('#nameplate-subtitle').textContent=step===0?'Твой путь начинается здесь':label;
  }
  function showStep(index){
    step=Math.max(0,Math.min(2,index));furthest=Math.max(furthest,step);
    const titles=['Цвет кожи','Начальное оружие','Цвет наряда'];$('#step-title').textContent=titles[step];$('#step-count').textContent=`ШАГ ${step+1} ИЗ 3`;
    document.querySelectorAll('[data-step]').forEach(panel=>panel.hidden=Number(panel.dataset.step)!==step);
    $('#back-button').hidden=step===0;
    progressButtons.forEach((button,i)=>{button.disabled=i>furthest;button.classList.toggle('current',i===step);button.classList.toggle('complete',i<step);if(i===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
    updateChoices();loadPreview();
  }
  function radioKeys(buttons,select){buttons.forEach((button,i)=>button.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+buttons.length)%buttons.length;
    select(buttons[index]);buttons[index].focus();
  }));}
  function selectSkin(button){selected=button.dataset.skin;haptic();updateChoices();loadPreview();}
  function selectWeapon(button){weapon=button.dataset.weapon;haptic();updateChoices();loadPreview();}
  function selectColor(button){rememberedColors[weapon]=button.dataset.outfitColor;haptic();updateChoices();loadPreview();}
  controls.forEach(button=>button.addEventListener('click',()=>selectSkin(button)));radioKeys(controls,selectSkin);
  weaponButtons.forEach(button=>button.addEventListener('click',()=>selectWeapon(button)));radioKeys(weaponButtons,selectWeapon);
  colorButtons.forEach(button=>button.addEventListener('click',()=>selectColor(button)));radioKeys(colorButtons,selectColor);
  progressButtons.forEach((button,i)=>button.addEventListener('click',()=>{if(i<=furthest)showStep(i);}));
  $('#back-button').addEventListener('click',()=>showStep(step-1));
  function rotate(delta){direction=(direction+delta+4)%4;$('#view-label').textContent=directionNames[direction];haptic();draw();}
  const preview = document.querySelector('#scene');
  let swipe = null;
  function cancelSwipe() {
    const previous = swipe;
    swipe = null;
    preview.classList.remove('is-dragging');
    if (previous && preview.hasPointerCapture(previous.id)) {
      preview.releasePointerCapture(previous.id);
    }
  }
  preview.addEventListener('pointerdown', event => {
    // A second finger cancels rotation so pinch gestures cannot rotate the hero.
    if (!event.isPrimary) { cancelSwipe(); return; }
    if (swipe || event.button !== 0) return;
    swipe = {id:event.pointerId, x:event.clientX, y:event.clientY};
    preview.setPointerCapture(event.pointerId);
    preview.classList.add('is-dragging');
  });
  preview.addEventListener('pointermove', event => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    // Lock out a gesture that starts vertically rather than interpreting it as a turn.
    if (Math.abs(dy) >= 12 && Math.abs(dy) > Math.abs(dx) * 1.3) cancelSwipe();
  });
  preview.addEventListener('pointerup', event => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    cancelSwipe();
    if (Math.abs(dx) >= 32 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      rotate(dx > 0 ? 1 : -1);
    }
  });
  preview.addEventListener('pointercancel', cancelSwipe);
  preview.addEventListener('lostpointercapture', cancelSwipe);
  window.addEventListener('blur', cancelSwipe);
  window.addEventListener('resize', cancelSwipe);
  preview.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    rotate(event.key === 'ArrowRight' ? 1 : -1);
  });
  function openDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal();}
  $('#help-button').addEventListener('click',()=>openDialog('#info-dialog'));
  $('#credits-button').addEventListener('click',()=>openDialog('#credits-dialog'));
  document.querySelectorAll('dialog').forEach(dialog=>{
    dialog.querySelectorAll('.dialog-close,.dialog-action').forEach(button=>button.addEventListener('click',()=>dialog.close()));
    dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  });
  $('#start-adventure').addEventListener('click',()=>{window.location.href='./';});
  createButton.addEventListener('click',()=>{
    if(loadingError){loadPreview();return;}if(!imageReady)return;
    if(step<2){showStep(step+1);return;}
    const editing=!!saved;
    const character={version:1,name:saved?.name||'Странник',level:saved?.level||1,skin:selected,weapon,outfit:outfit().id,outfitColor:rememberedColors[weapon],appearanceVersion:2,class:saved?.class||null,equipment:weapon==='sword'?['sword','shield',outfit().id]:[weapon,outfit().id],createdAt:saved?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
    try{
      localStorage.setItem(key,JSON.stringify(character));saved=character;
      $('#success-dialog h2').textContent=editing?'Облик сохранён.':'Герой создан.';
      $('#success-dialog > p:not(.eyebrow)').textContent='Кожа, оружие и цвет наряда сохранены на этом устройстве.';
      $('#saved-skin').textContent=skins.find(s=>s.id===selected).label;$('#saved-loadout').textContent=`${outfit().name} · ${catalogue.color(rememberedColors[weapon]).name}`;
      updateButton();openDialog('#success-dialog');try{telegram?.HapticFeedback?.notificationOccurred('success');}catch{}
    }catch{
      status.textContent='Хранилище недоступно. Разреши сохранение данных и попробуй снова.';
      $('#info-dialog h2').textContent='Не удалось сохранить';$('#info-dialog > p:not(.eyebrow)').textContent='Разреши браузеру сохранять данные для этого сайта и попробуй ещё раз.';openDialog('#info-dialog');
    }
  });
  showStep(0);
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  setInterval(()=>{if(step!==0||!imageReady||reducedMotion.matches||document.hidden)return;frame=frame?0:1;draw();},650);
})();
