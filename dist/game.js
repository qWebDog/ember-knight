(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const skinIds = ['light','amber','olive','bronze','brown','black'];
  const skinNames = ['Светлый','Тёплый','Оливковый','Бронзовый','Смуглый','Тёмный'];
  const telegram = window.Telegram?.WebApp;
  const arena = $('.adventure'), battlefield = $('.battlefield'), dialog = $('#game-dialog');
  const autoButton = $('#auto-button'), resultPanel = $('#battle-result');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let character = null, auto = true, wallet = 0;
  try {
    const saved = JSON.parse(localStorage.getItem('ember.character.v1'));
    if (saved?.version === 1 && skinIds.includes(saved.skin)) character = saved;
    auto = localStorage.getItem('ember.combat.auto.v1') !== 'off';
    const coins = Number(localStorage.getItem('ember.test.gold.v1'));
    if (Number.isSafeInteger(coins) && coins >= 0) wallet = Math.min(coins,999999999);
  } catch {}
  if (new URLSearchParams(window.location.search).get('battle') === 'test') auto = true;
  const loadouts = window.EmberLoadouts;
  const arrowSprite = 'assets/projectiles/arrow.png';
  const loadout = loadouts?.selection(character) || null;
  const starterWeapon = loadout ? loadouts.weapon(loadout.weapon) : null;
  const starterOutfit = loadout ? loadouts.outfit(loadout.weapon,loadout.outfit) : null;
  const heroMagic = loadouts?.magicSelection(character);
  const ranged = starterWeapon && starterWeapon.projectile !== 'melee';
  const skin = character?.skin || 'light';
  const name = typeof character?.name === 'string' && character.name.trim() ? character.name.slice(0,24) : 'Странник';
  const level = Number.isInteger(character?.level) ? Math.max(1,Math.min(99,character.level)) : 1;
  $('#player-name').textContent = name;
  $('.fighter-name').textContent = name;
  $('#level-badge').textContent = level;
  const battle = window.EmberCombat.createBattle({heroName:name,heroProjectile:starterWeapon?.projectile,heroWeapon:starterWeapon?.id,heroMagic});
  battle.pause();
  let ready = false, assetError = false, lastFrameTime = null, restartRemaining = null, resultSummary = '';
  const paidDeaths = new Set();
  const enemyDefinitions = {
    archer1:{type:'archer',spawn:.62,label:'Лучник'},
    archer2:{type:'archer',spawn:.61,label:'Лучник I'},
    archer3:{type:'archer',spawn:.80,label:'Лучник II'},
    orc:{type:'orc',spawn:.65,label:'Орк'}
  };
  const actors = {};
  for (const id of ['hero',...Object.keys(enemyDefinitions)]) {
    const element = document.querySelector(`[data-fighter="${id}"]`);
    actors[id] = {element, canvas:element.querySelector('canvas'), bar:element.querySelector('.healthbar'), images:{}, animation:null, hitAt:-10, blockAt:-10, lastKey:null,...enemyDefinitions[id],x:null,distance:0,direction:1,moving:false};
  }
  const effects = [];
  const spellImages = {};
  let heroX = null, fieldWidth = null, moving = false, heroMoving = false;
  let walkDistance = 0, walkDirection = 3, activeTime = 0;
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
  function alignTerrain() {
    const bounds = arena.getBoundingClientRect(), fighter = actors.hero.element.getBoundingClientRect();
    const feet = fighter.bottom - bounds.top - fighter.height * 2 / 64;
    const scale = Math.max(bounds.width / 900, feet / 330, (bounds.height - feet) / 150);
    const art = $('.battle-landscape');
    art.style.backgroundSize = `${900 * scale}px ${480 * scale}px`;
    art.style.backgroundPosition = `center ${feet - 330 * scale}px`;
    updateMovement(0,battle.getState());
  }
  new ResizeObserver(alignTerrain).observe(arena);
  alignTerrain();
  function updateWallet() {
    $('.gold strong').textContent = wallet >= 10000 ? `${Math.floor(wallet/1000)}k` : wallet;
    $('.gold').setAttribute('aria-label', `Золото: ${wallet}`);
  }
  updateWallet();
  function loadImage(path) {
    return new Promise((resolve,reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(path)); image.src = path; });
  }
  async function loadAssets() {
    ready = false; assetError = false; updateControls();
    try {
      let idle;
      if (loadout) {
        const walk = await loadImage(loadouts.path(loadout,skin,'walk'));
        const attack = await loadImage(loadouts.path(loadout,skin,'attack'));
        idle = walk;
        actors.hero.images.idle = {image:walk,row:3,still:0,...starterWeapon.walk};
        actors.hero.images.walk = {image:walk,row:3,...starterWeapon.walk};
        actors.hero.images.attack = {image:attack,row:3,...starterWeapon.attack};
        if (starterWeapon.attacks) {
          const variants = await Promise.all(Object.entries(starterWeapon.attacks).map(async ([variant,geometry]) => {
            const image = variant === 'slash' ? attack : await loadImage(loadouts.path(loadout,skin,variant));
            return [variant,{image,row:3,...geometry}];
          }));
          actors.hero.images.attacks = Object.fromEntries(variants);
        }
        if (starterWeapon.block) {
          const block = await loadImage(loadouts.path(loadout,skin,'block'));
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
      const [orcAttack] = await Promise.all([
        loadImage('assets/enemies/lpc/orc-attack.png').catch(() => null),
        loadImage(arrowSprite),
        ...['fire','ice','shadow'].map(async magic=>{spellImages[magic]=await loadImage(`assets/magic/${magic}.png`);})
      ]);
      actors.orc.images.attack = orcAttack ? {image:orcAttack,frames:6,row:1,tile:128,origin:32} : { ...actors.orc.images.idle,frames:1 };
      const face = $('#avatar').getContext('2d'); face.imageSmoothingEnabled = false;
      const avatarTile=loadout?starterWeapon.walk.tile:64, avatarOrigin=loadout?starterWeapon.walk.origin:0;
      face.drawImage(idle,avatarOrigin+19,avatarTile*2+avatarOrigin+12,26,26,0,0,32,32);
      ready = true;
      updateMovement(0,battle.getState());
      $('#status').textContent = 'Бой готов: один лучник, два лучника, затем орк.';
      render(battle.getState()); syncPause();
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
    $('#battle-state').textContent = !ready ? assetError ? 'Ошибка загрузки' : 'Загрузка боя' : !auto ? 'Пауза' : state.phase === 'victory' ? 'Победа · 3/3' : state.phase === 'defeat' ? 'Новый заход' : state.phase==='intermission' ? 'Следующая волна…' : moving ? 'Подход к цели' : `Волна ${state.waveNumber}/${state.waveCount}`;
    if(ended) updateCountdown();
  }
  function updateCountdown() {
    if(restartRemaining===null)return;
    $('#result-copy').textContent=`${resultSummary} ${auto ? `Новый бой через ${Math.max(1,Math.ceil(restartRemaining))} с.` : 'Автоповтор на паузе.'}`;
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
  function handleEvents(events) {
    for (const event of events) {
      if (event.type === 'cast') {
        actors[event.sourceId].animation={at:event.at,duration:.66};
        addSpell(event);
      } else if (event.type === 'attack') {
        if (!event.impact) actors[event.sourceId].animation = {at:activeTime,duration:event.animationDuration || (event.projectile === 'arrow' ? .9 : .66),variant:event.variant,heavy:event.heavy,counter:event.counter};
        if (event.impact) {
          const spell=effects.find(effect=>effect.type==='spell'&&effect.castId===event.castId);
          if(spell){spell.landed=true;spell.impactAt=event.at;spell.duration=event.at-spell.at+spell.impactDuration;}
        }
        actors[event.targetId].hitAt = activeTime;
        addEffect(event.counter ? 'counter' : event.heavy ? 'heavy' : 'damage',event.sourceId,event.targetId,event.counter ? `Ответ −${event.damage}` : `−${event.damage}`,event.at);
        if (event.projectile === 'arrow') addEffect('arrow',event.sourceId,event.targetId,null,event.at);
      } else if (event.type === 'block') {
        actors.hero.blockAt = activeTime;
        // The real LPC guard pose interrupts the swing; the following counter
        // starts its own animation instead of resuming a stale attack frame.
        actors.hero.animation = null;
        addEffect('block',event.sourceId,'hero','Блок',event.at);
      } else if (event.type === 'death') {
        removeEffects(effect=>effect.type!=='spell'||effect.targetId!==event.id||effect.landed);
        if(event.id!=='hero'&&event.reward>0&&!paidDeaths.has(event.id)){
          paidDeaths.add(event.id);wallet=Math.min(999999999,wallet+event.reward);updateWallet();
          try{localStorage.setItem('ember.test.gold.v1',String(wallet));}catch{}
          addEffect('coin','hero',event.id,`+${event.reward}`,event.at);
        }
        $('#status').textContent = event.id === 'hero' ? 'Герой пал. Монеты за побеждённых врагов сохранены.' : `${actors[event.id].label} побеждён. +${event.reward} монет.`;
      } else if(event.type==='wave_clear'){
        removeEffects(effect=>effect.type!=='spell'||effect.landed);
        $('#status').textContent=`Волна ${event.waveNumber} пройдена.`;
        updateControls();
      } else if(event.type==='wave'){
        prepareWave(battle.getState());
        $('#status').textContent=`Волна ${event.waveNumber} из ${event.waveCount}: ${event.enemies.length===2?'два лучника':event.enemies[0].type==='orc'?'орк':'один лучник'}.`;
        updateControls();
      } else if (event.type === 'end') {
        restartRemaining=2;
        resultSummary=event.result==='victory'?`Все три волны пройдены. За бой: +${event.totalReward} монет.`:`Герой пал. За бой сохранено: +${event.totalReward} монет.`;
        $('#result-title').textContent = event.result === 'victory' ? 'Победа!' : 'Новый заход';
        $('#replay-button').textContent = 'Начать сейчас'; resultPanel.hidden = false;
        $('#status').textContent = event.result === 'victory' ? `Победа. Следующий бой начнётся автоматически. Получено ${event.totalReward} монет.` : 'Герой восстановится и начнёт бой заново. Заработанные монеты сохранены.';
        try { telegram?.HapticFeedback?.notificationOccurred(event.result === 'victory' ? 'success' : 'warning'); } catch {}
        removeEffects(effect=>effect.type!=='spell'||effect.landed);
        updateControls();
      }
    }
  }
  function drawActor(id, state) {
    const actor = actors[id], unit = id === 'hero' ? state.hero : state.enemies.find(enemy=>enemy.id===id);
    if(!unit){actor.element.hidden=true;return;}
    actor.element.hidden=false;
    if (!actor.images.idle) return;
    const age = actor.animation ? activeTime - actor.animation.at : 100;
    const ended = ['victory','defeat'].includes(state.phase);
    const distance = id === 'hero' ? walkDistance : actor.distance;
    const walking = (id==='hero'?heroMoving:actor.moving) && distance > 0 && unit.hp > 0 && !ended && !reducedMotion.matches && actor.images.walk?.frames > 1;
    const blocking = !walking && !ended && unit.hp > 0 && !reducedMotion.matches && actor.images.block && activeTime - actor.blockAt < .28;
    const attacking = !walking && !blocking && !ended && age >= 0 && age < (actor.animation?.duration || 0) && unit.hp > 0 && !reducedMotion.matches;
    const kind = walking ? 'walk' : blocking ? 'block' : attacking ? 'attack' : 'idle';
    const descriptor = attacking && actor.images.attacks?.[actor.animation.variant] || actor.images[kind];
    const row = walking ? id === 'hero' ? walkDirection : actor.direction : descriptor.row;
    const tile = descriptor.tile || 64, origin = descriptor.origin || 0;
    const cell = walking ? 1 + Math.floor((distance / .75 % 1) * 8) : attacking ? Math.min(descriptor.frames-1,Math.floor(age / actor.animation.duration * descriptor.frames)) : Number.isInteger(descriptor.still) ? descriptor.still : id === 'hero' && auto && unit.hp > 0 && !ended && !reducedMotion.matches ? Math.floor(activeTime / .65) % 2 : 0;
    const key = `${kind}-${descriptor.image.src}-${cell}-${row}-${tile}-${origin}`;
    if (actor.lastKey !== key) {
      actor.canvas.width = tile; actor.canvas.height = tile;
      const ctx = actor.canvas.getContext('2d'); ctx.clearRect(0,0,tile,tile); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(descriptor.image,cell*tile,row*tile,tile,tile,0,0,tile,tile); actor.lastKey = key;
      actor.canvas.style.width = `${tile / 64 * 100}%`; actor.canvas.style.height = `${tile / 64 * 100}%`;
      actor.canvas.style.left = `${-origin / 64 * 100}%`; actor.canvas.style.top = `${-origin / 64 * 100}%`;
    }
    actor.element.dataset.motion = kind;
    actor.element.dataset.attack = attacking ? actor.animation.variant || 'basic' : '';
    actor.element.dataset.counter = String(Boolean(attacking && actor.animation.counter));
    actor.element.classList.toggle('is-heavy',Boolean(attacking && actor.animation.heavy));
    actor.element.classList.toggle('is-blocking',Boolean(blocking));
    actor.element.classList.toggle('is-defeated',unit.hp <= 0);
    actor.element.classList.toggle('is-target',id === state.targetId);
    actor.element.classList.toggle('is-hit',!ended && !reducedMotion.matches && activeTime - actor.hitAt < .16);
    actor.bar.querySelector('i').style.width = `${unit.hp / unit.maxHp * 100}%`;
    actor.bar.setAttribute('aria-valuenow',unit.hp);
    actor.bar.setAttribute('aria-valuemax',unit.maxHp);
    actor.element.setAttribute('aria-label', `${unit.name}${id === 'hero' && loadout ? `, ${starterWeapon.name}, наряд ${starterOutfit.name}, ${loadouts.color(loadout.outfitColor).name}${heroMagic?`, магия ${loadouts.magic(heroMagic).name}`:''}` : ''}: ${unit.hp} из ${unit.maxHp} здоровья`);
  }
  function prepareWave(state) {
    removeEffects(()=>false);
    heroX=null;fieldWidth=null;walkDistance=0;walkDirection=3;moving=heroMoving=false;
    pairContacted=false;previousSeparation=null;contactTarget=null;previousTargetSeparation=null;
    for(const actor of Object.values(actors)){
      actor.x=null;actor.distance=0;actor.moving=false;actor.direction=1;
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
        const heroSpeed=ranged?0:heroSize*.85,enemySpeed=enemySize*.85,closingSpeed=heroSpeed+enemySpeed;
        usedTime=reducedMotion.matches?0:Math.min(dt,gap/closingSpeed);
        const time=reducedMotion.matches?gap/closingSpeed:usedTime;
        const heroStep=heroSpeed*time,enemyStep=enemySpeed*time;
        heroX+=heroStep;enemy.x-=enemyStep;
        if(!reducedMotion.matches){walkDistance+=heroStep/heroSize;enemy.distance+=enemyStep/enemySize;}
        walkDirection=3;enemy.direction=1;
        moving=enemy.x-heroX-separation>.01;heroMoving=moving&&heroSpeed>0;enemy.moving=moving;
      }
      if(!moving)pairContacted=true;
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
          heroX+=Math.sign(gap)*distance;
          if(!reducedMotion.matches)walkDistance+=distance/heroSize;
          usedTime=reducedMotion.matches?0:distance/speed;
          moving=heroMoving=!reducedMotion.matches&&Math.abs(goal-heroX)>.01;
        }
        if(!moving)contactTarget=state.targetId;
      }
    }
    actors.hero.element.style.left=`${heroX}px`;
    for(const id of Object.keys(enemyDefinitions))actors[id].element.style.left=`${actors[id].x}px`;
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
    const inReach=(id,x)=>Math.abs(x-heroX)<=heroSize*.23+actors[id].element.offsetWidth*.34+.01;
    const target=state.targetId;
    return {
      heroCanAttack:Boolean(target && (ranged || inReach(target,actors[target].x))),
      orcCanAttack:state.enemies.some(enemy=>enemy.type==='orc'&&enemy.hp>0) && inReach('orc',actors.orc.x)
    };
  }
  function tick(timestamp) {
    if(lastFrameTime===null)lastFrameTime=timestamp;
    const dt=Math.min(.1,Math.max(0,(timestamp-lastFrameTime)/1000));lastFrameTime=timestamp;
    if(ready&&auto&&!document.hidden&&!dialog.open){
      const before=battle.getState();
      activeTime+=dt;
      if(['victory','defeat'].includes(before.phase)){
        if(restartRemaining!==null){
          restartRemaining=Math.max(0,restartRemaining-dt);
          if(restartRemaining<=1e-6)restartBattle(false);else updateCountdown();
        }
      }else{
        const wasMoving=moving;
        if(before.phase==='intermission'){
          handleEvents(battle.advance(dt,{heroCanAttack:Boolean(ranged),orcCanAttack:false}));
        }else{
          const beforeRange=attackAvailability(before);
          const walkTime=updateMovement(dt,before);
          battle.resume();
          if(walkTime>0)handleEvents(battle.advance(walkTime,beforeRange));
          if(dt>walkTime)handleEvents(battle.advance(dt-walkTime,attackAvailability(battle.getState())));
        }
        const after=battle.getState();
        updateMovement(0,after);
        if(moving!==wasMoving||after.phase!==before.phase)updateControls();
      }
    }
    if(ready)render(battle.getState());
    window.requestAnimationFrame(tick);
  }
  function restartBattle(startAuto) {
    battle.restart();if(startAuto)auto=true;
    activeTime=0;restartRemaining=null;resultSummary='';paidDeaths.clear();
    prepareWave(battle.getState());resultPanel.hidden=true;lastFrameTime=null;
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
  $('#profile-button').addEventListener('click', () => openInfo('ТВОЙ ГЕРОЙ',name,`Уровень ${level} · Сила 12 · ${skinNames[skinIds.indexOf(skin)]} оттенок кожи. ${loadout ? `${starterWeapon.name} · наряд «${starterOutfit.name}», ${loadouts.color(loadout.outfitColor).name.toLowerCase()} цвет.${heroMagic?` Магия: ${loadouts.magic(heroMagic).name}.`:''}` : 'Без класса, брони и оружия.'} В тестовом бою: 200 здоровья.`,true));
  document.querySelectorAll('[data-info]').forEach(button=>button.addEventListener('click',()=>openInfo(...information[button.dataset.info]())));
  dialog.querySelectorAll('.dialog-close,.dialog-action').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  dialog.addEventListener('close',syncPause);
  dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  loadAssets(); window.requestAnimationFrame(tick);
})();
