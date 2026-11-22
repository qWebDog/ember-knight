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
  const loadout = loadouts?.selection(character) || null;
  const starterWeapon = loadout ? loadouts.weapon(loadout.weapon) : null;
  const starterOutfit = loadout ? loadouts.outfit(loadout.weapon,loadout.outfit) : null;
  const ranged = starterWeapon && starterWeapon.projectile !== 'melee';
  const skin = character?.skin || 'light';
  const name = typeof character?.name === 'string' && character.name.trim() ? character.name.slice(0,24) : 'Странник';
  const level = Number.isInteger(character?.level) ? Math.max(1,Math.min(99,character.level)) : 1;
  $('#player-name').textContent = name;
  $('.fighter-name').textContent = name;
  $('#level-badge').textContent = level;
  const battle = window.EmberCombat.createBattle({heroName:name,heroProjectile:starterWeapon?.projectile,heroWeapon:starterWeapon?.id});
  battle.pause();
  let ready = false, assetError = false, rewardPaid = false, lastFrameTime = null;
  const actors = {};
  for (const id of ['hero','orc','archer','mage']) {
    const element = document.querySelector(`[data-fighter="${id}"]`);
    actors[id] = {element, canvas:element.querySelector('canvas'), bar:element.querySelector('.healthbar'), images:{}, animation:null, hitAt:-10, blockAt:-10, lastKey:null};
  }
  const effects = [];
  const orcSpawnRatio = battlefield.clientWidth ? actors.orc.element.offsetLeft / battlefield.clientWidth : .6;
  let heroX = null, orcX = null, fieldWidth = null, moving = false, heroMoving = false, orcMoving = false;
  let walkDistance = 0, orcWalkDistance = 0, walkDirection = 3, orcWalkDirection = 1, activeTime = 0;
  let pairContacted = false, previousSeparation = null;
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
        ['archer','skeleton-shoot.png','skeleton-left.png',13,5],
        ['mage','mage-spellcast.png','mage-left.png',7,0]
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
      actors.orc.images.walk = { ...actors.orc.images.idle,still:undefined };
      const orcAttack = await loadImage('assets/enemies/lpc/orc-attack.png').catch(() => null);
      actors.orc.images.attack = orcAttack ? {image:orcAttack,frames:6,row:1,tile:128,origin:32} : { ...actors.orc.images.idle,frames:1 };
      const face = $('#avatar').getContext('2d'); face.imageSmoothingEnabled = false;
      const avatarTile=loadout?starterWeapon.walk.tile:64, avatarOrigin=loadout?starterWeapon.walk.origin:0;
      face.drawImage(idle,avatarOrigin+19,avatarTile*2+avatarOrigin+12,26,26,0,0,32,32);
      ready = true;
      updateMovement(0,battle.getState());
      $('#status').textContent = 'Тестовый бой готов: орк-щитоносец, скелет-лучник и могильный колдун.';
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
    arena.classList.toggle('is-paused', !ready || !auto || dialog.open || ended);
    autoButton.disabled = !ready || ended;
    autoButton.classList.toggle('active', auto && !ended);
    autoButton.setAttribute('aria-pressed', String(auto && !ended));
    autoButton.setAttribute('aria-label', ended ? 'Бой завершён' : `Автобой ${auto ? 'включён' : 'приостановлен'}`);
    $('#auto-label').textContent = ended ? '✓' : auto ? 'ВКЛ' : 'ВЫКЛ';
    $('#battle-state').textContent = !ready ? assetError ? 'Ошибка загрузки' : 'Загрузка боя' : state.phase === 'victory' ? 'Победа · 3/3' : state.phase === 'defeat' ? 'Поражение' : auto ? moving ? 'Подход к цели' : 'Тестовый бой' : 'Пауза';
  }
  function syncPause() {
    if (ready && auto && !moving && !document.hidden && !dialog.open) battle.resume(); else battle.pause();
    lastFrameTime = null; updateControls();
  }
  autoButton.addEventListener('click', () => {
    if (!ready || ['victory','defeat'].includes(battle.getState().phase)) return;
    auto = !auto; syncPause();
    try { localStorage.setItem('ember.combat.auto.v1',auto ? 'on' : 'off'); telegram?.HapticFeedback?.selectionChanged(); } catch {}
    $('#status').textContent = auto ? 'Бой продолжается' : 'Бой приостановлен';
  });
  document.addEventListener('visibilitychange', syncPause);
  function addEffect(type, sourceId, targetId, text, at) {
    if (reducedMotion.matches) return;
    const element = document.createElement('span');
    const floating = ['damage','heavy','counter','block'].includes(type);
    element.className = floating ? `damage-number ${type}-number ${targetId === 'hero' && type !== 'block' ? 'enemy-damage' : ''}` : `projectile ${type}`;
    element.setAttribute('aria-hidden','true'); if (text) element.textContent = text;
    battlefield.appendChild(element); effects.push({element,type,floating,sourceId,targetId,at:activeTime,duration:floating ? .85 : .38});
  }
  function handleEvents(events) {
    for (const event of events) {
      if (event.type === 'attack') {
        actors[event.sourceId].animation = {at:activeTime,duration:event.animationDuration || (event.sourceId === 'archer' || (event.sourceId === 'hero' && starterWeapon?.id === 'bow') ? .9 : .66),variant:event.variant,heavy:event.heavy,counter:event.counter};
        actors[event.targetId].hitAt = activeTime;
        addEffect(event.counter ? 'counter' : event.heavy ? 'heavy' : 'damage',event.sourceId,event.targetId,event.counter ? `Ответ −${event.damage}` : `−${event.damage}`,event.at);
        if (event.projectile !== 'melee') addEffect(event.projectile,event.sourceId,event.targetId,null,event.at);
      } else if (event.type === 'block') {
        actors.hero.blockAt = activeTime;
        // The real LPC guard pose interrupts the swing; the following counter
        // starts its own animation instead of resuming a stale attack frame.
        actors.hero.animation = null;
        addEffect('block',event.sourceId,'hero','Блок',event.at);
      } else if (event.type === 'death') {
        $('#status').textContent = event.id === 'hero' ? 'Герой пал' : `${battle.getState().enemies.find(enemy=>enemy.id===event.id).name} побеждён`;
      } else if (event.type === 'end') {
        if (event.result === 'victory' && !rewardPaid) {
          rewardPaid = true; wallet = Math.min(999999999,wallet + event.reward); updateWallet();
          try { localStorage.setItem('ember.test.gold.v1',String(wallet)); } catch {}
        }
        $('#result-title').textContent = event.result === 'victory' ? 'Победа!' : 'Попробуем ещё?';
        $('#result-copy').textContent = event.result === 'victory' ? `Все три врага повержены. +${event.reward} золота · ${activeTime.toFixed(1).replace('.',',')} сек.` : 'Герой пал. Восстанови силы и начни бой заново.';
        $('#replay-button').textContent = 'Снова в бой'; resultPanel.hidden = false;
        $('#status').textContent = event.result === 'victory' ? `Победа. Получено ${event.reward} золота.` : 'Поражение. Можно повторить бой.';
        try { telegram?.HapticFeedback?.notificationOccurred(event.result === 'victory' ? 'success' : 'warning'); } catch {}
        effects.splice(0).forEach(effect => effect.element.remove());
        updateControls();
      }
    }
  }
  function drawActor(id, state) {
    const actor = actors[id], unit = id === 'hero' ? state.hero : state.enemies.find(enemy=>enemy.id===id);
    if (!actor.images.idle) return;
    const age = actor.animation ? activeTime - actor.animation.at : 100;
    const ended = ['victory','defeat'].includes(state.phase);
    const distance = id === 'orc' ? orcWalkDistance : walkDistance;
    const walking = ((id === 'hero' && heroMoving) || (id === 'orc' && orcMoving)) && distance > 0 && unit.hp > 0 && !ended && !reducedMotion.matches && actor.images.walk?.frames > 1;
    const blocking = !walking && !ended && unit.hp > 0 && !reducedMotion.matches && actor.images.block && activeTime - actor.blockAt < .28;
    const attacking = !walking && !blocking && !ended && age >= 0 && age < (actor.animation?.duration || 0) && unit.hp > 0 && !reducedMotion.matches;
    const kind = walking ? 'walk' : blocking ? 'block' : attacking ? 'attack' : 'idle';
    const descriptor = attacking && actor.images.attacks?.[actor.animation.variant] || actor.images[kind];
    const row = walking ? id === 'orc' ? orcWalkDirection : walkDirection : descriptor.row;
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
    actor.element.setAttribute('aria-label', `${unit.name}${id === 'hero' && loadout ? `, ${starterWeapon.name}, наряд ${starterOutfit.name}, ${loadouts.color(loadout.outfitColor).name}` : ''}: ${unit.hp} из ${unit.maxHp} здоровья`);
  }
  // Resolve the two melee fighters from the same positions so they meet without crossing.
  // Walking phase uses actual distance; ranged fighters keep their starting positions.
  function updateMovement(dt,state) {
    const width = battlefield.clientWidth;
    const heroSize = actors.hero.element.offsetWidth, orcSize = actors.orc.element.offsetWidth;
    const home = width * (window.innerWidth > 700 ? .18 : .22);
    if (heroX === null) heroX = home;
    if (orcX === null) orcX = width * orcSpawnRatio;
    const resized = fieldWidth && fieldWidth !== width;
    if (resized) { const ratio = width / fieldWidth; heroX *= ratio; orcX *= ratio; }
    fieldWidth = width;
    moving = heroMoving = orcMoving = false;
    let usedTime = 0;
    const ended = ['victory','defeat'].includes(state.phase);
    const orcAlive = state.enemies.find(enemy => enemy.id === 'orc').hp > 0;
    if (!ended && orcAlive) {
      if (ranged) heroX = home;
      const separation = heroSize * .23 + orcSize * .34;
      let gap = orcX - heroX - separation;
      if (gap < 0 || (pairContacted && (resized || separation !== previousSeparation))) {
        if (ranged) orcX = heroX + separation;
        else { const middle = (heroX + orcX) / 2; heroX = middle - separation / 2; orcX = middle + separation / 2; }
        gap = 0;
      }
      previousSeparation = separation;
      if (gap > .01) {
        const heroSpeed = ranged ? 0 : heroSize * .85, orcSpeed = orcSize * .85;
        const closingSpeed = heroSpeed + orcSpeed;
        usedTime = reducedMotion.matches ? 0 : Math.min(dt,gap / closingSpeed);
        const fraction = reducedMotion.matches ? gap / closingSpeed : usedTime;
        const heroStep = heroSpeed * fraction, orcStep = orcSpeed * fraction;
        heroX += heroStep; orcX -= orcStep;
        if (!reducedMotion.matches) { walkDistance += heroStep / heroSize; orcWalkDistance += orcStep / orcSize; }
        walkDirection = 3; orcWalkDirection = 1;
        moving = orcX - heroX - separation > .01;
        heroMoving = moving && heroSpeed > 0; orcMoving = moving;
      }
      if (!moving) pairContacted = true;
    } else if (!ended && state.targetId) {
      if (ranged) heroX = home;
      else {
        const target = actors[state.targetId].element;
        const separation = heroSize * .23 + target.offsetWidth * .34;
        const goal = Math.max(home,target.offsetLeft - separation), gap = goal - heroX;
        if (Math.abs(gap) > .01) {
          walkDirection = gap >= 0 ? 3 : 1;
          const speed = heroSize * .85;
          const distance = reducedMotion.matches ? Math.abs(gap) : Math.min(Math.abs(gap),speed * dt);
          heroX += Math.sign(gap) * distance;
          if (!reducedMotion.matches) walkDistance += distance / heroSize;
          usedTime = reducedMotion.matches ? 0 : distance / speed;
          moving = heroMoving = !reducedMotion.matches && Math.abs(goal - heroX) > .01;
        }
      }
    }
    actors.hero.element.style.left = `${heroX}px`;
    actors.orc.element.style.left = `${orcX}px`;
    return usedTime;
  }
  function renderEffects(state) {
    const field = battlefield.getBoundingClientRect();
    for (let i=effects.length-1;i>=0;i--) {
      const effect = effects[i], age = activeTime - effect.at;
      if (age >= effect.duration || reducedMotion.matches) { effect.element.remove(); effects.splice(i,1); continue; }
      const target = actors[effect.targetId].element.getBoundingClientRect(), source = actors[effect.sourceId].element.getBoundingClientRect();
      const p = Math.max(0,age/effect.duration), tx=target.left+target.width/2-field.left, ty=target.top+target.height*.4-field.top;
      if (effect.floating) {
        effect.element.style.left = `${tx}px`; effect.element.style.top = `${ty-p*22}px`; effect.element.style.opacity = String(1-p);
      } else {
        const sx=source.left+source.width*(effect.sourceId==='hero'?.7:.3)-field.left, sy=source.top+source.height*.45-field.top;
        if(effect.type==='arrow')effect.element.style.transform=`translate(-50%,-50%) rotate(${tx>=sx?180:0}deg)`;
        effect.element.style.left = `${sx+(tx-sx)*p}px`; effect.element.style.top = `${sy+(ty-sy)*p}px`;
      }
    }
  }
  function render(state) {
    for (const id of Object.keys(actors)) drawActor(id,state);
    $('#hero-vital').textContent = `${state.hero.hp} / ${state.hero.maxHp} HP`;
    const waves = document.querySelectorAll('.wave');
    waves.forEach((wave,i) => { wave.classList.toggle('done',i<state.defeatedCount); wave.classList.toggle('current',i===state.defeatedCount); });
    $('.stage-progress').setAttribute('aria-label',`Побеждено ${state.defeatedCount} из 3 врагов`);
    renderEffects(state);
  }
  function tick(timestamp) {
    if (lastFrameTime === null) lastFrameTime = timestamp;
    const dt = Math.min(.1,Math.max(0,(timestamp-lastFrameTime)/1000)); lastFrameTime = timestamp;
    if (ready && auto && !document.hidden && !dialog.open) {
      const before = battle.getState();
      if (!['victory','defeat'].includes(before.phase)) {
        activeTime += dt;
        const wasMoving = moving;
        const walkTime = updateMovement(dt,before);
        if (moving) battle.pause();
        else { battle.resume(); handleEvents(battle.advance(Math.max(0,dt-walkTime))); }
        updateMovement(0,battle.getState());
        if (moving) battle.pause();
        if (moving !== wasMoving) updateControls();
      }
    }

    if (ready) render(battle.getState());
    window.requestAnimationFrame(tick);
  }
  $('#replay-button').addEventListener('click', () => {
    if (assetError) { resultPanel.hidden = true; loadAssets(); return; }
    battle.restart(); auto = true; rewardPaid = false; heroX = null; orcX = null; fieldWidth = null; walkDistance = 0; orcWalkDistance = 0; activeTime = 0; moving = heroMoving = orcMoving = false; pairContacted = false; previousSeparation = null;
    for (const actor of Object.values(actors)) { actor.animation=null; actor.hitAt=-10; actor.blockAt=-10; actor.lastKey=null; }
    effects.splice(0).forEach(effect => effect.element.remove()); resultPanel.hidden = true; lastFrameTime = null;
    try { localStorage.setItem('ember.combat.auto.v1','on'); } catch {}
    updateMovement(0,battle.getState()); render(battle.getState()); syncPause(); $('#status').textContent = 'Новый тестовый бой начался';
  });
  const information = {
    gold: () => ['КОШЕЛЁК','Золото',`В кошельке ${wallet} золота. Победа в тестовом бою приносит 25 золота. Сохранение — на этом устройстве.`],
    crystals: () => ['КОШЕЛЁК','Кристаллы','Редкие кристаллы для особых находок. Их история начнётся в следующих главах.'],
    rewards: () => ['НАГРАДЫ','Трофеи первого боя',`За победу над орком, лучником и колдуном — 25 золота. Сейчас в кошельке: ${wallet}.`],
    map: () => ['ГЛАВА I','Забытый лес','Битва 1–1: орк-щитоносец, скелет-лучник и могильный колдун. Тестовый бой можно повторять.'],
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
  $('#profile-button').addEventListener('click', () => openInfo('ТВОЙ ГЕРОЙ',name,`Уровень ${level} · Сила 12 · ${skinNames[skinIds.indexOf(skin)]} оттенок кожи. ${loadout ? `${starterWeapon.name} · наряд «${starterOutfit.name}», ${loadouts.color(loadout.outfitColor).name.toLowerCase()} цвет.` : 'Без класса, брони и оружия.'} В тестовом бою: 200 здоровья.`,true));
  document.querySelectorAll('[data-info]').forEach(button=>button.addEventListener('click',()=>openInfo(...information[button.dataset.info]())));
  dialog.querySelectorAll('.dialog-close,.dialog-action').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  dialog.addEventListener('close',syncPause);
  dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  loadAssets(); window.requestAnimationFrame(tick);
})();
