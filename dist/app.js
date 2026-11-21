(() => {
  'use strict';
  const skins = [
    {id:'light', label:'Светлый', color:'#F9D5BA'},
    {id:'amber', label:'Тёплый', color:'#FDD082'},
    {id:'olive', label:'Оливковый', color:'#D38B59'},
    {id:'bronze', label:'Бронзовый', color:'#AE6B3F'},
    {id:'brown', label:'Смуглый', color:'#9C663E'},
    {id:'black', label:'Тёмный', color:'#603429'}
  ];
  const key = 'ember.character.v1';
  const canvas = document.querySelector('#hero');
  const ctx = canvas.getContext('2d');
  const controls = [...document.querySelectorAll('.skin-option')];
  const createButton = document.querySelector('#create-button');
  const status = document.querySelector('#status');
  const images = new Map();
  let selected = 'light', direction = 2, frame = 0, saved = null, imageReady = false;
  let loadingError = false;
  const directionNames = ['Вид сзади', 'Левый бок', 'Вид спереди', 'Правый бок'];
  const telegram = window.Telegram?.WebApp;
  try {
    telegram?.ready();
    telegram?.expand();
    telegram?.setHeaderColor('#111613');
    telegram?.setBackgroundColor('#111613');
  } catch { /* The screen also works outside Telegram. */ }
  try {
    const candidate = JSON.parse(localStorage.getItem(key));
    if (candidate?.version === 1 && skins.some(s => s.id === candidate.skin)) {
      saved = candidate;
      selected = candidate.skin;
    }
  } catch { /* Storage can be unavailable in private webviews. */ }
  function haptic(type = 'selectionChanged') {
    try { telegram?.HapticFeedback?.[type]?.(); } catch {}
  }
  // Fit the actual browser/Telegram viewport, including sheet expansion and rotation.
  function syncViewport() {
    const browserHeight = window.visualViewport?.height || window.innerHeight;
    const telegramHeight = telegram?.initData && Number(telegram.viewportHeight);
    const height = telegramHeight > 0 ? Math.min(browserHeight, telegramHeight) : browserHeight;
    document.documentElement.style.setProperty('--app-height', `${Math.floor(height)}px`);
  }
  window.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('resize', syncViewport);
  telegram?.onEvent?.('viewportChanged', syncViewport);
  syncViewport();
  function alignCharacter() {
    const scene = document.querySelector('#scene');
    const stage = document.querySelector('.sprite-stage');
    const bottom = Number(getComputedStyle(scene).getPropertyValue('--scene-bottom')) || 122;
    const feet = Math.max(30, scene.clientHeight - bottom);
    // Keep the entire LPC silhouette above its nameplate even in a short webview.
    const pixelScale = Math.max(1, Math.min(5, Math.floor((feet - 32) / 47)));
    const size = pixelScale * 64;
    stage.style.width = `${size}px`;
    stage.style.height = `${size}px`;
    stage.style.top = `${feet - 62 * pixelScale}px`;
    // Position the background's actual pedestal under the feet at every aspect ratio.
    const artScale = Math.max(scene.clientWidth / 760, feet / 500, (scene.clientHeight - feet) / 160);
    scene.style.backgroundSize = `${760 * artScale}px ${660 * artScale}px`;
    scene.style.backgroundPosition = `center ${feet - 500 * artScale}px`;
  }
  new ResizeObserver(alignCharacter).observe(document.querySelector('#scene'));
  alignCharacter();
  function draw() {
    const img = images.get(selected);
    if (!img) return;
    ctx.clearRect(0, 0, 64, 64);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, frame * 64, direction * 64, 64, 64, 0, 0, 64, 64);
    canvas.setAttribute('aria-label', `Странник без экипировки. Цвет кожи: ${skins.find(s => s.id === selected).label}. ${directionNames[direction]}.`);
  }
  function updateButton() {
    createButton.disabled = !imageReady;
    createButton.querySelector('span').textContent = loadingError ? 'Повторить загрузку' : !imageReady ? 'Загружаем героя…' : saved ? 'Сохранить облик' : 'Создать персонажа';
    if (loadingError) createButton.disabled = false;
  }
  function selectSkin(id, feedback = false) {
    selected = id;
    controls.forEach((button) => {
      const isSelected = button.dataset.skin === id;
      button.classList.toggle('selected', isSelected);
      button.setAttribute('aria-checked', String(isSelected));
      button.tabIndex = isSelected ? 0 : -1;
    });
    document.querySelector('#skin-name').textContent = skins.find(s => s.id === id).label;
    if (feedback) haptic();
    draw();
  }
  controls.forEach((button, i) => {
    button.style.setProperty('--skin', skins[i].color);
    button.addEventListener('click', () => selectSkin(button.dataset.skin, true));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      event.preventDefault();
      let index = i;
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = skins.length - 1;
      else index = (i + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1) + skins.length) % skins.length;
      selectSkin(skins[index].id, true);
      controls[index].focus();
    });
  });
  function rotate(delta) {
    direction = (direction + delta + 4) % 4;
    document.querySelector('#view-label').textContent = directionNames[direction];
    haptic();
    draw();
  }
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
  function openDialog(id) {
    const dialog = document.querySelector(id);
    if (!dialog.open) dialog.showModal();
  }
  document.querySelector('#help-button').addEventListener('click', () => openDialog('#info-dialog'));
  document.querySelector('#credits-button').addEventListener('click', () => openDialog('#credits-dialog'));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelectorAll('.dialog-close, .dialog-action').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });
  async function loadSprites() {
    loadingError = false;
    imageReady = false;
    updateButton();
    try {
      await Promise.all(skins.map(skin => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { images.set(skin.id, img); resolve(); };
        img.onerror = reject;
        img.src = `assets/characters/${skin.id}.png`;
      })));
      imageReady = true;
      status.textContent = 'Герой готов. Выбери цвет кожи.';
      draw();
    } catch {
      loadingError = true;
      status.textContent = 'Не удалось загрузить героя. Нажми «Повторить загрузку».';
    }
    updateButton();
  }
  createButton.addEventListener('click', () => {
    if (loadingError) { loadSprites(); return; }
    if (!imageReady) return;
    const character = {version:1, name:'Странник', level:1, skin:selected, class:null, equipment:[], createdAt:saved?.createdAt || new Date().toISOString(), updatedAt:new Date().toISOString()};
    try {
      localStorage.setItem(key, JSON.stringify(character));
      saved = character;
      document.querySelector('#success-dialog h2').textContent = 'Герой создан.';
      document.querySelector('#success-dialog > p:not(.eyebrow)').innerHTML = 'Странник готов к своей истории.<br>Облик сохранён на этом устройстве.';
      document.querySelector('#saved-skin').textContent = skins.find(s => s.id === selected).label;
      updateButton();
      openDialog('#success-dialog');
      try { telegram?.HapticFeedback?.notificationOccurred('success'); } catch {}
    } catch {
      status.textContent = 'Хранилище недоступно. Разреши сохранение данных в браузере и попробуй снова.';
      document.querySelector('#info-dialog h2').textContent = 'Не удалось сохранить';
      document.querySelector('#info-dialog > p:not(.eyebrow)').textContent = 'Хранилище браузера недоступно. Разреши сохранение данных для этого сайта и попробуй снова.';
      openDialog('#info-dialog');
    }
  });
  selectSkin(selected);
  loadSprites();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  setInterval(() => {
    if (!imageReady || reducedMotion.matches || document.hidden) return;
    frame = frame ? 0 : 1;
    draw();
  }, 650);
})();
