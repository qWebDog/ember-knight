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
function createHarness({skin = 'bronze', preference, search = '', weapon, outfit, outfitColor, magic, reducedMotion = false, fieldWidth = 800, modelSize = 64, arenaHeight = 400, fieldHeight = 180, fieldBottomGap = 62, roadGround = 36, viewportHeight = 800, combatOptions = {}, savedProgression, legacyGold, storageBlocked = false, wolfEquipped = false, dragonBoss = false, mixedWave = false} = {}) {
  const storage = new Map([['ember.character.v1', JSON.stringify({version:1, skin, name:'Тестовый герой', level:1,weapon,outfit,outfitColor,magic})]]);
  if (wolfEquipped) storage.set('ember.equipment.v1',
    JSON.stringify({version:1,byClass:{
      sword:{companion:'wolf'},bow:{companion:'wolf'},wand:{companion:'wolf'}
    }}));
  if (preference) storage.set('ember.combat.auto.v1', preference);
  if (savedProgression) storage.set('ember.progress.v1', JSON.stringify(savedProgression));
  if (legacyGold !== undefined) storage.set('ember.test.gold.v1', String(legacyGold));
  const nodes = new Map(), pendingImages = [], loadedPaths = [], raf = [], resizeCallbacks = [], events = [];
  let battle, skillMount, now = 0, restarts = 0;
  const actorIds=['hero','archer1','archer2','archer3','orc',...(mixedWave?['skeletonSword1','skeletonSword2']:[]),...(dragonBoss?['dragon']:[])];
  const enemyIds=actorIds.filter(id=>id!=='hero');
  const spawnRatios={hero:.18,archer1:.70,archer2:.62,archer3:.82,orc:.60,skeletonSword1:.51,skeletonSword2:.60,dragon:.76};
  const restartStates=[];

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
      this.clientWidth = fieldWidth; this.clientHeight = selector==='.battlefield'?fieldHeight:arenaHeight; this.offsetWidth = modelSize; this.offsetLeft = 0;
      this.classList = {toggle:(name, enabled) => {
        if (enabled === undefined) enabled = !this.classes.has(name);
        if (enabled) this.classes.add(name); else this.classes.delete(name);
        return enabled;
      },contains:name=>this.classes.has(name),add:(...names)=>names.forEach(name=>this.classes.add(name)),remove:(...names)=>names.forEach(name=>this.classes.delete(name))};
    }
    addEventListener(type, callback) { (this.handlers[type] ||= []).push(callback); }
    dispatch(type, extra = {}) { for (const callback of this.handlers[type] || []) callback({target:this, ...extra}); }
    click() { if (!this.disabled) this.dispatch('click'); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    querySelector(selector) {
      if(this.selector==='#companion-wolf'&&selector==='canvas')return node('companion:canvas');
      if (this.actor) {
        if (selector === 'canvas') return node(this.actor === 'hero' ? '#player-sprite' : `#enemy-${this.actor}`);
        if (selector === '.healthbar') return node(`healthbar:${this.actor}`);
        if (selector === '.enemy-name') return node(`name:${this.actor}`);
        if (selector === '.fighter-name') return node('.fighter-name');
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
      // Model the actual responsive CSS dimensions of the original dragon
      // atlas. The flame origin is anchored to this canvas, not the fighter.
      if(this.selector==='#enemy-dragon'){
        const actor=node('[data-fighter="dragon"]').getBoundingClientRect();
        const width=window.innerWidth>700?164:127;
        const height=width*161/205,bottom=actor.bottom-(window.innerWidth>700?7:4);
        const left=actor.left+actor.width/2-width/2;
        return {left,top:bottom-height,right:left+width,bottom,width,height};
      }
      const parsed = Number.parseFloat(this.style.left),centerX = Number.isFinite(parsed)?parsed:this.offsetLeft;
      if (this.actor) {
        const width=this.offsetWidth,field=node('.battlefield').getBoundingClientRect();
        const ground=Number.parseFloat(node('.battlefield').style['--road-ground'])||roadGround;
        const depthOffset=Number.parseFloat(this.style['--lane-offset'])||0;
        const bottom=field.bottom-ground+depthOffset,left=centerX-width/2;
        return {left,right:left+width,top:bottom-width,bottom,width,height:width};
      }
      if(this.selector==='#companion-wolf'){
        const field=node('.battlefield').getBoundingClientRect();
        const ground=Number.parseFloat(node('.battlefield').style['--road-ground'])||roadGround;
        const depthOffset=Number.parseFloat(this.style['--lane-offset'])||0;
        const width=modelSize,centerX=Number.parseFloat(this.style.left)||0;
        const bottom=field.bottom-ground+depthOffset;
        return {left:centerX-width/2,right:centerX+width/2,top:bottom-width,bottom,width,height:width};
      }
      if(this.selector==='.battlefield')return {left:0,right:this.clientWidth,top:arenaHeight-fieldBottomGap-fieldHeight,bottom:arenaHeight-fieldBottomGap,width:this.clientWidth,height:fieldHeight};
      return {left:0,right:this.clientWidth,top:0,bottom:arenaHeight,width:this.clientWidth,height:arenaHeight};
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
  for (const id of actorIds) {
    assert.ok(html.includes(`data-fighter="${id}"`));
    const actor = node(`[data-fighter="${id}"]`);
    actor.actor = id; actor.dataset.fighter=id; actor.dataset.type=id.startsWith('archer')?'archer':id;
    actor.offsetLeft = spawnRatios[id]*fieldWidth;
    const tag=html.match(new RegExp(`<[^>]+data-fighter="${id}"[^>]*>`))[0];
    actor.hidden=/\bhidden\b/.test(tag);
    for(const name of (tag.match(/class="([^"]*)"/)?.[1]||'').split(/\s+/))if(name)actor.classes.add(name);
  }
  node('#battle-result').hidden = true;
  node('.battlefield').style.setProperty('--road-ground',`${roadGround}px`);
  const waves = [node('wave:0'),node('wave:1'),node('wave:2'),
    ...(dragonBoss?[node('wave:3')]:[])];
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
      if (selector === '[data-fighter]') return actorIds.map(id=>node(`[data-fighter="${id}"]`));
      if (selector === '.enemy') return enemyIds.map(id=>node(`[data-fighter="${id}"]`));
      throw new Error(`Unimplemented selector ${selector}`);
    }
  });
  class ImageStub {
    set src(value) {
      this.path = value;
      const data = fs.readFileSync(path.join(dist, value));
      if(value.endsWith('.svg')){
        const svg=data.toString('utf8'),size=svg.match(/<svg[^>]+width="(\d+)"[^>]+height="(\d+)"/);assert.ok(size);
        this.width=this.naturalWidth=Number(size[1]);this.height=this.naturalHeight=Number(size[2]);
      }else{
        assert.equal(data.subarray(1,4).toString(), 'PNG');
        this.width = this.naturalWidth = data.readUInt32BE(16); this.height = this.naturalHeight = data.readUInt32BE(20);
      }
      pendingImages.push(this); loadedPaths.push(value);
    }
    get src() { return this.path; }
  }
  const window = {
    innerWidth:fieldWidth, innerHeight:viewportHeight, location:{search},
    matchMedia:() => ({matches:reducedMotion}), addEventListener() {},
    requestAnimationFrame:callback => raf.push(callback),
    EmberSkillPanel:{mount:options => {skillMount = options; return {destroy() {}};}}
  };
  const context = vm.createContext({
    window, document, Image:ImageStub, URLSearchParams,
    getComputedStyle:element=>({getPropertyValue:name=>element.style[name]??(name==='--road-ground'?`${roadGround}px`:'')}),
    ResizeObserver:class {constructor(callback) {this.callback = callback;} observe() {resizeCallbacks.push(this.callback); this.callback();}},
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key,value) => {if(storageBlocked)throw new Error('storage blocked');storage.set(key,String(value));}}
  });
  vm.runInContext(fs.readFileSync(path.join(dist,'loadouts.js'),'utf8'), context, {filename:'loadouts.js'});
  vm.runInContext(combatSource, context, {filename:'combat.js'});
  vm.runInContext(fs.readFileSync(path.join(dist,'progression.js'),'utf8'), context, {filename:'progression.js'});
  if(wolfEquipped){
    window.localStorage={
      getItem:key=>storage.get(key)??null,
      setItem:(key,value)=>storage.set(key,String(value))
    };
    vm.runInContext(fs.readFileSync(path.join(dist,'equipment.js'),'utf8'),context,{filename:'equipment.js'});
    vm.runInContext(fs.readFileSync(path.join(dist,'companion.js'),'utf8'),context,{filename:'companion.js'});
  }
  if(dragonBoss)vm.runInContext(fs.readFileSync(path.join(dist,'dragon.js'),'utf8'),
    context,{filename:'dragon.js'});
  const createBattle = window.EmberCombat.createBattle;
  window.EmberCombat.createBattle = options => {
    battle = createBattle({...options,skeletonSwordsEnabled:mixedWave,...combatOptions});
    const advance = battle.advance;
    battle.advance = (seconds, availability) => {
      const emitted = advance(seconds, availability);
      events.push(...JSON.parse(JSON.stringify(emitted)));
      return emitted;
    };
    const strike=battle.companionStrike;
    battle.companionStrike=(...args)=>{
      const emitted=strike(...args);
      events.push(...JSON.parse(JSON.stringify(emitted)));
      return emitted;
    };
    const restart=battle.restart;
    battle.restart=()=>{
      const reset=restart();restarts++;restartStates.push(JSON.parse(JSON.stringify(battle.getState())));return reset;
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
  function runUntil(condition, maxSeconds = 120) {
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
    return Math.abs(orcX()-heroX()) <= separation+.01&&Math.abs(footY('orc')-footY('hero'))<=.01;
  }
  function footY(id) {const rect=node(`[data-fighter="${id}"]`).getBoundingClientRect();return rect.bottom-rect.height*2/64;}
  function depth(id) {return Number(node(`[data-fighter="${id}"]`).dataset.depth);}
  function spells() {
    return node('.battlefield').children.filter(element=>String(element.className).includes('spell-projectile'));
  }
  function spellState() {
    return spells().map(element=>({magic:element.dataset.magic,phase:element.dataset.phase,left:element.style.left,top:element.style.top,transform:element.style.transform,width:element.width,height:element.height,draws:element.draws.length,lastDraw:element.draws.at(-1)}));
  }
  function statusCanvases(id) {
    return (id?[id]:actorIds).flatMap(actorId=>node(`[data-fighter="${actorId}"]`).children.filter(element=>element.className==='status-effect'));
  }
  function statusState() {
    return actorIds.flatMap(id=>statusCanvases(id).map(element=>({id,status:element.dataset.status,frame:element.dataset.frame,opacity:element.style.opacity,left:element.style.left,top:element.style.top,width:element.width,height:element.height,draws:element.draws.length,last:element.draws.at(-1)})));
  }
  function visualState() {
    return {state:state(), x:heroX(), orcX:orcX(), draws:node('#player-sprite').draws.length, lastDraw:node('#player-sprite').draws.at(-1), orcDraws:node('#enemy-orc').draws.length,lastOrcDraw:node('#enemy-orc').draws.at(-1)};
  }
  function resizeField(width,nextModelSize,view={}) {
    const ratio = width/node('.battlefield').clientWidth;
    node('.battlefield').clientWidth = width; node('.adventure').clientWidth = width;
    window.innerWidth = width;
    if(view.arenaHeight!==undefined)arenaHeight=view.arenaHeight;
    if(view.fieldHeight!==undefined)fieldHeight=view.fieldHeight;
    if(view.fieldBottomGap!==undefined)fieldBottomGap=view.fieldBottomGap;
    if(view.viewportHeight!==undefined)window.innerHeight=view.viewportHeight;
    if(view.roadGround!==undefined){roadGround=view.roadGround;node('.battlefield').style.setProperty('--road-ground',`${roadGround}px`);}
    node('.adventure').clientHeight=arenaHeight;node('.battlefield').clientHeight=fieldHeight;
    for (const id of enemyIds) node(`[data-fighter="${id}"]`).offsetLeft *= ratio;
    if(nextModelSize)for(const id of actorIds)node(`[data-fighter="${id}"]`).offsetWidth=nextModelSize;
    resizeCallbacks.forEach(callback => callback());
  }
  return {node,storage,get battle(){return battle;},
    get skillMount(){return skillMount;}, get progression(){return skillMount.store;}, loadedPaths, document, state, events, actorIds, enemyIds, restartStates, get runCount(){return restarts+1;}, loadNextImage, loadAllImages, runFor, runUntil, frame, heroX, orcX, footY, depth, inMeleeRange, spells, spellState, statusCanvases, statusState, visualState, resizeField};
}
function runFramesUntil(ui, condition, maxSeconds=5) {
  for(let count=0;!condition() && count<Math.ceil(maxSeconds*1000/16);count++)ui.frame(16);
  assert.ok(condition(),`animation condition not reached within ${maxSeconds}s`);
}
function assertSpellCells(spell,magic) {
  assert.equal(spell.width,64);assert.equal(spell.height,64);
  for(const row of [0,1,2]){
    const draws=spell.draws.filter(draw=>draw.crop[1]===row*64);
    assert.deepEqual([...new Set(draws.map(draw=>draw.crop[0]/64))].sort((a,b)=>a-b),[0,1,2,3,4,5]);
    assert.ok(draws.every(draw=>draw.src===`assets/magic/${magic}.png` && draw.crop[2]===64 && draw.crop[3]===64));
  }
}


function visibleEnemies(ui){return ui.enemyIds.filter(id=>!ui.node(`[data-fighter="${id}"]`).hidden);}
function actorX(ui,id){return Number.parseFloat(ui.node(`[data-fighter="${id}"]`).style.left);}
function inReach(ui,id){return Math.abs(actorX(ui,id)-ui.heroX())<=ui.node('[data-fighter="hero"]').offsetWidth*.23+ui.node(`[data-fighter="${id}"]`).offsetWidth*.34+.01&&Math.abs(ui.footY(id)-ui.footY('hero'))<=.01;}
function kills(ui){return ui.events.filter(event=>event.type==='death'&&event.id!=='hero');}
function wallet(ui){return Number(ui.storage.get('ember.test.gold.v1')||0);}
function sceneSnapshot(ui){const fade=ui.node(html.includes('id="scene-fade"')?'#scene-fade':'.scene-fade');return {opacity:Number(fade.style.opacity||0),phase:fade.dataset.phase||'',resultHidden:ui.node('#battle-result').hidden,title:ui.node('#result-title').textContent};}
function fullSnapshot(ui){return {combat:ui.state(),scene:sceneSnapshot(ui),spells:ui.spellState(),statuses:ui.statusState(),actors:ui.actorIds.map(id=>({id,x:actorX(ui,id),depth:ui.depth(id),footY:ui.footY(id),lane:ui.node(`[data-fighter="${id}"]`).dataset.lane,z:ui.node(`[data-fighter="${id}"]`).style.zIndex,hidden:ui.node(`[data-fighter="${id}"]`).hidden,motion:ui.node(`[data-fighter="${id}"]`).dataset.motion,draws:ui.node(id==='hero'?'#player-sprite':`#enemy-${id}`).draws.length,last:ui.node(id==='hero'?'#player-sprite':`#enemy-${id}`).draws.at(-1)}))};}

test('Warrior, Archer and Mage walk in from the left screen edge before the fight starts',async()=>{
 for(const selection of [
   {weapon:'sword',outfit:'militia'},
   {weapon:'bow',outfit:'wanderer'},
   {weapon:'wand',outfit:'acolyte',magic:'fire'}
 ]){
   const ui=createHarness(selection);await ui.loadAllImages();
   const start=ui.heroX(),home=800*.18,hero=ui.node('[data-fighter="hero"]');
   assert.equal(start,-hero.offsetWidth/2,'start fully outside the left edge, not at the battle position');
   assert.equal(ui.state().elapsed,0);
   ui.runFor(.3);
   assert.ok(ui.heroX()>start&&ui.heroX()<home,'hero moves into view');
   assert.equal(hero.dataset.motion,'walk','uses native animated LPC walk cells');
   assert.equal(ui.state().elapsed,0,'entrance must not consume cooldown or combat time');
   assert.ok(!ui.events.some(e=>e.type==='attack'||e.type==='cast'));
   ui.runFor(2.4);
   assert.ok(ui.heroX()>=home-1e-6,'hero reaches the proper starting location');
   assert.ok(ui.state().elapsed>0,'combat begins only after entering');
   assert.ok(!ui.node('.adventure').dataset.transition,'entrance does not hide an existing scene transition');
 }
});

test('all three waves repeat a calm left-edge walk before allowing any combat',async()=>{
 for(const selection of [
   {weapon:'sword',outfit:'militia'},
   {weapon:'bow',outfit:'wanderer'},
   {weapon:'wand',outfit:'acolyte',magic:'fire'}
 ]){
   const ui=createHarness(selection);await ui.loadAllImages();
   const size=ui.node('[data-fighter="hero"]').offsetWidth,edge=-size/2,home=800*.18;
   for(let wave=0;wave<3;wave++){
     if(wave>0)ui.runUntil(()=>ui.state().waveIndex===wave);
     const start=ui.heroX(),at=ui.state().elapsed;
     const emitted=ui.events.length,health=ui.state().hero.hp;
     assert.ok(start>=edge-1e-7&&start<edge+(home-edge)*.06,
       'each wave starts with the hero by the left edge');
     ui.runFor(.9);
     assert.ok(ui.heroX()>start&&ui.heroX()<home,'walking should be visibly gradual');
     assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'walk');
     assert.equal(ui.state().elapsed,at,'no combat time during the entrance');
     assert.equal(ui.events.length,emitted,'no attacks or casts occur while entering');
     assert.equal(ui.state().hero.hp,health,'enemies cannot deal damage during entrance');
     ui.runFor(1.8);
     assert.ok(ui.heroX()>=home-1e-6,'character reaches the correct start point');
     assert.ok(ui.state().elapsed>at,'battle resumes after the full walk');
   }
 }
});

