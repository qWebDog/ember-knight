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
function createHarness({skin = 'bronze', preference, search = '', weapon, outfit, outfitColor, reducedMotion = false, fieldWidth = 800} = {}) {
  const storage = new Map([['ember.character.v1', JSON.stringify({version:1, skin, name:'Тестовый герой', level:1,weapon,outfit,outfitColor})]]);
  if (preference) storage.set('ember.combat.auto.v1', preference);
  const nodes = new Map(), pendingImages = [], loadedPaths = [], raf = [], resizeCallbacks = [], events = [];
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
      this.clientWidth = fieldWidth; this.offsetWidth = 64; this.offsetLeft = 0;
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
    actor.actor = id; actor.offsetLeft = (160 + index * 140) * fieldWidth / 800;
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
    innerWidth:fieldWidth, innerHeight:800, location:{search},
    matchMedia:() => ({matches:reducedMotion}), addEventListener() {},
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
  window.EmberCombat.createBattle = options => {
    battle = createBattle(options);
    const advance = battle.advance;
    battle.advance = (seconds, availability) => {
      const emitted = advance(seconds, availability);
      events.push(...JSON.parse(JSON.stringify(emitted)));
      return emitted;
    };
    return battle;
  };
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
  function orcX() { return Number.parseFloat(node('[data-fighter="orc"]').style.left); }
  function inMeleeRange() {
    const separation=node('[data-fighter="hero"]').offsetWidth*.23+node('[data-fighter="orc"]').offsetWidth*.34;
    return Math.abs(orcX()-heroX()) <= separation+.01;
  }
  function visualState() {
    return {state:state(), x:heroX(), orcX:orcX(), draws:node('#player-sprite').draws.length, lastDraw:node('#player-sprite').draws.at(-1), orcDraws:node('#enemy-orc').draws.length,lastOrcDraw:node('#enemy-orc').draws.at(-1)};
  }
  function resizeField(width,modelSize) {
    const ratio = width/node('.battlefield').clientWidth;
    node('.battlefield').clientWidth = width; node('.adventure').clientWidth = width;
    window.innerWidth = width;
    for (const id of ['orc','archer','mage']) node(`[data-fighter="${id}"]`).offsetLeft *= ratio;
    if(modelSize)for(const id of ['hero','orc','archer','mage'])node(`[data-fighter="${id}"]`).offsetWidth=modelSize;
    resizeCallbacks.forEach(callback => callback());
  }
  return {node, storage, loadedPaths, document, state, events, loadNextImage, loadAllImages, runFor, runUntil, frame, heroX, orcX, inMeleeRange, visualState, resizeField};
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
  assert.equal(ui.state().phase, 'running', 'ranged attacks stay active while melee fighters approach');
  assert.equal(ui.node('#auto-button').disabled, false);
  assert.ok(ui.loadedPaths.includes('assets/characters/combat/bronze-walk.png'));
  assert.ok(ui.loadedPaths.includes('assets/characters/combat/bronze-attack.png'));
  assert.deepEqual(ui.node('#player-sprite').draws.at(-1).crop, [0,192,64,64]);
  assert.equal(ui.node('[data-fighter="hero"]').dataset.motion, 'idle', 'the hero does not step before any distance is travelled');
  for (const id of ['orc','archer','mage']) assert.equal(ui.node(`#enemy-${id}`).draws.at(-1).crop[1], 64);
  const initialOrcX=ui.orcX();
  ui.runFor(.8);
  assert.ok(ui.orcX()<initialOrcX,'the melee enemy also walks toward the hero');
  assert.ok(ui.state().elapsed > 0, 'the world clock advances during approach');
  assert.equal(ui.state().hero.hp, 200);
  assert.equal(ui.state().enemies[0].hp, 100, 'neither side attacks from a distance during approach');
  const walking = ui.node('#player-sprite').draws.filter(draw => draw.src.endsWith('bronze-walk.png'));
  assert.ok(new Set(walking.map(draw => draw.crop[0])).size >= 5, 'travel advances several real gait frames');
  assert.ok(walking.every(draw => draw.crop[0] >= 64 && draw.crop[0] <= 512 && draw.crop[1] === 192));
  ui.runUntil(() => ui.node('[data-fighter="hero"]').dataset.motion === 'idle', 3);
  assert.equal(ui.state().enemies[0].hp, 100, 'the hero stands before the first timed attack');
  const orc = ui.node('[data-fighter="orc"]');
  const expectedX = ui.orcX() - (64*.23 + orc.offsetWidth*.34);
  assert.ok(Math.abs(ui.heroX()-expectedX) < .01, 'hero is actually in contact range');
  ui.runUntil(() => ui.state().enemies[0].hp < 100, 2);
  assert.ok(ui.node('#player-sprite').draws.some(draw => draw.src === 'assets/characters/combat/bronze-attack.png'));
  assert.equal(ui.state().enemies[0].hp, 91);
});

