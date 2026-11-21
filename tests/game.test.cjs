'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dist = path.resolve(__dirname, '../dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const gameSource = fs.readFileSync(path.join(dist, 'game.js'), 'utf8');
const combatSource = fs.readFileSync(path.join(dist, 'combat.js'), 'utf8');

// The real game controller and combat engine run together. Only browser surfaces,
// image decoding and the animation clock are replaced; no combat logic is mocked.
function createHarness({skin = 'bronze', preference, search = '', weapon, outfit} = {}) {
  const storage = new Map([['ember.character.v1', JSON.stringify({version:1, skin, name:'Тестовый герой', level:1,weapon,outfit})]]);
  if (preference) storage.set('ember.combat.auto.v1', preference);
  const nodes = new Map(), pendingImages = [], loadedPaths = [], raf = [], resizeCallbacks = [];
  let battle, now = 0;

  class Element {
    constructor(selector) {
      this.selector = selector; this.textContent = ''; this.hidden = false;
      this.disabled = false; this.open = false; this.attributes = {}; this.handlers = {};
      this.style = {setProperty(name, value) { this[name] = value; }};
      this.classes = new Set(); this.children = []; this.draws = []; this.motionHistory = [];
      this.dataset = new Proxy({}, {set:(target,name,value) => {
        if (name === 'motion') this.motionHistory.push(value);
        target[name] = value; return true;
      }});
      this.clientWidth = 800; this.offsetWidth = 64; this.offsetLeft = 0;
      this.classList = {toggle:(name, enabled) => {
        if (enabled === undefined) enabled = !this.classes.has(name);
        if (enabled) this.classes.add(name); else this.classes.delete(name);
        return enabled;
      }};
    }
    addEventListener(type, callback) { (this.handlers[type] ||= []).push(callback); }
    dispatch(type, extra = {}) { for (const callback of this.handlers[type] || []) callback({target:this, ...extra}); }
    click() { if (!this.disabled) this.dispatch('click'); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    querySelector(selector) {
      if (this.actor) {
        if (selector === 'canvas') return node(this.actor === 'hero' ? '#player-sprite' : `#enemy-${this.actor}`);
        if (selector === '.healthbar') return node(`healthbar:${this.actor}`);
      }
      if (this.selector.startsWith('healthbar:') && selector === 'i') return node(`${this.selector}:fill`);
      throw new Error(`Unimplemented nested selector: ${this.selector} ${selector}`);
    }
    querySelectorAll(selector) {
      assert.equal(this.selector, '#game-dialog');
      assert.equal(selector, '.dialog-close,.dialog-action');
      return [node('.dialog-close'), node('.dialog-action')];
    }
    getContext() {
      return {clearRect() {}, drawImage:(image, sx, sy, sw, sh, ...destination) => {
        assert.ok(sx >= 0 && sy >= 0 && sx + sw <= image.width && sy + sh <= image.height,
          `crop exceeds ${image.src}: ${[sx,sy,sw,sh]}`);
        this.draws.push({src:image.src, crop:[sx,sy,sw,sh], destination});
      }};
    }
    getBoundingClientRect() {
      const left = Number.parseFloat(this.style.left) || this.offsetLeft;
      if (this.actor) return {left, right:left+this.offsetWidth, top:204, bottom:268, width:this.offsetWidth, height:64};
      return {left:0, right:this.clientWidth, top:0, bottom:400, width:this.clientWidth, height:400};
    }
    appendChild(child) { this.children.push(child); child.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; this.dispatch('close'); } }
  }
  function node(selector) {
    if (selector.startsWith('#')) assert.ok(html.includes(`id="${selector.slice(1)}"`), `missing HTML ${selector}`);
    if (!nodes.has(selector)) nodes.set(selector, new Element(selector));
    return nodes.get(selector);
  }
  for (const [index, id] of ['hero','orc','archer','mage'].entries()) {
    assert.ok(html.includes(`data-fighter="${id}"`));
    const actor = node(`[data-fighter="${id}"]`);
    actor.actor = id; actor.offsetLeft = 160 + index * 140;
  }
  node('#battle-result').hidden = true;
  const waves = [node('wave:0'),node('wave:1'),node('wave:2')];
  const infoButtons = ['gold','crystals','rewards','map','fist','dash','fire'].map(id => {
    assert.ok(html.includes(`data-info="${id}"`));
    const element = node(`info:${id}`); element.dataset = {info:id}; return element;
  });
  const document = new Element('document');
  Object.assign(document, {
    hidden:false, documentElement:node('html'), querySelector:node,
    createElement:tag => new Element(`created:${tag}`),
    querySelectorAll(selector) {
      if (selector === '.wave') return waves;
      if (selector === '[data-info]') return infoButtons;
      throw new Error(`Unimplemented selector ${selector}`);
    }
  });
  class ImageStub {
    set src(value) {
      this.path = value;
      const data = fs.readFileSync(path.join(dist, value));
      assert.equal(data.subarray(1,4).toString(), 'PNG');
      this.width = data.readUInt32BE(16); this.height = data.readUInt32BE(20);
      pendingImages.push(this); loadedPaths.push(value);
    }
    get src() { return this.path; }
  }
  const window = {
    innerWidth:800, innerHeight:800, location:{search},
    matchMedia:() => ({matches:false}), addEventListener() {},
    requestAnimationFrame:callback => raf.push(callback)
  };
  const context = vm.createContext({
    window, document, Image:ImageStub, URLSearchParams,
    ResizeObserver:class {constructor(callback) {this.callback = callback;} observe() {resizeCallbacks.push(this.callback); this.callback();}},
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key,value) => storage.set(key,String(value))}
  });
  vm.runInContext(fs.readFileSync(path.join(dist,'loadouts.js'),'utf8'), context, {filename:'loadouts.js'});
  vm.runInContext(combatSource, context, {filename:'combat.js'});
  const createBattle = window.EmberCombat.createBattle;
  window.EmberCombat.createBattle = options => { battle = createBattle(options); return battle; };
  vm.runInContext(gameSource, context, {filename:'game.js'});

  async function flushPromises() { for (let i=0; i<12; i++) await Promise.resolve(); }
  async function loadNextImage() {
    assert.ok(pendingImages.length, 'expected pending image');
    pendingImages.shift().onload(); await flushPromises();
  }
  async function loadAllImages() {
    while (pendingImages.length) await loadNextImage();
    await flushPromises();
  }
  function frame(milliseconds = 100) {
    now += milliseconds;
    const callbacks = raf.splice(0);
    assert.equal(callbacks.length, 1, 'one controller animation loop');
    callbacks[0](now);
  }
  // Establish the animation clock while assets are still loading.
  frame(0);
  function runFor(seconds) { for (let i=0; i<Math.round(seconds*10); i++) frame(100); }
  function runUntil(condition, maxSeconds = 45) {
    let elapsed = 0;
    while (!condition() && elapsed < maxSeconds*1000) { frame(100); elapsed += 100; }
    assert.ok(condition(), `condition not reached within ${maxSeconds}s`);
    return elapsed/1000;
  }
  function state() { return JSON.parse(JSON.stringify(battle.getState())); }
  function heroX() { return Number.parseFloat(node('[data-fighter="hero"]').style.left); }
  function visualState() {
    return {state:state(), x:heroX(), draws:node('#player-sprite').draws.length, lastDraw:node('#player-sprite').draws.at(-1)};
  }
  function resizeField(width) {
    const ratio = width/node('.battlefield').clientWidth;
    node('.battlefield').clientWidth = width; node('.adventure').clientWidth = width;
    window.innerWidth = width;
    for (const id of ['orc','archer','mage']) node(`[data-fighter="${id}"]`).offsetLeft *= ratio;
    resizeCallbacks.forEach(callback => callback());
  }
  return {node, storage, loadedPaths, document, state, loadNextImage, loadAllImages, runFor, runUntil, frame, heroX, visualState, resizeField};
}