test('the battle entrance pauses, survives a viewport resize and restarts at the left edge',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer'});await ui.loadAllImages();
 ui.runFor(.2);
 const before=ui.heroX(),time=ui.state().elapsed,draws=ui.node('#player-sprite').draws.length;
 ui.node('#auto-button').click();
 ui.runFor(.7);
 assert.equal(ui.heroX(),before,'auto-off freezes the entrance');
 assert.equal(ui.state().elapsed,time);
 assert.equal(ui.node('#player-sprite').draws.length,draws);
 ui.resizeField(1000);ui.frame(0);
 const oldStart=-ui.node('[data-fighter="hero"]').offsetWidth/2,oldHome=800*.18;
 const fraction=(before-oldStart)/(oldHome-oldStart);
 assert.ok(Math.abs(ui.heroX()-(oldStart+(1000*.18-oldStart)*fraction))<1e-7,'resize retains the percent-complete entrance');
 ui.node('#auto-button').click();ui.runFor(2.7);
 assert.equal(ui.heroX(),1000*.18,'ranged hero rests at the normal starting point');
 ui.node('#replay-button').click();
 assert.equal(ui.state().elapsed,0);
 assert.equal(ui.heroX(),-ui.node('[data-fighter="hero"]').offsetWidth/2,'restart starts fully outside the edge again');
 assert.equal(ui.state().waveIndex,0);
 ui.runFor(.3);
 assert.ok(ui.heroX()>-ui.node('[data-fighter="hero"]').offsetWidth/2&&ui.heroX()<1000*.18);
});

test('reduced-motion preference skips entrance without hiding the fighter or delaying combat',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',reducedMotion:true});await ui.loadAllImages();
 assert.equal(ui.heroX(),800*.18);
 ui.runFor(.4);assert.equal(ui.heroX(),800*.18);
 assert.ok(ui.state().elapsed>.2);
});

test('assets gate startup; the first wave shows one real LPC archer and the selected bare hero skin',async()=>{
 const ui=createHarness({skin:'bronze',preference:'off',search:'?battle=test'});
 assert.equal(ui.state().phase,'paused');assert.equal(ui.node('#auto-button').disabled,true);ui.runFor(2);assert.equal(ui.state().elapsed,0);
 await ui.loadNextImage();assert.equal(ui.state().phase,'paused');await ui.loadAllImages();
 assert.equal(ui.state().phase,'running');assert.equal(ui.node('#auto-button').disabled,false);
 assert.deepEqual(ui.state().enemies.map(enemy=>[enemy.id,enemy.type]),[['archer1','archer']]);
 assert.deepEqual(visibleEnemies(ui),['archer1']);assert.equal(ui.node('#wave-number').textContent,'1/3');assert.ok(!html.includes('data-fighter="mage"'));
 assert.ok(ui.loadedPaths.includes('assets/characters/combat/bronze-walk.png'));
 assert.ok(ui.loadedPaths.includes('assets/characters/combat/bronze-attack.png'));
 assert.deepEqual(ui.node('#player-sprite').draws.at(-1).crop,[0,192,64,64]);
 assert.equal(ui.node('#enemy-archer1').draws.at(-1).crop[1],64);
 const enemyX=actorX(ui,'archer1');ui.runFor(2.8);
 assert.ok(ui.heroX()>800*.18);assert.equal(actorX(ui,'archer1'),enemyX);assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'walk');
 assert.ok(ui.node('#player-sprite').draws.filter(draw=>draw.src.endsWith('bronze-walk.png')).every(draw=>draw.crop[0]>=64&&draw.crop[0]<=512&&draw.crop[1]===192));
 ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.sourceId==='hero'));
 assert.ok(inReach(ui,'archer1'));assert.ok(ui.node('#player-sprite').draws.some(draw=>draw.src.endsWith('bronze-attack.png')));
});

test('three waves have exact enemy topology, carry hero HP, and immediately save five coins for every kill',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer'});await ui.loadAllImages();
 const expected=[['archer1'],['archer2','archer3'],['orc']];
 for(let wave=0;wave<3;wave++){
  assert.equal(ui.state().waveIndex,wave);assert.deepEqual(visibleEnemies(ui),expected[wave]);
  assert.equal(ui.node('#wave-number').textContent,`${wave+1}/3`);
  ui.runUntil(()=>wave===2?ui.state().phase==='victory':ui.state().phase==='intermission');
  const cleared=ui.state(),hp=cleared.hero.hp;
  assert.equal(cleared.completedWaves,wave+1);assert.equal(wallet(ui),[5,15,20][wave]);
  assert.equal(wallet(ui),kills(ui).length*5);assert.ok(kills(ui).every(event=>event.reward===5));
  if(wave<2){
   assert.ok(ui.node('.battlefield').classes.has('is-between-waves'));
   ui.runUntil(()=>ui.state().waveIndex===wave+1);assert.equal(ui.state().hero.hp,hp,'wave spawn must not heal the hero');
   assert.ok(ui.node('wave:0').classes.has('done'));
  }
 }
 assert.equal(ui.state().defeatedCount,4);assert.equal(ui.state().reward,20);
 assert.deepEqual(kills(ui).map(event=>event.id),['archer1','archer2','archer3','orc']);
 const end=ui.events.find(event=>event.type==='end');assert.equal(end.reward,0);assert.equal(end.totalReward,20);
 assert.equal(ui.node('.gold').attributes['aria-label'],'Золото: 20');
 ui.node('#auto-button').click();ui.runFor(3);assert.equal(wallet(ui),20,'the terminal state must not add a victory bonus');
});

test('auto, dialogs and visibility freeze both battle motion and the intermission timer',async()=>{
 const ui=createHarness();await ui.loadAllImages();ui.runFor(.4);
 ui.node('#auto-button').click();const paused=fullSnapshot(ui);ui.runFor(4);assert.deepEqual(fullSnapshot(ui),paused);
 ui.node('#auto-button').click();ui.runFor(.2);assert.ok(ui.heroX()>paused.actors[0].x);
 ui.node('#profile-button').click();const dialog=fullSnapshot(ui);ui.runFor(3);assert.deepEqual(fullSnapshot(ui),dialog);
 ui.node('#game-dialog').close();ui.runFor(.2);ui.document.hidden=true;ui.document.dispatch('visibilitychange');
 const hidden=fullSnapshot(ui);ui.runFor(4);assert.deepEqual(fullSnapshot(ui),hidden);
 ui.document.hidden=false;ui.document.dispatch('visibilitychange');ui.runUntil(()=>ui.state().phase==='intermission');
 const hp=ui.state().hero.hp;ui.node('#auto-button').click();const between=fullSnapshot(ui);ui.runFor(4);assert.deepEqual(fullSnapshot(ui),between);
 assert.ok(ui.node('.battlefield').classes.has('is-between-waves'));
 ui.node('#auto-button').click();ui.runUntil(()=>ui.state().waveIndex===1,2);assert.equal(ui.state().hero.hp,hp);
});

test('automatic victory loops restore HP and appearance, reuse enemy IDs, and pay exactly twenty coins per run',async()=>{
 const ui=createHarness({skin:'black',weapon:'wand',outfit:'acolyte',outfitColor:'forest',magic:'ice'});await ui.loadAllImages();
 ui.runUntil(()=>ui.state().phase==='victory');assert.equal(wallet(ui),20);assert.equal(ui.runCount,1);
 assert.equal(ui.node('#auto-button').disabled,false);assert.equal(ui.node('#replay-button').textContent,'Начать сейчас');
 ui.runUntil(()=>ui.runCount===2,3);
 assert.equal(ui.state().hero.hp,200);assert.equal(ui.state().waveIndex,0);assert.equal(ui.state().reward,0);assert.deepEqual(visibleEnemies(ui),['archer1']);assert.equal(wallet(ui),20);
 assert.equal(ui.restartStates[0].hero.hp,200);assert.equal(ui.node('#battle-result').hidden,true);
 ui.runUntil(()=>ui.runCount===2&&ui.state().phase==='victory');assert.equal(wallet(ui),40);
 assert.equal(kills(ui).length,8);assert.equal(kills(ui).filter(event=>event.id==='archer1').length,2);
 assert.ok(ui.events.filter(event=>event.type==='cast').every(event=>
    event.sourceId==='hero'&&['fire','ice'].includes(event.magic)));
 assert.deepEqual(ui.events.filter(event=>event.type==='cast').slice(0,4).map(event=>event.magic),
   ['fire','ice','fire','ice']);
 assert.ok(ui.node('#player-sprite').draws.every(draw=>draw.src.includes('/black-')));
 ui.runUntil(()=>!ui.node('#battle-result').hidden,2);ui.node('#replay-button').click();assert.equal(ui.runCount,3);assert.equal(ui.state().hero.hp,200);assert.equal(wallet(ui),40);assert.equal(ui.spells().length,0);
});

test('victory countdown uses active visible time and can be paused without blocking or duplicating the RAF loop',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer'});await ui.loadAllImages();ui.runUntil(()=>ui.state().phase==='victory');
 ui.node('#auto-button').click();const end=ui.state();ui.runFor(5);assert.equal(ui.runCount,1);assert.deepEqual(ui.state(),end);assert.equal(wallet(ui),20);
 assert.ok(ui.node('#result-copy').textContent.includes('паузе'));
 ui.node('#auto-button').click();ui.runFor(.3);ui.node('#profile-button').click();ui.runFor(5);assert.equal(ui.runCount,1);
 ui.node('#game-dialog').close();ui.runFor(.3);ui.document.hidden=true;ui.document.dispatch('visibilitychange');ui.runFor(5);assert.equal(ui.runCount,1);
 ui.document.hidden=false;ui.document.dispatch('visibilitychange');ui.runUntil(()=>ui.runCount===2,3);assert.equal(wallet(ui),20);assert.equal(ui.state().hero.hp,200);
});

test('defeat preserves partial kill gold and automatically starts a healed run without a loss of weapon or magic',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'fire',combatOptions:{heroMaxHp:8,heroDamage:100}});await ui.loadAllImages();
 ui.runUntil(()=>ui.state().phase==='defeat');
 assert.equal(ui.state().hero.hp,0);assert.ok(kills(ui).length>0&&kills(ui).length<4);
 const earned=kills(ui).length*5;assert.equal(wallet(ui),earned);assert.equal(ui.state().reward,earned);
 assert.equal(ui.events.find(event=>event.type==='death'&&event.id==='hero').reward,0);
 assert.equal(ui.events.find(event=>event.type==='end').reward,0);
 ui.runUntil(()=>ui.runCount===2,3);assert.equal(ui.state().hero.hp,8);assert.equal(ui.state().waveIndex,0);assert.equal(wallet(ui),earned);
 ui.runUntil(()=>wallet(ui)>earned);assert.equal(wallet(ui),earned+5,'the same archer ID earns coins again in the new run');
 assert.ok(ui.events.filter(event=>event.type==='cast').every(event=>event.magic==='fire'));
});

test('all starter weapons, six skins and clothing colors use matching LPC sheets while preserving weapon range',async()=>{
 const catalogue=require('../dist/loadouts.js'),skins=['light','amber','olive','bronze','brown','black'];
 for(const weapon of catalogue.weapons)for(let index=0;index<skins.length;index++){
  const skin=skins[index],color=catalogue.colors[index],outfit=weapon.outfits[0];
  const ui=createHarness({skin,weapon:weapon.id,outfit:outfit.id,outfitColor:color.id});await ui.loadAllImages();
  const prefix=`assets/characters/loadouts/${weapon.id}/${outfit.id}/${color.id}/${skin}-`;
  assert.ok(ui.loadedPaths.includes(prefix+'walk.png'));assert.ok(ui.loadedPaths.includes(prefix+'attack.png'));
  ui.runFor(3.2);const home=ui.heroX();ui.runFor(.7);if(weapon.projectile==='melee')assert.ok(ui.heroX()>home);else assert.equal(ui.heroX(),home);
  ui.runUntil(()=>ui.node('#player-sprite').draws.some(draw=>draw.src===prefix+'attack.png'));
  assert.ok(ui.node('#player-sprite').draws.filter(draw=>draw.src===prefix+'attack.png').every(draw=>draw.crop[1]===weapon.attack.tile*3&&draw.crop[2]===weapon.attack.tile));
  ui.node('#profile-button').click();assert.ok(ui.node('#dialog-copy').textContent.includes(outfit.name));assert.ok(ui.node('#dialog-copy').textContent.includes(color.name.toLowerCase()));
 }
});

test('legacy wardrobe normalization preserves the saved skin and does not silently rewrite the character',async()=>{
 const ui=createHarness({skin:'bronze',weapon:'sword',outfit:'watchman'});await ui.loadAllImages();
 assert.ok(ui.loadedPaths.includes('assets/characters/loadouts/sword/militia/blue/bronze-walk.png'));
 assert.equal(JSON.parse(ui.storage.get('ember.character.v1')).outfit,'watchman');
 ui.node('#profile-button').click();assert.ok(ui.node('#dialog-copy').textContent.includes('Ополченец'));
});