test('auto, dialog and page visibility freeze location, animation, active combat time and damage', async () => {
  const ui = createHarness(); await ui.loadAllImages(); ui.runFor(.2);
  assert.equal(ui.node('[data-fighter="hero"]').dataset.motion, 'walk');
  ui.node('#auto-button').click();
  const paused = ui.visualState();
  assert.equal(paused.state.phase, 'paused');
  assert.equal(ui.storage.get('ember.combat.auto.v1'), 'off');
  ui.runFor(10); assert.deepEqual(ui.visualState(), paused);
  ui.node('#auto-button').click(); ui.runFor(.2);
  assert.ok(ui.heroX() > paused.x);
  ui.node('#profile-button').click();
  assert.equal(ui.node('#game-dialog').open, true);
  const inDialog = ui.visualState(); ui.runFor(5); assert.deepEqual(ui.visualState(), inDialog);
  ui.node('#game-dialog').close(); ui.runFor(.2);
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
  assert.ok(victory.elapsed > 27.6 && victory.elapsed < 40, 'world time includes approaches while only melee cooldowns freeze');
  assert.ok(Math.abs(wallSeconds-victory.elapsed)<.2, 'world time follows visible unpaused time');
  assert.ok(victory.hero.hp > 0 && victory.hero.hp < 58, 'incoming ranged attacks continue during retargeting');
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

test('the approaching orc walks, ranged enemies stay still, and contact uses the actual axe animation', async () => {
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
    if(id==='orc')assert.ok(actor.motionHistory.includes('walk'),'the melee orc approaches with a gait');
    else assert.ok(!actor.motionHistory.includes('walk'), `${id} stays at range`);
    assert.equal(actor.dataset.motion, 'idle');
  }
  const walkFrames=canvas.draws.filter(draw=>draw.src.endsWith('orc-walk.png'));
  assert.ok(walkFrames.some(draw=>draw.crop[0]>0),'orc uses travelling frames');
  assert.ok(walkFrames.every(draw=>draw.crop[1]===64),'orc walks facing left');
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


test('all three fixed outfits and six clothing colors appear in battle with matching weapon animation and range',async()=>{
 const catalogue=require('../dist/loadouts.js');
 for(const weapon of catalogue.weapons)for(const color of catalogue.colors){
  const outfit=weapon.outfits[0];
  const ui=createHarness({skin:'olive',weapon:weapon.id,outfit:outfit.id,outfitColor:color.id});await ui.loadAllImages();
  const root=`assets/characters/loadouts/${weapon.id}/${outfit.id}/${color.id}/olive-`;
  assert.ok(ui.loadedPaths.includes(root+'walk.png'));assert.ok(ui.loadedPaths.includes(root+'attack.png'));
  const start=ui.heroX();ui.runFor(.7);
  if(weapon.projectile==='melee')assert.ok(ui.heroX()>start);else{assert.equal(ui.heroX(),start);assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'idle');}
  ui.runUntil(()=>ui.node('#player-sprite').draws.some(d=>d.src===root+'attack.png'));
  const attacks=ui.node('#player-sprite').draws.filter(d=>d.src===root+'attack.png');assert.ok(attacks.every(d=>d.crop[2]===weapon.attack.tile&&d.crop[1]===weapon.attack.tile*3));
  ui.node('#profile-button').click();assert.ok(ui.node('#dialog-copy').textContent.includes(outfit.name));assert.ok(ui.node('#dialog-copy').textContent.includes(color.name.toLowerCase()));ui.node('#game-dialog').close();
  ui.runUntil(()=>ui.state().phase==='victory',60);assert.equal(ui.storage.get('ember.test.gold.v1'),'25');
 }
});

test('a previously saved alternative wardrobe uses the new fixed outfit without losing the hero skin',async()=>{
 const ui=createHarness({skin:'bronze',weapon:'sword',outfit:'watchman'});await ui.loadAllImages();
 assert.ok(ui.loadedPaths.includes('assets/characters/loadouts/sword/militia/blue/bronze-walk.png'));
 assert.equal(JSON.parse(ui.storage.get('ember.character.v1')).outfit,'watchman');
 ui.node('#profile-button').click();assert.ok(ui.node('#dialog-copy').textContent.includes('Ополченец'));
});


test('both melee fighters close the gap without crossing; dead orc stays put and replay restores its spawn',async()=>{
 const ui=createHarness();await ui.loadAllImages();const startH=ui.heroX(),startO=ui.orcX();
 ui.runFor(.5);assert.ok(ui.heroX()>startH);assert.ok(ui.orcX()<startO);
 assert.ok(Math.abs((ui.heroX()-startH)-(startO-ui.orcX()))<1e-8,'equal-sized units meet half way');
 ui.runUntil(()=>ui.inMeleeRange());
 assert.ok(Math.abs(ui.orcX()-ui.heroX()-64*.57)<.01,'actors stop at melee range');
 ui.runUntil(()=>ui.state().enemies[0].hp===0);const deadX=ui.orcX();
 ui.runFor(3);assert.equal(ui.orcX(),deadX);
 ui.runUntil(()=>ui.state().phase==='victory');assert.equal(ui.orcX(),deadX);
 ui.node('#replay-button').click();assert.equal(ui.orcX(),startO);assert.equal(ui.heroX(),startH);assert.equal(ui.node('[data-fighter="orc"]').dataset.motion,'idle');
});

test('orc approaches a stationary bow or wand user, with no melee damage before contact',async()=>{
 for(const [weapon,outfit]of [['bow','wanderer'],['wand','acolyte']]){
  const ui=createHarness({weapon,outfit});await ui.loadAllImages();const h=ui.heroX(),o=ui.orcX();ui.runFor(.8);
  assert.equal(ui.heroX(),h);assert.ok(ui.orcX()<o);assert.ok(ui.state().elapsed>0);assert.equal(ui.state().hero.hp,200);
  assert.equal(ui.node('[data-fighter="orc"]').dataset.motion,'walk');assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'idle');
  ui.runUntil(()=>ui.inMeleeRange());assert.ok(Math.abs(ui.orcX()-ui.heroX()-64*.57)<.01);
  assert.ok(ui.events.some(event=>event.type==='attack' && event.sourceId==='hero'),'a ranged hero attacks during the orc approach');
  assert.ok(!ui.events.some(event=>event.type==='attack' && event.sourceId==='orc'),'orc cannot hit before its in-range cooldown elapses');
  ui.runUntil(()=>ui.state().phase==='victory');assert.equal(ui.state().hero.hp,58);assert.equal(ui.storage.get('ember.test.gold.v1'),'25');
 }
});

test('paused viewport changes rescale both melee fighters once and preserve contact with a new model size',async()=>{
 const ui=createHarness();await ui.loadAllImages();ui.runUntil(()=>ui.inMeleeRange());ui.node('#auto-button').click();
 const h=ui.heroX(),o=ui.orcX(),middle=(h+o)/2,elapsed=ui.state().elapsed;
 ui.resizeField(1000,50);assert.ok(Math.abs((ui.heroX()+ui.orcX())/2-middle*1.25)<1e-8);assert.ok(Math.abs(ui.orcX()-ui.heroX()-50*.57)<.01);
 const h2=ui.heroX(),o2=ui.orcX();ui.frame(0);assert.equal(ui.heroX(),h2);assert.equal(ui.orcX(),o2);assert.equal(ui.state().elapsed,elapsed);
});

test('sword combo selects all three native sheets and plays every frame of the 13-frame heavy backslash', async () => {
  const ui = createHarness({skin:'bronze',weapon:'sword',outfit:'militia',outfitColor:'red'});
  await ui.loadAllImages();
  const prefix = 'assets/characters/loadouts/sword/militia/red/bronze-';
  const hero = ui.node('[data-fighter="hero"]'), canvas = ui.node('#player-sprite');
  for (const file of ['halfslash.png','attack.png','backslash.png']) assert.ok(ui.loadedPaths.includes(prefix+file));
  for (const [variant,file] of [['halfslash','halfslash.png'],['slash','attack.png'],['backslash','backslash.png']]) {
    ui.runUntil(() => hero.dataset.attack === variant);
    assert.equal(canvas.draws.at(-1).src, prefix+file);
    assert.deepEqual(canvas.draws.at(-1).crop, [0,384,128,128], `${variant} begins at its own native first frame`);
    assert.equal(canvas.width,128); assert.equal(canvas.height,128);
    assert.equal(canvas.style.width,'200%'); assert.equal(canvas.style.height,'200%');
    assert.equal(canvas.style.left,'-50%'); assert.equal(canvas.style.top,'-50%');
    assert.equal(hero.classes.has('is-heavy'),variant === 'backslash');
    if (variant === 'backslash') assert.ok(ui.node('.battlefield').children.some(element => element.className.includes('heavy-number')));
  }
  for (let i=0;i<80 && hero.dataset.attack === 'backslash';i++) ui.frame(16);
  const heavyFrames = canvas.draws.filter(draw => draw.src === prefix+'backslash.png');
  assert.deepEqual([...new Set(heavyFrames.map(draw => draw.crop[0]/128))].sort((a,b)=>a-b), [...Array(13).keys()]);
  assert.ok(heavyFrames.every(draw => draw.crop[1]===384 && draw.crop[2]===128 && draw.crop[3]===128));
  const regular = ui.events.filter(event => event.type==='attack' && event.sourceId==='hero' && !event.counter);
  assert.deepEqual(regular.slice(0,3).map(event => [event.variant,event.comboStep,Boolean(event.heavy)]), [
    ['halfslash',1,false],['slash',2,false],['backslash',3,true]
  ]);
});

test('shield block and fast counter use separate feedback; pause freezes them and replay clears sword state', async () => {
  const ui = createHarness({weapon:'sword',outfit:'militia',outfitColor:'sand'});
  await ui.loadAllImages();
  const hero = ui.node('[data-fighter="hero"]');
  let hpBeforeBlock=ui.state().hero.hp, eventCountBeforeBlock=ui.events.length;
  ui.runUntil(() => {
    if(ui.events.some(event=>event.type==='block'))return true;
    hpBeforeBlock=ui.state().hero.hp;eventCountBeforeBlock=ui.events.length;return false;
  });
  const block = ui.events.find(event => event.type==='block');
  assert.equal(block.targetId,'hero'); assert.equal(block.blockedDamage,3);
  const incoming=ui.events.slice(eventCountBeforeBlock).filter(event=>event.type==='attack'&&event.targetId==='hero');
  assert.equal(incoming.find(event=>event.sourceId===block.sourceId).damage,3,'the shield absorbs half of the six-damage melee hit');
  assert.equal(ui.state().hero.hp,hpBeforeBlock-incoming.reduce((sum,event)=>sum+event.damage,0));
  assert.equal(ui.node('healthbar:hero:fill').style.width, `${ui.state().hero.hp/ui.state().hero.maxHp*100}%`);
  assert.equal(hero.classes.has('is-blocking'),true);
  assert.equal(hero.dataset.motion,'block','a block uses the original guarded body-and-shield pose');
  assert.equal(hero.dataset.attack,'','the interrupted swing cannot leak through the guard pose');
  const guard=ui.node('#player-sprite').draws.at(-1);
  assert.ok(guard.src.endsWith('/sand/bronze-block.png'));
  assert.deepEqual(guard.crop,[0,192,64,64]);
  assert.equal(ui.node('#player-sprite').style.width,'100%');
  assert.equal(ui.node('#player-sprite').style.left,'0%');
  assert.ok(ui.node('.battlefield').children.some(element => element.className.includes('block-number') && element.textContent==='Блок'));
  const visual = () => ({...ui.visualState(),attack:hero.dataset.attack,counter:hero.dataset.counter,heavy:hero.classes.has('is-heavy'),blocking:hero.classes.has('is-blocking'),effects:ui.node('.battlefield').children.map(element=>({className:element.className,text:element.textContent,left:element.style.left,top:element.style.top,opacity:element.style.opacity}))});
  ui.node('#auto-button').click(); const paused = visual(); ui.runFor(2); assert.deepEqual(visual(),paused);
  ui.node('#auto-button').click();
  ui.runUntil(() => ui.events.some(event => event.type==='attack' && event.counter));
  const counter = ui.events.find(event => event.type==='attack' && event.counter);
  assert.equal(counter.sourceId,'hero'); assert.equal(counter.variant,'halfslash');
  assert.ok(counter.animationDuration < ui.events.find(event=>event.sourceId==='hero' && !event.counter).animationDuration);
  assert.equal(hero.dataset.attack,'halfslash'); assert.equal(hero.dataset.counter,'true');
  assert.equal(hero.classes.has('is-heavy'),false);
  assert.ok(ui.node('#player-sprite').draws.at(-1).src.endsWith('-halfslash.png'));
  assert.ok(ui.node('.battlefield').children.some(element=>element.className.includes('counter-number') && element.textContent.startsWith('Ответ')));
  ui.node('#auto-button').click(); const pausedCounter=visual(); ui.runFor(2); assert.deepEqual(visual(),pausedCounter);
  ui.node('#auto-button').click(); ui.runUntil(()=>ui.state().phase==='victory',60);
  const eventCount=ui.events.length; ui.node('#replay-button').click();
  assert.equal(hero.dataset.attack,''); assert.equal(hero.dataset.counter,'false');
  assert.equal(hero.classes.has('is-heavy'),false); assert.equal(hero.classes.has('is-blocking'),false);
  assert.equal(ui.node('.battlefield').children.length,0,'old floating block/counter effects do not survive replay');
  ui.runUntil(()=>ui.events.slice(eventCount).some(event=>event.type==='attack' && event.sourceId==='hero'));
  const first=ui.events.slice(eventCount).find(event=>event.type==='attack' && event.sourceId==='hero');
  assert.equal(first.variant,'halfslash'); assert.equal(first.comboStep,1); assert.equal(Boolean(first.counter),false);
});

test('bow and wand retain their own attacks and never load or render sword combo or shield effects', async () => {
  for (const [weapon,outfit,projectile] of [['bow','wanderer','arrow'],['wand','acolyte','magic']]) {
    const ui=createHarness({weapon,outfit,outfitColor:'blue'}); await ui.loadAllImages();
    ui.runUntil(()=>ui.state().phase==='victory',60);
    assert.ok(!ui.loadedPaths.some(file=>file.endsWith('-halfslash.png') || file.endsWith('-backslash.png') || file.endsWith('-block.png')));
    assert.ok(ui.events.filter(event=>event.type==='attack' && event.sourceId==='hero').every(event=>event.projectile===projectile && !event.counter && !event.heavy && !['halfslash','slash','backslash'].includes(event.variant)));
    assert.ok(!ui.events.some(event=>event.type==='block'));
    assert.equal(ui.state().elapsed,27.6); assert.equal(ui.state().hero.hp,58);
    assert.equal(ui.storage.get('ember.test.gold.v1'),'25');
  }
});

test('reduced motion suppresses sword animation and block effects while combat still resolves with valid rewards', async () => {
  const options={weapon:'sword',outfit:'militia',outfitColor:'forest'};
  const normal=createHarness(options), reduced=createHarness({...options,reducedMotion:true});
  await normal.loadAllImages(); await reduced.loadAllImages();
  reduced.runUntil(()=>reduced.events.some(event=>event.type==='attack' && event.counter),60);
  const hero=reduced.node('[data-fighter="hero"]');
  assert.equal(hero.dataset.motion,'idle'); assert.equal(hero.dataset.attack,''); assert.equal(hero.dataset.counter,'false');
  assert.equal(hero.classes.has('is-heavy'),false); assert.equal(hero.classes.has('is-blocking'),false);
  assert.equal(reduced.node('.battlefield').children.length,0);
  assert.ok(reduced.node('#player-sprite').draws.every(draw=>draw.src.endsWith('-walk.png')),'reduced-motion hero holds the equipped idle pose');
  normal.runUntil(()=>normal.state().phase==='victory',60); reduced.runUntil(()=>reduced.state().phase==='victory',60);
  for(const ui of [normal,reduced]){
    assert.equal(ui.state().defeatedCount,3);assert.equal(ui.state().reward,25);
    assert.ok(ui.state().hero.hp>0&&ui.state().hero.hp<=ui.state().hero.maxHp);
    assert.equal(ui.events.filter(event=>event.type==='end').length,1);
    assert.ok(ui.events.some(event=>event.type==='block'));
    assert.ok(ui.events.some(event=>event.type==='attack'&&event.counter));
  }
  assert.ok(normal.state().elapsed>reduced.state().elapsed,'instant reduced-motion positioning removes travel time');
  assert.ok(normal.state().hero.hp<=reduced.state().hero.hp,'extra travel can expose the normal hero to more ranged fire');
  assert.equal(reduced.storage.get('ember.test.gold.v1'),'25');
});

test('archer and mage attack throughout a long initial approach while both melee attacks remain out of range',async()=>{
  const ui=createHarness({fieldWidth:3200});await ui.loadAllImages();
  assert.equal(ui.state().phase,'running');assert.equal(ui.inMeleeRange(),false);
  ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.sourceId==='archer'),5);
  const arrow=ui.node('.battlefield').children.find(element=>element.className.includes('projectile arrow'));
  assert.ok(arrow);
  assert.equal(arrow.src,'assets/projectiles/arrow.png','the archer uses the supplied arrow artwork');
  assert.equal(arrow.alt,'');
  assert.match(arrow.style.transform,/rotate\(-?[\d.]+deg\)/);
  assert.equal(ui.node('[data-fighter="archer"]').dataset.motion,'attack');
  assert.ok(ui.node('#enemy-archer').draws.at(-1).src.endsWith('skeleton-shoot.png'));
  ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.sourceId==='mage'),2);
  assert.ok(ui.node('.battlefield').children.some(element=>element.className.includes('projectile magic')));
  assert.equal(ui.node('[data-fighter="mage"]').dataset.motion,'attack');
  assert.ok(ui.node('#enemy-mage').draws.at(-1).src.endsWith('mage-spellcast.png'));
  assert.equal(ui.inMeleeRange(),false,'the approach lasts longer than both ranged attack timers');
  assert.ok(ui.state().elapsed>=3.8);assert.equal(ui.state().hero.hp,183);
  assert.equal(ui.state().enemies[0].hp,100);
  assert.ok(!ui.events.some(event=>event.type==='attack'&&['hero','orc'].includes(event.sourceId)),'neither melee fighter attacks from a distance');
  assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'walk');
  assert.equal(ui.node('[data-fighter="orc"]').dataset.motion,'walk');
  ui.runUntil(()=>ui.inMeleeRange(),5);const contactTime=ui.state().elapsed;
  ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.sourceId==='hero'),2);
  const first=ui.events.find(event=>event.type==='attack'&&event.sourceId==='hero');
  assert.ok(first.at>contactTime,'the melee cooldown resumes after reaching contact');
});