test('controller waits for assets, walks into range before damage, and uses selected skin and correct LPC rows', async () => {
  const ui = createHarness({skin:'bronze', preference:'off', search:'?battle=test'});
  assert.equal(ui.state().phase, 'paused');
  assert.equal(ui.node('#auto-button').disabled, true);
  ui.runFor(2);
  assert.equal(ui.state().elapsed, 0);
  await ui.loadNextImage();
  assert.equal(ui.state().phase, 'paused', 'idle alone cannot start the battle');
  await ui.loadAllImages();
  assert.equal(ui.state().phase, 'paused', 'combat waits while the hero approaches');
  assert.equal(ui.node('#auto-button').disabled, false);
  assert.ok(ui.loadedPaths.includes('assets/characters/combat/bronze-walk.png'));
  assert.ok(ui.loadedPaths.includes('assets/characters/combat/bronze-attack.png'));
  assert.deepEqual(ui.node('#player-sprite').draws.at(-1).crop, [0,192,64,64]);
  assert.equal(ui.node('[data-fighter="hero"]').dataset.motion, 'idle', 'the hero does not step before any distance is travelled');
  for (const id of ['orc','archer','mage']) assert.equal(ui.node(`#enemy-${id}`).draws.at(-1).crop[1], 64);
  ui.runFor(1.3);
  assert.equal(ui.state().elapsed, 0);
  assert.equal(ui.state().hero.hp, 200);
  assert.equal(ui.state().enemies[0].hp, 100, 'neither side attacks from a distance during approach');
  const walking = ui.node('#player-sprite').draws.filter(draw => draw.src.endsWith('bronze-walk.png'));
  assert.ok(new Set(walking.map(draw => draw.crop[0])).size >= 5, 'travel advances several real gait frames');
  assert.ok(walking.every(draw => draw.crop[0] >= 64 && draw.crop[0] <= 512 && draw.crop[1] === 192));
  ui.runUntil(() => ui.node('[data-fighter="hero"]').dataset.motion === 'idle', 3);
  assert.equal(ui.state().enemies[0].hp, 100, 'the hero stands before the first timed attack');
  const orc = ui.node('[data-fighter="orc"]');
  const expectedX = orc.offsetLeft - (64*.23 + orc.offsetWidth*.34);
  assert.ok(Math.abs(ui.heroX()-expectedX) < .01, 'hero is actually in contact range');
  ui.runUntil(() => ui.state().enemies[0].hp < 100, 2);
  assert.ok(ui.node('#player-sprite').draws.some(draw => draw.src === 'assets/characters/combat/bronze-attack.png'));
  assert.equal(ui.state().enemies[0].hp, 91);
});