function arrowsFrom(ui,source){
 return ui.node('.battlefield').children.filter(e=>e.className==='projectile arrow'&&(!source||e.dataset.source===source));
}
function nearTime(actual,expected,epsilon=.025){
 assert.ok(Math.abs(actual-expected)<=epsilon,'at '+actual+' expected '+expected);
}
test('hero bow arrow exits on original LPC frame 9 and lands with damage at 1.2 seconds',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer'});await ui.loadAllImages();
 ui.runUntil(()=>ui.state().elapsed>=.35,8);
 const arrow=arrowsFrom(ui,'hero')[0];assert.ok(arrow);
 nearTime(Number(arrow.dataset.releaseAt),.92,1e-5);
 nearTime(Number(arrow.dataset.impactAt),1.2,1e-5);
 assert.equal(arrow.hidden,true);assert.equal(arrow.style.visibility,'hidden');
 assert.equal(ui.state().enemies[0].hp,60);
 runFramesUntil(ui,()=>!arrow.hidden,1);
 nearTime(ui.state().elapsed,.92);
 const shot=ui.node('#player-sprite').draws.filter(d=>d.src.endsWith('bronze-attack.png')).at(-1);
 assert.ok(shot);assert.ok(shot.crop[0]/64>=9&&shot.crop[0]/64<=10);
 assert.equal(ui.state().enemies[0].hp,60);
 const x=parseFloat(arrow.style.left);ui.frame(32);
 assert.ok(parseFloat(arrow.style.left)>x);
 ui.runUntil(()=>ui.events.some(e=>e.type==='attack'&&e.sourceId==='hero'),2);
 assert.equal(ui.state().enemies[0].hp,48);
 assert.ok(!ui.node('.battlefield').children.includes(arrow));
 assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'idle');
});
test('skeleton arrow begins at release frame, flies left, and disappears on damage',async()=>{
 const ui=createHarness({weapon:'sword',outfit:'militia',fieldWidth:3200});await ui.loadAllImages();
 ui.runUntil(()=>arrowsFrom(ui,'archer1').length>0,8);
 const arrow=arrowsFrom(ui,'archer1')[0];
 nearTime(Number(arrow.dataset.releaseAt),1.52,1e-5);
 nearTime(Number(arrow.dataset.impactAt),1.8,1e-5);
 assert.equal(arrow.hidden,true);assert.equal(ui.state().hero.hp,200);
 runFramesUntil(ui,()=>!arrow.hidden,2);
 nearTime(ui.state().elapsed,1.52);
 const shot=ui.node('#enemy-archer1').draws.filter(d=>d.src.endsWith('skeleton-shoot.png')).at(-1);
 assert.ok(shot);assert.ok(shot.crop[0]/64>=9&&shot.crop[0]/64<=10);
 assert.equal(ui.state().hero.hp,200);
 const x=parseFloat(arrow.style.left);ui.frame(32);assert.ok(parseFloat(arrow.style.left)<x);
 ui.runUntil(()=>ui.events.some(e=>e.type==='attack'&&e.sourceId==='archer1'),2);
 assert.equal(ui.state().hero.hp,193);assert.ok(!ui.node('.battlefield').children.includes(arrow));
});
test('two archers in wave two release two distinct arrows that land together',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer'});await ui.loadAllImages();
 ui.runUntil(()=>ui.state().waveIndex===1,90);
 const hp=ui.state().hero.hp;
 ui.runUntil(()=>arrowsFrom(ui).filter(e=>!e.hidden&&e.dataset.source.startsWith('archer')).length===2,8);
 const shots=arrowsFrom(ui).filter(e=>e.dataset.source.startsWith('archer'));
 assert.deepEqual(shots.map(e=>e.dataset.source).sort(),['archer2','archer3']);
 nearTime(Number(shots[0].dataset.impactAt),Number(shots[1].dataset.impactAt),1e-6);
 assert.equal(ui.state().hero.hp,hp);
 ui.runUntil(()=>ui.events.some(e=>e.type==='attack'&&e.sourceId==='archer2'),3);
 assert.equal(ui.state().hero.hp,hp-14);
 assert.ok(shots.every(e=>!ui.node('.battlefield').children.includes(e)));
});
test('pausing mid-draw freezes release timing and the hero bow frame',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer'});await ui.loadAllImages();
 ui.runUntil(()=>arrowsFrom(ui,'hero').length>0,8);
 const arrow=arrowsFrom(ui,'hero')[0],before=ui.state().elapsed,draws=ui.node('#player-sprite').draws.length;
 ui.node('#auto-button').click();ui.runFor(1);
 assert.equal(ui.state().elapsed,before);assert.equal(arrow.hidden,true);
 assert.equal(ui.node('#player-sprite').draws.length,draws);
 ui.node('#auto-button').click();runFramesUntil(ui,()=>!arrow.hidden,2);
 assert.ok(ui.state().elapsed>before);assert.equal(arrow.style.visibility,'visible');
});
test('distant archers fire during a melee approach, without spawning the old mage or allowing attacks from afar',async()=>{
 const ui=createHarness({fieldWidth:3200});await ui.loadAllImages();
 ui.runUntil(()=>ui.node('.battlefield').children.some(element=>element.className==='projectile arrow'&&!element.hidden),5);
 assert.equal(ui.state().hero.hp,200,'the arrow has left the bow but has not yet landed');
 ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.sourceId==='archer1'),5);
 assert.ok(ui.node('#enemy-archer1').draws.at(-1).src.endsWith('skeleton-shoot.png'));
 assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'walk');assert.equal(inReach(ui,'archer1'),false);
 assert.equal(ui.state().hero.hp,193);assert.equal(ui.state().enemies[0].hp,60);
 assert.ok(!ui.events.some(event=>event.sourceId==='hero'||event.sourceId==='orc'||event.type==='cast'));
 assert.deepEqual(visibleEnemies(ui),['archer1']);assert.equal(ui.spells().length,0);
});

test('gait follows travelled distance and paused resizes preserve archer contact and later the orc pair',async()=>{
 const ui=createHarness();await ui.loadAllImages();ui.runFor(3.2);const x=ui.heroX();ui.frame(100);
 assert.ok(Math.abs(ui.heroX()-x-64*.85*.1)<1e-8);
 ui.node('#auto-button').click();const phase=ui.node('#player-sprite').draws.at(-1),draws=ui.node('#player-sprite').draws.length,before=ui.heroX();
 ui.resizeField(1000);ui.frame(0);assert.ok(Math.abs(ui.heroX()-before*1.25)<1e-8);assert.equal(ui.node('#player-sprite').draws.length,draws);assert.deepEqual(ui.node('#player-sprite').draws.at(-1),phase);
 ui.node('#auto-button').click();ui.runUntil(()=>inReach(ui,'archer1'));ui.node('#auto-button').click();const elapsed=ui.state().elapsed;
 ui.resizeField(800,50);ui.frame(0);assert.ok(inReach(ui,'archer1'));assert.equal(ui.state().elapsed,elapsed);
 ui.node('#auto-button').click();ui.runUntil(()=>ui.state().waveIndex===2);ui.runUntil(()=>ui.inMeleeRange());ui.node('#auto-button').click();
 const middle=(ui.heroX()+ui.orcX())/2,time=ui.state().elapsed;
 ui.resizeField(1000,44);ui.frame(0);assert.ok(Math.abs((ui.heroX()+ui.orcX())/2-middle*1.25)<1e-8);
 assert.ok(Math.abs(ui.orcX()-ui.heroX()-44*.57)<.01);assert.equal(ui.state().elapsed,time);
});

test('the last-wave orc walks towards melee and ranged heroes, then uses native attack tiles only in range',async()=>{
 for(const options of [{},{weapon:'bow',outfit:'wanderer'}]){
  const ui=createHarness(options);await ui.loadAllImages();ui.runUntil(()=>ui.state().waveIndex===2);
  ui.runFor(2.6); // Let the last wave's walk-in finish before pursuing.
  const h=ui.heroX(),o=ui.orcX(),start=ui.events.length;ui.runFor(.5);
  assert.ok(ui.orcX()<o);if(options.weapon)assert.equal(ui.heroX(),h);else assert.ok(ui.heroX()>h);
  assert.equal(ui.node('[data-fighter="orc"]').dataset.motion,'walk');
  const walking=ui.node('#enemy-orc').draws.filter(draw=>draw.src.endsWith('orc-walk.png'));
  assert.ok(walking.some(draw=>draw.crop[0]>0));
  const strides=walking.filter(draw=>draw.crop[0]>0);
  assert.ok(strides.every(draw=>draw.crop[1]===64),
   'Orc moving left toward the hero must use the side-facing LPC row 1, not the front row 2');
  assert.ok(!ui.events.slice(start).some(event=>event.type==='attack'&&event.sourceId==='orc'));
  ui.runUntil(()=>ui.inMeleeRange());assert.ok(Math.abs(ui.orcX()-ui.heroX()-64*.57)<.01);
  ui.runUntil(()=>ui.node('#enemy-orc').draws.some(draw=>draw.src.endsWith('orc-attack.png')));
  const canvas=ui.node('#enemy-orc');assert.equal(canvas.style.width,'200%');assert.equal(canvas.style.left,'-50%');
  assert.ok(canvas.draws.filter(draw=>draw.src.endsWith('orc-attack.png')).every(draw=>draw.crop[1]===128&&draw.crop[2]===128));
 }
});

test('sword combo selects all three native sheets and plays every one of the thirteen heavy frames',async()=>{
 const ui=createHarness({weapon:'sword',outfit:'militia',outfitColor:'red'});await ui.loadAllImages();
 const hero=ui.node('[data-fighter="hero"]'),canvas=ui.node('#player-sprite'),prefix='assets/characters/loadouts/sword/militia/red/bronze-';
 for(const [variant,file]of[['halfslash','halfslash.png'],['slash','attack.png'],['backslash','backslash.png']]){
  ui.runUntil(()=>hero.dataset.attack===variant);assert.equal(canvas.draws.at(-1).src,prefix+file);assert.deepEqual(canvas.draws.at(-1).crop,[0,384,128,128]);
  assert.equal(canvas.style.width,'200%');assert.equal(canvas.style.left,'-50%');assert.equal(hero.classes.has('is-heavy'),variant==='backslash');
 }
 for(let i=0;i<80&&hero.dataset.attack==='backslash';i++)ui.frame(16);
 const frames=canvas.draws.filter(draw=>draw.src===prefix+'backslash.png').map(draw=>draw.crop[0]/128);
 assert.deepEqual([...new Set(frames)].sort((a,b)=>a-b),[...Array(13).keys()]);
 assert.deepEqual(ui.events.filter(event=>event.type==='attack'&&event.sourceId==='hero'&&!event.counter).slice(0,3).map(event=>[event.variant,event.comboStep,Boolean(event.heavy)]),[['halfslash',1,false],['slash',2,false],['backslash',3,true]]);
 const regular=ui.events.filter(event=>event.type==='attack'&&event.sourceId==='hero'&&!event.counter).slice(0,3);
 assert.ok(Math.abs(regular[1].at-regular[0].at-1.2)<1e-6);assert.ok(Math.abs(regular[2].at-regular[1].at-1.35)<1e-6);
 assert.deepEqual(regular.map(event=>event.animationDuration),[.56,.66,.91]);
});

test('shield guard and counter work against the final orc, freeze on pause, and reset before the next run',async()=>{
 const ui=createHarness({weapon:'sword',outfit:'militia'});await ui.loadAllImages();ui.runUntil(()=>ui.events.some(event=>event.type==='block'));
 const hero=ui.node('[data-fighter="hero"]'),guard=ui.node('#player-sprite').draws.at(-1),block=ui.events.find(event=>event.type==='block');
 assert.equal(ui.state().waveIndex,2);assert.equal(block.sourceId,'orc');assert.equal(block.blockedDamage,3);assert.equal(hero.dataset.motion,'block');
 assert.ok(guard.src.endsWith('-block.png'));assert.deepEqual(guard.crop,[0,192,64,64]);assert.equal(ui.node('#player-sprite').style.width,'100%');
 ui.node('#auto-button').click();const held=fullSnapshot(ui);ui.runFor(2);assert.deepEqual(fullSnapshot(ui),held);assert.equal(hero.classes.has('is-blocking'),true);
 ui.node('#auto-button').click();ui.runUntil(()=>ui.events.some(event=>event.counter));assert.equal(hero.dataset.counter,'true');assert.equal(hero.dataset.attack,'halfslash');
 ui.runUntil(()=>ui.state().phase==='victory');ui.runUntil(()=>!ui.node('#battle-result').hidden,2);ui.node('#replay-button').click();
 assert.equal(hero.dataset.counter,'false');assert.equal(hero.dataset.attack,'');assert.equal(hero.classes.has('is-heavy'),false);assert.equal(hero.classes.has('is-blocking'),false);assert.equal(ui.node('.battlefield').children.length,0);
});

test('a single Mage animates both fire and ice spells with independent impact timing',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'ice'});
 await ui.loadAllImages();
 for(const [index,magic] of ['fire','ice'].entries()){
  ui.runUntil(()=>ui.events.filter(e=>e.type==='cast'&&e.sourceId==='hero').length>index,8);
  const cast=ui.events.filter(e=>e.type==='cast'&&e.sourceId==='hero')[index];
  const spell=ui.spells().find(element=>element.dataset.magic===magic);
  assert.ok(spell,magic+' must launch its own visible projectile');
  assert.equal(cast.magic,magic);
  assert.equal(cast.targetId,'archer1');
  assert.equal(spell.dataset.phase,'appear');
  assert.equal(cast.at,(index+1)*1.2);
  assert.equal(cast.impactAt,cast.at+.9);
  assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'attack');
  runFramesUntil(ui,()=>spell.dataset.phase==='flight');
  runFramesUntil(ui,()=>ui.events.some(e=>e.type==='attack'&&e.castId===cast.castId));
  const hit=ui.events.find(e=>e.type==='attack'&&e.castId===cast.castId);
  assert.equal(hit.magic,magic);
  assert.equal(hit.at,cast.impactAt);
  assert.equal(hit.projectile,'magic');
  assert.equal(currentStatus(ui,'archer1').type,magic==='fire'?'burn':'freeze');
  runFramesUntil(ui,()=>!ui.spells().includes(spell));
  assertSpellCells(spell,magic);
 }
 assert.equal(JSON.parse(ui.storage.get('ember.character.v1')).magic,'ice',
   'the old saved school is not rewritten during battle');
});

test('auto, dialog and hidden states freeze actual appearance, flight and impact canvases',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'ice'});await ui.loadAllImages();ui.runUntil(()=>ui.spells().length>0);const spell=ui.spells()[0];
 ui.node('#auto-button').click();const appearance=fullSnapshot(ui);ui.runFor(2);assert.deepEqual(fullSnapshot(ui),appearance);
 ui.node('#auto-button').click();runFramesUntil(ui,()=>spell.dataset.phase==='flight');ui.node('#profile-button').click();const flight=fullSnapshot(ui);ui.runFor(2);assert.deepEqual(fullSnapshot(ui),flight);
 ui.node('#game-dialog').close();runFramesUntil(ui,()=>spell.dataset.phase==='impact');ui.document.hidden=true;ui.document.dispatch('visibilitychange');const impact=fullSnapshot(ui);ui.runFor(2);assert.deepEqual(fullSnapshot(ui),impact);
 ui.document.hidden=false;ui.document.dispatch('visibilitychange');runFramesUntil(ui,()=>!ui.spells().includes(spell));assertSpellCells(spell,'fire');
});

test('the winning impact finishes before automatic restart and manual replay clears remaining effects',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'ice'});await ui.loadAllImages();runFramesUntil(ui,()=>ui.state().phase==='victory',120);
 const state=ui.state(),events=ui.events.length,landed=ui.spells();assert.ok(landed.length>0);assert.ok(landed.every(element=>element.dataset.phase==='impact'));
 ui.node('#profile-button').click();const held=ui.spellState();ui.runFor(1);assert.deepEqual(ui.spellState(),held);ui.node('#game-dialog').close();
 runFramesUntil(ui,()=>ui.spells().length===0,1);for(const spell of landed)assert.deepEqual([...new Set(spell.draws.filter(draw=>draw.crop[1]===128).map(draw=>draw.crop[0]/64))].sort((a,b)=>a-b),[0,1,2,3,4,5]);
 assert.deepEqual(ui.state(),state);assert.equal(ui.events.length,events);assert.equal(wallet(ui),20);assert.equal(ui.runCount,1);
 ui.runUntil(()=>!ui.node('#battle-result').hidden,2);ui.node('#replay-button').click();assert.equal(ui.runCount,2);assert.equal(ui.spells().length,0);assert.equal(wallet(ui),20);assert.equal(ui.state().hero.hp,200);
});

test('old and invalid hero schools become fire; this encounter spawns no NPC mage or shadow casts',async()=>{
 for(const magic of [undefined,'invalid','shadow']){
  const ui=createHarness({weapon:'wand',outfit:'acolyte',magic});await ui.loadAllImages();ui.runUntil(()=>ui.events.some(event=>event.type==='cast'));
  assert.equal(ui.events.find(event=>event.type==='cast').magic,'fire');assert.ok(!ui.actorIds.includes('mage'));assert.equal(ui.spells()[0].dataset.source,'hero');
  assert.equal(JSON.parse(ui.storage.get('ember.character.v1')).magic,magic);
 }
});

test('reduced motion keeps the three-wave combat and rewards while suppressing all model and projectile animation',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'ice',reducedMotion:true});await ui.loadAllImages();ui.runUntil(()=>ui.events.some(event=>event.type==='cast'));
 const cast=ui.events.find(event=>event.type==='cast');assert.equal(ui.state().enemies[0].hp,60);assert.equal(ui.spells().length,0);
 ui.runUntil(()=>ui.events.some(event=>event.castId===cast.castId&&event.type==='attack'));assert.equal(ui.events.find(event=>event.castId===cast.castId&&event.type==='attack').at,cast.impactAt);
 ui.runUntil(()=>ui.state().phase==='victory');assert.equal(wallet(ui),20);assert.equal(ui.spells().length,0);assert.equal(ui.node('.battlefield').children.length,0);
 assert.ok(ui.node('#player-sprite').draws.every(draw=>draw.src.endsWith('-walk.png')));
 assert.ok(ui.events.filter(event=>event.type==='cast').every(event=>
   ['fire','ice'].includes(event.magic)&&event.sourceId==='hero'));
});

