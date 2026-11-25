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
  if (new URLSearchParams(window.location.search).get('battle') === 'test') auto = true;
  const loadouts = window.EmberLoadouts;
  const arrowSprite = 'assets/projectiles/arrow.png';
  // The 13-frame LPC bow releases at frame 9. Flight ends at the original
  // engine hit time, so damage and combat cooldowns remain unchanged.
  const arrowReleaseFrame=9,arrowPoseFrames=13,arrowFlightDuration=.28;
  const loadout = loadouts?.selection(character) || null;
  const starterWeapon = loadout ? loadouts.weapon(loadout.weapon) : null;
  const starterOutfit = loadout ? loadouts.outfit(loadout.weapon,loadout.outfit) : null;
  // Every Mage casts both elements, even with an old saved magic value.
  const heroMagic = starterWeapon?.id==='wand'?'both':null;
  // Do not apply Warrior upgrades to Mage spells. Gold stays shared in one
  // atomic progression record; only the selected class's ranks affect combat.
  const progression = window.EmberProgression.createStore({storage:progressionStorage,classId:starterWeapon?.id||'sword',heroLevel:character?.level});
  wallet = progression.getState().gold;
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
  $('#level-badge').textContent = starterWeapon?.id==='wand'?progression.getTalents().level:level;
  const dragonBoss=Boolean(window.EmberDragon);
  const battle = window.EmberCombat.createBattle({heroName:name,heroProjectile:starterWeapon?.projectile,heroWeapon:starterWeapon?.id,heroMagic,
    dragonBossEnabled:dragonBoss,skeletonSwordsEnabled:true,
    companionEnabled:equipment?.classId==='bow'&&equipment.getState().companion==='wolf',
    ...progression.getStats(),heroTalents:starterWeapon?.id==='wand'?progression.getTalents().equipped:[]});
  battle.pause();
  let ready = false, assetError = false, lastFrameTime = null, restartRemaining = null, resultSummary = '';
  const paidDeaths = new Set();
  let creditedRunGold = 0;
  // The WebApp opts into the mixed wave; old standalone engine fixtures remain supported.
  const mixedWave=battle.getState().totalEnemies>(dragonBoss?5:4);
  const enemyDefinitions = {
    archer1:{type:'archer',spawn:.62,label:'Лучник',defaultLane:2},
    archer2:{type:'archer',spawn:.61,label:'Лучник I',defaultLane:1},
    archer3:{type:'archer',spawn:.80,label:'Лучник II',defaultLane:5},
    ...(mixedWave?{skeletonSword1:{type:'swordsman',spawn:.51,label:'Мечник I',defaultLane:2},skeletonSword2:{type:'swordsman',spawn:.60,label:'Мечник II',defaultLane:4}}:{}),
    orc:{type:'orc',spawn:.65,label:'Орк',defaultLane:4},
    ...(dragonBoss?{dragon:{type:'dragon',spawn:.76,label:'Красный дракон',defaultLane:3}}:{})
  };
  const actors = {};
  let dragonSprites=null;
  for (const id of ['hero',...Object.keys(enemyDefinitions)]) {
    const element = document.querySelector(`[data-fighter="${id}"]`);
    actors[id] = {element, canvas:element.querySelector('canvas'), bar:element.querySelector('.healthbar'), images:{}, animation:null, hitAt:-10, blockAt:-10, lastKey:null,statusCanvas:null,statusKey:null,frozenPose:null,poseAnimation:null,poseAge:100,defaultLane:3,...enemyDefinitions[id],depth:enemyDefinitions[id]?.defaultLane||3,x:null,distance:0,direction:1,moving:false};
  }
  // The Archer's equipped wolf is an independent melee attacker. Its bite
  // reaches the engine at the source animation's impact frame.
  const companion=window.EmberCompanion?.create({
    element:$('#companion-wolf'),store:equipment,loadImage
  });
  const effects = [];
  const cuedArrows=new Map();
  const spellImages = {};
  const pendingIceImpacts = new Map();
  let statusImage = null;
  const mageSkillRows=['thermal','steam','chaos','absorption','rebirth','echo','overload','archmage'];
  const mageEffectTile=64;
  const mageEffects={};let sphereCanvas=null,sphereHitAt=-Infinity,sphereDrawKey=null;
  const sphereTile=128,sphereBreakDuration=.56;
  let laneStep = 0;
  arena.dataset.lanes='5';battlefield.dataset.lanes='5';
  let heroX = null, fieldWidth = null, moving = false, heroMoving = false;
  // The engine clock deliberately freezes for the 2.5s wave entrance.
  // Wolf sprite frames need their own pause-aware visual clock, otherwise
  // its x-coordinate moves while the legs stay on one static frame.
  let walkDistance = 0, walkDirection = 3, activeTime = 0, companionTime = 0;
  let companionDeathAt = null, companionHitAt = -10;
  let sceneTransition = null;
  // At the start of EACH wave the hero walks in at a deliberate pace
  // from fully off-screen. The battle clock stays on hold until arrival.
  const heroEntranceDuration=2.5;
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
    if(starterWeapon?.id==='wand'){
      $('#level-badge').textContent=progression.getTalents().level;
      if(change?.type==='talents')battle.setTalents(progression.getTalents().equipped);
    }
    if(change?.type!=='purchase')return;
    const current = battle.getState().hero, stats = progression.getStats();
    const oldSpeed = current.attackSpeed || 1;
    if (current.damage !== stats.heroDamage || current.maxHp !== stats.heroMaxHp || oldSpeed !== stats.heroAttackSpeed || stats.heroBurnRank || stats.heroSphereRank || stats.heroShardRank || starterWeapon?.id==='wand') {
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
  window.EmberSkillPanel?.mount({root:$('#skills-panel'),store:progression,heroLevel:level,classId:starterWeapon?.id||'sword'});
  let equipmentUI=null,talentUI=null;
  const talentPanel=$('#talents-panel');
  const showLowerPanel=mode=>{
    $('#equipment-panel').hidden=mode!=='equipment';$('#skills-panel').hidden=mode!=='skills';
    if(talentPanel)talentPanel.hidden=mode!=='talents';
    if(mode==='equipment')equipmentUI?.refreshPreview();if(mode==='talents')talentUI?.render();
  };
  if(starterWeapon?.id==='wand'&&window.EmberTalentPanel&&talentPanel){
    talentUI=window.EmberTalentPanel.mount({root:talentPanel,store:progression,battle});
    for(const id of ['open-talents-tab','gear-talents-tab']){const tab=$('#'+id);tab.disabled=false;tab.setAttribute('aria-label','Таланты');tab.addEventListener('click',()=>showLowerPanel('talents'));}
    $('#talent-skills-tab').addEventListener('click',()=>showLowerPanel('skills'));
    $('#talent-gear-tab').addEventListener('click',()=>showLowerPanel('equipment'));
  }
  const equipmentPanel=$('#equipment-panel'),skillsPanel=$('#skills-panel');
  if(equipment&&window.EmberEquipmentUI&&equipmentPanel&&skillsPanel){
    equipmentUI=window.EmberEquipmentUI.mount({
      root:equipmentPanel,store:equipment,
      outfitColor:loadout?.outfitColor||'sand',
      getSprite:()=>actors.hero.images.idle,
      loadItem:async(slot,id,colors)=>{
        // Stage the original wolf image before committing an equipment choice.
        // Companion selection must not rebuild the hero's LPC armor or bow.
        if(slot==='companion'){
          if(id==='wolf')await companion?.load();
          return;
        }
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
      paintCompanion:(ctx,pose)=>companion?.paintPreview(ctx,pose),
      onEquip:(_look,slot)=>{
        if(slot==='companion'){
          battle.setCompanionEnabled?.(equipment.classId==='bow'&&equipment.getState().companion==='wolf');
          companionDeathAt=null;
          companion?.reset();
        }
        if(slot!=='companion'&&classEquipment&&loadedClassSprites)applyClassSprites(loadedClassSprites);
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
      if(mixedWave){
        const [walk,attack]=await Promise.all([loadImage('assets/enemies/lpc/skeleton-sword-walk.svg'),loadImage('assets/enemies/lpc/skeleton-sword-attack.svg')]);
        for(const id of ['skeletonSword1','skeletonSword2'])actors[id].images={idle:{image:walk,frames:9,row:1,still:0},walk:{image:walk,frames:9,row:1},attack:{image:attack,frames:6,row:1,tile:128,origin:32}};
      }
      actors.archer2.images = {...actors.archer1.images};
      actors.archer3.images = {...actors.archer1.images};
      actors.orc.images.walk = { ...actors.orc.images.idle,still:undefined };
      // Red Dragon uses native 205×161 cells, not LPC 64×64 fighter cells.
      if(dragonBoss)dragonSprites=await window.EmberDragon.load(loadImage);
      const [orcAttack,statusAtlas] = await Promise.all([
        loadImage('assets/enemies/lpc/orc-attack.png').catch(() => null),
        loadImage('assets/magic/status-effects.png'),
        loadImage(arrowSprite),
        ...['fire','ice','shadow'].map(async magic=>{spellImages[magic]=await loadImage(`assets/magic/${magic}.png`);})
      ]);
      statusImage = statusAtlas;
      if(starterWeapon?.id==='wand'){
        await Promise.all(['burn','shards','sphere','impact'].map(async effect=>{mageEffects[effect]=await loadImage(effect==='sphere'?'assets/magic/mage-sphere-v2.svg':effect==='impact'?'assets/magic/mage-barrier-impact.svg':`assets/magic/mage-${effect}.png`);}));
        mageEffects.advanced=await Promise.all(mageSkillRows.map(skill=>loadImage(skill==='echo'?'assets/magic/mage-echo-resonance-v2.png':`assets/magic/mage-${skill}.png`)));
      }
      actors.orc.images.attack = orcAttack ? {image:orcAttack,frames:6,row:1,tile:128,origin:32} : { ...actors.orc.images.idle,frames:1 };
      const face = $('#avatar').getContext('2d'); face.imageSmoothingEnabled = false;
      const avatarTile=loadout?starterWeapon.walk.tile:64, avatarOrigin=loadout?starterWeapon.walk.origin:0;
      face.drawImage(idle,avatarOrigin+19,avatarTile*2+avatarOrigin+12,26,26,0,0,32,32);
      // Helmet/armor are native pose overlays; sword/shield are complete, recomposed LPC sheets.
      if(equipmentArt)try{await equipmentArt.prepareLook(equipment.getState(),equipment.getColors());}
      catch{$('#status').textContent='Не удалось загрузить часть LPC-экипировки.';}
      // A missing cosmetic image should never block combat or hero creation.
      if(equipment?.getState().companion==='wolf')try{await companion?.load();}catch{}
      ready = true;
      beginHeroEntrance();
      updateMovement(0,battle.getState());
      $('#status').textContent = dragonBoss
        ?'Бой готов: три волны и финальный красный дракон.'
        :'Бой готов: один лучник, смешанная волна скелетов, затем орк.';
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
    $('#battle-state').textContent = !ready ? assetError ? 'Ошибка загрузки' : 'Загрузка боя' : !auto ? 'Пауза' : state.phase === 'victory' ? `Победа · ${state.waveCount}/${state.waveCount}` : state.phase === 'defeat' ? 'Поражение' : state.phase==='intermission' ? 'Следующая волна…' : heroEntrance ? 'Выход на арену' : moving ? 'Подход к цели' : `Волна ${state.waveNumber}/${state.waveCount}`;
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
    const justSpawned=transition.fresh;
    if(justSpawned){transition.at=activeTime;transition.lastTime=activeTime;transition.fresh=false;}
    const age=transition.phase==='wave-in'&&heroEntrance
      ?(justSpawned?0:heroEntrance.elapsed)
      :Math.max(0,activeTime-transition.at);
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
  function addEffect(type, sourceId, targetId, text, at,options={}) {
    if (reducedMotion.matches) return null;
    const element = document.createElement(type === 'arrow' ? 'img' : 'span');
    if (type === 'arrow') {
      element.src = arrowSprite; element.alt = ''; element.draggable = false;
      element.width = 192; element.height = 30;
    }
    const floating = ['damage','heavy','counter','block','coin'].includes(type);
    element.className = floating ? `damage-number ${type}-number ${targetId === 'hero' && type !== 'block' ? 'enemy-damage' : ''}` : `projectile ${type}`;
    element.setAttribute('aria-hidden','true'); if (text) element.textContent = text;
    if(type==='arrow'){
      element.hidden=true;element.style.visibility='hidden';
      element.dataset.source=sourceId;
      element.dataset.target=targetId;
      element.dataset.releaseAt=String(at);
      element.dataset.impactAt=String(at+(options.duration||arrowFlightDuration));
    }
    const effect={element,type,floating,sourceId,targetId,
      at:options.at??activeTime,
      duration:options.duration??(type==='coin'?.65:floating?.85:.38)};
    battlefield.appendChild(element);effects.push(effect);
    return effect;
  }
  function addSpell(event) {
    if (reducedMotion.matches) return;
    const magic=event.sourceId==='hero'?(event.magic==='ice'?'ice':'fire')
      :event.sourceId==='dragon'?'fire':'shadow';
    const element=document.createElement('canvas');
    element.width=64; element.height=64; element.className='spell-projectile';
    element.dataset.magic=magic; if(event.shards)element.dataset.shards='true';if(event.echo){element.dataset.echo='true';element.hidden=true;element.style.visibility='hidden';} element.dataset.source=event.sourceId; element.dataset.target=event.targetId;
    if(event.breath&&event.sourceId==='dragon'){
      // Each pulse is one independent fire spell, exactly like a Mage orb,
      // spawned from the dragon's visible mouth rather than body centre.
      element.dataset.dragonVolley='true';
      element.dataset.burst=String(event.burstIndex);
    }
    element.setAttribute('aria-hidden','true'); battlefield.appendChild(element);
    effects.push({element,type:'spell',sourceId:event.sourceId,targetId:event.targetId,magic,image:event.shards&&mageEffects.shards?mageEffects.shards:spellImages[magic],shards:Boolean(event.shards&&mageEffects.shards),
      castId:event.castId,at:event.at,impactAt:event.impactAt,appearDuration:event.appearDuration,echo:Boolean(event.echo),
      flightDuration:event.flightDuration,impactDuration:event.impactDuration,
      duration:event.appearDuration+event.flightDuration+event.impactDuration,
      dragonVolley:Boolean(event.breath&&event.sourceId==='dragon'),
      mouthOrigin:null,landed:false,lastKey:null,angle:null});
  }
  // The sphere's visible rim is radius 50/128 of its 150% overlay.
  // Projectiles aim at that ellipse instead of the hero's body while it exists.
  const sphereRadius=size=>size*1.5*50/128;
  const heroMeleeSeparation=(state,heroSize,enemySize)=>(state.hero.sphere?.hp>0?sphereRadius(heroSize):heroSize*.23)+enemySize*.34;
  function barrierContact(target,field,sx,sy){
    const cx=target.left+target.width/2-field.left,cy=target.top+target.height/2-field.top;
    const rx=sphereRadius(target.width),ry=sphereRadius(target.height);
    let dx=sx-cx,dy=sy-cy;
    if(Math.hypot(dx,dy)<1e-6){dx=1;dy=0;}
    const scale=1/Math.hypot(dx/rx,dy/ry),x=cx+dx*scale,y=cy+dy*scale;
    const len=Math.hypot(dx,dy);
    return {x,y,nx:dx/len,ny:dy/len};
  }
  function aimAtBarrier(effect,state,target,field,sx,sy){
    if(effect.targetId!=='hero'||effect.sourceId==='hero'||!state.hero.sphere?.hp||effect.landed)return null;
    const contact=barrierContact(target,field,sx,sy);
    // Stop the arrow's leading tip, not its midpoint, at the glowing rim.
    const source=actors[effect.sourceId]?.element;
    const arrowWidth=effect.element.offsetWidth||source?.offsetWidth*.62||target.width*.62;
    const padding=effect.type==='arrow'?arrowWidth*.46:target.width*.13;
    effect.barrierContact=contact;
    effect.element.dataset.barrierX=String(contact.x);effect.element.dataset.barrierY=String(contact.y);
    return {x:contact.x+contact.nx*padding,y:contact.y+contact.ny*padding};
  }
  function shatterBlockedProjectile(event){
    if(reducedMotion.matches||!mageEffects.impact||!['arrow','magic'].includes(event.projectile))return;
    const field=battlefield.getBoundingClientRect(),target=actors.hero.element.getBoundingClientRect();
    const source=actors[event.sourceId]?.element.getBoundingClientRect();
    if(!source)return;
    const match=effects.find(effect=>effect.sourceId===event.sourceId&&effect.targetId==='hero'&&
      (event.projectile==='arrow'?effect.type==='arrow'&&Math.abs(effect.at+effect.duration-event.at)<.001:
       effect.type==='spell'&&effect.castId===event.castId));
    const sx=match?.mouthOrigin?.x??(source.left+source.width*.3-field.left);
    const sy=match?.mouthOrigin?.y??(source.top+source.height*.45-field.top);
    const point=match?.barrierContact||barrierContact(target,field,sx,sy);
    // Consume the exact projectile at the engine-confirmed hit. The final
    // shield-breaking hit still shatters; excess damage is handled by combat.
    if(match){match.element.remove();effects.splice(effects.indexOf(match),1);}
    const element=document.createElement('canvas');element.width=64;element.height=64;
    element.className='barrier-impact';element.dataset.kind=event.projectile==='arrow'?'arrow':'magic';
    element.dataset.source=event.sourceId;element.dataset.target='hero';
    if(event.castId)element.dataset.castId=event.castId;
    element.setAttribute('aria-hidden','true');battlefield.appendChild(element);
    const angle=Math.atan2(point.ny,point.nx)*180/Math.PI;
    element.style.left=point.x+'px';element.style.top=point.y+'px';
    element.style.transform=`translate(-50%,-50%) rotate(${angle}deg)`;
    effects.push({type:'barrier-impact',element,sourceId:event.sourceId,targetId:'hero',at:event.at,duration:.36,
      kind:element.dataset.kind,point,lastKey:null});
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
    const enhanced=status.enhanced&&mageEffects.burn;
    const frame=enhanced?(reducedMotion.matches?3:Math.floor((state.elapsed-status.startedAt)*12)%8):reducedMotion.matches?2:Math.min(5,Math.max(0,Math.floor((state.elapsed-status.startedAt)/(status.endsAt-status.startedAt)*6+1e-7)));
    const canvas=actor.statusCanvas,row=status.type==='freeze'?1:0,key=`${status.type}:${frame}:${Boolean(enhanced)}`;
    canvas.dataset.status=status.type;canvas.dataset.frame=String(frame);
    canvas.style.opacity=status.type==='freeze'?'0.65':'1';
    actor.element.classList.toggle('is-burning',status.type==='burn');
    if(actor.statusKey!==key){
      const width=(statusImage.naturalWidth||statusImage.width)/6,height=(statusImage.naturalHeight||statusImage.height)/2;
      const ctx=canvas.getContext('2d');ctx.clearRect(0,0,64,64);ctx.imageSmoothingEnabled=false;
      if(enhanced)ctx.drawImage(mageEffects.burn,frame*32,0,32,32,0,0,64,64);else ctx.drawImage(statusImage,frame*width,row*height,width,height,0,0,64,64);actor.statusKey=key;
    }
  }
  function addMageSkillEffect(event){
    const row=mageSkillRows.indexOf(event.skill);
    if(row<0||!mageEffects.advanced?.[row]||reducedMotion.matches)return;
    const element=document.createElement('canvas');element.width=mageEffectTile;element.height=mageEffectTile;element.className='mage-advanced-effect';
    element.dataset.skill=event.skill;element.dataset.target=event.targetId;element.setAttribute('aria-hidden','true');
    battlefield.appendChild(element);
    const resonance=event.skill==='echo'&&Number.isFinite(event.echoReleaseAt);
    effects.push({type:'mage-advanced',element,row,sourceId:event.sourceId,targetId:event.targetId,at:event.at,
      resonance,releaseAt:event.releaseAt,echoReleaseAt:event.echoReleaseAt,
      duration:resonance?event.echoReleaseAt-event.at+.40:event.skill==='archmage'?.9:.6,lastKey:null});
  }
  function handleEvents(events) {
    for (const event of events) {
      if(event.type==='talentKnockback'){
        for(const id of event.targets){const actor=actors[id];if(!actor||actor.x==null)continue;const side=actor.x>=heroX?1:-1;actor.x+=side*actors.hero.element.offsetWidth*.65;actor.moving=false;actor.element.style.left=actor.x+'px';}
        pairContacted=false;projectFormation();
      }else if(event.type==='mageSkill'){
        addMageSkillEffect(event);
      }else if(event.type==='sphere'){
        if(event.absorbed>0){sphereHitAt=event.at;shatterBlockedProjectile(event);addEffect('block',event.sourceId,'hero',`Щит −${event.absorbed}`,event.at);}
      } else if (event.type === 'cast') {
        if(!event.shards&&!event.echo&&event.sourceId==='hero'&&event.magic==='ice')pendingIceImpacts.set(event.castId,{at:event.impactAt,targetId:event.targetId});
        const caster=actors[event.sourceId];
        if(event.sourceId==='dragon'&&event.breath){
          // One five-shot salvo must have ONE sustained open-jaw pose.
          // Individual pulse events may not restart/close the mouth.
          const spacing=window.EmberCombat.dragonBreath.spacing;
          const holdAfterLastShot=.22;
          if(event.burstIndex===0||!Number.isFinite(caster.breathUntil)
            ||event.at>caster.breathUntil){
            caster.breathStartedAt=event.at;
            caster.breathUntil=event.at+
              (Math.max(1,event.burstCount)-1)*spacing+holdAfterLastShot;
          }else{
            caster.breathUntil=Math.max(caster.breathUntil,event.at+holdAfterLastShot);
          }
        }else if(!event.shards&&!event.echo){
          caster.animation={at:event.at,duration:event.animationDuration||.66};
        }
        addSpell(event);
      } else if (event.type === 'attack') {
        // Visual bow wind-up already began before impact. Do not restart it
        // at the moment the arrow reaches its target.
        if (!event.impact&&!event.dot&&event.projectile!=='arrow'&&event.sourceId!=='companion')
          actors[event.sourceId].animation = {at:event.sourceId==='orc'?event.at:activeTime,duration:event.animationDuration || .66,
            variant:event.variant,heavy:event.heavy,counter:event.counter,swipe:event.dragonSwipe};
        if (event.impact) {
          pendingIceImpacts.delete(event.castId);
          const spell=effects.find(effect=>effect.type==='spell'&&effect.castId===event.castId);
          if(spell){spell.landed=true;spell.impactAt=event.at;spell.duration=event.at-spell.at+spell.impactDuration;}
        }
        if(!event.dot&&event.damage>0){
          if(event.targetId==='companion')companionHitAt=companionTime;
          else if(actors[event.targetId])actors[event.targetId].hitAt=activeTime;
        }
        if(event.damage>0)addEffect(event.counter ? 'counter' : event.heavy ? 'heavy' : 'damage',event.sourceId,event.targetId,event.counter ? `Ответ −${event.damage}` : `−${event.damage}`,event.at);
      } else if(event.type==='status'){
        syncFrozenActors(battle.getState());
      } else if (event.type === 'block') {
        actors.hero.blockAt = activeTime;
        // The real LPC guard pose interrupts the swing; the following counter
        // starts its own animation instead of resuming a stale attack frame.
        actors.hero.animation = null;
        addEffect('block',event.sourceId,'hero','Блок',event.at);
      } else if (event.type === 'death') {
        if(event.id==='companion'){
          companionDeathAt=companionTime;
          $('#status').textContent='Боевой волк пал. Враги переключились на лучника.';
          continue;
        }
        clearStatus(actors[event.id]);
        if(event.id==='dragon'){
          // Boss death is authoritative. No flames, cast particles or
          // dragon-generated damage numbers may outlive the dragon sprite.
          removeEffects(effect=>effect.sourceId!=='dragon');
          actors.dragon.animation=null;
          actors.dragon.breathUntil=-1;
          actors.dragon.breathStartedAt=null;
        }
        for(const [id,impact]of pendingIceImpacts)if(impact.targetId===event.id)pendingIceImpacts.delete(id);
        removeEffects(effect=>effect.type!=='spell'||effect.targetId!==event.id||effect.landed);
        let rewardSaved = true, receivedReward = event.reward;
        if(event.id!=='hero'&&event.reward>0&&!paidDeaths.has(event.id)){
          paidDeaths.add(event.id);
          const award = progression.awardGold(event.reward,starterWeapon?.id==='wand'?10:0);
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
        prepareWave(battle.getState());talentUI?.render();
        // Reset actors under black, then fade while the new entrance walks in.
        // The engine clock is held during the entrance, so the fade follows
        // the local entrance clock instead of relying on combat time.
        beginSceneTransition('wave-in',event.at);
        $('#status').textContent=`Волна ${event.waveNumber} из ${event.waveCount}: ${event.enemies[0].type==='dragon'?'красный дракон':event.enemies.some(enemy=>enemy.type==='swordsman')?'два мечника и два лучника':event.enemies.length===2?'два лучника':event.enemies[0].type==='orc'?'орк':'один лучник'}.`;
        updateControls();
      } else if (event.type === 'end') {
        // Terminal transitions must not freeze a visible breath in place
        // while the result/auto-restart countdown is running.
        removeEffects(effect=>effect.sourceId!=='dragon'
          && (effect.type!=='spell'||effect.landed));
        pendingIceImpacts.clear();for(const actor of Object.values(actors))clearStatus(actor);
        restartRemaining=2;
        resultSummary=event.result==='victory'?`Все ${battle.getState().waveCount} волн пройдены. За бой: +${creditedRunGold} монет.`:`Герой пал. За бой сохранено: +${creditedRunGold} монет.`;
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
  function drawDragon(actor,unit,state){
    if(!dragonSprites)return;
    const pose=companion?.getPose();
    const towardWolf=state.phase==='running'&&state.enemyTargetId==='companion'
      &&unit.hp>0&&Number.isFinite(pose?.x)
      &&Math.abs(actor.x-pose.x)<Math.max(145,actor.element.offsetWidth*2.2);
    // Descend visibly BEFORE swiping, and rise back up before breathing
    // fire at the hero. These are presentation coordinates only.
    const now=companionTime;
    const elapsed=actor.diveClock===null||actor.diveClock===undefined?0:
      Math.max(0,Math.min(.1,now-actor.diveClock));
    actor.diveClock=now;
    const desired=towardWolf?1:0;
    const current=actor.dive||0;
    actor.dive=Math.max(0,Math.min(1,current+Math.sign(desired-current)
      *Math.min(Math.abs(desired-current),elapsed*(desired?1.6:1.9))));
    const hoverHeight=Math.min(60,Math.max(30,actors.hero.element.offsetWidth*.7));
    const ageOfStrike=actor.animation?.swipe?activeTime-actor.animation.at:99;
    const lunge=ageOfStrike>=0&&ageOfStrike<.66
      ?Math.max(0,Math.sin(ageOfStrike/.66*Math.PI))*9:0;
    actor.element.style.setProperty('--dragon-hover',
      `${-hoverHeight*(1-actor.dive)
        +Math.sin(now*3.1)*(actor.dive>.95?.75:2)+lunge}px`);
    actor.element.dataset.dive=actor.dive>.92?'near-wolf':
      actor.dive>.08?'descending':'high';
    const age=actor.animation?activeTime-actor.animation.at:999;
    const ended=state.phase==='defeat'||state.phase==='victory';
    const hit=activeTime-actor.hitAt<.17;
    const breathing=unit.hp>0&&!ended
      &&(state.phase==='running'||state.phase==='paused')
      &&state.enemyTargetId==='hero'
      &&Number.isFinite(actor.breathUntil)
      &&activeTime+1e-7<actor.breathUntil;
    const attack=!ended&&unit.hp>0&&age>=0&&age<(actor.animation?.duration||0);
    // Breath overrides flapping, hit reactions and the gaps between casts.
    // The dragon keeps its actual open-mouth sprite until the last fireball
    // is emitted, then resumes its normal flying pose.
    const kind=breathing?'breath':hit?'hit':attack?'attack':unit.hp>0?'fly':'idle';
    const frame=window.EmberDragon.frameAt(breathing?
      activeTime-(actor.breathStartedAt??activeTime)
      :hit?activeTime-actor.hitAt:attack?age:companionTime,
      kind,'left',reducedMotion.matches);
    actor.dragonFrame=frame;
    // Hover/dive transform is set above; never overwrite it with idle bob.
    const key=`${frame.direction}:${frame.frame}:${kind}`;
    if(actor.lastKey!==key){
      const geometry=window.EmberDragon.sheet;
      actor.canvas.width=geometry.frameWidth;actor.canvas.height=geometry.frameHeight;
      const ctx=actor.canvas.getContext('2d');
      window.EmberDragon.draw(ctx,dragonSprites,frame);
      actor.lastKey=key;
    }
    actor.element.dataset.motion=kind;
    actor.element.dataset.breathing=breathing?'true':'false';
    actor.element.dataset.facing='left';
    actor.element.classList.toggle('is-defeated',unit.hp<=0);
    actor.element.classList.toggle('is-target',unit.id===state.targetId);
    actor.element.classList.toggle('is-hit',!ended&&hit);
    actor.bar.querySelector('i').style.width=`${unit.hp/unit.maxHp*100}%`;
    actor.bar.setAttribute('aria-valuenow',unit.hp);
    actor.bar.setAttribute('aria-valuemax',unit.maxHp);
    actor.element.setAttribute('aria-label',
      `${unit.name}: ${unit.hp} из ${unit.maxHp} здоровья`);
    drawStatus(actor,unit,state);
  }
  function drawActor(id, state) {
    const actor = actors[id], unit = id === 'hero' ? state.hero : state.enemies.find(enemy=>enemy.id===id);
    if(!unit){actor.element.hidden=true;clearStatus(actor);return;}
    actor.element.hidden=false;
    if(id==='dragon'){drawDragon(actor,unit,state);return;}
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
    // LPC directions: 0=back, 1=left, 2=front, 3=right.
    // When moving toward a hero/wolf on the left, Orc must use the LEFT
    // profile (row 1), not the front-facing row 2.
    const defender=state.enemyTargetId==='companion'?companion?.getPose():null;
    const facingTargetX=defender?.x??heroX;
    const enemyFacing=['archer','swordsman'].includes(actor.type)?(facingTargetX>actor.x?3:1):descriptor.row;
    const row = walking ? (id==='hero'?walkDirection:actor.direction) : enemyFacing;
    const tile = descriptor.tile || 64, origin = descriptor.origin || 0;
    const cell = walking ? 1 + Math.floor((distance / .75 % 1) * 8) : attacking ? Math.min(descriptor.frames-1,Math.floor((age+(actor.animation?.arrowCue?1e-6:0)) / actor.animation.duration * descriptor.frames)) : Number.isInteger(descriptor.still) ? descriptor.still : id === 'hero' && auto && unit.hp > 0 && !ended && !reducedMotion.matches ? Math.floor(activeTime / .65) % 2 : 0;
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
    actor.element.setAttribute('aria-label', `${unit.name}${id === 'hero' && loadout ? `, ${starterWeapon.name}, наряд ${starterOutfit.name}, ${loadouts.color(loadout.outfitColor).name}${starterWeapon?.id==='wand'?', огонь и лёд':''}` : ''}: ${unit.hp} из ${unit.maxHp} здоровья`);
    drawStatus(actor,unit,state);
  }
  function prepareWave(state) {
    removeEffects(()=>false);
    pendingIceImpacts.clear();
    cuedArrows.clear();
    heroX=null;fieldWidth=null;walkDistance=0;walkDirection=3;moving=heroMoving=false;
    companionTime=0;companionDeathAt=null;companionHitAt=-10;
    companion?.reset();
    pairContacted=false;previousSeparation=null;contactTarget=null;previousTargetSeparation=null;
    for(const actor of Object.values(actors)){
      clearStatus(actor);actor.poseAnimation=null;actor.poseAge=100;
      actor.x=null;actor.distance=0;actor.moving=false;actor.direction=1;
      actor.depth=actor.defaultLane;
      actor.animation=null;actor.hitAt=-10;actor.blockAt=-10;actor.lastKey=null;
      if(actor.type==='dragon'){
        actor.dive=0;actor.diveClock=null;
        actor.breathStartedAt=null;actor.breathUntil=-1;
      }
    }
    beginHeroEntrance();
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
    // The second zero-dt reconciliation in advanceBattleFrame must NOT
    // erase movement flags set when the Orc physically walked this frame.
    // That erased his walk animation and made him appear to slide.
    if(dt>0){
      moving=heroMoving=false;
      for(const id of Object.keys(enemyDefinitions))actors[id].moving=false;
    }
    let usedTime=0;
    const canMove=(state.phase==='running'||(state.phase==='paused'&&state.completedWaves===state.waveIndex))&&state.hero.hp>0;
    if(heroEntrance){
      // Use battlefield-relative coordinates to keep the intro at the same
      // percentage through a rotation/resize. No CSS transform blur.
      const from=-heroSize/2; // center just outside the leftmost visible pixel
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
    // Mixed wave: both swordsmen approach the current defender, while archers stay at their spawn points.
    const swords=state.enemies.filter(unit=>unit.type==='swordsman'&&unit.hp>0);
    if(canMove&&swords.length){
      if(ranged)heroX=home;
      else if(state.targetId){
        const target=actors[state.targetId],gap=target.x-heroX-heroSize*.23-target.element.offsetWidth*.34;
        if(Math.abs(gap)>.01){
          const step=Math.sign(gap)*Math.min(Math.abs(gap),reducedMotion.matches?Math.abs(gap):heroSize*.85*dt);
          const oldDepth=actors.hero.depth;
          heroX+=step;actors.hero.depth+=(target.depth-actors.hero.depth)*Math.min(1,Math.abs(step/gap));
          if(!reducedMotion.matches){walkDistance+=Math.hypot(step,(actors.hero.depth-oldDepth)*laneStep)/heroSize;heroMoving=moving=Math.abs(step)>.001;if(heroMoving)usedTime=dt;}
          if(step)walkDirection=step>0?3:1;
        }else if(dt>0){actors.hero.depth=target.depth;}
      }
      const wolf=state.enemyTargetId==='companion',pose=wolf?companion?.getPose():null;
      const defenderX=pose?.x??(wolf?heroX-heroSize*.83:heroX),defenderDepth=pose?.depth??actors.hero.depth;
      const contact=window.EmberCompanion?.contact||{enemy:.56,companion:.18};
      for(const unit of swords){
        const enemy=actors[unit.id],size=enemy.element.offsetWidth;
        const separation=wolf?size*contact.enemy+heroSize*contact.companion:heroMeleeSeparation(state,heroSize,size);
        const side=enemy.x>=defenderX?1:-1;
        const goal=defenderX+side*separation;
        if(!wolf&&state.hero.sphere?.hp>0&&Math.abs(enemy.x-defenderX)<separation)enemy.x=goal;
        if(isFrozen(unit,state))continue;
        const gap=goal-enemy.x;
        const depthGoal=Math.max(1,Math.min(5,defenderDepth+(unit.id===state.targetId?0:.75)));
        const step=Math.sign(gap)*Math.min(Math.abs(gap),reducedMotion.matches?Math.abs(gap):size*.85*dt);
        const oldDepth=enemy.depth;
        if(Math.abs(gap)>.01){enemy.x+=step;enemy.depth+=(depthGoal-enemy.depth)*Math.min(1,Math.abs(step/gap));}
        else if(dt>0)enemy.depth=depthGoal;
        if(!reducedMotion.matches&&dt>0){enemy.distance+=Math.hypot(step,(enemy.depth-oldDepth)*laneStep)/size;enemy.moving=Math.abs(step)>.001;if(enemy.moving)usedTime=dt;}
        if(Math.abs(step)>1e-6)enemy.direction=step>0?3:1;
      }
      actors.hero.element.style.left=`${heroX}px`;
      for(const id of Object.keys(enemyDefinitions))actors[id].element.style.left=`${actors[id].x}px`;
      projectFormation();return usedTime;
    }
    // Only melee enemies chase the wolf or hero; ranged enemies fire from their positions.
    if(canMove&&ranged&&state.companion){
      const pose=state.enemyTargetId==='companion'?companion?.getPose():null;
      const defenderX=pose?.x??(state.enemyTargetId==='companion'?heroX-heroSize*.83:heroX);
      const defenderDepth=state.enemyTargetId==='companion'?(pose?.depth??actors.hero.depth):actors.hero.depth;
      heroX=home;
      for(const unit of state.enemies){
        if(unit.hp<=0)continue;
        const enemy=actors[unit.id];
        if(unit.projectile!=='melee')continue; // Archers and dragon hold their ranged positions.
        const enemySize=enemy.element.offsetWidth;
        // Exact shared stopping distance with the wolf's pursuit logic:
        // wolf.destination = enemy.x - (enemySize*.32 + wolfSize*.18).
        // Different distances make both actors endlessly walk past contact.
        const wolfContact=window.EmberCompanion?.contact||{enemy:.56,companion:.18};
        const separation=state.enemyTargetId==='companion'
          ?enemySize*wolfContact.enemy+heroSize*wolfContact.companion
          :heroMeleeSeparation(state,heroSize,enemySize);
        const goalX=defenderX+separation;
        if(state.enemyTargetId!=='companion'&&state.hero.sphere?.hp>0&&enemy.x<goalX)enemy.x=goalX;
        const gap=goalX-enemy.x;
        if(isFrozen(unit,state))continue;
        const speed=enemySize*.85;
        const distance=reducedMotion.matches?Math.abs(gap):Math.min(Math.abs(gap),speed*dt);
        const step=Math.sign(gap)*distance;
        if(Math.abs(gap)>.01){
          const oldDepth=enemy.depth;
          const fraction=Math.min(1,distance/Math.abs(gap));
          enemy.x+=step;
          enemy.depth+=(defenderDepth-enemy.depth)*fraction;
          if(!reducedMotion.matches){
            enemy.distance+=Math.hypot(distance,(enemy.depth-oldDepth)*laneStep)/enemySize;
            if(dt>0){
              enemy.moving=distance>.001&&Math.abs(goalX-enemy.x)>.01;
              if(enemy.moving)usedTime=dt;
            }
          }
          // The battle engine reconciles formation again with dt=0.
          // A zero-length step is NOT rightward movement: preserve the
          // last real heading so Orc faces its target during every walk.
          if(Math.abs(step)>1e-6)enemy.direction=step>0?3:1;
        }else{
          // Exact contact aligns their feet on the same ground lane.
          enemy.depth=defenderDepth;
        }
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
      const separation=heroMeleeSeparation(state,heroSize,enemySize);
      let gap=enemy.x-heroX-separation;
      if(gap<0||(pairContacted&&(resized||(!state.hero.sphere&&separation!==previousSeparation)))){
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
  function cueArrowShots(state){
    if(!ready||!auto||dialog.open||document.hidden||reducedMotion.matches
      ||heroEntrance||state.phase!=='running'
      ||sceneTransition&&sceneTransition.phase!=='wave-in')return;
    const shots=battle.getArrowSchedule?.()||[];
    const valid=new Set(shots.map(shot=>shot.sourceId+':'+shot.targetId+':'+shot.at.toFixed(6)));
    for(const [key,effect] of cuedArrows){
      if(valid.has(key)||activeTime+1e-6>=effect.at+effect.duration)continue;
      effect.element.remove();
      const i=effects.indexOf(effect);if(i>=0)effects.splice(i,1);
      const shooter=actors[effect.sourceId];
      if(shooter.animation?.arrowCue===key){shooter.animation=null;shooter.lastKey=null;}
      cuedArrows.delete(key);
    }
    for(const shot of shots){
      const source=actors[shot.sourceId],
        target=shot.targetId==='companion'?$('#companion-wolf'):actors[shot.targetId];
      if(!source?.images.attack||!target||!shot.animationDuration)continue;
      if(state.companion && shot.sourceId!=='hero' && source.moving)continue;
      const key=shot.sourceId+':'+shot.targetId+':'+shot.at.toFixed(6);
      if(cuedArrows.has(key))continue;
      const releaseAt=shot.at-arrowFlightDuration;
      const startAt=releaseAt-shot.animationDuration*arrowReleaseFrame/arrowPoseFrames;
      if(activeTime+1e-6<startAt||activeTime>shot.at)continue;
      source.animation={at:startAt,duration:shot.animationDuration,arrowCue:key};
      source.lastKey=null;
      const effect=addEffect('arrow',shot.sourceId,shot.targetId,null,releaseAt,
        {at:releaseAt,duration:arrowFlightDuration});
      if(effect)cuedArrows.set(key,effect);
    }
  }
  function renderEffects(state) {
    const field = battlefield.getBoundingClientRect();
    for (let i=effects.length-1;i>=0;i--) {
      const effect = effects[i], age = activeTime - effect.at;
      // Each dragon orb is finite, removed on impact or immediately on
      // source death, and never survives result screens or wave transitions.
      if(effect.dragonVolley){
        const alive=state.phase==='running'
          &&state.enemies.some(unit=>unit.id==='dragon'&&unit.hp>0);
        if(!alive){effect.element.remove();effects.splice(i,1);continue;}
      }
      if (age+1e-6 >= effect.duration || reducedMotion.matches) { effect.element.remove(); effects.splice(i,1); continue; }
      if(effect.type==='mage-advanced'){
        const actor=actors[effect.targetId]?.element;if(!actor){effect.element.remove();effects.splice(i,1);continue;}
        const bounds=actor.getBoundingClientRect();
        let frame=Math.min(5,Math.max(0,Math.floor(age/effect.duration*6)));
        if(effect.resonance){
          // Align with the projectile origin at the tip of the Mage's weapon.
          // Frame 2 is the primary release, frame 3 the actual echo release.
          const release=effect.releaseAt-effect.at,echo=effect.echoReleaseAt-effect.at;
          frame=age+1e-6<release?(age<release/2?0:1):age+1e-6<echo?2:3+Math.min(2,Math.max(0,Math.floor((age-echo+1e-6)/.14)));
          effect.element.style.left=(bounds.left+bounds.width*.88-field.left)+'px';
          effect.element.style.top=(bounds.top+bounds.height*.67-field.top)+'px';
          effect.element.style.width=effect.element.style.height=(bounds.width*1.65)+'px';
        }else{
          effect.element.style.left=(bounds.left+bounds.width/2-field.left)+'px';effect.element.style.top=(bounds.top+bounds.height/2-field.top)+'px';
          effect.element.style.width=effect.element.style.height=(bounds.width*(effect.row===2?2.7:1.9))+'px';
        }
        effect.element.dataset.frame=String(frame);
        if(effect.lastKey!==frame){const ctx=effect.element.getContext('2d');ctx.clearRect(0,0,mageEffectTile,mageEffectTile);ctx.imageSmoothingEnabled=false;ctx.drawImage(mageEffects.advanced[effect.row],frame*mageEffectTile,0,mageEffectTile,mageEffectTile,0,0,mageEffectTile,mageEffectTile);effect.lastKey=frame;}
        continue;
      }
      if(effect.type==='barrier-impact'){
        const frame=Math.min(5,Math.max(0,Math.floor(age/.06))),row=effect.kind==='arrow'?0:1;
        effect.element.dataset.frame=String(frame);
        if(effect.lastKey!==frame){const ctx=effect.element.getContext('2d');ctx.clearRect(0,0,64,64);ctx.imageSmoothingEnabled=false;ctx.drawImage(mageEffects.impact,frame*64,row*64,64,64,0,0,64,64);effect.lastKey=frame;}
        continue;
      }
      if(effect.echo){effect.element.hidden=age<0;effect.element.style.visibility=age<0?'hidden':'visible';if(age<0)continue;}
      if(effect.type==='arrow'&&age<0){effect.element.hidden=true;effect.element.style.visibility='hidden';continue;}
      if(effect.type==='arrow'){effect.element.hidden=false;effect.element.style.visibility='visible';}
      const sourceElement=effect.sourceId==='companion'?$('#companion-wolf'):actors[effect.sourceId]?.element;
      const targetElement=effect.targetId==='companion'?$('#companion-wolf'):actors[effect.targetId]?.element;
      if(!sourceElement||!targetElement){effect.element.remove();effects.splice(i,1);continue;}
      const target = targetElement.getBoundingClientRect(), source = sourceElement.getBoundingClientRect();
      const p = Math.max(0,age/effect.duration), tx=target.left+target.width/2-field.left, ty=target.top+target.height*.4-field.top;
      if (effect.type === 'spell') {
        const phase=effect.landed?'impact':age+1e-6<effect.appearDuration?'appear':'flight';
        const row=phase==='appear'?0:phase==='flight'?1:2;
        const phaseAge=Math.max(0,phase==='appear'?age:phase==='flight'?age-effect.appearDuration:activeTime-effect.impactAt);
        const phaseDuration=phase==='appear'?effect.appearDuration:phase==='flight'?effect.flightDuration:effect.impactDuration;
        const cell=phase==='flight'?Math.floor((phaseAge+1e-6)/(phaseDuration/6))%6:Math.min(5,Math.floor((phaseAge+1e-6)/(phaseDuration/6)));
        let sx=source.left+source.width*(effect.sourceId==='hero'?.88:.28)-field.left;
        let sy=source.top+source.height*(effect.sourceId==='hero'?.67:.53)-field.top;
        if(effect.dragonVolley){
          // Snapshot muzzle position ONCE at this shot's launch. Never
          // tether its trajectory to later wing/head frames.
          if(!effect.mouthOrigin){
            const dragon=actors.dragon;
            if(!dragon?.canvas||!dragon.dragonFrame){
              effect.element.remove();effects.splice(i,1);continue;
            }
            const mouth=window.EmberDragon.mouthAt(
              dragon.canvas.getBoundingClientRect(),dragon.dragonFrame);
            effect.mouthOrigin={x:mouth.x-field.left,y:mouth.y-field.top};
            effect.element.dataset.muzzleX=String(effect.mouthOrigin.x);
            effect.element.dataset.muzzleY=String(effect.mouthOrigin.y);
          }
          sx=effect.mouthOrigin.x;sy=effect.mouthOrigin.y;
        }
        const barrier=aimAtBarrier(effect,state,target,field,sx,sy);
        const hitX=barrier?.x??tx,hitY=barrier?.y??(target.top+target.height*.55-field.top);
        const progress=phase==='appear'?0:phase==='impact'?1:Math.min(1,phaseAge/effect.flightDuration);
        if(phase!=='impact'||effect.angle===null)effect.angle=Math.atan2(hitY-sy,hitX-sx)*180/Math.PI+180;
        effect.element.style.left=`${sx+(hitX-sx)*progress}px`;
        effect.element.style.top=`${sy+(hitY-sy)*progress}px`;
        effect.element.style.transform=`translate(-25%,-50%) rotate(${effect.angle}deg)`;
        effect.element.dataset.phase=phase;
        const key=`${row}:${cell}`;
        if(effect.lastKey!==key){
          const ctx=effect.element.getContext('2d');ctx.clearRect(0,0,64,64);ctx.imageSmoothingEnabled=false;
          if(effect.shards){const f=phase==='appear'?Math.min(1,cell):phase==='flight'?2+cell%3:5+Math.min(2,Math.floor(cell/2));ctx.drawImage(effect.image,f*32,0,32,32,0,0,64,64);effect.element.style.transform=`translate(-50%,-50%) rotate(${effect.angle-180}deg)`;}else ctx.drawImage(effect.image,cell*64,row*64,64,64,0,0,64,64);effect.lastKey=key;
        }
      } else if (effect.floating) {
        effect.element.style.left = `${tx}px`; effect.element.style.top = `${ty-p*22}px`; effect.element.style.opacity = String(1-p);
      } else {
        const sx=source.left+source.width*(effect.sourceId==='hero'?.7:.3)-field.left, sy=source.top+source.height*.45-field.top;
        const barrier=effect.type==='arrow'?aimAtBarrier(effect,state,target,field,sx,sy):null;
        const hitX=barrier?.x??tx,hitY=barrier?.y??ty;
        if(effect.type==='arrow'){
          const angle=Math.atan2(hitY-sy,hitX-sx)*180/Math.PI+180;
          effect.element.style.transform=`translate(-50%,-50%) rotate(${angle}deg)`;
        }
        effect.element.style.left = `${sx+(hitX-sx)*p}px`; effect.element.style.top = `${sy+(hitY-sy)*p}px`;
      }
    }
  }
  function renderMageSphere(state){
    const sphere=state.hero.sphere;
    const age=sphere?.brokenAt==null?0:Math.max(0,state.elapsed-sphere.brokenAt);
    const ended=['victory','defeat'].includes(state.phase);
    // Battle time drives all atlas animation, including damage feedback.
    // Do not show a fresh or previously broken sphere on the result screen.
    const visible=Boolean(mageEffects.sphere&&sphere&&!ended&&
      (sphere.hp>0||sphere.brokenAt!==null&&age<sphereBreakDuration&&!reducedMotion.matches));
    if(!visible){if(sphereCanvas)sphereCanvas.remove();sphereCanvas=null;sphereDrawKey=null;return;}
    if(!sphereCanvas){
      sphereCanvas=document.createElement('canvas');sphereCanvas.width=sphereTile;sphereCanvas.height=sphereTile;
      sphereCanvas.className='mage-sphere';actors.hero.element.appendChild(sphereCanvas);
    }
    const fraction=sphere.hp/sphere.maxHp,pulse=reducedMotion.matches?0:Math.floor(state.elapsed*7)%4;
    const frame=sphere.hp<=0?8+Math.min(3,Math.floor(age/.14)):fraction>.5?pulse:fraction>.25?4+pulse%2:6+pulse%2;
    const hitAge=state.elapsed-sphereHitAt;
    const hitFrame=sphere.hp>0&&!reducedMotion.matches&&hitAge>=-1e-7&&hitAge<.32?
      12+Math.min(3,Math.floor(Math.max(0,hitAge)/.08)):-1;
    sphereCanvas.dataset.frame=String(frame);sphereCanvas.dataset.hitFrame=String(hitFrame);
    sphereCanvas.dataset.hp=String(sphere.hp);sphereCanvas.dataset.maxHp=String(sphere.maxHp);
    sphereCanvas.setAttribute('aria-label',`Прочность сферы: ${sphere.hp} из ${sphere.maxHp}`);
    const key=frame+':'+hitFrame;
    if(sphereDrawKey!==key){
      const ctx=sphereCanvas.getContext('2d');ctx.clearRect(0,0,sphereTile,sphereTile);ctx.imageSmoothingEnabled=false;
      ctx.drawImage(mageEffects.sphere,frame*sphereTile,0,sphereTile,sphereTile,0,0,sphereTile,sphereTile);
      if(hitFrame>=0)ctx.drawImage(mageEffects.sphere,hitFrame*sphereTile,0,sphereTile,sphereTile,0,0,sphereTile,sphereTile);
      sphereDrawKey=key;
    }
    sphereCanvas.style.opacity='1';
    actors.hero.element.style.setProperty('--sphere-hp',String(fraction));
  }
  function render(state) {
    renderSceneTransition(state);
    if(sceneTransition?.phase==='wave-out'||sceneTransition?.phase==='victory'){
      companion?.followExit({
        heroX:heroX??0,heroDepth:actors.hero.depth
      });
    }
    cueArrowShots(state);
    for (const id of Object.keys(actors)) drawActor(id,state);
    renderMageSphere(state);
    const wolfFallen=state.companion?.hp===0&&companionDeathAt!==null;
    const wolfDefeatedWithHero=state.phase==='defeat'&&state.companion?.hp>0;
    companion?.render({
      time:companionTime,x:heroX??0,heroSize:actors.hero.element.offsetWidth,
      depth:actors.hero.depth,laneStep,
      moving:heroMoving,
      direction:walkDirection,
      action:wolfFallen||wolfDefeatedWithHero?'die':null,
      actionAge:wolfFallen?Math.max(0,companionTime-companionDeathAt)
        :sceneTransition?.phase==='defeat'?Math.max(0,activeTime-sceneTransition.at):0,
      reducedMotion:reducedMotion.matches,
      alive:state.hero.hp>0&&Boolean(state.companion?.hp>0)
    });
    const wolfElement=$('#companion-wolf');
    if(wolfElement){
      wolfElement.classList.toggle('is-hit',companionTime-companionHitAt<.16);
      if(state.companion){
        const bar=$('#companion-health-fill');
        if(bar)bar.style.width=`${state.companion.hp/state.companion.maxHp*100}%`;
        wolfElement.setAttribute('aria-label',`Боевой волк: ${state.companion.hp} из ${state.companion.maxHp} HP`);
      }
    }
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
    const enemyReach=(id,x)=>Math.abs(x-heroX)<=heroMeleeSeparation(state,heroSize,actors[id].element.offsetWidth)+.01&&Math.abs(actors[id].depth-actors.hero.depth)<=1e-4;
    const target=state.targetId;
    const wolfBattle=Boolean(state.companion);
    const pose=state.enemyTargetId==='companion'?companion?.getPose():null;
    const defenderX=state.enemyTargetId==='companion'?pose?.x??heroX-heroSize*.83:heroX;
    const defenderDepth=state.enemyTargetId==='companion'?pose?.depth??actors.hero.depth:actors.hero.depth;
    const enemyCanAttack=Object.fromEntries(state.enemies.map(enemy=>{
      const actor=actors[enemy.id],size=actor.element.offsetWidth;
      const wolfContact=window.EmberCompanion?.contact||{enemy:.56,companion:.18};
      const reach=state.enemyTargetId==='companion'
        ?size*wolfContact.enemy+heroSize*wolfContact.companion+.01
        :heroMeleeSeparation(state,heroSize,size)+.01;
      if(enemy.projectile==='arrow'||(!wolfBattle&&enemy.type!=='swordsman'))return [enemy.id,enemy.hp>0];
      return [enemy.id,Boolean(enemy.hp>0
        &&(enemy.type==='dragon'&&state.enemyTargetId==='hero'
          ||Math.abs(actor.x-defenderX)<=reach)
        &&Math.abs(actor.depth-defenderDepth)<=(enemy.type==='swordsman'?.76:.06)
        &&(enemy.type!=='dragon'||state.enemyTargetId==='hero'
          ||(actor.dive||0)>=.92))];
    }));
    return {
      nearbyEnemies:Object.fromEntries(state.enemies.map(a=>[a.id,state.enemies.filter(b=>b.id!==a.id&&Math.hypot(actors[a.id].x-actors[b.id].x,(actors[a.id].depth-actors[b.id].depth)*laneStep)<=heroSize*1.6).sort((b,c)=>Math.hypot(actors[a.id].x-actors[b.id].x,(actors[a.id].depth-actors[b.id].depth)*laneStep)-Math.hypot(actors[a.id].x-actors[c.id].x,(actors[a.id].depth-actors[c.id].depth)*laneStep)).map(b=>b.id)])),
      heroCanAttack:Boolean(target && (ranged || inReach(target,actors[target].x))),
      heroCloseRange:Boolean(target && inReach(target,actors[target].x)),
      orcCanAttack:wolfBattle?Boolean(enemyCanAttack.orc):
        state.enemies.some(enemy=>enemy.type==='orc'&&enemy.hp>0) && enemyReach('orc',actors.orc.x),
      immediateOrcContact:true,
      enemyCanAttack,
      // A second enemy may act on the same combat tick that the first
      // kills the wolf. It must not strike the hero from the wolf's location.
      enemyCanAttackHero:wolfBattle?Object.fromEntries(state.enemies.map(enemy=>{
        const actor=actors[enemy.id],size=actor.element.offsetWidth;
        const reach=heroMeleeSeparation(state,heroSize,size)+.01;
        if(enemy.projectile==='arrow')return [enemy.id,enemy.hp>0];
        return [enemy.id,Boolean(enemy.hp>0
          &&(enemy.type==='dragon'||Math.abs(actor.x-heroX)<=reach)
          &&Math.abs(actor.depth-actors.hero.depth)<=(enemy.type==='swordsman'?.76:.06)
          &&(enemy.type!=='dragon'||(actor.dive||0)<=.08))];
      })):undefined
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
  function updateCompanionCombat(dt) {
    if(!companion)return;
    const state=battle.getState();
    const target=state.targetId&&actors[state.targetId];
    const unit=state.enemies.find(enemy=>enemy.id===state.targetId);
    const bite=companion.advance({
      dt,time:companionTime,phase:state.phase,
      entering:Boolean(heroEntrance),
      exiting:sceneTransition?.phase==='wave-out'||sceneTransition?.phase==='victory',
      heroAlive:state.hero.hp>0,
      companionAlive:Boolean(state.companion?.hp>0),
      heroX:heroX??0,
      // Resting point must never follow the hero's wave-exit movement.
      anchorX:battlefield.clientWidth*(window.innerWidth>700?.18:.22),
      heroSize:actors.hero.element.offsetWidth,
      heroDepth:actors.hero.depth,reducedMotion:reducedMotion.matches,
      target:target&&unit?{id:unit.id,x:target.x,width:target.element.offsetWidth,
        depth:target.depth,hp:unit.hp}:null
    });
    // This hit is confirmed by the combat engine, which owns HP, death
    // rewards, wave transitions and victory. No Archer shot is delayed.
    if(bite){
      const events=battle.companionStrike?.(bite.targetId,bite.damage)||[];
      handleEvents(events);
    }
  }
  function tick(timestamp) {
    if(lastFrameTime===null)lastFrameTime=timestamp;
    const dt=Math.min(.1,Math.max(0,(timestamp-lastFrameTime)/1000));lastFrameTime=timestamp;
    if(ready&&auto&&!document.hidden&&!dialog.open){
      // Advance visuals even while the combat simulation is held for entry.
      // Freeze this clock whenever automatic play, visibility or a modal
      // pauses the game, so bites remain synced to their actual frames.
      companionTime+=dt;
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
      updateCompanionCombat(dt);
    }
    if(ready)render(battle.getState());
    window.requestAnimationFrame(tick);
  }
  function restartBattle(startAuto) {
    battle.restart();talentUI?.render();if(startAuto)auto=true;
    activeTime=0;sphereHitAt=-Infinity;sphereDrawKey=null;restartRemaining=null;resultSummary='';paidDeaths.clear();creditedRunGold=0;
    clearSceneTransition();
    prepareWave(battle.getState());
    resultPanel.hidden=true;lastFrameTime=null;
    if(startAuto)try{localStorage.setItem('ember.combat.auto.v1','on');}catch{}
    render(battle.getState());syncPause();$('#status').textContent='Битва 1–1. Волна 1: один лучник.';
  }
  $('#replay-button').addEventListener('click',()=>{
    if(assetError){resultPanel.hidden=true;loadAssets();return;}
    restartBattle(true);
  });
  const information = {
    gold: () => ['КОШЕЛЁК','Золото',`В кошельке ${wallet} золота. За каждого врага — 5 монет, за все ${battle.getState().waveCount} волны — ${battle.getState().totalEnemies*5}. Монеты сохраняются и при поражении. Сохранение — на этом устройстве.`],
    crystals: () => ['КОШЕЛЁК','Кристаллы','Редкие кристаллы для особых находок. Их история начнётся в следующих главах.'],
    rewards: () => ['НАГРАДЫ','Трофеи первого боя',`За каждого из ${battle.getState().totalEnemies} врагов — 5 монет. Полный проход приносит ${battle.getState().totalEnemies*5} монет; бонуса за победу нет. Сейчас в кошельке: ${wallet}.`],
    map: () => ['ГЛАВА I','Забытый лес',`Битва 1–1: один лучник, два мечника и два лучника, орк${dragonBoss?', затем красный дракон':''}. После победы или поражения бой начинается заново автоматически.`],
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
  $('#profile-button').addEventListener('click', () => openInfo('ТВОЙ ГЕРОЙ',name,`Уровень ${level} · Сила ${battle.getState().hero.damage} · ${skinNames[skinIds.indexOf(skin)]} оттенок кожи. ${loadout ? `${starterWeapon.name} · наряд «${starterOutfit.name}», ${loadouts.color(loadout.outfitColor).name.toLowerCase()} цвет.${starterWeapon?.id==='wand'?' Магия: огонь и лёд.':''}` : 'Без класса, брони и оружия.'} Максимум здоровья: ${battle.getState().hero.maxHp}.`,true));
  document.querySelectorAll('[data-info]').forEach(button=>button.addEventListener('click',()=>openInfo(...information[button.dataset.info]())));
  dialog.querySelectorAll('.dialog-close,.dialog-action').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  dialog.addEventListener('close',syncPause);
  dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  loadAssets(); window.requestAnimationFrame(tick);
})();