test('auto, dialog and page visibility freeze location, animation, active combat time and damage', async () => {
  const ui = createHarness(); await ui.loadAllImages(); ui.runFor(.7);
  assert.equal(ui.node('[data-fighter="hero"]').dataset.motion, 'walk');
  ui.node('#auto-button').click();
  const paused = ui.visualState();
  assert.equal(paused.state.phase, 'paused');
  assert.equal(ui.storage.get('ember.combat.auto.v1'), 'off');
  ui.runFor(10); assert.deepEqual(ui.visualState(), paused);
  ui.node('#auto-button').click(); ui.runFor(.5);
  assert.ok(ui.heroX() > paused.x);
  ui.node('#profile-button').click();
  assert.equal(ui.node('#game-dialog').open, true);
  const inDialog = ui.visualState(); ui.runFor(5); assert.deepEqual(ui.visualState(), inDialog);
  ui.node('#game-dialog').close(); ui.runFor(.3);
  assert.ok(ui.heroX() > inDialog.x);
  ui.document.hidden = true; ui.document.dispatch('visibilitychange');
  const hidden = ui.visualState(); ui.runFor(10); assert.deepEqual(ui.visualState(), hidden);
  ui.document.hidden = false; ui.document.dispatch('visibilitychange'); ui.runFor(.2);
  assert.ok(ui.heroX() > hidden.x && ui.heroX()-hidden.x <= 64*.85*.2, 'hidden wall time is not added to movement');
  ui.runUntil(() => ui.state().enemies[0].hp < 100);
  ui.node('#auto-button').click();
  const pausedCombat = ui.visualState(); ui.runFor(5);
  assert.deepEqual(ui.visualState(), pausedCombat, 'a paused attack frame and damaged health also freeze');
});

test('victory pays once, freezes finished combat, and replay restores all fighters before a second reward', async () => {
  const ui = createHarness(); await ui.loadAllImages();
  const wallSeconds = ui.runUntil(() => ui.state().phase === 'victory');
  const victory = ui.state();
  assert.equal(victory.phase, 'victory');
  assert.equal(victory.elapsed, 27.6, 'walking does not consume the combat engine attack timers');
  assert.ok(wallSeconds > victory.elapsed && wallSeconds < 40, 'wall duration includes all three approaches');
  assert.equal(victory.defeatedCount, 3);
  assert.equal(ui.node('#result-title').textContent, 'Победа!');
  assert.equal(ui.node('#battle-result').hidden, false);
  assert.equal(ui.node('#auto-button').disabled, true);
  assert.equal(ui.storage.get('ember.test.gold.v1'), '25');
  assert.equal(ui.node('.gold').attributes['aria-label'], 'Золото: 25');
  ui.runFor(20); assert.deepEqual(ui.state(), victory);
  assert.equal(ui.storage.get('ember.test.gold.v1'), '25');
  ui.node('#replay-button').click();
  const reset = ui.state();
  assert.equal(reset.phase, 'paused'); assert.equal(reset.elapsed, 0);
  assert.equal(reset.hero.hp, 200); assert.deepEqual(reset.enemies.map(enemy => enemy.hp), [100,60,65]);
  assert.equal(ui.node('#battle-result').hidden, true);
  assert.equal(ui.node('#hero-vital').textContent, '200 / 200 HP');
  assert.equal(ui.heroX(), 800*.18);
  assert.equal(ui.node('[data-fighter="hero"]').dataset.motion, 'idle');
  ui.runFor(.2);
  assert.equal(ui.node('[data-fighter="hero"]').dataset.motion, 'walk');
  assert.deepEqual(ui.node('#player-sprite').draws.at(-1).crop, [64,192,64,64], 'replay restarts the gait at its first travelling frame');
  for (const id of ['orc','archer','mage']) assert.equal(ui.node(`[data-fighter="${id}"]`).classes.has('is-defeated'), false);
  ui.runUntil(() => ui.state().phase === 'victory');
  assert.equal(ui.state().phase, 'victory');
  assert.equal(ui.storage.get('ember.test.gold.v1'), '50');
  ui.runFor(10); assert.equal(ui.storage.get('ember.test.gold.v1'), '50');
});