test('distant skeletons really shoot at 1.8 and 3.6 seconds with a shorter native shooting pose',async()=>{
 const ui=createHarness({fieldWidth:3200});await ui.loadAllImages();
 ui.runUntil(()=>ui.node('.battlefield').children.some(element=>element.className==='projectile arrow'&&!element.hidden),6);
 assert.equal(ui.state().hero.hp,200,'enemy bow release precedes the hit');
 assert.equal(ui.node('[data-fighter="archer1"]').dataset.motion,'attack','skeleton releases the bow while the arrow is flying');
 ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.sourceId==='archer1'),6);
 const first=ui.events.find(event=>event.type==='attack'&&event.sourceId==='archer1');
 assert.equal(first.at,1.8);assert.equal(first.animationDuration,.6);
 assert.equal(ui.node('[data-fighter="archer1"]').dataset.motion,'idle','release pose ends before the arrow hits');
 assert.ok(!ui.node('.battlefield').children.some(element=>element.className==='projectile arrow'&&!element.hidden), 'arrow reaches the hero on impact, not after damage');
 ui.runUntil(()=>ui.state().elapsed>=2.45,2);
 assert.equal(ui.node('[data-fighter="archer1"]').dataset.motion,'idle','the shortened shot pose is over before 2.5 seconds');
 ui.runUntil(()=>ui.events.filter(event=>event.type==='attack'&&event.sourceId==='archer1').length===2,2);
 assert.deepEqual(ui.events.filter(event=>event.type==='attack'&&event.sourceId==='archer1').map(event=>event.at),[1.8,3.6]);
 assert.equal(ui.state().hero.hp,186);assert.equal(inReach(ui,'archer1'),false);
 assert.ok(!ui.events.some(event=>event.type==='attack'&&event.sourceId==='hero'),'melee hero remains out of range');
});

test('both wand schools accelerate only when the orc reaches them; queued far spells and paused fast spells keep their own timing',async()=>{
 for(const magic of ['fire','ice']){
  const ui=createHarness({weapon:'wand',outfit:'acolyte',magic});await ui.loadAllImages();ui.runUntil(()=>ui.state().waveIndex===2);
  ui.runFor(2.6);const home=ui.heroX();runFramesUntil(ui,()=>ui.inMeleeRange(),20);assert.equal(ui.heroX(),home);
  const contactTime=ui.state().elapsed;
  const queuedFar=ui.events.filter(event=>event.type==='cast'&&event.targetId==='orc'&&event.appearDuration===.42&&event.impactAt>contactTime).at(-1);
  assert.ok(queuedFar,'a far spell was already launched before contact');
  runFramesUntil(ui,()=>ui.events.some(event=>event.type==='cast'&&event.targetId==='orc'&&event.appearDuration===.18),5);
  const close=ui.events.find(event=>event.type==='cast'&&event.targetId==='orc'&&event.appearDuration===.18),spell=ui.spells().at(-1);
  assert.ok(['fire','ice'].includes(close.magic));assert.equal(close.flightDuration,.12);assert.equal(close.impactDuration,.42);assert.equal(close.castInterval,.8);
  assert.ok(Math.abs(close.impactAt-close.at-.3)<1e-6);assert.ok(close.animationDuration<.66);
  assert.equal(spell.dataset.magic,close.magic);assert.equal(spell.dataset.phase,'appear');
  runFramesUntil(ui,()=>spell.dataset.phase==='flight');ui.node('#auto-button').click();const held=fullSnapshot(ui);ui.runFor(2);assert.deepEqual(fullSnapshot(ui),held);
  ui.node('#auto-button').click();runFramesUntil(ui,()=>ui.events.some(event=>event.type==='attack'&&event.castId===close.castId));
  assert.equal(ui.events.find(event=>event.type==='attack'&&event.castId===close.castId).at,close.impactAt);
  runFramesUntil(ui,()=>ui.state().elapsed>=close.at+.4);
  assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'idle','the close-range cast uses its shorter animation duration');
  runFramesUntil(ui,()=>!ui.spells().includes(spell));assertSpellCells(spell,close.magic);
  runFramesUntil(ui,()=>ui.events.filter(event=>event.type==='cast'&&event.targetId==='orc'&&event.appearDuration===.18).length>=2);
  const closeCasts=ui.events.filter(event=>event.type==='cast'&&event.targetId==='orc'&&event.appearDuration===.18);
  assert.ok(Math.abs(closeCasts[1].at-closeCasts[0].at-.8)<1e-6);
  const oldImpact=ui.events.find(event=>event.type==='attack'&&event.castId===queuedFar.castId);
  assert.ok(oldImpact);assert.equal(oldImpact.at,queuedFar.impactAt);assert.ok(Math.abs(oldImpact.at-queuedFar.at-.9)<1e-6,'entering contact cannot retime an in-flight far projectile');
 }
});

test('far wand casts and the hero bow keep their original cadence, including bow shots after melee contact',async()=>{
 for(const [weapon,outfit]of [['wand','acolyte'],['bow','wanderer']]){
  const ui=createHarness({weapon,outfit,magic:'fire'});await ui.loadAllImages();
  const type=weapon==='wand'?'cast':'attack';
  ui.runUntil(()=>ui.events.filter(event=>event.type===type&&event.sourceId==='hero').length>=3,9);
  const first=ui.events.filter(event=>event.type===type&&event.sourceId==='hero').slice(0,3);
  assert.deepEqual(first.map(event=>event.at),[1.2,2.4,3.6]);
  if(weapon==='wand'){
   assert.ok(first.every(event=>event.appearDuration===.42&&event.flightDuration===.48&&event.impactDuration===.42&&event.castInterval===1.2));
   assert.ok(first.every(event=>Math.abs(event.impactAt-event.at-.9)<1e-6));
  }else{
   ui.runUntil(()=>ui.state().waveIndex===2);ui.runUntil(()=>ui.inMeleeRange());const contact=ui.state().elapsed;
   ui.runUntil(()=>ui.events.filter(event=>event.type==='attack'&&event.sourceId==='hero'&&event.at>contact).length>=2,4);
   const shots=ui.events.filter(event=>event.type==='attack'&&event.sourceId==='hero'&&event.at>contact);
   assert.ok(Math.abs(shots[1].at-shots[0].at-1.2)<1e-6);assert.ok(shots.every(event=>event.projectile==='arrow'));
  }
 }
});


function currentStatus(ui,id){return ui.state().enemies.find(enemy=>enemy.id===id)?.status||null;}
function assertIceOpacity(canvas){
 assert.equal(canvas.dataset.status,'freeze');
 const css=fs.readFileSync(path.join(dist,'game.css'),'utf8');
 const rule=css.match(/\.fighter>canvas\.status-effect\[data-status="freeze"\]\{[^}]*opacity:\s*([.\d]+)/);
 assert.equal(Number(canvas.style.opacity??rule?.[1]),.65,'the actual actor-local freeze canvas uses 65% opacity');
}
function assertStatusCells(canvas,status){
 assert.equal(canvas.width,64);assert.equal(canvas.height,64);assert.equal(canvas.dataset.status,status);
 const row=status==='burn'?0:1;
 assert.ok(canvas.draws.length>0);
 for(const draw of canvas.draws){assert.equal(draw.src,'assets/magic/status-effects.png');assert.deepEqual(draw.crop.slice(1),[row*362,362,362]);}
 assert.deepEqual([...new Set(canvas.draws.map(draw=>draw.crop[0]/362))].sort((a,b)=>a-b),[0,1,2,3,4,5]);
}

test('burn is attached at the spell impact for half a second, ticks twice, and never recasts or creates burn projectiles',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'fire'});await ui.loadAllImages();
 assert.ok(ui.loadedPaths.includes('assets/magic/status-effects.png'));
 ui.runUntil(()=>ui.events.some(event=>event.type==='cast'));
 const cast=ui.events.find(event=>event.type==='cast');assert.equal(currentStatus(ui,'archer1'),null);assert.equal(ui.statusCanvases().length,0);
 runFramesUntil(ui,()=>ui.state().elapsed>=cast.impactAt-.04);assert.equal(currentStatus(ui,'archer1'),null,'appearance and flight cannot burn the target');
 runFramesUntil(ui,()=>currentStatus(ui,'archer1')?.type==='burn');
 const status=currentStatus(ui,'archer1'),applied=ui.events.find(event=>event.type==='status'),overlay=ui.statusCanvases('archer1')[0];
 assert.ok(overlay);assert.equal(status.startedAt,cast.impactAt);assert.equal(status.endsAt,status.startedAt+.5);
 assert.deepEqual([applied.status,applied.sourceId,applied.targetId,applied.at,applied.duration,applied.endsAt],['burn','hero','archer1',cast.impactAt,.5,cast.impactAt+.5]);
 assert.equal(ui.state().enemies[0].hp,48);assert.equal(overlay.dataset.status,'burn');
 const attackDraws=ui.node('#player-sprite').draws.filter(draw=>draw.src.endsWith('-attack.png')).length;
 runFramesUntil(ui,()=>ui.events.some(event=>event.dot));
 const first=ui.events.find(event=>event.dot);assert.deepEqual([first.damage,first.projectile,first.magic,first.at],[1,'burn','fire',status.startedAt+.25]);
 assert.equal(ui.events.filter(event=>event.type==='cast').length,1,'a burn tick must not become another cast');
 assert.equal(ui.spells().length,1,'only the original spell exists before the regular second cast');
 assert.equal(ui.node('#player-sprite').draws.filter(draw=>draw.src.endsWith('-attack.png')).length,attackDraws,'a burn tick must not restart a caster pose');
 assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'idle');
 runFramesUntil(ui,()=>!ui.statusCanvases().includes(overlay));
 const ticks=ui.events.filter(event=>event.dot);assert.deepEqual(ticks.map(event=>[event.at,event.damage]),[[status.startedAt+.25,1],[status.startedAt+.5,1]]);
 assert.equal(currentStatus(ui,'archer1'),null);assert.equal(ui.state().enemies[0].hp,46);assert.equal(ui.events.filter(event=>event.type==='cast').length,2);
 assert.ok(ui.node('#player-sprite').draws.at(-1).crop[0]>=64,'the normal second cast keeps progressing through its pose rather than restarting at the DoT tick');
 assert.equal(ui.node('.battlefield').children.some(element=>String(element.className).includes('projectile burn')),false);
 assertStatusCells(overlay,'burn');
});

test('ice visibly holds the approaching orc position and exact LPC pose, including across pause, then walking resumes',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'ice'});await ui.loadAllImages();ui.runUntil(()=>ui.state().waveIndex===2);
 runFramesUntil(ui,()=>currentStatus(ui,'orc')?.type==='freeze',20);
 const frozen=currentStatus(ui,'orc'),overlay=ui.statusCanvases('orc')[0],actor=ui.node('[data-fighter="orc"]'),canvas=ui.node('#enemy-orc');
 assert.ok(overlay);assert.equal(ui.inMeleeRange(),false,'the first ice hit lands while the orc is still walking');
 assert.equal(actor.classes.has('is-frozen'),true);assertIceOpacity(overlay);
 const x=ui.orcX(),pose=canvas.draws.at(-1),count=canvas.draws.length,time=ui.state().elapsed;
 ui.runFor(.3);assert.equal(ui.orcX(),x);assert.deepEqual(canvas.draws.at(-1),pose);assert.equal(canvas.draws.length,count);assert.ok(ui.state().elapsed>time);
 assert.equal(currentStatus(ui,'orc').endsAt,frozen.endsAt);ui.node('#auto-button').click();
 const beforeResize={orc:ui.orcX(),hero:ui.heroX()};ui.resizeField(1000);ui.frame(0);
 assert.ok(Math.abs(ui.orcX()-beforeResize.orc*1.25)<1e-8,'paused resize scales an approaching frozen orc instead of snapping it to contact');
 assert.ok(Math.abs(ui.heroX()-beforeResize.hero*1.25)<1e-8);assert.equal(ui.inMeleeRange(),false);
 assert.deepEqual(canvas.draws.at(-1),pose,'resizing cannot advance the held LPC pose');
 const thawX=ui.orcX(),held=fullSnapshot(ui);ui.runFor(3);assert.deepEqual(fullSnapshot(ui),held,'a paused frozen overlay and its remaining lifetime must not advance');
 ui.node('#auto-button').click();runFramesUntil(ui,()=>!currentStatus(ui,'orc'),2);assert.equal(ui.statusCanvases('orc').length,0);assert.equal(actor.classes.has('is-frozen'),false);
 ui.runFor(.1);assert.ok(ui.orcX()<thawX,'the orc resumes walking after thaw');assert.equal(actor.dataset.motion,'walk');
 assertStatusCells(overlay,'freeze');
});

test('a frozen orc in melee contact cannot advance an attack pose or strike before the freeze expires',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'ice'});await ui.loadAllImages();ui.runUntil(()=>ui.state().waveIndex===2);ui.runUntil(()=>ui.inMeleeRange());
 const contact=ui.state().elapsed;
 runFramesUntil(ui,()=>currentStatus(ui,'orc')?.type==='freeze'&&currentStatus(ui,'orc').startedAt>=contact-1e-6,6);
 const status=currentStatus(ui,'orc'),canvas=ui.node('#enemy-orc'),x=ui.orcX(),pose=canvas.draws.at(-1),count=canvas.draws.length;
 ui.runFor(.3);assert.equal(ui.orcX(),x);assert.deepEqual(canvas.draws.at(-1),pose);assert.equal(canvas.draws.length,count);
 assert.ok(!ui.events.some(event=>event.type==='attack'&&event.sourceId==='orc'&&event.at>=status.startedAt&&event.at<status.endsAt));
 ui.document.hidden=true;ui.document.dispatch('visibilitychange');const hidden=fullSnapshot(ui);ui.runFor(3);assert.deepEqual(fullSnapshot(ui),hidden);
 ui.document.hidden=false;ui.document.dispatch('visibilitychange');runFramesUntil(ui,()=>!currentStatus(ui,'orc'),2);
 assert.equal(ui.node('[data-fighter="orc"]').classes.has('is-frozen'),false);
});

test('a burn kill pays once and all status overlays and queued ticks clear across waves and an explicit restart',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'fire',combatOptions:{heroDamage:59}});await ui.loadAllImages();
 runFramesUntil(ui,()=>currentStatus(ui,'archer1')?.type==='burn');
 runFramesUntil(ui,()=>ui.state().phase==='intermission');
 const death=kills(ui)[0];assert.equal(death.id,'archer1');assert.equal(wallet(ui),5);assert.equal(currentStatus(ui,'archer1'),null);assert.equal(ui.statusCanvases().length,0);
 ui.runFor(.4);assert.equal(wallet(ui),5);assert.equal(kills(ui).length,1,'the second scheduled burn tick cannot kill or reward the same enemy again');
 ui.runUntil(()=>ui.state().waveIndex===1);assert.equal(ui.statusCanvases().length,0);assert.ok(ui.state().enemies.every(enemy=>!enemy.status));
 runFramesUntil(ui,()=>ui.state().enemies.some(enemy=>enemy.status?.type==='burn'),6);assert.ok(ui.statusCanvases().length);
 ui.node('#replay-button').click();assert.equal(ui.state().waveIndex,0);assert.equal(ui.statusCanvases().length,0);assert.ok(ui.state().enemies.every(enemy=>!enemy.status));
 const gold=wallet(ui);ui.runFor(.2);assert.equal(ui.state().enemies[0].hp,60);assert.equal(wallet(ui),gold,'old burn timers cannot leak into the restarted encounter');
});

test('reduced motion keeps a static ice indicator for the same gameplay lifetime without animating the overlay',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'ice',reducedMotion:true});await ui.loadAllImages();runFramesUntil(ui,()=>currentStatus(ui,'archer1')?.type==='freeze');
 const status=currentStatus(ui,'archer1'),overlay=ui.statusCanvases('archer1')[0];assert.ok(overlay);assert.equal(overlay.dataset.frame,'2');assertIceOpacity(overlay);
 const pose=overlay.draws.at(-1);assert.deepEqual(pose.crop,[2*362,362,362,362]);assert.equal(ui.spells().length,0);
 ui.runFor(.3);assert.deepEqual(overlay.draws.at(-1),pose);assert.equal(overlay.dataset.frame,'2');assert.equal(currentStatus(ui,'archer1').endsAt,status.endsAt);
 runFramesUntil(ui,()=>!currentStatus(ui,'archer1'),2);assert.equal(ui.statusCanvases().length,0);
 ui.runUntil(()=>ui.state().phase==='victory');assert.equal(wallet(ui),20);assert.equal(ui.statusCanvases().length,0);assert.equal(ui.spells().length,0);
});


