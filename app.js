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
  const magicButtons = [...document.querySelectorAll('[data-magic]')];
  const colorButtons = [...document.querySelectorAll('[data-outfit-color]')];
  const progressButtons = [...document.querySelectorAll('[data-go-step]')];
  const cache = new Map();
  let selected='light', weapon='sword', selectedMagic=null, step=0, furthest=0, direction=2, frame=0, saved=null;
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
      if(choice){weapon=choice.weapon;rememberedColors[weapon]=choice.outfitColor;if(weapon==='wand')selectedMagic=catalogue.magic(candidate.magic)?.id||'fire';}
    }
  }catch{}
  function choice(){return {weapon,outfit:catalogue.weapon(weapon).outfits[0].id,outfitColor:rememberedColors[weapon]};}
  function outfit(){return catalogue.weapon(weapon).outfits[0];}
  function magicChoice(){return weapon==='wand'?catalogue.magic(selectedMagic):null;}
  function validMagic(){return weapon!=='wand'||!!magicChoice();}
  function appearanceLabel(){return `${outfit().name} · ${catalogue.color(rememberedColors[weapon]).name}${weapon==='wand'?` · ${magicChoice()?.name||'Выбери стихию'}`:''}`;}
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
  // All classes are normalized to the *visible silhouette*, not the
  // nominal 64/128px LPC atlas cell (most of which is transparent).
  // The existing Mage presentation is the reference chosen by the player.
  const previewSize=128,referenceMageTile=52;
  const boundsCache=new WeakMap();
  let referenceMageImage=null;
  function opaqueBounds(image,tile,cell,row){
    let frames=boundsCache.get(image);
    if(!frames){frames=new Map();boundsCache.set(image,frames);}
    const key=tile+':'+cell+':'+row;
    if(frames.has(key))return frames.get(key);
    const sample=document.createElement('canvas');
    sample.width=tile;sample.height=tile;
    const sampleCtx=sample.getContext('2d',{willReadFrequently:true});
    sampleCtx.clearRect(0,0,tile,tile);
    sampleCtx.drawImage(image,cell*tile,row*tile,tile,tile,0,0,tile,tile);
    const rgba=sampleCtx.getImageData(0,0,tile,tile).data;
    let x0=tile,y0=tile,x1=-1,y1=-1;
    for(let y=0;y<tile;y++)for(let x=0;x<tile;x++){
      if(rgba[(y*tile+x)*4+3]<8)continue;
      x0=Math.min(x0,x);x1=Math.max(x1,x);
      y0=Math.min(y0,y);y1=Math.max(y1,y);
    }
    const bounds=x1>=x0?{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1}
      :{x:0,y:0,width:tile,height:tile};
    frames.set(key,bounds);
    return bounds;
  }
  function draw(){
    if(!previewImage||!previewDescriptor)return;
    const d=previewDescriptor,tile=d.tile||64,cell=step===0?frame:0;
    if(tile>previewSize||tile<64)throw new Error('Unsupported LPC preview cell size: '+tile);
    if(canvas.width!==previewSize||canvas.height!==previewSize){
      canvas.width=previewSize;canvas.height=previewSize;
    }
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,previewSize,previewSize);ctx.imageSmoothingEnabled=false;
    if(step===0||weapon==='wand'||!referenceMageImage){
      // Preserve the accepted Mage exactly, including its pixel position.
      const displayTile=step>0&&weapon==='wand'?referenceMageTile:tile;
      ctx.drawImage(previewImage,cell*tile,direction*tile,tile,tile,
        (previewSize-displayTile)/2,(previewSize-tile)/2+tile-displayTile,displayTile,displayTile);
    }else{
      // Measure actual nontransparent bounds in the same direction on
      // both sheets. All visible characters get the Mage's exact height.
      const mage=opaqueBounds(referenceMageImage,64,0,direction);
      const figure=opaqueBounds(previewImage,tile,cell,direction);
      const visibleHeight=mage.height*referenceMageTile/64;
      const zoom=visibleHeight/figure.height;
      const width=figure.width*zoom;
      const mageCenter=38+(mage.x+mage.width/2)*referenceMageTile/64;
      const mageFeet=44+(mage.y+mage.height)*referenceMageTile/64;
      ctx.drawImage(previewImage,cell*tile+figure.x,direction*tile+figure.y,
        figure.width,figure.height,mageCenter-width/2,mageFeet-visibleHeight,width,visibleHeight);
    }
    canvas.style.width='200%';canvas.style.height='200%';
    canvas.style.left='-50%';canvas.style.top='-50%';
    const description=step===0?'без экипировки':`${catalogue.weapon(weapon).name}, наряд ${outfit().name}, ${catalogue.color(rememberedColors[weapon]).name}${magicChoice()?`, стихия ${magicChoice().name}`:''}`;
    canvas.setAttribute('aria-label',`Странник: ${description}. Цвет кожи: ${skins.find(s=>s.id===selected).label}. ${directionNames[direction]}.`);
  }
  function updateButton(){
    createButton.disabled=(!imageReady&&!loadingError)||(step>0&&!validMagic()&&!loadingError);
    progressButtons.forEach((button,i)=>{button.disabled=i>furthest||(i===2&&!validMagic());});
    createButton.querySelector('span').textContent=loadingError?'Повторить загрузку':!imageReady?'Загружаем героя…':step===0?'Далее':!validMagic()?'Выбери стихию':step===1?'Выбрать цвет':saved?'Сохранить героя':'Создать персонажа';
  }
  async function loadPreview(){
    const version=++imageVersion;imageReady=false;loadingError=false;updateButton();
    const path=step===0?`assets/characters/${selected}.png`:catalogue.path(choice(),selected,'walk');
    try {
      // Load the same fixed Mage reference for every class. Measuring
      // image alpha avoids guessing scale from padded LPC frame sizes.
      const magePath=catalogue.path({weapon:'wand',outfit:'acolyte',outfitColor:'purple'},selected,'walk');
      const [image,mageReference]=await Promise.all([getImage(path),step===0?Promise.resolve(null):getImage(magePath)]);
      if(version!==imageVersion)return;
      previewImage=image;referenceMageImage=mageReference;
      previewDescriptor=step===0?{tile:64,origin:0}:catalogue.weapon(weapon).walk;
      imageReady=true;draw();status.textContent=step===0?'Выбери оттенок кожи':weapon==='wand'&&!magicChoice()?'Выбери стихию: огонь или лёд':`${catalogue.weapon(weapon).name}, ${appearanceLabel()}`;
    }catch{if(version!==imageVersion)return;loadingError=true;status.textContent='Не удалось загрузить облик. Нажми «Повторить загрузку».';}
    updateButton();
  }
  function markRadios(buttons,isSelected){let chosen=false;buttons.forEach(b=>{const yes=isSelected(b);chosen=chosen||yes;b.setAttribute('aria-checked',String(yes));b.classList.toggle('selected',yes);b.tabIndex=yes?0:-1;});if(!chosen&&buttons[0])buttons[0].tabIndex=0;}
  function updateChoices(){
    markRadios(controls,b=>b.dataset.skin===selected);$('#skin-name').textContent=skins.find(s=>s.id===selected).label;
    markRadios(weaponButtons,b=>b.dataset.weapon===weapon);
    markRadios(magicButtons,b=>b.dataset.magic===selectedMagic);
    $('#magic-school').hidden=weapon!=='wand';
    $('.wizard').classList.toggle('has-magic',step===1&&weapon==='wand');
    $('#magic-choice-name').textContent=magicChoice()?.description||'Выбери стихию';
    const item=catalogue.weapon(weapon);$('#weapon-description').textContent=item.description;
    markRadios(colorButtons,b=>b.dataset.outfitColor===rememberedColors[weapon]);
    $('#fixed-outfit-name').textContent=outfit().name;$('#outfit-description').textContent=outfit().description;
    $('#outfit-color-name').textContent=catalogue.color(rememberedColors[weapon]).name;
    const label=step===0?'Выбери цвет кожи':appearanceLabel();
    $('#preview-summary').textContent=label;$('#nameplate-subtitle').textContent=step===0?'Твой путь начинается здесь':label;
  }
  function showStep(index){
    step=Math.max(0,Math.min(2,index));if(step===2&&!validMagic())step=1;furthest=Math.max(furthest,step);
    const titles=['Цвет кожи','Начальное оружие','Цвет наряда'];$('#step-title').textContent=titles[step];$('#step-count').textContent=`ШАГ ${step+1} ИЗ 3`;
    document.querySelectorAll('[data-step]').forEach(panel=>panel.hidden=Number(panel.dataset.step)!==step);
    $('#back-button').hidden=step===0;
    progressButtons.forEach((button,i)=>{button.disabled=i>furthest||(i===2&&!validMagic());button.classList.toggle('current',i===step);button.classList.toggle('complete',i<step);if(i===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
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
  function selectMagic(button){const option=catalogue.magic(button.dataset.magic);if(!option)return;selectedMagic=option.id;haptic();updateChoices();updateButton();draw();status.textContent=`Выбрана стихия: ${option.name}`;}
  controls.forEach(button=>button.addEventListener('click',()=>selectSkin(button)));radioKeys(controls,selectSkin);
  weaponButtons.forEach(button=>button.addEventListener('click',()=>selectWeapon(button)));radioKeys(weaponButtons,selectWeapon);
  magicButtons.forEach(button=>button.addEventListener('click',()=>selectMagic(button)));radioKeys(magicButtons,selectMagic);
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
    if(step>0&&!validMagic()){showStep(1);return;}
    if(step<2){showStep(step+1);return;}
    const editing=!!saved;
    const character={version:1,name:saved?.name||'Странник',level:saved?.level||1,skin:selected,weapon,outfit:outfit().id,outfitColor:rememberedColors[weapon],appearanceVersion:2,...(weapon==='wand'?{magic:magicChoice().id}:{}),class:saved?.class||null,equipment:weapon==='sword'?['sword','shield',outfit().id]:[weapon,outfit().id],createdAt:saved?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
    try{
      localStorage.setItem(key,JSON.stringify(character));saved=character;
      $('#success-dialog h2').textContent=editing?'Облик сохранён.':'Герой создан.';
      $('#success-dialog > p:not(.eyebrow)').textContent=weapon==='wand'?'Кожа, палочка, стихия и цвет наряда сохранены на этом устройстве.':'Кожа, оружие и цвет наряда сохранены на этом устройстве.';
      $('#saved-skin').textContent=skins.find(s=>s.id===selected).label;$('#saved-loadout').textContent=appearanceLabel();
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
