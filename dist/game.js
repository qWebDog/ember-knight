(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const skinIds = ['light','amber','olive','bronze','brown','black'];
  const skinNames = ['Светлый','Тёплый','Оливковый','Бронзовый','Смуглый','Тёмный'];
  const telegram = window.Telegram?.WebApp;
  const arena = $('.adventure'), battlefield = $('.battlefield'), dialog = $('#game-dialog');
  const autoButton = $('#auto-button'), resultPanel = $('#battle-result'), sceneFade = $('#scene-fade');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let character = null, auto = true, wallet = 0;
  try {
    const saved = JSON.parse(localStorage.getItem('ember.character.v1'));
    if (saved?.version === 1 && skinIds.includes(saved.skin)) character = saved;
    auto = localStorage.getItem('ember.combat.auto.v1') !== 'off';
  } catch {}
  let progressionStorage = null;
  try { progressionStorage = localStorage; } catch {}
  const progression = window.EmberProgression.createStore({storage:progressionStorage});
  wallet = progression.getState().gold;
  if (new URLSearchParams(window.location.search).get('battle') === 'test') auto = true;
  const loadouts = window.EmberLoadouts;
  const arrowSprite = 'assets/projectiles/arrow.png';
  const loadout = loadouts?.selection(character) || null;
  const starterWeapon = loadout ? loadouts.weapon(loadout.weapon) : null;
  const starterOutfit = loadout ? loadouts.outfit(loadout.weapon,loadout.outfit) : null;
  const heroMagic = loadouts?.magicSelection(character);
  const equipment = window.EmberEquipment?.createStore({classId:starterWeapon?.id||'sword'});
  const dyeEngine=window.EmberEquipmentDye?.create({canvasFactory:()=>document.createElement('canvas')});
  const equipmentArt = starterWeapon?.id==='sword' && equipment?.enabled
    ? window.EmberEquipmentArt?.create({loadImage,dye:dyeEngine,outfitColor:loadout?.outfitColor||'sand'}) : null;
  const ranged = starterWeapon && starterWeapon.projectile !== 'melee';
  const skin = character?.skin || 'light';
  const swordEquipment = starterWeapon?.id==='sword' && equipment?.enabled && loadout && window.EmberSwordEquipment
    ? window.EmberSwordEquipment.create({skin,color:loadout.outfitColor,loadImage,
      standardPath:pose=>loadouts.path(loadout,skin,pose)}) : null;
  const classEquipment = ['bow','wand'].includes(starterWeapon?.id) && equipment?.enabled && loadout && window.EmberClassEquipment
    ? window.EmberClassEquipment.create({classId:starterWeapon.id,skin,color:loadout.outfitColor,
      loadImage,standardPath:pose=>loadouts.path(loadout,skin,pose),
      canvasFactory:()=>document.createElement('canvas'),dye:dyeEngine}) : null;
  let loadedClassSprites = null;
  function applyClassSprites(images){
    if(!images||!actors.hero.images.walk)return;
    const sets=actors.hero.images;
    for(const [kind,pose] of [['idle','walk'],['walk','walk'],['attack','attack']]){
      if(sets[kind])sets[kind].image=images[pose];
    }
    actors.hero.lastKey=null;
  }
  let loadedSwordSprites = null;
  function applySwordSprites(images){
    if(!images||!actors.hero.images.walk)return;
    const sets=actors.hero.images;
    for(const [kind,pose] of [['idle','walk'],['walk','walk'],['attack','attack'],['block','block']]){
      if(sets[kind])sets[kind].image=images[pose];
    }
    for(const variant of ['slash','halfslash','backslash']){
      if(sets.attacks?.[variant])sets.attacks[variant].image=images[variant==='slash'?'attack':variant];
    }
    actors.hero.lastKey=null;
  }
  const name = typeof character?.name === 'string' && character.name.trim() ? character.name.slice(0,24) : 'Странник';
  const level = Number.isInteger(character?.level) ? Math.max(1,Math.min(99,character.level)) : 1;
  $('#player-name').textContent = name;
  $('.fighter-name').textContent = name;
  $('#level-badge').textContent = level;
  const battle = window.EmberCombat.createBattle({heroName:name,heroProjectile:starterWeapon?.projectile,heroWeapon:starterWeapon?.id,heroMagic,...progression.getStats()});
  battle.pause();
  let ready = false, assetError = false, lastFrameTime = null, restartRemaining = null, resultSummary = '';
  const paidDeaths = new Set();
  let creditedRunGold = 0;
  const enemyDefinitions = {
    archer1:{type:'archer',spawn:.62,label:'Лучник',defaultLane:2},
    archer2:{type:'archer',spawn:.61,label:'Лучник I',defaultLane:1},
    archer3:{type:'archer',spawn:.80,label:'Лучник II',defaultLane:5},
    orc:{type:'orc',spawn:.65,label:'Орк',defaultLane:4}
  };
  const actors = {};
  for (const id of ['hero',...Object.keys(enemyDefinitions)]) {
    const element = document.querySelector(`[data-fighter="${id}"]`);
    actors[id] = {element, canvas:element.querySelector('canvas'), bar:element.querySelector('.healthbar'), images:{}, animation:null, hitAt:-10, blockAt:-10, lastKey:null,statusCanvas:null,statusKey:null,frozenPose:null,poseAnimation:null,poseAge:100,defaultLane:3,...enemyDefinitions[id],depth:enemyDefinitions[id]?.defaultLane||3,x:null,distance:0,direction:1,moving:false};
  }
  const effects = [];
  const spellImages = {};
  const pendingIceImpacts = new Map();
  let statusImage = null;
  let laneStep = 0;
  arena.dataset.lanes='5';battlefield.dataset.lanes='5';
  let heroX = null, fieldWidth = null, moving = false, heroMoving = false;
  let walkDistance = 0, walkDirection = 3, activeTime = 0;
  let sceneTransition = null;
  // The hero enters from the left edge only at the start of a battle.
  // Wave transitions retain their existing fade-and-reset choreography.
  const heroEntranceDuration=.75;
  let heroEntrance=null;
  function beginHeroEntrance(){
    heroEntrance={elapsed:0};
    walkDistance=0;walkDirection=3;heroMoving=moving=false;
    actors.hero.lastKey=null;
  }
  const waveExitDuration=window.EmberCombat.intermissionDuration||1.4;
  arena.dataset.transition='';sceneFade.dataset.opacity='0';sceneFade.style.opacity='0';
  let pairContacted = false, previousSeparation = null, contactTarget = null, previousTargetSeparation = null;
  try { telegram?.ready(); telegram?.expand(); telegram?.setHeaderColor('#14231f'); telegram?.setBackgroundColor('#161e18'); } catch {}
  function syncViewport() {
    const visible = window.visualViewport?.height || window.innerHeight;
    const tgHeight = telegram?.initData && Number(telegram.viewportHeight);
    document.documentElement.style.setProperty('--app-height', `${Math.floor(tgHeight > 0 ? Math.min(tgHeight,visible) : visible)}px`);
  }
  window.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('resize', syncViewport);
  telegram?.onEvent?.('viewportChanged', syncViewport);
  syncViewport();
  function projectFormation() {
    battlefield.dataset.laneStep=String(laneStep);
    battlefield.style.setProperty('--lane-step',`${laneStep}px`);
    for(const actor of Object.values(actors)){
      actor.depth=Math.max(1,Math.min(5,actor.depth));
      actor.element.dataset.defaultLane=String(actor.defaultLane);
      actor.element.dataset.depth=String(actor.depth);
      actor.element.dataset.lane=String(Math.round(actor.depth));
      actor.element.style.setProperty('--lane-offset',`${(actor.depth-3)*laneStep}px`);
      actor.element.style.zIndex=String(Math.round(100+(actor.depth-1)*100));
    }
  }
  function alignTerrain() {
    const bounds = arena.getBoundingClientRect(), fighter = actors.hero.element.getBoundingClientRect();
    // Measure the fixed middle of the road, cancelling the hero's current row.
    const feet = fighter.bottom - bounds.top - fighter.height * 2 / 64 - (actors.hero.depth-3)*laneStep;
    // Keep feet on the selected forest's road while covering any viewport.
    const sceneSize = 1254, roadY = 1028;
    const scale = Math.max(bounds.width / sceneSize, feet / roadY, (bounds.height - feet) / (sceneSize - roadY));
    const art = $('.battle-landscape');
    art.style.backgroundSize = `${sceneSize * scale}px ${sceneSize * scale}px`;
    art.style.backgroundPosition = `center ${feet - roadY * scale}px`;
    laneStep=Math.min(12,actors.hero.element.offsetWidth*.18,35*scale);
    updateMovement(0,battle.getState());
  }
  new ResizeObserver(alignTerrain).observe(arena);
  alignTerrain();
  function updateWallet() {
    $('.gold strong').textContent = wallet >= 10000 ? `${Math.floor(wallet/1000)}k` : wallet;
    $('.gold').setAttribute('aria-label', `Золото: ${wallet}`);
  }
  updateWallet();
  $('.power b').textContent = battle.getState().hero.damage;
  progression.subscribe((state,change) => {
    wallet = state.gold;
    updateWallet();
    if(change?.type!=='purchase')return;
    const current = battle.getState().hero, stats = progression.getStats();
    const oldSpeed = current.attackSpeed || 1;
    if (current.damage !== stats.heroDamage || current.maxHp !== stats.heroMaxHp || oldSpeed !== stats.heroAttackSpeed) {
      const ratio = oldSpeed / stats.heroAttackSpeed;
      const animation = actors.hero.animation;
      if (animation && ratio !== 1) {
        const age = Math.max(0,activeTime-animation.at);
        if (age < animation.duration) {
          animation.at = activeTime-age*ratio;
          animation.duration *= ratio;
        }
      }
      const guardAge = activeTime-actors.hero.blockAt;
      if (ratio !== 1 && guardAge >= 0 && guardAge < .28/oldSpeed) actors.hero.blockAt=activeTime-guardAge*ratio;
      battle.updateHeroStats(stats);
      $('.power b').textContent = battle.getState().hero.damage;
      if (ready) render(battle.getState());
    }
  });
  window.EmberSkillPanel?.mount({root:$('#skills-panel'),store:progression,heroLevel:level});
  let equipmentUI=null;
  const equipmentPanel=$('#equipment-panel'),skillsPanel=$('#skills-panel');
  if(equipment&&window.EmberEquipmentUI&&equipmentPanel&&skillsPanel){
    const showLowerPanel=mode=>{
      const isGear=mode==='equipment';
      equipmentPanel.hidden=!isGear;
      skillsPanel.hidden=isGear;
      if(isGear)equipmentUI?.refreshPreview();
    };
    equipmentUI=window.EmberEquipmentUI.mount({
      root:equipmentPanel,store:equipment,
      outfitColor:loadout?.outfitColor||'sand',
      getSprite:()=>actors.hero.images.idle,
      loadItem:async(slot,id,colors)=>{
        const nextLook={...equipment.getState(),[slot]:id};
        // Stage every layer before saving a selection. In particular, a new
        // shield must have its native foreground ready over the chest armor.
        if(classEquipment){
          loadedClassSprites=await classEquipment.load(nextLook,colors||equipment.getColors(nextLook));
        }else{
          const changingWeapon=slot==='weapon'||slot==='shield';
          const [_,images]=await Promise.all([
            equipmentArt?.prepareLook(nextLook,colors||equipment.getColors(nextLook)),
            changingWeapon&&swordEquipment?swordEquipment.load(nextLook):Promise.resolve(null)
          ]);
          if(images)loadedSwordSprites=images;
        }
      },
      paintItem:(ctx,pose)=>equipmentArt?.draw(ctx,pose),
      paintBack:(ctx,pose)=>equipmentArt?.drawBack(ctx,pose),
      onEquip:(_look,slot)=>{
        if(classEquipment&&loadedClassSprites)applyClassSprites(loadedClassSprites);
        if((slot==='weapon'||slot==='shield')&&loadedSwordSprites)applySwordSprites(loadedSwordSprites);
        actors.hero.lastKey=null;
        if(ready)render(battle.getState());
        equipmentUI?.refreshPreview();
      }
    });
    $('#open-equipment-tab')?.addEventListener('click',()=>showLowerPanel('equipment'));
    $('#back-skills-tab')?.addEventListener('click',()=>showLowerPanel('skills'));
  }
  function loadImage(path) {
    return new Promise((resolve,reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(path)); image.src = path; });
  }
  async function loadAssets() {
    ready = false; assetError = false; updateControls();
    try {
      let idle;
      if (loadout) {
        const swordSprites=swordEquipment?await swordEquipment.load(equipment.getState()):null;
        const classSprites=classEquipment?await classEquipment.load(equipment.getState(),equipment.getColors()):null;
        if(swordSprites)loadedSwordSprites=swordSprites;
        if(classSprites)loadedClassSprites=classSprites;
        const walk = classSprites?.walk||swordSprites?.walk||await loadImage(loadouts.path(loadout,skin,'walk'));
        const attack = classSprites?.attack||swordSprites?.attack||await loadImage(loadouts.path(loadout,skin,'attack'));
        idle = walk;
        actors.hero.images.idle = {image:walk,row:3,still:0,...starterWeapon.walk};
        actors.hero.images.walk = {image:walk,row:3,...starterWeapon.walk};
        actors.hero.images.attack = {image:attack,row:3,...starterWeapon.attack};
        if (starterWeapon.attacks) {
          const variants = await Promise.all(Object.entries(starterWeapon.attacks).map(async ([variant,geometry]) => {
            const image = variant === 'slash' ? attack : (swordSprites?.[variant]||await loadImage(loadouts.path(loadout,skin,variant)));
            return [variant,{image,row:3,...geometry}];
          }));
          actors.hero.images.attacks = Object.fromEntries(variants);
        }
        if (starterWeapon.block) {
          const block = swordSprites?.block||await loadImage(loadouts.path(loadout,skin,'block'));
          actors.hero.images.block = {image:block,row:3,still:0,...starterWeapon.block};
        }
      } else {
        idle = await loadImage(`assets/characters/${skin}.png`).catch(() => loadImage('assets/characters/light.png'));
        actors.hero.images.idle = {image:idle,frames:2,row:3};
        const walk = await loadImage(`assets/characters/combat/${skin}-walk.png`).catch(() => loadImage('assets/characters/combat/light-walk.png'));
        actors.hero.images.walk = {image:walk,frames:9,row:3};
        const attack = await loadImage(`assets/characters/combat/${skin}-attack.png`).catch(() => null);
        actors.hero.images.attack = attack ? {image:attack,frames:6,row:3} : actors.hero.images.idle;
      }
      await Promise.all([
        ['orc','orc-walk.png','orc-left.png',9,0],
        ['archer1','skeleton-shoot.png','skeleton-left.png',13,5]
      ].map(async ([id,sheet,fallback,frames,idleFrame]) => {
        try {
          const image = await loadImage(`assets/enemies/lpc/${sheet}`);
          actors[id].images.idle = {image,frames,row:1,still:idleFrame};
          actors[id].images.attack = {image,frames,row:1};
        } catch {
          const image = await loadImage(`assets/enemies/lpc/${fallback}`);
          actors[id].images.idle = actors[id].images.attack = {image,frames:1,row:0,still:0};
        }
      }));
      actors.archer2.images = {...actors.archer1.images};
      actors.archer3.images = {...actors.archer1.images};
      actors.orc.images.walk = { ...actors.orc.images.idle,still:undefined };
      const [orcAttack,statusAtlas] = await Promise.all([
        loadImage('assets/enemies/lpc/orc-attack.png').catch(() => null),
        loadImage('assets/magic/status-effects.png'),
        loadImage(arrowSprite),
        ...['fire','ice','shadow'].map(async magic=>{spellImages[magic]=await loadImage(`assets/magic/${magic}.png`);})
      ]);
      statusImage = statusAtlas;
      actors.orc.images.attack = orcAttack ? {image:orcAttack,frames:6,row:1,tile:128,origin:32} : { ...actors.orc.images.idle,frames:1 };
      const face = $('#avatar').getContext('2d'); face.imageSmoothingEnabled = false;
      const avatarTile=loadout?starterWeapon.walk.tile:64, avatarOrigin=loadout?starterWeapon.walk.origin:0;
      face.drawImage(idle,avatarOrigin+19,avatarTile*2+avatarOrigin+12,26,26,0,0,32,32);
      // Helmet/armor are native pose overlays; sword/shield are complete, recomposed LPC sheets.
      if(equipmentArt)try{await equipmentArt.prepareLook(equipment.getState(),equipment.getColors());}
      catch{$('#status').textContent='Не удалось загрузить часть LPC-экипировки.';}
      ready = true;
      beginHeroEntrance();
      updateMovement(0,battle.getState());
      $('#status').textContent = 'Бой готов: один лучник, два лучника, затем орк.';
      render(battle.getState()); equipmentUI?.refreshPreview(); syncPause();
    } catch {
      assetError = true;
      $('#result-title').textContent = 'Не удалось загрузить бой';
      $('#result-copy').textContent = 'Проверь соединение и попробуй ещё раз.';
      $('#replay-button').textContent = 'Повторить загрузку'; resultPanel.hidden = false;
      $('#status').textContent = 'Не удалось загрузить спрайты боя.'; updateControls();
    }
  }
  function updateControls() {
    const state = battle.getState(), ended = ['victory','defeat'].includes(state.phase);
    arena.classList.toggle('is-paused', !ready || !auto || dialog.open || document.hidden);
    battlefield.classList.toggle('is-between-waves',state.phase==='intermission'||(state.phase==='paused'&&state.completedWaves>state.waveIndex));
    autoButton.disabled = !ready;
    autoButton.classList.toggle('active', auto);
    autoButton.setAttribute('aria-pressed', String(auto));
    autoButton.setAttribute('aria-label', `${ended?'Автоповтор':'Автобой'} ${auto ? 'включён' : 'приостановлен'}`);
    $('#auto-label').textContent = auto ? 'ВКЛ' : 'ВЫКЛ';
    $('#battle-state').textContent = !ready ? assetError ? 'Ошибка загрузки' : 'Загрузка боя' : !auto ? 'Пауза' : state.phase === 'victory' ? 'Победа · 3/3' : state.phase === 'defeat' ? 'Поражение' : state.phase==='intermission' ? 'Следующая волна…' : heroEntrance ? 'Выход на арену' : moving ? 'Подход к цели' : `Волна ${state.waveNumber}/${state.waveCount}`;
    if(ended) updateCountdown();
  }
  function updateCountdown() {
    if(restartRemaining===null)return;
    $('#result-copy').textContent=`${resultSummary} ${auto ? `Новый бой через ${Math.max(1,Math.ceil(restartRemaining))} с.` : 'Автоповтор на паузе.'}`;
  }
  function beginSceneTransition(phase,at) {
    sceneTransition={phase,at,lastTime:at,depth:actors.hero.depth,fresh:phase==='wave-in'};
    arena.dataset.transition=phase;sceneFade.dataset.phase=phase;
    if(phase==='wave-out'||phase==='victory'||phase==='defeat')actors.hero.animation=null;
  }
  function clearSceneTransition() {
    sceneTransition=null;arena.dataset.transition='';sceneFade.dataset.phase='';sceneFade.dataset.opacity='0';sceneFade.style.opacity='0';
  }
  function renderSceneTransition(state) {
    if(!sceneTransition)return;
    const transition=sceneTransition;
    // A wave reset gets one fully covered paint even if a frame crosses its boundary.
    if(transition.fresh){transition.at=activeTime;transition.lastTime=activeTime;transition.fresh=false;}
    const age=Math.max(0,activeTime-transition.at);
    const outgoing=transition.phase==='wave-out'||transition.phase==='victory';
    if(outgoing&&state.hero.hp>0){
      if(!reducedMotion.matches){
        const elapsed=Math.max(0,activeTime-transition.lastTime),size=actors.hero.element.offsetWidth;
        const distance=size*.85*elapsed;
        heroX+=distance;walkDistance+=distance/size;
        walkDirection=3;heroMoving=true;moving=true;
      }else heroMoving=false;
      actors.hero.depth=transition.depth;
      actors.hero.element.style.left=`${heroX}px`;projectFormation();
    }
    transition.lastTime=activeTime;
    let opacity;
    if(transition.phase==='wave-in'){
      opacity=Math.max(0,1-age/.4);
      if(age>=.4){clearSceneTransition();return;}
    }else if(reducedMotion.matches)opacity=1;
    else if(transition.phase==='defeat')opacity=Math.min(1,age/.5);
    else opacity=Math.max(0,Math.min(1,(age-.5)/(waveExitDuration-.5)));
    sceneFade.style.opacity=String(opacity);sceneFade.dataset.opacity=String(opacity);
    if(transition.phase==='victory'||transition.phase==='defeat')resultPanel.hidden=opacity<.85;
  }
  function syncPause() {
    if (ready && auto && !document.hidden && !dialog.open) battle.resume(); else battle.pause();
    lastFrameTime = null; updateControls();
  }
  autoButton.addEventListener('click', () => {
    if (!ready) return;
    auto = !auto; syncPause();
    try { localStorage.setItem('ember.combat.auto.v1',auto ? 'on' : 'off'); telegram?.HapticFeedback?.selectionChanged(); } catch {}
    $('#status').textContent = auto ? 'Бой продолжается' : 'Бой приостановлен';
  });
  document.addEventListener('visibilitychange', syncPause);
  function addEffect(type, sourceId, targetId, text, at) {
    if (reducedMotion.matches) return;
    const element = document.createElement(type === 'arrow' ? 'img' : 'span');
    if (type === 'arrow') {
      element.src = arrowSprite; element.alt = ''; element.draggable = false;
      element.width = 192; element.height = 30;
    }
    const floating = ['damage','heavy','counter','block','coin'].includes(type);
    element.className = floating ? `damage-number ${type}-number ${targetId === 'hero' && type !== 'block' ? 'enemy-damage' : ''}` : `projectile ${type}`;
    element.setAttribute('aria-hidden','true'); if (text) element.textContent = text;
    battlefield.appendChild(element); effects.push({element,type,floating,sourceId,targetId,at:activeTime,duration:type==='coin'?.65:floating ? .85 : .38});
  }
  function addSpell(event) {
    if (reducedMotion.matches) return;
    const magic=event.sourceId==='hero'?(event.magic==='ice'?'ice':'fire'):'shadow';
    const element=document.createElement('canvas');
    element.width=64; element.height=64; element.className='spell-projectile';
    element.dataset.magic=magic; element.dataset.source=event.sourceId; element.dataset.target=event.targetId;
    element.setAttribute('aria-hidden','true'); battlefield.appendChild(element);
    effects.push({element,type:'spell',sourceId:event.sourceId,targetId:event.targetId,magic,image:spellImages[magic],
      castId:event.castId,at:event.at,impactAt:event.impactAt,appearDuration:event.appearDuration,
      flightDuration:event.flightDuration,impactDuration:event.impactDuration,
      duration:event.appearDuration+event.flightDuration+event.impactDuration,landed:false,lastKey:null,angle:null});
  }
  function removeEffects(keep) {
    for(let i=effects.length-1;i>=0;i--)if(!keep(effects[i])){effects[i].element.remove();effects.splice(i,1);}
  }
  function clearStatus(actor) {
    if(actor.statusCanvas)actor.statusCanvas.remove();
    actor.statusCanvas=null;actor.statusKey=null;actor.frozenPose=null;
    actor.element.classList.toggle('is-frozen',false);
    actor.element.classList.toggle('is-burning',false);
  }
  function isFrozen(unit,state) {
    return unit?.hp>0 && !['victory','defeat'].includes(state.phase) && unit.status?.type==='freeze' && unit.status.endsAt>state.elapsed+1e-7;
  }
  function syncFrozenPose(actor,unit,state) {
    const frozen=isFrozen(unit,state);
    if(frozen&&!actor.frozenPose){
      actor.frozenPose={animation:actor.animation,age:actor.poseAnimation===actor.animation?actor.poseAge:actor.animation?Math.max(0,activeTime-actor.animation.at):100};
    }else if(!frozen&&actor.frozenPose){
      // Only resume the captured animation. An attack emitted exactly at thaw is new.
      if(unit?.hp>0&&!['victory','defeat'].includes(state.phase)&&actor.animation&&actor.animation===actor.frozenPose.animation)actor.animation.at=activeTime-actor.frozenPose.age;
      actor.frozenPose=null;
    }
    actor.element.classList.toggle('is-frozen',frozen);
    return frozen;
  }
  function syncFrozenActors(state) {
    for(const id of Object.keys(enemyDefinitions))syncFrozenPose(actors[id],state.enemies.find(unit=>unit.id===id),state);
  }
  function drawStatus(actor,unit,state) {
    const status=unit?.status;
    if(!statusImage||!unit||unit.hp<=0||['victory','defeat'].includes(state.phase)||!status||status.endsAt<=state.elapsed+1e-7){
      if(actor.statusCanvas)actor.statusCanvas.remove();actor.statusCanvas=null;actor.statusKey=null;actor.element.classList.toggle('is-burning',false);return;
    }
    if(!actor.statusCanvas){
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.className='status-effect';
      canvas.setAttribute('aria-hidden','true');actor.element.appendChild(canvas);actor.statusCanvas=canvas;
    }
    const frame=reducedMotion.matches?2:Math.min(5,Math.max(0,Math.floor((state.elapsed-status.startedAt)/(status.endsAt-status.startedAt)*6+1e-7)));
    const canvas=actor.statusCanvas,row=status.type==='freeze'?1:0,key=`${status.type}:${frame}`;
    canvas.dataset.status=status.type;canvas.dataset.frame=String(frame);
    canvas.style.opacity=status.type==='freeze'?'0.65':'1';
    actor.element.classList.toggle('is-burning',status.type==='burn');
    if(actor.statusKey!==key){
      const width=(statusImage.naturalWidth||statusImage.width)/6,height=(statusImage.naturalHeight||statusImage.height)/2;
      const ctx=canvas.getContext('2d');ctx.clearRect(0,0,64,64);ctx.imageSmoothingEnabled=false;
      ctx.drawImage(statusImage,frame*width,row*height,width,height,0,0,64,64);actor.statusKey=key;
    }
  }
  function handleEvents(events) {
    for (const event of events) {
      if (event.type === 'cast') {
        if(event.sourceId==='hero'&&event.magic==='ice')pendingIceImpacts.set(event.castId,{at:event.impactAt,targetId:event.targetId});
        actors[event.sourceId].animation={at:event.at,duration:event.animationDuration||.66};
        addSpell(event);
      } else if (event.type === 'attack') {
        if (!event.impact&&!event.dot) actors[event.sourceId].animation = {at:activeTime,duration:event.animationDuration || (event.projectile === 'arrow' ? .9 : .66),variant:event.variant,heavy:event.heavy,counter:event.counter};
        if (event.impact) {
          pendingIceImpacts.delete(event.castId);
          const spell=effects.find(effect=>effect.type==='spell'&&effect.castId===event.castId);
          if(spell){spell.landed=true;spell.impactAt=event.at;spell.duration=event.at-spell.at+spell.impactDuration;}
        }
        if(!event.dot)actors[event.targetId].hitAt = activeTime;
        addEffect(event.counter ? 'counter' : event.heavy ? 'heavy' : 'damage',event.sourceId,event.targetId,event.counter ? `Ответ −${event.damage}` : `−${event.damage}`,event.at);
        if (!event.dot&&event.projectile === 'arrow') addEffect('arrow',event.sourceId,event.targetId,null,event.at);
      } else if(event.type==='status'){
        syncFrozenActors(battle.getState());
      } else if (event.type === 'block') {
        actors.hero.blockAt = activeTime;
        // The real LPC guard pose interrupts the swing; the following counter
        // starts its own animation instead of resuming a stale attack frame.
        actors.hero.animation = null;
        addEffect('block',event.sourceId,'hero','Блок',event.at);
      } else if (event.type === 'death') {
        clearStatus(actors[event.id]);
        for(const [id,impact]of pendingIceImpacts)if(impact.targetId===event.id)pendingIceImpacts.delete(id);
        removeEffects(effect=>effect.type!=='spell'||effect.targetId!==event.id||effect.landed);
        let rewardSaved = true, receivedReward = event.reward;
        if(event.id!=='hero'&&event.reward>0&&!paidDeaths.has(event.id)){
          paidDeaths.add(event.id);
          const award = progression.awardGold(event.reward);
          rewardSaved = award.ok;
          if(award.ok){receivedReward=award.awarded;creditedRunGold+=receivedReward;if(receivedReward>0)addEffect('coin','hero',event.id,`+${receivedReward}`,event.at);}
        }
        $('#status').textContent = event.id === 'hero' ? 'Герой пал. Монеты за побеждённых врагов сохранены.' : rewardSaved ? `${actors[event.id].label} побеждён. +${receivedReward} монет.` : `${actors[event.id].label} побеждён. Не удалось сохранить награду — проверь доступ к хранилищу.`;
      } else if(event.type==='wave_clear'){
        removeEffects(effect=>effect.type!=='spell'||effect.landed);
        beginSceneTransition('wave-out',event.at);
        $('#status').textContent=`Волна ${event.waveNumber} пройдена.`;
        updateControls();
      } else if(event.type==='wave'){
        prepareWave(battle.getState());
        // Reset actors under black on this paint, then reveal on the active clock.
        beginSceneTransition('wave-in',event.at);
        $('#status').textContent=`Волна ${event.waveNumber} из ${event.waveCount}: ${event.enemies.length===2?'два лучника':event.enemies[0].type==='orc'?'орк':'один лучник'}.`;
        updateControls();
      } else if (event.type === 'end') {
        pendingIceImpacts.clear();for(const actor of Object.values(actors))clearStatus(actor);
        restartRemaining=2;
        resultSummary=event.result==='victory'?`Все три волны пройдены. За бой: +${creditedRunGold} монет.`:`Герой пал. За бой сохранено: +${creditedRunGold} монет.`;
        $('#result-title').textContent = event.result === 'victory' ? 'Победа' : 'Поражение';
        beginSceneTransition(event.result,event.at);
        $('#replay-button').textContent = 'Начать сейчас'; resultPanel.hidden = true;
        $('#status').textContent = event.result === 'victory' ? `Победа. Следующий бой начнётся автоматически. Получено ${creditedRunGold} монет.` : 'Герой восстановится и начнёт бой заново. Заработанные монеты сохранены.';
        try { telegram?.HapticFeedback?.notificationOccurred(event.result === 'victory' ? 'success' : 'warning'); } catch {}
        removeEffects(effect=>effect.type!=='spell'||effect.landed);
        updateControls();
      }
    }
  }
  function drawActor(id, state) {
    const actor = actors[id], unit = id === 'hero' ? state.hero : state.enemies.find(enemy=>enemy.id===id);
    if(!unit){actor.element.hidden=true;clearStatus(actor);return;}
    actor.element.hidden=false;
    if (!actor.images.idle) return;
    const frozen=syncFrozenPose(actor,unit,state);
    const age = actor.animation ? activeTime - actor.animation.at : 100;
    const ended = ['victory','defeat'].includes(state.phase);
    const walkingOut=id==='hero'&&(sceneTransition?.phase==='wave-out'||sceneTransition?.phase==='victory');
    const distance = id === 'hero' ? walkDistance : actor.distance;
    const walking = (id==='hero'?heroMoving:actor.moving) && distance > 0 && unit.hp > 0 && (!ended||walkingOut) && !reducedMotion.matches && actor.images.walk?.frames > 1;
    const blocking = !walking && !ended && unit.hp > 0 && !reducedMotion.matches && actor.images.block && activeTime - actor.blockAt < .28/(state.hero.attackSpeed||1);
    const attacking = !walking && !blocking && !ended && age >= 0 && age < (actor.animation?.duration || 0) && unit.hp > 0 && !reducedMotion.matches;
    const kind = walking ? 'walk' : blocking ? 'block' : attacking ? 'attack' : 'idle';
    const descriptor = attacking && actor.images.attacks?.[actor.animation.variant] || actor.images[kind];
    const row = walking ? id === 'hero' ? walkDirection : actor.direction : descriptor.row;
    const tile = descriptor.tile || 64, origin = descriptor.origin || 0;
    const cell = walking ? 1 + Math.floor((distance / .75 % 1) * 8) : attacking ? Math.min(descriptor.frames-1,Math.floor(age / actor.animation.duration * descriptor.frames)) : Number.isInteger(descriptor.still) ? descriptor.still : id === 'hero' && auto && unit.hp > 0 && !ended && !reducedMotion.matches ? Math.floor(activeTime / .65) % 2 : 0;
    const key = `${kind}-${descriptor.image.src}-${cell}-${row}-${tile}-${origin}`;
    if (!frozen&&actor.lastKey !== key) {
      actor.canvas.width = tile; actor.canvas.height = tile;
      const ctx = actor.canvas.getContext('2d'); ctx.clearRect(0,0,tile,tile); ctx.imageSmoothingEnabled = false;
      const gearPose=id==='hero'&&equipmentArt?{equipped:equipment.getState(),colors:equipment.getColors(),row,frame:cell,kind,
        variant:attacking?(actor.animation?.variant||'slash'):null,tile,origin}:null;
      if(gearPose)equipmentArt.drawBack(ctx,gearPose);
      ctx.drawImage(descriptor.image,cell*tile,row*tile,tile,tile,0,0,tile,tile);
      if(gearPose)equipmentArt.draw(ctx,gearPose);
      actor.lastKey = key;
      actor.canvas.style.width = `${tile / 64 * 100}%`; actor.canvas.style.height = `${tile / 64 * 100}%`;
      actor.canvas.style.left = `${-origin / 64 * 100}%`; actor.canvas.style.top = `${-origin / 64 * 100}%`;
    }
    if(!frozen){
      actor.poseAge=age;actor.poseAnimation=actor.animation;
      actor.element.dataset.motion = kind;
      actor.element.dataset.attack = attacking ? actor.animation.variant || 'basic' : '';
      actor.element.dataset.counter = String(Boolean(attacking && actor.animation.counter));
      actor.element.classList.toggle('is-heavy',Boolean(attacking && actor.animation.heavy));
      actor.element.classList.toggle('is-blocking',Boolean(blocking));
    }
    actor.element.classList.toggle('is-defeated',unit.hp <= 0);
    actor.element.classList.toggle('is-target',id === state.targetId);
    actor.element.classList.toggle('is-hit',!ended && !reducedMotion.matches && activeTime - actor.hitAt < .16);
    actor.bar.querySelector('i').style.width = `${unit.hp / unit.maxHp * 100}%`;
    actor.bar.setAttribute('aria-valuenow',unit.hp);
    actor.bar.setAttribute('aria-valuemax',unit.maxHp);
    actor.element.setAttribute('aria-label', `${unit.name}${id === 'hero' && loadout ? `, ${starterWeapon.name}, наряд ${starterOutfit.name}, ${loadouts.color(loadout.outfitColor).name}${heroMagic?`, магия ${loadouts.magic(heroMagic).name}`:''}` : ''}: ${unit.hp} из ${unit.maxHp} здоровья`);
    drawStatus(actor,unit,state);
  }
  function prepareWave(state) {
    removeEffects(()=>false);
    pendingIceImpacts.clear();
    heroX=null;fieldWidth=null;walkDistance=0;walkDirection=3;moving=heroMoving=false;
    pairContacted=false;previousSeparation=null;contactTarget=null;previousTargetSeparation=null;
    for(const actor of Object.values(actors)){
      clearStatus(actor);actor.poseAnimation=null;actor.poseAge=100;
      actor.x=null;actor.distance=0;actor.moving=false;actor.direction=1;
      actor.depth=actor.defaultLane;
      actor.animation=null;actor.hitAt=-10;actor.blockAt=-10;actor.lastKey=null;
    }
    updateMovement(0,state);
  }
  // Range holds only melee cooldowns; archers shoot throughout the approach.
  function updateMovement(dt,state) {
    const activeIds=new Set(state.enemies.map(enemy=>enemy.id));
    for(const id of Object.keys(enemyDefinitions))actors[id].element.hidden=!activeIds.has(id);
    const width=battlefield.clientWidth;
    if(!width)return 0;
    const heroSize=actors.hero.element.offsetWidth;
    const home=width*(window.innerWidth>700?.18:.22);
    if(heroX===null)heroX=home;
    for(const id of Object.keys(enemyDefinitions))if(actors[id].x===null)actors[id].x=width*actors[id].spawn;
    const resized=fieldWidth&&fieldWidth!==width;
    if(resized){const ratio=width/fieldWidth;heroX*=ratio;for(const id of Object.keys(enemyDefinitions))actors[id].x*=ratio;}
    fieldWidth=width;
    moving=heroMoving=false;
    for(const id of Object.keys(enemyDefinitions))actors[id].moving=false;
    let usedTime=0;
    const canMove=(state.phase==='running'||(state.phase==='paused'&&state.completedWaves===state.waveIndex))&&state.hero.hp>0;
    if(heroEntrance){
      // Use battlefield-relative coordinates to keep the intro at the same
      // percentage through a rotation/resize. No CSS transform blur.
      const from=-width*.05;
      const previousX=heroX;
      if(reducedMotion.matches){
        heroEntrance=null;heroX=home;
      }else{
        usedTime=canMove?Math.min(dt,Math.max(0,heroEntranceDuration-heroEntrance.elapsed)):0;
        heroEntrance.elapsed=Math.min(heroEntranceDuration,heroEntrance.elapsed+usedTime);
        heroX=from+(home-from)*(heroEntrance.elapsed/heroEntranceDuration);
        if(usedTime>0)walkDistance+=Math.abs(heroX-previousX)/heroSize;
        walkDirection=3;
        moving=heroMoving=canMove&&heroEntrance.elapsed<heroEntranceDuration;
        if(heroEntrance.elapsed>=heroEntranceDuration-1e-8)heroEntrance=null;
      }
      actors.hero.element.style.left=`${heroX}px`;
      for(const id of Object.keys(enemyDefinitions))actors[id].element.style.left=`${actors[id].x}px`;
      projectFormation();
      return usedTime;
    }
    const melee=state.enemies.find(enemy=>enemy.type==='orc'&&enemy.hp>0);
    if(canMove&&melee){
      const enemy=actors[melee.id],enemySize=enemy.element.offsetWidth;
      if(ranged)heroX=home;
      const separation=heroSize*.23+enemySize*.34;
      let gap=enemy.x-heroX-separation;
      if(gap<0||(pairContacted&&(resized||separation!==previousSeparation))){
        if(ranged)enemy.x=heroX+separation;
        else{const middle=(heroX+enemy.x)/2;heroX=middle-separation/2;enemy.x=middle+separation/2;}
        gap=0;
      }
      previousSeparation=separation;
      if(gap>.01){
        const heroSpeed=ranged?0:heroSize*.85,enemySpeed=isFrozen(melee,state)?0:enemySize*.85,closingSpeed=heroSpeed+enemySpeed;
        usedTime=reducedMotion.matches||!closingSpeed?0:Math.min(dt,gap/closingSpeed);
        const time=reducedMotion.matches&&closingSpeed?gap/closingSpeed:usedTime;
        const heroStep=heroSpeed*time,enemyStep=enemySpeed*time;
        const heroDepth=actors.hero.depth,enemyDepth=enemy.depth;
        const fraction=Math.min(1,(heroStep+enemyStep)/gap);
        if(ranged){
          if(enemyStep>0)enemy.depth+=(actors.hero.depth-enemy.depth)*fraction;
        }else if(heroStep>0)actors.hero.depth+=(enemy.depth-actors.hero.depth)*fraction;
        heroX+=heroStep;enemy.x-=enemyStep;
        if(!reducedMotion.matches){
          walkDistance+=Math.hypot(heroStep,(actors.hero.depth-heroDepth)*laneStep)/heroSize;
          enemy.distance+=Math.hypot(enemyStep,(enemy.depth-enemyDepth)*laneStep)/enemySize;
        }
        walkDirection=3;enemy.direction=1;
        moving=enemy.x-heroX-separation>.01&&closingSpeed>0;heroMoving=moving&&heroSpeed>0;enemy.moving=moving&&enemySpeed>0;
      }
      if(enemy.x-heroX-separation<=.01){
        if(ranged){if(!isFrozen(melee,state))enemy.depth=actors.hero.depth;}
        else actors.hero.depth=enemy.depth;
        pairContacted=Math.abs(enemy.depth-actors.hero.depth)<=1e-4;
      }
    }else if(canMove&&state.targetId){
      if(ranged)heroX=home;
      else{
        const target=actors[state.targetId];
        const separation=heroSize*.23+target.element.offsetWidth*.34;
        const goal=Math.max(home,target.x-separation);
        if(contactTarget===state.targetId&&(resized||separation!==previousTargetSeparation))heroX=goal;
        previousTargetSeparation=separation;
        const gap=goal-heroX;
        if(Math.abs(gap)>.01){
          walkDirection=gap>=0?3:1;
          const speed=heroSize*.85;
          const distance=reducedMotion.matches?Math.abs(gap):Math.min(Math.abs(gap),speed*dt);
          const depth=actors.hero.depth;
          actors.hero.depth+=(target.depth-actors.hero.depth)*Math.min(1,distance/Math.abs(gap));
          heroX+=Math.sign(gap)*distance;
          if(!reducedMotion.matches)walkDistance+=Math.hypot(distance,(actors.hero.depth-depth)*laneStep)/heroSize;
          usedTime=reducedMotion.matches?0:distance/speed;
          moving=heroMoving=!reducedMotion.matches&&Math.abs(goal-heroX)>.01;
        }
        if(!moving){actors.hero.depth=target.depth;contactTarget=state.targetId;}
      }
    }
    actors.hero.element.style.left=`${heroX}px`;
    for(const id of Object.keys(enemyDefinitions))actors[id].element.style.left=`${actors[id].x}px`;
    projectFormation();
    return usedTime;
  }
  function renderEffects(state) {
    const field = battlefield.getBoundingClientRect();
    for (let i=effects.length-1;i>=0;i--) {
      const effect = effects[i], age = activeTime - effect.at;
      if (age+1e-6 >= effect.duration || reducedMotion.matches) { effect.element.remove(); effects.splice(i,1); continue; }
      const target = actors[effect.targetId].element.getBoundingClientRect(), source = actors[effect.sourceId].element.getBoundingClientRect();
      const p = Math.max(0,age/effect.duration), tx=target.left+target.width/2-field.left, ty=target.top+target.height*.4-field.top;
      if (effect.type === 'spell') {
        const phase=effect.landed?'impact':age+1e-6<effect.appearDuration?'appear':'flight';
        const row=phase==='appear'?0:phase==='flight'?1:2;
        const phaseAge=Math.max(0,phase==='appear'?age:phase==='flight'?age-effect.appearDuration:activeTime-effect.impactAt);
        const phaseDuration=phase==='appear'?effect.appearDuration:phase==='flight'?effect.flightDuration:effect.impactDuration;
        const cell=phase==='flight'?Math.floor((phaseAge+1e-6)/(phaseDuration/6))%6:Math.min(5,Math.floor((phaseAge+1e-6)/(phaseDuration/6)));
        const sx=source.left+source.width*(effect.sourceId==='hero'?.88:.28)-field.left;
        const sy=source.top+source.height*(effect.sourceId==='hero'?.67:.53)-field.top;
        const hitY=target.top+target.height*.55-field.top;
        const progress=phase==='appear'?0:phase==='impact'?1:Math.min(1,phaseAge/effect.flightDuration);
        if(phase!=='impact'||effect.angle===null)effect.angle=Math.atan2(hitY-sy,tx-sx)*180/Math.PI+180;
        effect.element.style.left=`${sx+(tx-sx)*progress}px`;
        effect.element.style.top=`${sy+(hitY-sy)*progress}px`;
        effect.element.style.transform=`translate(-25%,-50%) rotate(${effect.angle}deg)`;
        effect.element.dataset.phase=phase;
        const key=`${row}:${cell}`;
        if(effect.lastKey!==key){
          const ctx=effect.element.getContext('2d');ctx.clearRect(0,0,64,64);ctx.imageSmoothingEnabled=false;
          ctx.drawImage(effect.image,cell*64,row*64,64,64,0,0,64,64);effect.lastKey=key;
        }
      } else if (effect.floating) {
        effect.element.style.left = `${tx}px`; effect.element.style.top = `${ty-p*22}px`; effect.element.style.opacity = String(1-p);
      } else {
        const sx=source.left+source.width*(effect.sourceId==='hero'?.7:.3)-field.left, sy=source.top+source.height*.45-field.top;
        if(effect.type==='arrow'){
          const angle=Math.atan2(ty-sy,tx-sx)*180/Math.PI+180;
          effect.element.style.transform=`translate(-50%,-50%) rotate(${angle}deg)`;
        }
        effect.element.style.left = `${sx+(tx-sx)*p}px`; effect.element.style.top = `${sy+(ty-sy)*p}px`;
      }
    }
  }
  function render(state) {
    renderSceneTransition(state);
    for (const id of Object.keys(actors)) drawActor(id,state);
    $('#hero-vital').textContent = `${state.hero.hp} / ${state.hero.maxHp} HP`;
    const waves = document.querySelectorAll('.wave');
    waves.forEach((wave,i) => { wave.classList.toggle('done',i<state.completedWaves); wave.classList.toggle('current',i===state.waveIndex&&i>=state.completedWaves); });
    $('#wave-number').textContent=`${state.waveNumber}/${state.waveCount}`;
    $('.stage-progress').setAttribute('aria-label',`Волна ${state.waveNumber} из ${state.waveCount}. Пройдено: ${state.completedWaves}.`);
    renderEffects(state);
  }
  function attackAvailability(state) {
    const heroSize=actors.hero.element.offsetWidth;
    const inReach=(id,x)=>Math.abs(x-heroX)<=heroSize*.23+actors[id].element.offsetWidth*.34+.01&&Math.abs(actors[id].depth-actors.hero.depth)<=1e-4;
    const target=state.targetId;
    return {
      heroCanAttack:Boolean(target && (ranged || inReach(target,actors[target].x))),
      heroCloseRange:Boolean(target && inReach(target,actors[target].x)),
      orcCanAttack:state.enemies.some(enemy=>enemy.type==='orc'&&enemy.hp>0) && inReach('orc',actors.orc.x)
    };
  }
  function advanceBattleFrame(dt) {
    let remaining=dt;
    const advance=(seconds,availability)=>{
      const events=battle.advance(seconds,availability);
      // A terminal hit may stop partway through a frame. Follow actual engine time
      // until the terminal countdown becomes the owner of the visual clock.
      activeTime=battle.getState().elapsed;
      handleEvents(events);
    };
    while(remaining>1e-7){
      const before=battle.getState();
      if(['victory','defeat'].includes(before.phase))break;
      let step=remaining;
      if(before.phase==='intermission')step=Math.min(step,before.intermissionRemaining);
      // Cast events supply their engine-time impact boundary even with reduced motion.
      // Status rendering itself always reads the enemy snapshot, never this schedule.
      for(const [id,impact]of pendingIceImpacts){
        if(impact.at<=before.elapsed+1e-7){pendingIceImpacts.delete(id);continue;}
        step=Math.min(step,impact.at-before.elapsed);
      }
      for(const unit of before.enemies)if(isFrozen(unit,before))step=Math.min(step,unit.status.endsAt-before.elapsed);
      step=Math.min(remaining,Math.max(1e-6,step));
      const wasMoving=moving;
      if(before.phase==='intermission'){
        advance(step,{heroCanAttack:Boolean(ranged),orcCanAttack:false});
      }else{
        // Entrance is presentation-only: the combat clock and cooldowns do not
        // advance until the character visibly reaches the battle position.
        let entryTime=0;
        if(heroEntrance){
          entryTime=updateMovement(step,before);
          if(!heroEntrance&&entryTime<step)updateControls();
        }
        const remainingCombat=step-entryTime;
        if(!heroEntrance&&remainingCombat>1e-7){
          const beforeRange=attackAvailability(before);
          const walkTime=updateMovement(remainingCombat,before);
          battle.resume();
          if(walkTime>0)advance(walkTime,beforeRange);
          if(remainingCombat>walkTime)advance(remainingCombat-walkTime,attackAvailability(battle.getState()));
        }
      }
      const after=battle.getState();
      syncFrozenActors(after);updateMovement(0,after);
      if(moving!==wasMoving||after.phase!==before.phase)updateControls();
      remaining-=step;
    }
  }
  function tick(timestamp) {
    if(lastFrameTime===null)lastFrameTime=timestamp;
    const dt=Math.min(.1,Math.max(0,(timestamp-lastFrameTime)/1000));lastFrameTime=timestamp;
    if(ready&&auto&&!document.hidden&&!dialog.open){
      const before=battle.getState();
      if(['victory','defeat'].includes(before.phase)){
        activeTime+=dt;
        if(restartRemaining!==null){
          restartRemaining=Math.max(0,restartRemaining-dt);
          if(restartRemaining<=1e-6)restartBattle(false);else updateCountdown();
        }
      }else{
        advanceBattleFrame(dt);
      }
    }
    if(ready)render(battle.getState());
    window.requestAnimationFrame(tick);
  }
  function restartBattle(startAuto) {
    battle.restart();if(startAuto)auto=true;
    activeTime=0;restartRemaining=null;resultSummary='';paidDeaths.clear();creditedRunGold=0;
    clearSceneTransition();
    prepareWave(battle.getState());beginHeroEntrance();updateMovement(0,battle.getState());
    resultPanel.hidden=true;lastFrameTime=null;
    if(startAuto)try{localStorage.setItem('ember.combat.auto.v1','on');}catch{}
    render(battle.getState());syncPause();$('#status').textContent='Битва 1–1. Волна 1: один лучник.';
  }
  $('#replay-button').addEventListener('click',()=>{
    if(assetError){resultPanel.hidden=true;loadAssets();return;}
    restartBattle(true);
  });
  const information = {
    gold: () => ['КОШЕЛЁК','Золото',`В кошельке ${wallet} золота. За каждого врага — 5 монет, за все три волны — 20. Монеты сохраняются и при поражении. Сохранение — на этом устройстве.`],
    crystals: () => ['КОШЕЛЁК','Кристаллы','Редкие кристаллы для особых находок. Их история начнётся в следующих главах.'],
    rewards: () => ['НАГРАДЫ','Трофеи первого боя',`За каждого из четырёх врагов — 5 монет. Полный проход приносит 20 монет; бонуса за победу нет. Сейчас в кошельке: ${wallet}.`],
    map: () => ['ГЛАВА I','Забытый лес','Битва 1–1: один лучник, два лучника, затем орк. После победы или поражения бой начинается заново автоматически.'],
    fist: () => ['УМЕНИЕ','Натиск',starterWeapon?.id === 'sword' ? 'Мечник чередует короткий, рубящий и обратный удар. Третий удар наносит на 50% больше урона до брони. Щит смягчает каждый второй удар ближнего боя наполовину и открывает контратаку. Натиск откроется на 3 уровне.' : 'Откроется на 3 уровне. Сейчас герой использует базовую атаку своего оружия.'],
    dash: () => ['УМЕНИЕ','Рывок','Откроется на 5 уровне. В нужный момент решает один быстрый шаг.'],
    fire: () => ['УМЕНИЕ','Внутренний огонь','Откроется на 10 уровне. Сила, которую ещё предстоит пробудить.']
  };
  function openInfo(eyebrow,title,copy,profile=false) {
    $('#dialog-eyebrow').textContent=eyebrow; $('#dialog-title').textContent=title; $('#dialog-copy').textContent=copy;
    const link=$('#profile-link'); link.hidden=!profile; link.textContent=character?'Изменить облик':'Создать героя';
    $('#sprite-credits').hidden=!profile;
    if (!dialog.open) dialog.showModal(); syncPause();
  }
  $('#profile-button').addEventListener('click', () => openInfo('ТВОЙ ГЕРОЙ',name,`Уровень ${level} · Сила ${battle.getState().hero.damage} · ${skinNames[skinIds.indexOf(skin)]} оттенок кожи. ${loadout ? `${starterWeapon.name} · наряд «${starterOutfit.name}», ${loadouts.color(loadout.outfitColor).name.toLowerCase()} цвет.${heroMagic?` Магия: ${loadouts.magic(heroMagic).name}.`:''}` : 'Без класса, брони и оружия.'} Максимум здоровья: ${battle.getState().hero.maxHp}.`,true));
  document.querySelectorAll('[data-info]').forEach(button=>button.addEventListener('click',()=>openInfo(...information[button.dataset.info]())));
  dialog.querySelectorAll('.dialog-close,.dialog-action').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  dialog.addEventListener('close',syncPause);
  dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  loadAssets(); window.requestAnimationFrame(tick);
})();