// The road's approved 1254-pixel artwork has a conservative usable inner band
// from source Y=958 to1098. Project physical feet through the actual background
// transform rather than duplicating the controller's lane-step formula.
function roadProjection(ui){
 const art=ui.node('.battle-landscape'),size=Number.parseFloat(art.style.backgroundSize),top=Number.parseFloat(art.style.backgroundPosition.split(' ')[1]);
 const png=fs.readFileSync(path.join(dist,'assets/battlefield-forest.png')),sourceWidth=png.readUInt32BE(16);
 return {scale:size/sourceWidth,top};
}
function sourceFoot(ui,id){const {scale,top}=roadProjection(ui);return (ui.footY(id)-top)/scale;}
function roadCenterSource(ui){const {scale,top}=roadProjection(ui),offset=Number.parseFloat(ui.node('[data-fighter="hero"]').style['--lane-offset'])||0;return (ui.footY('hero')-offset-top)/scale;}
function almost(actual,expected,tolerance=1e-6,message='values are equal'){assert.ok(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} vs${expected}`);}
function actorRowSnapshot(ui){return ui.actorIds.map(id=>({id,depth:ui.depth(id),lane:ui.node(`[data-fighter="${id}"]`).dataset.lane,foot:ui.footY(id),offset:ui.node(`[data-fighter="${id}"]`).style['--lane-offset'],z:ui.node(`[data-fighter="${id}"]`).style.zIndex}));}
// Exact spawn assertions sample the event boundary, not the legitimate remaining
// fraction of a RAF frame that may already advance the new wave under black.
function enterWaveExactly(ui,index){
 while(ui.state().waveIndex<index){
  ui.runUntil(()=>ui.state().phase==='intermission');
  const before=ui.state().waveIndex;let attempts=0;
  while(ui.state().phase==='intermission'){
   assert.ok(++attempts<100,'the intermission must finish');
   const remaining=ui.state().intermissionRemaining;assert.ok(remaining>0);
   ui.frame(Math.min(.1,remaining)*1000);
  }
  assert.equal(ui.state().waveIndex,before+1);
 }
}


test('five configured depth lanes are ordered, distinct and remain inside the approved road at phone, laptop and landscape sizes',async()=>{
 const cases=[
  {fieldWidth:320,viewportHeight:568,arenaHeight:295.36,fieldHeight:101.4944,fieldBottomGap:58,roadGround:36,modelSize:49},
  {fieldWidth:390,viewportHeight:844,arenaHeight:438.88,fieldHeight:180.384,fieldBottomGap:61,roadGround:36,modelSize:59},
  {fieldWidth:1180,viewportHeight:900,arenaHeight:468,fieldHeight:200.08,fieldBottomGap:62,roadGround:36,modelSize:74},
  {fieldWidth:667,viewportHeight:375,arenaHeight:195,fieldHeight:98.25,fieldBottomGap:48,roadGround:26,modelSize:44}
 ];
 const expected={hero:3,archer1:2,archer2:1,archer3:5,orc:4};
 for(const view of cases){
  const ui=createHarness({...view,preference:'off',weapon:'bow',outfit:'wanderer'});await ui.loadAllImages();
  assert.equal(ui.node('.adventure').dataset.lanes,'5');assert.equal(ui.node('.battlefield').dataset.lanes,'5');
  assert.ok(Number(ui.node('.battlefield').dataset.laneStep)>0);
  for(const [id,lane]of Object.entries(expected)){
   assert.equal(Number(ui.node(`[data-fighter="${id}"]`).dataset.defaultLane),lane);assert.equal(ui.depth(id),lane);
   const foot=sourceFoot(ui,id);assert.ok(foot>=958-1e-6&&foot<=1098+1e-6,`${id} must stand inside the real road (${foot})`);
  }
  const ordered=ui.actorIds.slice().sort((a,b)=>ui.depth(a)-ui.depth(b)),feet=ordered.map(id=>ui.footY(id));
  assert.equal(new Set(feet).size,5);for(let index=1;index<feet.length;index++)assert.ok(feet[index]>feet[index-1]);
  assert.ok(feet.at(-1)-feet[0]<=48+1e-6);almost(roadCenterSource(ui),1028,1e-6,'the forest road center must remain fixed');
  const z=ordered.map(id=>Number(ui.node(`[data-fighter="${id}"]`).style.zIndex));for(let index=1;index<z.length;index++)assert.ok(z[index]>z[index-1],'front fighters sort above the back row');
 }
 const css=fs.readFileSync(path.join(dist,'game.css'),'utf8');
 for(const selector of['projectile','spell-projectile','damage-number']){
  const rules=[...css.matchAll(new RegExp(`\\.${selector}\\{[^}]*z-index:([0-9]+)`,'g'))];
  assert.ok(Number(rules.at(-1)?.[1])>500,`${selector} remains visible above every fighter depth`);
 }
});

test('melee walking changes depth towards the current enemy and every strike reaches the same physical road row',async()=>{
 const ui=createHarness({weapon:'sword',outfit:'militia'});await ui.loadAllImages();assert.equal(ui.depth('hero'),3);assert.equal(ui.depth('archer1'),2);
 ui.runFor(3.2);assert.ok(ui.depth('hero')<3&&ui.depth('hero')>=2);assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'walk');
 ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.sourceId==='hero'&&event.targetId==='archer1'));
 assert.ok(inReach(ui,'archer1'));almost(ui.footY('hero'),ui.footY('archer1'),.01);assert.equal(ui.depth('hero'),2);
 enterWaveExactly(ui,1);assert.equal(ui.depth('hero'),3);assert.equal(ui.depth('archer2'),1);assert.equal(ui.depth('archer3'),5);
 ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.sourceId==='hero'&&event.targetId==='archer2'));almost(ui.footY('hero'),ui.footY('archer2'),.01);assert.equal(ui.depth('hero'),1);
 ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.sourceId==='hero'&&event.targetId==='archer3'));almost(ui.footY('hero'),ui.footY('archer3'),.01);assert.equal(ui.depth('hero'),5);
 enterWaveExactly(ui,2);assert.equal(ui.depth('hero'),3);assert.equal(ui.depth('orc'),4);
 ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.sourceId==='orc'));assert.ok(ui.inMeleeRange());assert.equal(ui.depth('hero'),4);assert.equal(ui.depth('orc'),4);almost(ui.footY('hero'),ui.footY('orc'),.01);
});

function assertActualSpellRay(ui,spell){
 const source=ui.node('[data-fighter="hero"]').getBoundingClientRect(),target=ui.node(`[data-fighter="${spell.dataset.target}"]`).getBoundingClientRect(),field=ui.node('.battlefield').getBoundingClientRect();
 const sx=source.left+source.width*.88-field.left,sy=source.top+source.height*.67-field.top,tx=target.left+target.width/2-field.left,ty=target.top+target.height*.55-field.top;
 const angle=Number(spell.style.transform.match(/rotate\(([-.0-9]+)deg\)/)[1]);
 almost(angle,Math.atan2(ty-sy,tx-sx)*180/Math.PI+180,1e-8,'the projectile aims at the target on its actual road row');
 const x=Number.parseFloat(spell.style.left),y=Number.parseFloat(spell.style.top),fraction=(x-sx)/(tx-sx);
 assert.ok(fraction>=-1e-6&&fraction<=1+1e-6);almost(y,sy+(ty-sy)*fraction,1e-6,'the visible projectile is on the source-to-target ray');
 return angle;
}

test('ranged spells use off-row target coordinates and keep aiming correctly after a paused responsive resize',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'fire',
   combatOptions:{heroDamage:1,heroMaxHp:1000}});await ui.loadAllImages();ui.runUntil(()=>ui.spells().length>0);
 const spell=ui.spells()[0];runFramesUntil(ui,()=>spell.dataset.phase==='flight');
 assert.equal(ui.depth('hero'),3);assert.equal(ui.depth('archer1'),2);assert.ok(ui.footY('archer1')<ui.footY('hero'));
 const angle=assertActualSpellRay(ui,spell);ui.node('#auto-button').click();const elapsed=ui.state().elapsed;
 ui.resizeField(1000,44);ui.frame(0);const resizedAngle=assertActualSpellRay(ui,spell);assert.ok(Math.abs(resizedAngle-angle)>.1);assert.equal(ui.state().elapsed,elapsed);assert.equal(spell.dataset.phase,'flight');
 assert.equal(ui.depth('hero'),3);assert.equal(ui.depth('archer1'),2);almost(roadCenterSource(ui),1028);
 ui.node('#auto-button').click();enterWaveExactly(ui,2);
 assert.equal(ui.depth('orc'),4,'the orc waits motionless during wave entrance');
 ui.runFor(2.6);
 const startDepth=ui.depth('orc'),home=ui.heroX();assert.ok(startDepth<=4&&startDepth>3);
 ui.runFor(.4);assert.equal(ui.heroX(),home);assert.equal(ui.depth('hero'),3);assert.ok(ui.depth('orc')<4&&ui.depth('orc')>3);assert.equal(ui.node('[data-fighter="orc"]').dataset.motion,'walk');
 ui.runUntil(()=>ui.inMeleeRange());almost(ui.footY('hero'),ui.footY('orc'),.01);assert.equal(ui.depth('orc'),3);
});

test('freezing holds both orc road coordinates and pose; a paused resize reprojects depth without turning it into contact',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'ice'});await ui.loadAllImages();ui.runUntil(()=>ui.state().waveIndex===2);runFramesUntil(ui,()=>currentStatus(ui,'orc')?.type==='freeze',20);
 assert.equal(ui.inMeleeRange(),false);const orc=ui.node('[data-fighter="orc"]'),canvas=ui.node('#enemy-orc'),atFreeze={x:ui.orcX(),depth:ui.depth('orc'),foot:ui.footY('orc'),pose:canvas.draws.at(-1)};
 assert.ok(atFreeze.depth>3&&atFreeze.depth<4);ui.runFor(.3);assert.equal(ui.orcX(),atFreeze.x);assert.equal(ui.depth('orc'),atFreeze.depth);assert.equal(ui.footY('orc'),atFreeze.foot);assert.deepEqual(canvas.draws.at(-1),atFreeze.pose);
 ui.node('#auto-button').click();const oldOffset=Number.parseFloat(orc.style['--lane-offset']);ui.resizeField(667,44,{arenaHeight:195,fieldHeight:98.25,fieldBottomGap:48,roadGround:26,viewportHeight:375});ui.frame(0);
 assert.equal(ui.depth('orc'),atFreeze.depth);assert.ok(Math.abs(Number.parseFloat(orc.style['--lane-offset'])-oldOffset)>.01);assert.equal(ui.inMeleeRange(),false);assert.deepEqual(canvas.draws.at(-1),atFreeze.pose);almost(roadCenterSource(ui),1028,1e-6);
 const held=fullSnapshot(ui);ui.runFor(2);assert.deepEqual(fullSnapshot(ui),held);
 ui.node('#auto-button').click();runFramesUntil(ui,()=>!currentStatus(ui,'orc'),2);ui.runFor(.1);assert.ok(ui.orcX()<atFreeze.x*667/800);assert.ok(ui.depth('orc')<atFreeze.depth);assert.ok(ui.footY('orc')<held.actors.find(actor=>actor.id==='orc').footY);
});

test('pause, wave spawn and replay preserve or reset formation without drifting the road or adding a fake walking frame',async()=>{
 const ui=createHarness({weapon:'sword',outfit:'militia'});await ui.loadAllImages();ui.runFor(3.2);assert.ok(ui.depth('hero')>2&&ui.depth('hero')<3);
 ui.node('#auto-button').click();const phase=ui.node('#player-sprite').draws.at(-1),count=ui.node('#player-sprite').draws.length,depth=ui.depth('hero');
 ui.resizeField(390,59,{arenaHeight:438.88,fieldHeight:180.384,fieldBottomGap:61,roadGround:36,viewportHeight:844});ui.frame(0);
 assert.equal(ui.depth('hero'),depth);assert.deepEqual(ui.node('#player-sprite').draws.at(-1),phase);assert.equal(ui.node('#player-sprite').draws.length,count);almost(roadCenterSource(ui),1028,1e-6);
 const held=fullSnapshot(ui);ui.runFor(2);assert.deepEqual(fullSnapshot(ui),held);
 ui.node('#auto-button').click();enterWaveExactly(ui,1);assert.equal(ui.depth('hero'),3);assert.equal(ui.depth('archer2'),1);assert.equal(ui.depth('archer3'),5);assert.ok(Number(ui.node('[data-fighter="archer3"]').style.zIndex)>Number(ui.node('[data-fighter="archer2"]').style.zIndex));
 ui.runUntil(()=>ui.state().phase==='victory');ui.runUntil(()=>!ui.node('#battle-result').hidden,2);ui.node('#replay-button').click();assert.equal(ui.depth('hero'),3);assert.equal(ui.depth('archer1'),2);assert.equal(ui.depth('orc'),4);assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'idle');almost(roadCenterSource(ui),1028,1e-6);
});

function attacks(ui){return ui.events.filter(event=>event.type==='attack').length;}
function assertFadeCleared(ui){const scene=sceneSnapshot(ui);assert.equal(scene.opacity,0);assert.equal(scene.phase,'');assert.equal(scene.resultHidden,true);}

test('wave clear keeps the hero walking visibly on the same road row, then resets the wave behind a fully black upper scene',async()=>{
 const ui=createHarness({weapon:'sword',outfit:'militia'});await ui.loadAllImages();ui.runUntil(()=>ui.state().phase==='intermission');
 const x=ui.heroX(),depth=ui.depth('hero'),hp=ui.state().hero.hp,count=attacks(ui);assert.equal(depth,2);assert.equal(sceneSnapshot(ui).phase,'wave-out');assert.equal(sceneSnapshot(ui).opacity,0);assert.equal(sceneSnapshot(ui).resultHidden,true);
 ui.runFor(.3);assert.ok(ui.heroX()>x);assert.equal(ui.depth('hero'),depth);assert.equal(ui.node('[data-fighter="hero"]').dataset.motion,'walk');assert.ok(ui.node('#player-sprite').draws.at(-1).src.endsWith('-walk.png'));assert.ok(ui.node('#player-sprite').draws.at(-1).crop[0]>=64);
 assert.equal(attacks(ui),count);assert.equal(ui.state().hero.hp,hp);assert.equal(sceneSnapshot(ui).opacity,0);
 ui.runFor(.4);assert.ok(sceneSnapshot(ui).opacity>0&&sceneSnapshot(ui).opacity<1);assert.equal(attacks(ui),count);assert.equal(ui.depth('hero'),depth);
 runFramesUntil(ui,()=>ui.state().waveIndex===1,2);
 assert.equal(sceneSnapshot(ui).phase,'wave-in');assert.equal(sceneSnapshot(ui).opacity,1,'a fully black frame conceals the spawn reset');
 const spawned=ui.events.find(event=>event.type==='wave'&&event.waveIndex===1),age=ui.state().elapsed-spawned.at;
 assert.ok(age>=0&&age<=.016+1e-6,'only the remaining piece of the last RAF frame may advance the fresh wave');
 const home=800*.18,size=ui.node('[data-fighter="hero"]').offsetWidth,start=-size/2;
 assert.ok(ui.heroX()>=start-1e-6&&ui.heroX()<home,'the next wave starts another walk from the left edge');
 assert.equal(ui.depth('hero'),3,'new-wave entrance keeps the initial road row');
 assert.equal(ui.state().elapsed,spawned.at,'battle time is held during the next entrance');
 assert.equal(ui.state().hero.hp,hp);assert.equal(wallet(ui),5);
 ui.runFor(.2);assert.ok(sceneSnapshot(ui).opacity>0&&sceneSnapshot(ui).opacity<1);ui.runFor(.3);assertFadeCleared(ui);
 assert.ok(ui.heroX()<home,'the slower entrance continues after the screen fade');
 const upperStart=html.indexOf('<section class="adventure"'),upperEnd=html.indexOf('</section>',upperStart)+10,upper=html.slice(upperStart,upperEnd);
 assert.ok(upper.includes('id="scene-fade"'));assert.equal((html.match(/id="scene-fade"/g)||[]).length,1);assert.ok(!html.slice(upperEnd).includes('id="scene-fade"'));
 const css=fs.readFileSync(path.join(dist,'game.css'),'utf8'),fadeRule=css.match(/\.scene-fade\{([^}]*)\}/)?.[1]||'';
 assert.match(fadeRule,/position:absolute/);assert.match(fadeRule,/inset:0/);assert.match(fadeRule,/z-index:20/);
 assert.ok(!/\.battlefield\.is-between-waves \.fighter\{[^}]*opacity:0/.test(css),'the outgoing hero must not vanish through the old blanket opacity rule');
});

test('victory walks on before its result appears, while defeat stays still and reveals the exact defeat title',async()=>{
 const win=createHarness({weapon:'sword',outfit:'militia'});await win.loadAllImages();win.runUntil(()=>win.state().phase==='victory');
 const x=win.heroX(),depth=win.depth('hero'),hp=win.state().hero.hp,count=attacks(win);assert.equal(wallet(win),20);assert.equal(sceneSnapshot(win).resultHidden,true);
 win.runFor(.3);assert.ok(win.heroX()>x);assert.equal(win.depth('hero'),depth);assert.equal(win.node('[data-fighter="hero"]').dataset.motion,'walk');assert.equal(sceneSnapshot(win).phase,'victory');assert.equal(sceneSnapshot(win).resultHidden,true);
 win.runFor(1.1);assert.equal(sceneSnapshot(win).opacity,1);assert.equal(sceneSnapshot(win).resultHidden,false);assert.match(win.node('#result-title').textContent,/^Победа!?$/);assert.equal(attacks(win),count);assert.equal(win.state().hero.hp,hp);assert.equal(wallet(win),20);
 win.runUntil(()=>win.runCount===2,1);assert.equal(win.state().hero.hp,200);assert.equal(wallet(win),20);assertFadeCleared(win);
 const loss=createHarness({weapon:'wand',outfit:'acolyte',magic:'fire',combatOptions:{heroMaxHp:8,heroDamage:100}});await loss.loadAllImages();loss.runUntil(()=>loss.state().phase==='defeat');
 const corpse={x:loss.heroX(),depth:loss.depth('hero')},coins=wallet(loss);assert.ok(coins>0&&coins<20);assert.equal(loss.node('#result-title').textContent,'Поражение');assert.equal(sceneSnapshot(loss).resultHidden,true);
 loss.runFor(.3);assert.equal(loss.heroX(),corpse.x);assert.equal(loss.depth('hero'),corpse.depth);assert.notEqual(loss.node('[data-fighter="hero"]').dataset.motion,'walk');assert.ok(sceneSnapshot(loss).opacity>0&&sceneSnapshot(loss).opacity<1);
 loss.runFor(.3);assert.equal(sceneSnapshot(loss).opacity,1);assert.equal(sceneSnapshot(loss).resultHidden,false);assert.equal(loss.state().hero.hp,0);assert.equal(wallet(loss),coins);
 loss.runUntil(()=>loss.runCount===2,3);assert.equal(loss.state().hero.hp,8);assert.equal(wallet(loss),coins);assertFadeCleared(loss);
});

test('auto, modal and visibility pauses freeze walk-on, fade opacity and result reveal on the same active animation clock',async()=>{
 const ui=createHarness({weapon:'sword',outfit:'militia'});await ui.loadAllImages();ui.runUntil(()=>ui.state().phase==='intermission');ui.runFor(.7);
 assert.ok(sceneSnapshot(ui).opacity>0&&sceneSnapshot(ui).opacity<1);ui.node('#auto-button').click();const stopped=fullSnapshot(ui);ui.runFor(3);assert.deepEqual(fullSnapshot(ui),stopped);
 ui.node('#auto-button').click();ui.runFor(.1);ui.node('#profile-button').click();const modal=fullSnapshot(ui);ui.runFor(3);assert.deepEqual(fullSnapshot(ui),modal);
 ui.node('#game-dialog').close();ui.runFor(.2);ui.document.hidden=true;ui.document.dispatch('visibilitychange');const hidden=fullSnapshot(ui);ui.runFor(3);assert.deepEqual(fullSnapshot(ui),hidden);
 ui.document.hidden=false;ui.document.dispatch('visibilitychange');runFramesUntil(ui,()=>ui.state().waveIndex===1,2);ui.runFor(.2);
 assert.equal(sceneSnapshot(ui).phase,'wave-in');assert.ok(sceneSnapshot(ui).opacity>0&&sceneSnapshot(ui).opacity<1);
 ui.node('#auto-button').click();const arriving=fullSnapshot(ui);ui.runFor(3);assert.deepEqual(fullSnapshot(ui),arriving);ui.node('#auto-button').click();ui.runFor(.5);assertFadeCleared(ui);assert.equal(wallet(ui),5);
 const terminal=createHarness({weapon:'bow',outfit:'wanderer'});await terminal.loadAllImages();terminal.runUntil(()=>terminal.state().phase==='victory');terminal.runFor(.7);assert.equal(sceneSnapshot(terminal).resultHidden,true);
 terminal.node('#auto-button').click();const beforeReveal=fullSnapshot(terminal);terminal.runFor(3);assert.deepEqual(fullSnapshot(terminal),beforeReveal);assert.equal(sceneSnapshot(terminal).resultHidden,true);
 terminal.node('#auto-button').click();terminal.runFor(.8);assert.equal(terminal.state().phase,'victory');assert.equal(sceneSnapshot(terminal).resultHidden,false);assert.equal(wallet(terminal),20);
});

test('reduced motion keeps transitions without walking and manual replay clears fade layers without leaking another RAF loop',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',reducedMotion:true});await ui.loadAllImages();const home=ui.heroX();ui.runUntil(()=>ui.state().phase==='intermission');
 assert.equal(sceneSnapshot(ui).phase,'wave-out');assert.equal(sceneSnapshot(ui).opacity,1);assert.equal(ui.heroX(),home);assert.notEqual(ui.node('[data-fighter="hero"]').dataset.motion,'walk');
 ui.runFor(.3);assert.equal(ui.heroX(),home);assert.equal(sceneSnapshot(ui).opacity,1);assert.equal(wallet(ui),5);
 ui.runUntil(()=>ui.state().waveIndex===1,2);assert.equal(sceneSnapshot(ui).phase,'wave-in');assert.equal(sceneSnapshot(ui).opacity,1);ui.runFor(.5);assertFadeCleared(ui);
 ui.runUntil(()=>ui.state().phase==='victory');assert.equal(sceneSnapshot(ui).opacity,1);assert.equal(sceneSnapshot(ui).resultHidden,false);assert.equal(wallet(ui),20);
 ui.node('#replay-button').click();assert.equal(ui.runCount,2);assert.equal(ui.state().hero.hp,200);assert.equal(ui.state().waveIndex,0);assertFadeCleared(ui);assert.equal(ui.statusCanvases().length,0);assert.equal(ui.spells().length,0);assert.equal(wallet(ui),20);
 ui.runFor(.4);assertFadeCleared(ui);assert.equal(ui.runCount,2);assert.ok(ui.node('#player-sprite').draws.every(draw=>draw.crop[0]===0));
});

test('skill purchases update the active hero and HUD without healing, and survive replay and reload',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',savedProgression:{version:1,gold:120,levels:{power:0,vitality:0,tempo:0}}});await ui.loadAllImages();
 assert.equal(ui.skillMount.root,ui.node('#skills-panel'));assert.equal(ui.skillMount.heroLevel,1);
 ui.runUntil(()=>ui.events.some(event=>event.type==='attack'&&event.targetId==='hero'));
 ui.node('#auto-button').click();const hp=ui.state().hero.hp,elapsed=ui.state().elapsed;assert.ok(hp<200);
 for(const id of ['marksmanship','endurance','quickdraw'])assert.equal(ui.progression.purchase(id).ok,true);
 assert.equal(ui.state().elapsed,elapsed);assert.equal(ui.state().hero.hp,hp,'raising maximum HP must not heal the current battle');
 assert.equal(ui.state().hero.damage,14);assert.equal(ui.state().hero.maxHp,220);assert.equal(ui.state().hero.attackSpeed,1.05);
 assert.equal(ui.node('.power b').textContent,14);assert.equal(ui.node('#hero-vital').textContent,`${hp} / 220 HP`);assert.equal(ui.node('healthbar:hero').attributes['aria-valuemax'],'220');
 assert.equal(wallet(ui),90);assert.equal(ui.node('.gold').attributes['aria-label'],'Золото: 90');
 const oldAttacks=ui.events.filter(event=>event.type==='attack'&&event.sourceId==='hero').length;
 ui.node('#auto-button').click();ui.runUntil(()=>ui.events.filter(event=>event.type==='attack'&&event.sourceId==='hero').length===oldAttacks+2);
 const upgraded=ui.events.filter(event=>event.type==='attack'&&event.sourceId==='hero').slice(-2);
 assert.deepEqual(upgraded.map(event=>event.damage),[14,14]);assert.ok(upgraded[1].at-upgraded[0].at<1.2,'quickdraw must shorten the live arrow attack cadence');
 ui.runUntil(()=>ui.state().phase==='victory');ui.runUntil(()=>!ui.node('#battle-result').hidden,2);
 assert.equal(wallet(ui),110);ui.node('#replay-button').click();assert.equal(ui.state().hero.hp,220);assert.equal(ui.state().hero.damage,14);assert.equal(ui.state().hero.attackSpeed,1.05);
 const saved=JSON.parse(ui.storage.get('ember.progress.v1'));assert.deepEqual(saved.levels,{power:0,vitality:0,tempo:0});
 assert.deepEqual(saved.archerLevels,{marksmanship:1,endurance:1,quickdraw:1});assert.equal(saved.gold,110);
 const restored=createHarness({preference:'off',weapon:'bow',outfit:'wanderer',savedProgression:saved});await restored.loadAllImages();
 assert.equal(restored.state().hero.damage,14);assert.equal(restored.state().hero.maxHp,220);assert.equal(restored.state().hero.attackSpeed,1.05);assert.equal(restored.progression.getState().gold,110);assert.equal(restored.node('.gold').attributes['aria-label'],'Золото: 110');
});

test('kill rewards can buy skills through one persistent wallet without duplicate payouts',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',legacyGold:0});await ui.loadAllImages();
 ui.runUntil(()=>kills(ui).length===2);ui.node('#auto-button').click();assert.equal(wallet(ui),10);assert.equal(ui.progression.getState().gold,10);
 assert.equal(ui.progression.purchase('marksmanship').ok,true);assert.equal(wallet(ui),0);assert.equal(ui.state().hero.damage,14);assert.equal(ui.node('.gold').attributes['aria-label'],'Золото: 0');
 assert.equal(JSON.parse(ui.storage.get('ember.progress.v1')).gold,0);
 ui.node('#auto-button').click();ui.runUntil(()=>ui.state().phase==='victory');assert.equal(kills(ui).length,4);assert.equal(wallet(ui),10);assert.equal(ui.progression.getState().gold,10);assert.equal(JSON.parse(ui.storage.get('ember.progress.v1')).gold,10);
 ui.node('#auto-button').click();const settled=ui.storage.get('ember.progress.v1');ui.runFor(3);assert.equal(ui.storage.get('ember.progress.v1'),settled);assert.equal(wallet(ui),10);
});

test('blocked persistent storage grants neither a free skill nor an unsaved kill reward',async()=>{
 const saved={version:1,gold:30,levels:{power:0,vitality:0,tempo:0}},ui=createHarness({weapon:'bow',outfit:'wanderer',savedProgression:saved,legacyGold:30,storageBlocked:true});await ui.loadAllImages();
 assert.equal(ui.progression.purchase('marksmanship').ok,false);assert.equal(ui.state().hero.damage,12);assert.equal(ui.progression.getState().gold,30);assert.equal(ui.progression.getState().archerLevels?.marksmanship||0,0);assert.deepEqual(JSON.parse(ui.storage.get('ember.progress.v1')),saved);
 ui.runUntil(()=>kills(ui).length===1);assert.equal(ui.progression.getState().gold,30);assert.equal(wallet(ui),30);assert.equal(ui.node('.gold').attributes['aria-label'],'Золото: 30');assert.equal(ui.state().hero.damage,12);assert.deepEqual(JSON.parse(ui.storage.get('ember.progress.v1')),saved);
});

test('Mage skill purchases modify spell combat without inheriting Warrior damage',async()=>{
 const saved={version:1,gold:100,levels:{power:5,vitality:3,tempo:3}};
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'fire',savedProgression:saved});
 await ui.loadAllImages();
 assert.equal(ui.skillMount.classId,'wand');
 assert.equal(ui.state().hero.damage,12,'Warrior ranks must not buff Mage spells');
 assert.equal(ui.state().hero.maxHp,200);
 assert.equal(ui.progression.purchase('sorcery').ok,true);
 assert.equal(ui.progression.purchase('barrier').ok,true);
 assert.equal(ui.progression.purchase('channel').ok,true);
 assert.equal(ui.state().hero.damage,14);
 assert.equal(ui.state().hero.maxHp,220);
 assert.equal(ui.state().hero.attackSpeed,1.05);
 assert.equal(ui.progression.getState().gold,70);
 const restored=createHarness({weapon:'wand',outfit:'acolyte',magic:'ice',savedProgression:JSON.parse(ui.storage.get('ember.progress.v1'))});
 await restored.loadAllImages();
 assert.equal(restored.state().hero.damage,14);
 assert.equal(restored.state().hero.maxHp,220);
 assert.equal(restored.state().hero.attackSpeed,1.05);
});

test('Archer has independent live arrow upgrades and cannot spend Warrior or Mage skills',async()=>{
 const saved={version:1,gold:100,levels:{power:5,vitality:4,tempo:3},mageLevels:{sorcery:3,barrier:2,channel:1}};
 const ui=createHarness({weapon:'bow',outfit:'wanderer',savedProgression:saved});await ui.loadAllImages();
 assert.equal(ui.skillMount.classId,'bow');
 assert.equal(ui.state().hero.damage,12);
 assert.equal(ui.state().hero.maxHp,200);
 assert.equal(ui.progression.purchase('power').reason,'unknown');
 assert.equal(ui.progression.purchase('sorcery').reason,'unknown');
 assert.equal(ui.progression.purchase('marksmanship').ok,true);
 assert.equal(ui.progression.purchase('endurance').ok,true);
 assert.equal(ui.progression.purchase('quickdraw').ok,true);
 assert.equal(ui.state().hero.damage,14);
 assert.equal(ui.state().hero.maxHp,220);
 assert.equal(ui.state().hero.attackSpeed,1.05);
 const progress=JSON.parse(ui.storage.get('ember.progress.v1'));
 assert.deepEqual(progress.levels,saved.levels);
 assert.deepEqual(progress.mageLevels,saved.mageLevels);
 assert.deepEqual(progress.archerLevels,{marksmanship:1,endurance:1,quickdraw:1});
 const restored=createHarness({weapon:'bow',outfit:'wanderer',savedProgression:progress});await restored.loadAllImages();
 assert.equal(restored.state().hero.damage,14);
 assert.equal(restored.state().hero.maxHp,220);
 assert.equal(restored.state().hero.attackSpeed,1.05);
});

test('equipped Archer wolf runs into melee and hits while the Archer keeps firing arrows',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',wolfEquipped:true,
   combatOptions:{heroDamage:2,heroMaxHp:750}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.events.some(e=>e.type==='attack'&&e.sourceId==='companion'),25);
 const hit=ui.events.find(e=>e.type==='attack'&&e.sourceId==='companion');
 assert.equal(hit.projectile,'bite');
 assert.equal(hit.damage,7);
 assert.equal(hit.targetId,'archer1');
 assert.ok(hit.at>1.5,'wolf must travel and complete bite wind-up before damaging the enemy');
 // Wolf can arrive before the Archer's second shot. Check the next shot
 // when it occurs, not prematurely at the first bite impact.
 ui.runUntil(()=>ui.events.filter(e=>e.type==='attack'&&e.sourceId==='hero'&&e.projectile==='arrow').length>=2,6);
 const arrows=ui.events.filter(e=>e.type==='attack'&&e.sourceId==='hero'&&e.projectile==='arrow');
 assert.ok(arrows.length>=2,'Archer continues shooting throughout companion combat');
 assert.equal(arrows[0].at,1.2,'wolf must not shift the first arrow attack tick');
 assert.equal(arrows[1].at,2.4,'wolf must not shift the second arrow attack tick');
 const wolfNode=ui.node('#companion-wolf');
 assert.equal(wolfNode.hidden,false);
 assert.ok(wolfNode.motionHistory.includes('run'));
 assert.ok(wolfNode.motionHistory.includes('bite'));
 assert.ok(Number.parseFloat(wolfNode.style.left)>ui.heroX(),'wolf visibly ran ahead of the archer');
 const prior=ui.state(),priorBites=ui.events.filter(e=>e.sourceId==='companion').length;
 ui.node('#auto-button').click();
 ui.runFor(2);
 assert.equal(ui.state().elapsed,prior.elapsed,'combat pauses');
 assert.equal(ui.events.filter(e=>e.sourceId==='companion').length,priorBites,'wolf cannot bite on pause');
});
test('legacy saved wolf is ignored for Warrior and Mage in the live game',async()=>{
 for(const options of [{weapon:'sword',outfit:'wanderer'},{weapon:'wand',outfit:'acolyte',magic:'fire'}]){
   const ui=createHarness({...options,wolfEquipped:true});
   await ui.loadAllImages();
   ui.runFor(12);
   assert.equal(ui.node('#companion-wolf').hidden,true);
   assert.equal(ui.events.some(e=>e.sourceId==='companion'),false);
 }
});

test('equipped Archer wolf animates from the FIRST entrance frame while the combat clock is frozen',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',wolfEquipped:true,combatOptions:{heroMaxHp:800,heroDamage:120}});
 await ui.loadAllImages();
 const sprite=ui.node('companion:canvas'),wolfNode=ui.node('#companion-wolf');
 const x0=ui.heroX();
 ui.runFor(.7);
 assert.equal(ui.state().elapsed,0,'entrance deliberately holds only combat time');
 assert.ok(ui.heroX()>x0,'the Archer is walking onto the screen');
 assert.equal(wolfNode.dataset.motion,'walk','wolf must walk from the beginning of the entrance');
 assert.equal(wolfNode.dataset.facing,'right');
 const frames=sprite.draws.filter(draw=>draw.crop[1]===96).map(draw=>draw.crop[0]);
 assert.ok(new Set(frames).size>=4,
   'wolf paws must change frames during the frozen first-wave combat clock, not slide in a standing frame');
 assert.ok(Number.parseFloat(wolfNode.style.left)>x0-64,'wolf follows the incoming Archer immediately');
 const start=frames.length;
 ui.node('#auto-button').click();
 const xPause=Number.parseFloat(wolfNode.style.left),drawPause=sprite.draws.length;
 ui.runFor(.6);
 assert.equal(ui.state().elapsed,0);
 assert.equal(Number.parseFloat(wolfNode.style.left),xPause,'paused entrance must stop wolf position');
 assert.equal(sprite.draws.length,drawPause,'paused entrance must stop wolf animation frames');
 ui.node('#auto-button').click();
 ui.runFor(.5);
 assert.ok(sprite.draws.length>drawPause,'wolf must resume its gait without waiting for combat');
 assert.ok(sprite.draws.filter(draw=>draw.crop[1]===96).length>start);
});

test('equipped wolf starts animating immediately in the SECOND and THIRD wave entrances too',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',wolfEquipped:true,
  combatOptions:{heroMaxHp:1200,heroDamage:120}});
 await ui.loadAllImages();
 const sprite=ui.node('companion:canvas'),wolf=ui.node('#companion-wolf');
 for(const waveIndex of [1,2]){
   ui.runUntil(()=>ui.state().waveIndex===waveIndex,35);
   const held=ui.state().elapsed;
   const before=sprite.draws.length;
   ui.runFor(.6);
   assert.equal(ui.state().waveIndex,waveIndex);
   assert.equal(ui.state().elapsed,held,'combat clock must stay frozen for each new wave entrance');
   assert.equal(wolf.dataset.motion,'walk');
   const walked=sprite.draws.slice(before).filter(draw=>draw.crop[1]===96).map(draw=>draw.crop[0]);
   assert.ok(new Set(walked).size>=4,
     `wave ${waveIndex+1} wolf must animate its paws from the start instead of sliding`);
 }
});

test('stationary archers shoot the equipped wolf instead of the hero',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',wolfEquipped:true,
   combatOptions:{heroDamage:1,heroMaxHp:600}});
 await ui.loadAllImages();
 assert.equal(ui.state().companion.hp,70);
 assert.equal(ui.state().enemyTargetId,'companion');
 const archer=ui.node('[data-fighter="archer1"]'),start=actorX(ui,'archer1');
 ui.runUntil(()=>ui.events.some(e=>e.sourceId==='archer1'&&e.targetId==='companion'),20);
 const strike=ui.events.find(e=>e.sourceId==='archer1'&&e.targetId==='companion'&&e.type==='attack');
 assert.equal(strike.damage,7);
 assert.ok(Math.abs(actorX(ui,'archer1')-start)<.1,'archer stays at its spawn point');
 const restingX=actorX(ui,'archer1');
 ui.runFor(.2);
 assert.ok(Math.abs(actorX(ui,'archer1')-restingX)<.1,
   'enemy must stop moving while fighting the wolf');
 assert.equal(ui.state().hero.hp,600,'the Archer takes no damage while wolf survives');
 assert.equal(ui.state().companion.hp,63);
 assert.equal(ui.node('#companion-health-fill').style.width,'90%');
 assert.equal(ui.node('#companion-wolf').hidden,false);
 assert.ok(ui.events.some(e=>e.sourceId==='hero'&&e.projectile==='arrow'),
   'Archer keeps shooting while the wolf tanks');
});
test('after the wolf falls, stationary archers switch fire to the hero',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',wolfEquipped:true,
   combatOptions:{companionMaxHp:14,heroDamage:1,heroMaxHp:600}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.events.some(e=>e.type==='death'&&e.id==='companion'),25);
 assert.equal(ui.state().companion.hp,0);
 assert.equal(ui.state().enemyTargetId,'hero');
 assert.equal(ui.events.filter(e=>e.type==='death'&&e.id==='companion').length,1);
 assert.equal(ui.state().hero.hp,600);
 const previous=actorX(ui,'archer1');
 ui.runFor(.6);
 assert.ok(Math.abs(actorX(ui,'archer1')-previous)<.1,'archer switches targets without walking');
 assert.equal(ui.node('#companion-wolf').dataset.motion,'die');
 assert.equal(ui.node('#companion-health-fill').style.width,'0%');
 ui.runUntil(()=>ui.events.some(e=>e.type==='attack'&&e.targetId==='hero'&&e.sourceId==='archer1'),12);
 assert.ok(ui.state().hero.hp<600,'the enemy only attacks the hero after defeating the wolf');
 assert.equal(ui.events.filter(e=>e.type==='death'&&e.id==='companion').length,1);
 assert.ok(!ui.events.some(e=>e.sourceId==='companion'&&e.at>ui.events.find(x=>x.id==='companion'&&x.type==='death').at));
});

test('animated Red Dragon boss appears after the old three waves with flapping wings during entrance',async()=>{
 const ui=createHarness({weapon:'sword',outfit:'wanderer',dragonBoss:true,
   combatOptions:{heroDamage:450,heroMaxHp:1400}});
 await ui.loadAllImages();
 assert.equal(ui.state().waveCount,4);
 assert.equal(ui.state().totalEnemies,5);
 const wave=ui.runUntil(()=>ui.state().waveIndex===3,45);
 assert.ok(wave>0);
 assert.equal(ui.state().enemies[0].id,'dragon');
 assert.equal(ui.state().enemies[0].maxHp,180);
 const body=ui.node('[data-fighter="dragon"]'),sprite=ui.node('#enemy-dragon');
 assert.equal(body.hidden,false,'dragon needs a visible battle actor');
 assert.equal(body.dataset.motion,'fly');
 assert.ok(sprite.draws.some(d=>d.src==='assets/enemies/dragon/reddragonfly3.png'));
 const elapsed=ui.state().elapsed,previous=sprite.draws.length;
 ui.runFor(.6);
 assert.equal(ui.state().elapsed,elapsed,'combat remains frozen during the boss entrance');
 const frames=sprite.draws.slice(previous).map(draw=>draw.crop[0]);
 assert.ok(new Set(frames).size>=3,'dragon must flap wings while moving on during the entrance');
 ui.runUntil(()=>ui.events.some(e=>e.type==='death'&&e.id==='dragon'),25);
 assert.equal(ui.state().phase,'victory');
 assert.equal(ui.state().reward,25);
 assert.equal(ui.events.filter(e=>e.type==='death'&&e.id==='dragon').length,1);
});

test('dragon hovers and fires five separate Mage-style fireballs from its mouth',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',dragonBoss:true,wolfEquipped:false,
   combatOptions:{heroDamage:300,heroMaxHp:1800}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.state().waveIndex===3,45);
 ui.battle.updateHeroStats({heroDamage:1});
 const dragonActor=ui.node('[data-fighter="dragon"]');
 const startX=Number.parseFloat(dragonActor.style.left);
 ui.runFor(.7);
 assert.equal(Number.parseFloat(dragonActor.style.left),startX);
 assert.ok(ui.node('#enemy-dragon').draws.length>=4,'dragon still flaps its wings while flying');
 const orbs=()=>ui.node('.battlefield').children.filter(el=>
   el.className==='spell-projectile'&&el.dataset.dragonVolley==='true');
 ui.runUntil(()=>ui.events.some(e=>e.type==='cast'&&e.sourceId==='dragon'),12);
 assert.ok(orbs().length>=1,'first fireball is rendered');
 const first=orbs()[0],mouth=ui.node('#enemy-dragon').getBoundingClientRect();
 const atlas=require('../dist/dragon.js');
 const draw=ui.node('#enemy-dragon').draws.at(-1);
 const frame={frame:Math.floor(draw.crop[1]/161)*4+Math.floor(draw.crop[0]/205),direction:'left'};
 const point=atlas.mouthAt(mouth,frame),field=ui.node('.battlefield').getBoundingClientRect();
 assert.ok(Math.abs(Number(first.dataset.muzzleX)-(point.x-field.left))<9,
   'fireball launches from the animated mouth, not the torso');
 assert.ok(Math.abs(Number(first.dataset.muzzleY)-(point.y-field.top))<9,
   'fireball launches at mouth height');
 assert.equal(first.dataset.magic,'fire');
 assert.equal(first.dataset.burst,'0');
 assert.ok(['flight','impact'].includes(first.dataset.phase));
 ui.runUntil(()=>ui.events.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length>=5,10);
 const casts=ui.events.filter(e=>e.type==='cast'&&e.sourceId==='dragon').slice(0,5);
 assert.deepEqual(casts.map(e=>e.burstIndex),[0,1,2,3,4]);
 assert.equal(Number.parseFloat(dragonActor.style.left),startX);
 assert.ok(orbs().every(el=>el.className==='spell-projectile'),
   'no continuous fire beam is drawn');
 ui.runFor(.8);
 assert.equal(orbs().length,0,'every fireball expires before the next volley starts');
 assert.equal(ui.events.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,5,
   'dragon pauses between distinct salvos');
 const hits=ui.events.filter(e=>e.type==='attack'&&e.sourceId==='dragon');
 assert.equal(hits.length,5,'each of the five magic shots deals engine-confirmed damage');
});

test('hovering dragon hits equipped wolf with claws, not with persistent fire',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',dragonBoss:true,wolfEquipped:true,
   combatOptions:{heroDamage:300,heroMaxHp:1800}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.state().waveIndex===3,45);
 ui.battle.updateHeroStats({heroDamage:1});
 assert.ok(ui.state().companion.hp>0,'wolf must be alive at boss entrance');
 const boss=ui.node('[data-fighter="dragon"]');
 const initialX=Number.parseFloat(boss.style.left);
 ui.runUntil(()=>ui.events.some(e=>e.type==='attack'&&e.sourceId==='dragon'
   &&e.projectile==='claw'),18);
 const claw=ui.events.find(e=>e.sourceId==='dragon'&&e.projectile==='claw');
 assert.equal(claw.targetId,'companion');
 assert.equal(claw.damage,24);
 assert.ok(ui.state().companion.hp<ui.state().companion.maxHp);
 assert.equal(ui.events.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,0,
   'no fireball or fire breath may be aimed at a living wolf');
 assert.equal(ui.node('.battlefield').children.filter(el=>el.className==='dragon-breath').length,0);
 assert.equal(Number.parseFloat(boss.style.left),initialX,
   'dragon stays hovering while swiping at the wolf');
});

test('dragon fireballs disappear instantly when dragon dies during a salvo',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',dragonBoss:true,wolfEquipped:false,
   combatOptions:{heroDamage:300,heroMaxHp:1800}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.state().waveIndex===3,45);
 ui.battle.updateHeroStats({heroDamage:1});
 ui.runUntil(()=>ui.events.some(e=>e.type==='cast'&&e.sourceId==='dragon'),14);
 ui.runFor(.1);
 const visible=()=>ui.node('.battlefield').children.filter(el=>el.className==='spell-projectile'&&el.dataset.dragonVolley==='true');
 assert.ok(visible().length>0,'fire exists while dragon is alive and exhaling');
 ui.battle.updateHeroStats({heroDamage:500});
 ui.runUntil(()=>ui.events.some(e=>e.type==='death'&&e.id==='dragon'),3);
 assert.equal(ui.state().phase,'victory');
 assert.equal(visible().length,0,'every fireball is removed in the death event, not at timeout');
 const casts=ui.events.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length;
 const hits=ui.events.filter(e=>e.type==='attack'&&e.sourceId==='dragon').length;
 const hp=ui.state().hero.hp;
 ui.runFor(1.4);
 assert.equal(visible().length,0,'fire cannot linger during the result transition');
 assert.equal(ui.events.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,casts,
   'no extra fireball volleys after the boss is killed');
 assert.equal(ui.events.filter(e=>e.type==='attack'&&e.sourceId==='dragon').length,hits);
 assert.equal(ui.state().hero.hp,hp,'no hidden damage from vanished fire');
});

test('Orc faces its current direction toward the Archer wolf while running, not the viewer',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',wolfEquipped:true,
   combatOptions:{heroDamage:120,heroMaxHp:1400}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.state().waveIndex===2,35);
 ui.battle.updateHeroStats({heroDamage:1});
 const orc=ui.node('[data-fighter="orc"]');
 const startX=actorX(ui,'orc'),canvas=ui.node('#enemy-orc');
 const gait=new Set();
 let previous=actorX(ui,'orc'),sampled=0;
 for(let n=0;n<110;n++){
   ui.frame(100);
   const position=actorX(ui,'orc');
   const draw=canvas.draws.at(-1);
   const dx=position-previous;
   if(Math.abs(dx)>.001&&draw?.src.endsWith('orc-walk.png')&&draw.crop?.[0]>0){
     // Wolf can cross the Orc, so facing must be checked PER FRAME, not
     // against net movement over several seconds.
     assert.equal(draw.crop[1],dx<0?64:192,
       'Orc walk frame must face left/right toward the current moving target');
     gait.add(draw.crop[0]);
     sampled++;
   }
   previous=position;
   if(sampled>=6&&gait.size>=3)break;
 }
 assert.ok(Math.abs(actorX(ui,'orc')-startX)>5,'Orc must actually travel');
 assert.ok(orc.motionHistory.includes('walk'),'Orc uses its walk sprite while moving');
 assert.ok(sampled>=3,'sample several real movement frames');
 assert.ok(gait.size>=3,'Orc must animate at least three different stepping frames');
 assert.ok(ui.state().enemies[0].hp>0,'the tested Orc is still alive');
});
test('Archer and living wolf exit the completed wave in the SAME direction',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',wolfEquipped:true,
  combatOptions:{heroDamage:140,heroMaxHp:1300}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.events.some(e=>e.type==='wave_clear'),23);
 const wolf=ui.node('#companion-wolf');
 const heroBefore=ui.heroX(),wolfBefore=Number.parseFloat(wolf.style.left);
 ui.runFor(.7);
 const heroAfter=ui.heroX(),wolfAfter=Number.parseFloat(wolf.style.left);
 assert.ok(heroAfter>heroBefore+10,'the Archer walks right into the wave transition');
 assert.ok(wolfAfter>=wolfBefore,'wolf cannot run left away from the exiting Archer');
 assert.ok(wolfAfter>wolfBefore+8,'wolf accompanies the Archer instead of remaining stranded');
 assert.equal(wolf.dataset.facing,'right');
 assert.equal(wolf.dataset.motion,'walk');
});
test('dragon visibly descends toward wolf before claw strike and climbs back up before breathing fire',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',dragonBoss:true,wolfEquipped:true,
   combatOptions:{heroDamage:300,heroMaxHp:1800,companionMaxHp:12}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.state().waveIndex===3,45);
 ui.battle.updateHeroStats({heroDamage:1});
 const dragon=ui.node('[data-fighter="dragon"]');
 ui.runFor(.6);
 const high=Number.parseFloat(dragon.style['--dragon-hover']);
 assert.ok(high < -15,'dragon initially hovers visibly above the road');
 ui.runUntil(()=>dragon.dataset.dive==='descending',13);
 const descending=Number.parseFloat(dragon.style['--dragon-hover']);
 assert.ok(descending>high+1,'dragon lowers its body as wolf approaches');
 ui.runUntil(()=>dragon.dataset.dive==='near-wolf',8);
 const near=Number.parseFloat(dragon.style['--dragon-hover']);
 assert.ok(near>high+15,'dragon reaches wolf level before claw contact');
 ui.runUntil(()=>ui.events.some(e=>e.type==='attack'&&e.sourceId==='dragon'
   &&e.projectile==='claw'),7);
 assert.equal(ui.events.filter(e=>e.type==='cast'&&e.sourceId==='dragon').length,0,
   'the dive ends in physical contact, never flame damage against wolf');
 ui.runUntil(()=>ui.state().companion.hp===0,8);
 ui.runUntil(()=>dragon.dataset.dive==='high',5);
 const risen=Number.parseFloat(dragon.style['--dragon-hover']);
 assert.ok(risen<near-15,'after wolf falls dragon visibly takes flight again');
 ui.runUntil(()=>ui.events.some(e=>e.type==='cast'&&e.sourceId==='dragon'),8);
 assert.ok(ui.events.some(e=>e.sourceId==='dragon'&&e.breath&&e.targetId==='hero'));
});

test('Red Dragon keeps jaws open continuously across all five fireballs, then closes between salvos',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',dragonBoss:true,wolfEquipped:false,
   combatOptions:{heroDamage:300,heroMaxHp:1800}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.state().waveIndex===3,45);
 ui.battle.updateHeroStats({heroDamage:1});
 const body=ui.node('[data-fighter="dragon"]');
 const sprite=ui.node('#enemy-dragon');
 const casts=()=>ui.events.filter(e=>e.type==='cast'&&e.sourceId==='dragon');
 ui.runUntil(()=>casts().length===1,13);
 assert.equal(body.dataset.motion,'breath','dragon opens its mouth at first fireball');
 assert.equal(body.dataset.breathing,'true');
 assert.deepEqual(sprite.draws.at(-1).crop.slice(0,2),[0,483]);
 const historyStart=body.motionHistory.length;
 // Pause partway through a salvo. The jaw must not snap closed during pause.
 ui.node('#auto-button').click();
 const elapsed=ui.state().elapsed;
 ui.runFor(.7);
 assert.equal(ui.state().elapsed,elapsed);
 assert.equal(body.dataset.motion,'breath','paused dragon retains open mouth');
 ui.node('#auto-button').click();
 for(let i=2;i<=5;i++){
   ui.runUntil(()=>casts().length>=i,4);
   assert.equal(body.dataset.motion,'breath',
     'all dragon shots are released with the same open-mouth pose');
   assert.equal(body.dataset.breathing,'true');
   assert.deepEqual(sprite.draws.at(-1).crop.slice(0,2),[0,483],
     'a new cast never restarts the closed-mouth flight sprite');
 }
 assert.ok(body.motionHistory.slice(historyStart).every(m=>m==='breath'),
   'no closed-mouth flying or hit frame between five successive fireballs');
 ui.runFor(.1);
 assert.equal(body.dataset.motion,'breath',
   'dragon keeps mouth open briefly after launching the last fireball');
 ui.runFor(.25);
 assert.equal(body.dataset.breathing,'false',
   'dragon ends the open-mouth pose after the completed salvo');
 assert.equal(body.dataset.motion,'fly',
   'normal flight resumes in the gap before the next salvo');
 assert.equal(casts().length,5,'no sixth shot is triggered by the new pose');
});

test('Red Dragon never holds open-mouth fire pose for claw attacks on living wolf',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',dragonBoss:true,wolfEquipped:true,
   combatOptions:{heroDamage:300,heroMaxHp:1800}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.state().waveIndex===3,45);
 ui.battle.updateHeroStats({heroDamage:1});
 ui.runUntil(()=>ui.events.some(e=>e.type==='attack'&&e.sourceId==='dragon'
   &&e.projectile==='claw'),20);
 const body=ui.node('[data-fighter="dragon"]');
 assert.equal(body.dataset.breathing,'false');
 assert.notEqual(body.dataset.motion,'breath');
 assert.ok(!ui.events.some(e=>e.type==='cast'&&e.sourceId==='dragon'),
   'wolf attacks are claw-only, without fire or held open-mouth magic');
});

test('a Mage with a legacy saved ice choice actually alternates both spells automatically',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'ice',
   combatOptions:{heroMaxHp:1200,heroDamage:2}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.events.filter(e=>e.type==='cast'&&e.sourceId==='hero').length>=4,15);
 const casts=ui.events.filter(e=>e.type==='cast'&&e.sourceId==='hero').slice(0,4);
 assert.deepEqual(casts.map(e=>e.magic),['fire','ice','fire','ice']);
 assert.deepEqual(casts.map(e=>e.at),[1.2,2.4,3.6,4.8]);
 assert.equal(JSON.parse(ui.storage.get('ember.character.v1')).magic,'ice',
   'the old character save remains intact until explicitly edited');
 assert.ok(!ui.actorIds.includes('mage'),'no new NPC is introduced');
});

test('mixed second wave has two advancing swordsmen and two stationary archers',async()=>{
 const ui=createHarness({weapon:'bow',outfit:'wanderer',mixedWave:true,wolfEquipped:true,combatOptions:{heroDamage:100,heroMaxHp:2000,companionMaxHp:2000}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.state().waveIndex===1,35);
 ui.battle.updateHeroStats({heroDamage:1});
 assert.deepEqual(ui.state().enemies.map(e=>e.id),['skeletonSword1','skeletonSword2','archer2','archer3']);
 const ids=['skeletonSword1','skeletonSword2'],origins=ids.map(id=>actorX(ui,id)),archers=['archer2','archer3'].map(id=>actorX(ui,id));
 const gait=new Set();
 for(let i=0;i<100;i++){
   ui.frame(100);
   const actor=ui.node('[data-fighter="skeletonSword1"]'),draw=ui.node('#enemy-skeletonSword1').draws.at(-1);
   if(actor.dataset.motion==='walk'){assert.ok(draw.src.endsWith('skeleton-sword-walk.svg'));gait.add(draw.crop[0]);}
   if(gait.size>=3&&ui.events.some(e=>e.type==='attack'&&e.sourceId==='skeletonSword1'))break;
 }
 assert.ok(gait.size>=3);
 assert.ok(ids.every((id,i)=>Math.abs(actorX(ui,id)-origins[i])>5));
 assert.ok(['archer2','archer3'].every((id,i)=>Math.abs(actorX(ui,id)-archers[i])<.1));
 assert.ok(ui.events.some(e=>e.type==='attack'&&e.sourceId==='skeletonSword1'&&e.targetId==='companion'));
 assert.ok(ui.events.some(e=>e.type==='attack'&&e.sourceId==='archer2'&&e.targetId==='companion'));
});

test('mage shield is rendered as separate actor-local overlay and shard spell uses its own sprite',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',combatOptions:{heroDamage:1,heroSphereRank:1,heroShardRank:1,heroBurnRank:1,heroMaxHp:1000}});await ui.loadAllImages();
 const hero=ui.node('[data-fighter="hero"]');assert.ok(hero.children.some(el=>el.className==='mage-sphere'));ui.runUntil(()=>ui.events.some(e=>e.type==='cast'&&e.shards),15);assert.ok(ui.spells().some(el=>el.dataset.shards==='true'));ui.runUntil(()=>ui.events.some(e=>e.type==='sphere'&&e.broken),20);assert.ok(hero.children.some(el=>el.className==='mage-sphere'&&Number(el.dataset.frame)>=8));ui.runFor(.7);assert.ok(!hero.children.some(el=>el.className==='mage-sphere'));
});

test('arcane sphere atlas has separate transparent durability and hit frames, and keeps centered layout',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',combatOptions:{heroDamage:1,heroSphereRank:2,heroMaxHp:1000}});await ui.loadAllImages();
 const hero=ui.node('[data-fighter="hero"]'),shield=()=>hero.children.find(el=>el.className==='mage-sphere');
 assert.ok(ui.loadedPaths.includes('assets/magic/mage-sphere-v2.svg'));assert.equal(shield().width,128);assert.equal(shield().height,128);assert.ok(Number(shield().dataset.frame)<4);
 ui.runUntil(()=>ui.events.some(e=>e.type==='sphere'),20);assert.ok(Number(shield().dataset.hitFrame)>=12);assert.ok(shield().draws.some(d=>d.crop[0]>=12*128));
 ui.runUntil(()=>ui.state().hero.sphere.hp<=15,20);assert.ok(Number(shield().dataset.frame)>=4&&Number(shield().dataset.frame)<6);
 ui.runUntil(()=>ui.state().hero.sphere.hp<=7,20);assert.ok(Number(shield().dataset.frame)>=6&&Number(shield().dataset.frame)<8);
 ui.runUntil(()=>ui.events.some(e=>e.type==='sphere'&&e.broken),20);assert.ok(Number(shield().dataset.frame)>=8&&Number(shield().dataset.frame)<12);ui.runFor(.7);assert.ok(!shield());
 const css=fs.readFileSync(path.join(dist,'game.css'),'utf8');assert.match(css,/canvas\.mage-sphere\{[^}]*width:150%;height:150%;left:-25%;top:-25%/);
});

test('shield stops a skeleton arrow on its outer rim and draws splinters instead of body hit',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',combatOptions:{heroDamage:1,heroSphereRank:1,heroMaxHp:1000}});await ui.loadAllImages();
 const field=ui.node('.battlefield'),arrows=()=>field.children.filter(el=>el.className==='projectile arrow'&&el.dataset.target==='hero'&&!el.hidden),bursts=()=>field.children.filter(el=>el.className==='barrier-impact');
 ui.runUntil(()=>arrows().some(el=>Number.isFinite(Number(el.dataset.barrierX))),15);
 const arrow=arrows()[0],hero=ui.node('[data-fighter="hero"]').getBoundingClientRect(),rect=field.getBoundingClientRect();
 assert.ok(Number(arrow.dataset.barrierX)>hero.left+hero.width/2-rect.left);
 assert.ok(Number.parseFloat(arrow.style.left)>=Number(arrow.dataset.barrierX)-.01);
 ui.runUntil(()=>ui.events.some(e=>e.type==='sphere'),15);assert.ok(!field.children.includes(arrow));assert.equal(ui.state().hero.hp,1000);
 const burst=bursts()[0];assert.ok(burst);assert.equal(burst.dataset.kind,'arrow');assert.ok(burst.draws.some(d=>d.src.endsWith('mage-barrier-impact.svg')&&d.crop[1]===0));
 assert.ok(Math.abs(Number.parseFloat(burst.style.left)-Number(arrow.dataset.barrierX))<1);ui.runFor(.5);assert.ok(!field.children.includes(burst));
});
test('dragon magic shatters at shield, only unabsorbed damage reaches hero',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',dragonBoss:true,combatOptions:{heroDamage:300,heroMaxHp:1800}});await ui.loadAllImages();ui.runUntil(()=>ui.state().waveIndex===3,45);
 ui.battle.updateHeroStats({heroDamage:1,heroSphereRank:1});const field=ui.node('.battlefield');
 ui.runUntil(()=>ui.events.some(e=>e.type==='sphere'&&e.sourceId==='dragon'),15);
 const absorbed=ui.events.find(e=>e.type==='sphere'&&e.sourceId==='dragon');assert.equal(absorbed.projectile,'magic');assert.ok(absorbed.castId);assert.equal(absorbed.absorbed,6);
 const burst=field.children.find(el=>el.className==='barrier-impact'&&el.dataset.castId===absorbed.castId);assert.ok(burst);assert.equal(burst.dataset.kind,'magic');assert.ok(burst.draws.some(d=>d.crop[1]===64));
 assert.ok(!ui.spells().some(el=>el.dataset.dragonVolley==='true'&&el.dataset.burst==='0'));
 ui.runUntil(()=>ui.events.some(e=>e.type==='sphere'&&e.sourceId==='dragon'&&e.broken),15);assert.equal(ui.state().hero.sphere.hp,0);assert.ok(ui.events.some(e=>e.type==='attack'&&e.sourceId==='dragon'&&e.damage===4));
});

test('mage reaction uses separate transparent advanced effect atlas',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',combatOptions:{heroDamage:1,heroMaxHp:1000,heroFusionRank:1}});await ui.loadAllImages();for(const skill of ['thermal','steam','chaos','absorption','rebirth','echo','overload','archmage'])assert.ok(ui.loadedPaths.includes((skill==='echo'?'assets/magic/mage-echo-resonance-v2.png':'assets/magic/mage-'+skill+'.png')));assert.ok(!ui.loadedPaths.includes('assets/magic/mage-advanced.svg'));ui.runUntil(()=>ui.events.some(e=>e.type==='mageSkill'&&e.skill==='steam'),15);const effect=ui.node('.battlefield').children.find(el=>el.className==='mage-advanced-effect'&&el.dataset.skill==='steam');assert.ok(effect);assert.ok(effect.draws.some(d=>d.src.endsWith('mage-steam.png')&&d.crop[1]===0&&d.crop[2]===64&&d.crop[3]===64));
});

test('approved mage effect sheets are raster PNGs with real palette transparency and six equal frames',()=>{
 for(const skill of ['thermal','steam','chaos','absorption','rebirth','echo','overload','archmage']){
  const data=fs.readFileSync(path.join(dist,skill==='echo'?'assets/magic/mage-echo-resonance-v2.png':'assets/magic/mage-'+skill+'.png'));
  assert.equal(data.subarray(1,4).toString(),'PNG');assert.equal(data.readUInt32BE(16),384);assert.equal(data.readUInt32BE(20),64);
  let offset=8,transparent=false;
  while(offset+12<=data.length){const size=data.readUInt32BE(offset),type=data.toString('ascii',offset+4,offset+8);if(type==='tRNS')transparent=data.subarray(offset+8,offset+8+size).includes(0);offset+=size+12;}
  assert.ok(transparent,skill+' contains transparent pixels');
 }
});

test('Mage resonance portal is in front of the caster and releases a delayed elemental echo',async()=>{
 const ui=createHarness({weapon:'wand',outfit:'acolyte',magic:'fire',combatOptions:{heroDamage:1,heroMaxHp:10000,heroEchoRank:5}});
 await ui.loadAllImages();
 ui.runUntil(()=>ui.events.some(e=>e.type==='mageSkill'&&e.skill==='echo'),20);
 const resonance=ui.events.find(e=>e.type==='mageSkill'&&e.skill==='echo');
 const shot=ui.events.find(e=>e.type==='cast'&&e.echo);
 const primary=ui.events.find(e=>e.type==='cast'&&e.castId+':echo'===shot.castId);
 assert.ok(primary);assert.equal(shot.magic,primary.magic);
 assert.ok(Math.abs(shot.at-(primary.at+primary.appearDuration+.18))<1e-7);
 assert.ok(Math.abs(shot.impactAt-primary.impactAt-.18)<1e-7);
 assert.equal(shot.appearDuration,0);assert.equal(shot.flightDuration,primary.flightDuration);
 const field=ui.node('.battlefield');
 const portal=field.children.find(el=>el.className==='mage-advanced-effect'&&el.dataset.skill==='echo');
 const projectile=field.children.find(el=>el.className==='spell-projectile'&&el.dataset.echo==='true');
 assert.ok(portal&&projectile);assert.equal(projectile.hidden,true);
 assert.ok(!ui.loadedPaths.includes('assets/magic/mage-echo.png'),'never request the old cached atlas');
 const hero=ui.node('[data-fighter="hero"]').getBoundingClientRect(),bounds=field.getBoundingClientRect();
 assert.ok(Math.abs(parseFloat(portal.style.left)-(hero.left+hero.width*.88-bounds.left))<1);
 assert.ok(portal.draws.some(d=>d.src.endsWith('mage-echo-resonance-v2.png')&&d.crop[2]===64));
 ui.runUntil(()=>!projectile.hidden,2);
 assert.equal(projectile.dataset.phase,'flight');
 assert.ok(portal.draws.some(d=>d.crop[0]===192||d.crop[0]===256));
 ui.runFor(.7);assert.ok(!field.children.includes(portal));
});