test('ranged fire and damage continue while the hero walks to the next target after the orc dies',async()=>{
  const ui=createHarness();await ui.loadAllImages();
  ui.runUntil(()=>ui.state().enemies[0].hp===0);
  const start=ui.events.length,hp=ui.state().hero.hp,heroX=ui.heroX(),corpseX=ui.orcX();
  assert.equal(ui.state().targetId,'archer');assert.equal(ui.state().phase,'running');
  ui.runUntil(()=>['archer','mage'].every(id=>ui.events.slice(start).some(event=>event.type==='attack'&&event.sourceId===id)),6);
  assert.ok(ui.heroX()>heroX);assert.equal(ui.orcX(),corpseX);
  assert.ok(ui.state().hero.hp<hp);
  assert.ok(ui.node('[data-fighter="hero"]').motionHistory.includes('walk'));
  const target=ui.node('[data-fighter="archer"]');
  assert.ok(target.offsetLeft-ui.heroX()>64*.23+target.offsetWidth*.34,'ranged enemies attacked before the next melee contact');
  assert.ok(!ui.events.slice(start).some(event=>event.type==='attack'&&event.sourceId==='hero'));
  ui.runUntil(()=>ui.state().phase==='victory');
  assert.equal(ui.storage.get('ember.test.gold.v1'),'25');
});
