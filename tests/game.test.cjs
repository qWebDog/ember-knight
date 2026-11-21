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
function createHarness({skin = 'bronze', preference, search = ''} = {}) {
  const storage = new Map([['ember.character.v1', JSON.stringify({version:1, skin, name:'Тестовый герой', level:1})]]);
  if (preference) storage.set('ember.combat.auto.v1', preference);
  const nodes = new Map(), pendingImages = [], loadedPaths = [], raf = [];
  let battle, now = 0;

  class Element {
    constructor(selector) {
      this.selector = selector; this.textContent = ''; this.hidden = false;
      this.disabled = false; this.open = false; this.attributes = {}; this.handlers = {};
      this.style = {setProperty(name, value) { this[name] = value; }};
      this.classes = new Set(); this.children = []; this.draws = [];
      this.clientWidth = 800; this.offsetWidth = 128; this.offsetLeft = 0;
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
      if (this.actor) return {left, right:left+128, top:140, bottom:268, width:128, height:128};
      return {left:0, right:800, top:0, bottom:400, width:800, height:400};
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
    ResizeObserver:class {constructor(callback) {this.callback = callback;} observe() {this.callback();}},
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key,value) => storage.set(key,String(value))}
  });
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
  function state() { return JSON.parse(JSON.stringify(battle.getState())); }
  return {node, storage, loadedPaths, document, state, loadNextImage, loadAllImages, runFor};
}

test('controller waits for assets, starts the test battle, and draws selected skin and correct LPC rows', async () => {
  const ui = createHarness({skin:'bronze', preference:'off', search:'?battle=test'});
  assert.equal(ui.state().phase, 'paused');
  assert.equal(ui.node('#auto-button').disabled, true);
  ui.runFor(2);
  assert.equal(ui.state().elapsed, 0);
  await ui.loadNextImage();
  assert.equal(ui.state().phase, 'paused', 'idle alone cannot start the battle');
  await ui.loadAllImages();
  assert.equal(ui.state().phase, 'running');
  assert.equal(ui.node('#auto-button').disabled, false);
  assert.ok(ui.loadedPaths.includes('assets/characters/combat/bronze-attack.png'));
  assert.deepEqual(ui.node('#player-sprite').draws.at(-1).crop, [0,192,64,64]);
  for (const id of ['orc','archer','mage']) assert.equal(ui.node(`#enemy-${id}`).draws.at(-1).crop[1], 64);
  ui.runFor(1.3);
  assert.ok(ui.node('#player-sprite').draws.some(draw => draw.src === 'assets/characters/combat/bronze-attack.png'));
  assert.equal(ui.state().enemies[0].hp, 91);
});

test('auto, dialog and page visibility pause both active time and damage without catch-up', async () => {
  const ui = createHarness(); await ui.loadAllImages(); ui.runFor(5);
  ui.node('#auto-button').click();
  const paused = ui.state();
  assert.equal(paused.phase, 'paused');
  assert.equal(ui.storage.get('ember.combat.auto.v1'), 'off');
  ui.runFor(10); assert.deepEqual(ui.state(), paused);
  ui.node('#auto-button').click(); ui.runFor(2);
  assert.ok(ui.state().elapsed > paused.elapsed);
  ui.node('#profile-button').click();
  assert.equal(ui.node('#game-dialog').open, true);
  const inDialog = ui.state(); ui.runFor(5); assert.deepEqual(ui.state(), inDialog);
  ui.node('#game-dialog').close(); ui.runFor(1);
  assert.ok(ui.state().elapsed > inDialog.elapsed);
  ui.document.hidden = true; ui.document.dispatch('visibilitychange');
  const hidden = ui.state(); ui.runFor(10); assert.deepEqual(ui.state(), hidden);
  ui.document.hidden = false; ui.document.dispatch('visibilitychange'); ui.runFor(1);
  assert.ok(ui.state().elapsed > hidden.elapsed && ui.state().elapsed <= hidden.elapsed+1, 'hidden wall time is not simulated on return');
});

test('victory pays once, freezes finished combat, and replay restores all fighters before a second reward', async () => {
  const ui = createHarness(); await ui.loadAllImages(); ui.runFor(29);
  const victory = ui.state();
  assert.equal(victory.phase, 'victory');
  assert.ok(victory.elapsed >= 25 && victory.elapsed <= 28);
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
  assert.equal(reset.phase, 'running'); assert.equal(reset.elapsed, 0);
  assert.equal(reset.hero.hp, 200); assert.deepEqual(reset.enemies.map(enemy => enemy.hp), [100,60,65]);
  assert.equal(ui.node('#battle-result').hidden, true);
  assert.equal(ui.node('#hero-vital').textContent, '200 / 200 HP');
  for (const id of ['orc','archer','mage']) assert.equal(ui.node(`[data-fighter="${id}"]`).classes.has('is-defeated'), false);
  ui.runFor(29);
  assert.equal(ui.state().phase, 'victory');
  assert.equal(ui.storage.get('ember.test.gold.v1'), '50');
  ui.runFor(10); assert.equal(ui.storage.get('ember.test.gold.v1'), '50');
});