test('standing enemies never cycle walking frames and the orc swings the actual oversized axe animation', async () => {
  const ui = createHarness(); await ui.loadAllImages();
  ui.runUntil(() => ui.node('#enemy-orc').draws.some(draw => draw.src.endsWith('orc-attack.png')));
  const canvas = ui.node('#enemy-orc');
  const attacks = canvas.draws.filter(draw => draw.src.endsWith('orc-attack.png'));
  assert.ok(attacks.every(draw => draw.crop[1] === 128 && draw.crop[2] === 128 && draw.crop[3] === 128));
  assert.equal(canvas.width, 128); assert.equal(canvas.style.width, '200%');
  assert.equal(canvas.style.left, '-50%'); assert.equal(canvas.style.top, '-50%');
  ui.runUntil(() => ui.state().phase === 'victory');
  for (const id of ['orc','archer','mage']) {
    const actor = ui.node(`[data-fighter="${id}"]`);
    assert.ok(actor.motionHistory.includes('attack'), `${id} plays an attack`);
    assert.ok(!actor.motionHistory.includes('walk'), `${id} has no gait while standing`);
    assert.equal(actor.dataset.motion, 'idle');
  }
  assert.ok(canvas.draws.filter(draw => draw.src.endsWith('orc-walk.png')).every(draw => draw.crop[0] === 0), 'orc walk sheet supplies only its stationary frame');
  assert.equal(ui.node('[data-fighter="hero"]').dataset.motion, 'idle', 'the finished hero stands still');
});

test('walking speed and gait follow distance; a pure viewport resize does not add a fake step', async () => {
  const ui = createHarness(); await ui.loadAllImages(); ui.runFor(.4);
  const beforeX = ui.heroX(), before = ui.node('#player-sprite').draws.at(-1);
  ui.frame(100);
  assert.ok(Math.abs(ui.heroX()-beforeX - 64*.85*.1) < 1e-9, 'walk speed is 0.85 rendered model widths per second');
  const hero = ui.node('[data-fighter="hero"]');
  const phase = ui.node('#player-sprite').draws.at(-1);
  assert.equal(phase.src, 'assets/characters/combat/bronze-walk.png');
  const x = ui.heroX(), count = ui.node('#player-sprite').draws.length;
  ui.node('#auto-button').click();
  ui.resizeField(1000);
  assert.ok(Math.abs(ui.heroX()-x*1.25) < 1e-9, 'ResizeObserver realigns the paused hero immediately');
  ui.frame(0);
  assert.ok(Math.abs(ui.heroX()-x*1.25) < 1e-9);
  assert.equal(ui.node('#player-sprite').draws.length, count, 'rescaling position alone does not advance the gait phase');
  assert.deepEqual(ui.node('#player-sprite').draws.at(-1), phase);
  assert.equal(hero.dataset.motion, 'walk');
  assert.ok(before.crop[0] >= 64);
});


test('all nine saved starter outfits appear in battle with matching weapon animation and range',async()=>{
  const catalogue=require('../dist/loadouts.js');
  for(const weapon of catalogue.weapons)for(const outfit of weapon.outfits){
    const ui=createHarness({skin:'olive',weapon:weapon.id,outfit:outfit.id});await ui.loadAllImages();
    const root=`assets/characters/loadouts/${weapon.id}/${outfit.id}/olive-`;
    assert.ok(ui.loadedPaths.includes(root+'walk.png'));assert.ok(ui.loadedPaths.includes(root+'attack.png'));
    const start=ui.heroX();ui.runFor(.7);
    if(weapon.projectile==='melee')assert.ok(ui.heroX()>start);else{assert.equal(ui.heroX(),start);assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'idle');}
    ui.runUntil(()=>ui.node('#player-sprite').draws.some(d=>d.src===root+'attack.png'));
    const attacks=ui.node('#player-sprite').draws.filter(d=>d.src===root+'attack.png');
    assert.ok(attacks.every(d=>d.crop[2]===weapon.attack.tile&&d.crop[1]===weapon.attack.tile*3));
    ui.node('#profile-button').click();assert.ok(ui.node('#dialog-copy').textContent.includes(outfit.name));ui.node('#game-dialog').close();
    ui.runUntil(()=>ui.state().phase==='victory',60);assert.equal(ui.storage.get('ember.test.gold.v1'),'25');
  }
});
