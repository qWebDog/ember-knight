(() => {
  'use strict';
  const skinIds = ['light','amber','olive','bronze','brown','black'];
  const skinNames = ['Светлый','Тёплый','Оливковый','Бронзовый','Смуглый','Тёмный'];
  const telegram = window.Telegram?.WebApp;
  const arena = document.querySelector('.adventure');
  const sprite = document.querySelector('#player-sprite');
  const avatar = document.querySelector('#avatar');
  const dialog = document.querySelector('#game-dialog');
  const autoButton = document.querySelector('#auto-button');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let character = null;
  let auto = true;
  let frame = 0;
  let sheet = null;
  try {
    const saved = JSON.parse(localStorage.getItem('ember.character.v1'));
    if (saved?.version === 1 && skinIds.includes(saved.skin)) character = saved;
    const preference = localStorage.getItem('ember.auto.v1');
    if (preference !== null) auto = preference === 'on';
  } catch { /* The screen remains usable when browser storage is unavailable. */ }
  const skin = character?.skin || 'light';
  const name = typeof character?.name === 'string' && character.name.trim() ? character.name.slice(0,24) : 'Странник';
  const level = Number.isInteger(character?.level) ? Math.max(1,Math.min(99,character.level)) : 1;
  document.querySelector('#player-name').textContent = name;
  document.querySelector('.fighter-name').textContent = name;
  document.querySelector('#level-badge').textContent = level;
  document.querySelector('.battlefield').setAttribute('aria-label', `${name} без экипировки в Забытом лесу. Впереди два лесных слизня и огонёк.`);
  try {
    telegram?.ready();
    telegram?.expand();
    telegram?.setHeaderColor('#14231f');
    telegram?.setBackgroundColor('#161e18');
  } catch {}
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
    const bounds = arena.getBoundingClientRect();
    const fighter = document.querySelector('.player').getBoundingClientRect();
    const feet = fighter.bottom - bounds.top - fighter.height * 2 / 64;
    const scale = Math.max(bounds.width / 900, feet / 330, (bounds.height - feet) / 150);
    const art = document.querySelector('.battle-landscape');
    art.style.backgroundSize = `${900 * scale}px ${480 * scale}px`;
    art.style.backgroundPosition = `center ${feet - 330 * scale}px`;
  }
  new ResizeObserver(alignTerrain).observe(arena);
  alignTerrain();
  function draw() {
    if (!sheet) return;
    const context = sprite.getContext('2d');
    context.clearRect(0,0,64,64);
    context.imageSmoothingEnabled = false;
    context.drawImage(sheet,frame * 64,192,64,64,0,0,64,64);
    const face = avatar.getContext('2d');
    face.clearRect(0,0,32,32);
    face.imageSmoothingEnabled = false;
    face.drawImage(sheet,19,140,26,26,0,0,32,32);
  }
  function loadHero(id, canFallback = true) {
    const image = new Image();
    image.onload = () => { sheet = image; draw(); };
    image.onerror = () => {
      if (canFallback && id !== 'light') { loadHero('light', false); return; }
      document.querySelector('#status').textContent = 'Не удалось загрузить спрайт героя. Обнови страницу.';
    };
    image.src = `assets/characters/${id}.png`;
  }
  loadHero(skin);
  function applyAuto() {
    arena.classList.toggle('is-paused', !auto);
    autoButton.classList.toggle('active', auto);
    autoButton.setAttribute('aria-pressed', String(auto));
    autoButton.setAttribute('aria-label', `Автобой ${auto ? 'включён' : 'выключен'}`);
    document.querySelector('#auto-label').textContent = auto ? 'ВКЛ' : 'ВЫКЛ';
    document.querySelector('#battle-state').textContent = auto ? 'В пути' : 'На привале';
  }
  applyAuto();
  autoButton.addEventListener('click', () => {
    auto = !auto;
    applyAuto();
    try { localStorage.setItem('ember.auto.v1', auto ? 'on' : 'off'); } catch {}
    try { telegram?.HapticFeedback?.selectionChanged(); } catch {}
    document.querySelector('#status').textContent = auto ? 'Автобой включён' : 'Автобой приостановлен';
  });
  setInterval(() => {
    if (!auto || reducedMotion.matches || document.hidden) return;
    frame = frame ? 0 : 1;
    draw();
  }, 650);
  const information = {
    gold: ['КОШЕЛЁК','Золото','Золото пригодится для снаряжения и развития героя. Первые награды ждут впереди.'],
    crystals: ['КОШЕЛЁК','Кристаллы','Редкие кристаллы для особых находок. Их история начнётся в следующих главах.'],
    rewards: ['НАГРАДЫ','Первый трофей впереди','Награды за пройденные битвы появятся здесь. Сейчас твой путь только начинается.'],
    map: ['ГЛАВА I','Забытый лес','Опушка леса · Битва 1–1. Три волны отделяют странника от следующего шага в неизвестность.'],
    fist: ['УМЕНИЕ','Натиск','Откроется на 3 уровне. Первый шаг к собственной боевой технике.'],
    dash: ['УМЕНИЕ','Рывок','Откроется на 5 уровне. В нужный момент решает один быстрый шаг.'],
    fire: ['УМЕНИЕ','Внутренний огонь','Откроется на 10 уровне. Сила, которую ещё предстоит пробудить.']
  };
  function openInfo(eyebrow,title,copy,profile = false) {
    document.querySelector('#dialog-eyebrow').textContent = eyebrow;
    document.querySelector('#dialog-title').textContent = title;
    document.querySelector('#dialog-copy').textContent = copy;
    const link = document.querySelector('#profile-link');
    link.hidden = !profile;
    link.textContent = character ? 'Изменить облик' : 'Создать героя';
    if (!dialog.open) dialog.showModal();
  }
  document.querySelector('#profile-button').addEventListener('click', () => {
    const description = character ? `Уровень ${level} · Сила 12 · ${skinNames[skinIds.indexOf(skin)]} оттенок кожи. Пока без класса, брони и оружия. Вся история впереди.` : 'Твоя история ещё не написана. Выбери облик странника, прежде чем отправиться в путь.';
    openInfo('ТВОЙ ГЕРОЙ',name,description,true);
  });
  document.querySelectorAll('[data-info]').forEach(button => button.addEventListener('click', () => openInfo(...information[button.dataset.info])));
  dialog.querySelectorAll('.dialog-close,.dialog-action').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
})();
