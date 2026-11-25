/* Deterministic idle combat. Active time uses microsecond ticks; no wall clock or DOM. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EmberCombat = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const TICKS = 1000000;
  const archerDodge=Object.freeze({frames:Object.freeze([.100,.070,.065,.065,.055,.055,.060,.080,.080,.180]),offsets:Object.freeze([0,0,3,10,20,31,40,46,48,48]),release:.355,duration:.810,flight:.28});
  const HERO_INTERVAL = 1.2 * TICKS;
  const CLOSE_MAGIC_INTERVAL = .8 * TICKS;
  const COUNTER_DELAY = .3 * TICKS;
  const COUNTER_DURATION = .36 * TICKS;
  const intermissionDuration = 1.4;
  const INTERMISSION = Math.round(intermissionDuration * TICKS);
  const KILL_REWARD = 5;
  const WOLF_MAX_HP = 70;
  // The dragon releases five SEPARATE fire-magic projectiles like the
  // Mage's spell, never a continuous jet. Each has its own launch, flight,
  // engine hit and short impact animation.
  const dragonBreath=Object.freeze({bursts:5,spacing:.26,damage:60,flight:.42,afterglow:.22});
  const DRAGON_BREATH_SPACING=Math.round(dragonBreath.spacing*TICKS);
  const DRAGON_BREATH_FLIGHT=Math.round(dragonBreath.flight*TICKS);
  const statusTiming = Object.freeze({duration:.5,burnTickInterval:.25,burnDamage:1});
  const STATUS_DURATION = Math.round(statusTiming.duration*TICKS);
  const BURN_INTERVAL = Math.round(statusTiming.burnTickInterval*TICKS);
  const magicTiming = Object.freeze({appearDuration:.42,flightDuration:.48,impactDuration:.42});
  const closeMagicTiming = Object.freeze({appearDuration:.18,flightDuration:.12,impactDuration:.42});
  const swordSteps = [
    {variant:'halfslash', interval:1.05 * TICKS, animationDuration:.56, heavy:false},
    {variant:'slash', interval:1.2 * TICKS, animationDuration:.66, heavy:false},
    {variant:'backslash', interval:1.35 * TICKS, animationDuration:.91, heavy:true}
  ];
  const archetypes = {
    orc:{name:'Орк-щитоносец',maxHp:100,damage:6,interval:1.5,armor:3,projectile:'melee'},
    swordsman:{name:'Скелет-мечник',maxHp:35,damage:5,interval:1.6,armor:0,projectile:'melee'},
    archer:{name:'Скелет-лучник',maxHp:60,damage:7,interval:1.8,armor:0,projectile:'arrow'},
    mage:{name:'Могильный колдун',maxHp:65,damage:10,interval:3.8,armor:0,projectile:'magic'},
    dragon:{name:'Красный дракон',maxHp:180,damage:240,interval:2.8,armor:3,projectile:'magic'}
  };
  const waveTemplates = [
    [{id:'archer1',type:'archer'}],
    [{id:'archer2',type:'archer'},{id:'archer3',type:'archer'}],
    [{id:'orc',type:'orc'}]
  ];
  const totalEnemies = waveTemplates.reduce((count,wave) => count + wave.length,0);
  function positive(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
  function attackSpeed(value,fallback) {
    return Number.isFinite(value) && value >= 1 ? Math.min(1.25,value) : fallback;
  }
  function createBattle(options = {}) {
    // The default three-wave encounters are immutable for existing saves
    // and deterministic tests; the game's fourth boss wave opts in explicitly.
    const waves=options.skeletonSwordsEnabled===true ? waveTemplates.map((wave,index)=>index===1?[{id:'skeletonSword1',type:'swordsman'},{id:'skeletonSword2',type:'swordsman'},...wave]:wave) : waveTemplates;
    const activeWaves=options.dragonBossEnabled===true
      ?[...waves,[{id:'dragon',type:'dragon'}]]:waves;
    const activeTotalEnemies=activeWaves.reduce((n,wave)=>n+wave.length,0);
    const config = {
      name:typeof options.heroName === 'string' && options.heroName.trim() ? options.heroName.trim() : 'Странник',
      maxHp:positive(options.heroMaxHp, 200), damage:positive(options.heroDamage, 12),attackSpeed:attackSpeed(options.heroAttackSpeed,1),
      projectile:['melee','arrow','magic'].includes(options.heroProjectile) ? options.heroProjectile : 'melee',
      // The WebApp uses 'both'; explicit single-element modes remain
      // compatible with legacy engine tests, not a character setting.
      magic:options.heroMagic==='both'?'both':
        ['fire','ice'].includes(options.heroMagic)?options.heroMagic:'fire'
    };
    const mage=options.heroWeapon==='wand'&&config.projectile==='magic';
    const archer=options.heroWeapon==='bow'&&config.projectile==='arrow';
    const rank=value=>Number.isFinite(value)?Math.max(0,Math.min(5,Math.floor(value))):0;
    let burnRank=mage?rank(options.heroBurnRank):0,sphereRank=mage?rank(options.heroSphereRank):0,shardRank=mage?rank(options.heroShardRank):0;
    const archerRanks=Object.fromEntries(["piercing","poison","explosive","barbed","doubleShot","arrowRain","rendingBite","guardian","alpha","evasion","retreat","arrowDance","wolfBond"].map(id=>[id,archer?rank(options['archer_'+id]):0]));
    const DODGE_LEAD=Math.round(.32*TICKS),DODGE_COOLDOWN=2*TICKS;
    let dodgeUntil=0,dodgeSince=Infinity,evasionReady=0,enemyDodgeChecks=[];
    // Independent random rolls, seeded once; explicit seed/RNG for tests.
    let randomState=(Number.isInteger(options.dodgeSeed)?options.dodgeSeed:Math.floor(Math.random()*4294967296))>>>0;
    const dodgeRandom=typeof options.dodgeRandom==='function'?options.dodgeRandom:()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
    let arrowMeters={},arrowQueue=[],shotCount=0,rainLeft=0,rainAt=0,retreatAt=0,danceAt=0,danceUntil=0,wolfBites=0,wolfReviveAt=Infinity,roarUntil=0,roarAt=0;
    const wolfMax=()=>positive(options.companionMaxHp,WOLF_MAX_HP)*(1+.15*archerRanks.wolfBond);
    const advancedKeys=["heroFusionRank","heroChaosRank","heroAbsorptionRank","heroRebirthRank","heroEchoRank","heroOverloadRank","heroArchmageRank"];
    const advanced=Object.fromEntries(advancedKeys.map(key=>[key,mage?rank(options[key]):0]));
    let echoMeter=0,overloadMeter=0,archCount=0,archRemaining=0,reactionCount=0,rebirthUsed=false;
    const sphereCapacity=()=>sphereRank?10+10*sphereRank:0;
    let sphere=null;
    const talentIds=["shock","revenge","doubleEcho","ash","lastStand","chainEcho","permafrost","regeneration","timeWarp","storm","vampirism","powerStack","cataclysm","immortality","absolute"];
    const normalizeTalents=ids=>mage&&Array.isArray(ids)?[...new Set(ids)].filter(id=>talentIds.includes(id)).slice(0,3):[];
    let queuedTalents=normalizeTalents(options.heroTalents),activeTalents=[];
    let echoCount=0,chaosCount=0,powerCharged=false,immuneUntil=0,regenAt=Infinity;
    const hasTalent=id=>activeTalents.includes(id);
    function setTalents(ids){queuedTalents=normalizeTalents(ids);return [...queuedTalents];}

    const sword = options.heroWeapon === 'sword' && config.projectile === 'melee';
    let phase, pausedFrom, elapsed, remainder, hero, enemies, nextHero, nextEnemies, reward;
    let comboIndex, meleeHits, heroBusyUntil, pendingCounters, pendingImpacts, pendingBreaths;
    let mageCastIndex=0,orcHasAttacked=false;
    let waveIndex, completedWaves, defeatedCount, nextWaveAt;
    let companion,companionEverSummoned;
    function currentEnemyTarget(){
      return companionEnabled && companion?.hp>0 ? companion : hero;
    }
    // Companion ownership is gated by the permanent Archer class and can be
    // changed live by equipment without rescheduling the Archer's next arrow.
    let companionEnabled=options.heroWeapon==='bow'&&config.projectile==='arrow'&&options.companionEnabled===true;
    function heroTicks(base) { return Math.max(1,Math.round(base/config.attackSpeed)); }
    // Pure read-only shot schedule for sprite anticipation. Existing engine
    // attack ticks, damage, rewards and cooldowns stay exactly unchanged.
    function chooseArrow(commit=true){
      const meters=commit?arrowMeters:{...arrowMeters},queue=commit?arrowQueue:[...arrowQueue];
      for(const id of ['piercing','poison','explosive','barbed']){
        const r=archerRanks[id];if(!r)continue;
        meters[id]=(meters[id]||0)+1;
        if(meters[id]>=12-2*r){meters[id]=0;if(!queue.includes(id))queue.push(id);}
      }
      return queue.shift()||'normal';
    }
    // A single read-only plan drives both the bow pose and the actual attack.
    function archerShotPlan(at){
      const rain=archerRanks.arrowRain>0&&(rainLeft>0||at>=rainAt);
      const count=rain?4+archerRanks.arrowRain:0;
      const remaining=rain?(rainLeft||count):0;
      const dance=archerRanks.arrowDance>0&&(at<danceUntil||at>=danceAt);
      const speed=dance?1+.05*archerRanks.arrowDance:1;
      return {kind:chooseArrow(false),double:!!archerRanks.doubleShot&&(shotCount+1)%(14-2*archerRanks.doubleShot)===0,
        rain,remaining,count,speed,dance,danceIndex:shotCount%3,animationDuration:heroTicks((rain?.50:.9)*TICKS)/TICKS/speed,
        ...(rain?{rainIndex:count-remaining+1,rainCount:count}:{})};
    }
    function getArrowSchedule() {
      if(phase!=='running'&&phase!=='paused')return [];
      const target=enemies.find(enemy=>enemy.hp>0);
      if(!target||hero.hp<=0)return [];
      const shots=[];
      if(config.projectile==='arrow'){
        const plan=archer?archerShotPlan(nextHero):null;
        shots.push({sourceId:'hero',targetId:target.id,at:nextHero/TICKS,
          animationDuration:plan?.animationDuration??heroTicks(.9*TICKS)/TICKS,
          ...(plan?.kind&&plan.kind!=='normal'?{arrowType:plan.kind}:{}),
          ...(plan?.double?{double:true}:{}),...(plan?.dance?{dance:true,danceIndex:plan.danceIndex}:{}),...(plan?.rain?{rainIndex:plan.rainIndex,rainCount:plan.rainCount}:{})});
      }
      for(let i=0;i<enemies.length;i++){
        const enemy=enemies[i];
        if(enemy.hp<=0||enemy.projectile!=='arrow'
          ||enemy.status?.type==='freeze'&&enemy.status.endsAt>elapsed)continue;
        shots.push({sourceId:enemy.id,targetId:currentEnemyTarget().id,
          at:nextEnemies[i]/TICKS,animationDuration:.6});
      }
      return shots;
    }
    function getState() {
      const target = enemies.find(enemy => enemy.hp > 0);
      const waiting = phase === 'intermission' || (phase === 'paused' && pausedFrom === 'intermission');
      return {
        ...(mage?{activeTalents:[...activeTalents]}:{}),...(archer&&archerRanks.alpha?{wolfAttackSpeed:elapsed<roarUntil?1+.1*archerRanks.alpha:1}:{}),...(archer&&(archerRanks.arrowDance||archerRanks.alpha)?{archerEffects:{dance:elapsed<danceUntil,roar:companionEnabled&&companion?.hp>0&&elapsed<roarUntil}}:{}),phase, elapsed:elapsed / TICKS, hero:{...hero,...(sphere?{sphere:{...sphere}}:{})},
        companion:companionEnabled?{...companion,alive:companion.hp>0}:null,
        enemyTargetId:currentEnemyTarget().id,
        enemies:enemies.map(({arrowDots,...enemy}) => ({...enemy,status:enemy.status ? {type:enemy.status.type,startedAt:enemy.status.startedAt/TICKS,endsAt:enemy.status.endsAt/TICKS,...(enemy.status.enhanced?{enhanced:true}:{})} : null,alive:enemy.hp > 0})),
        targetId:target ? target.id : null,
        waveIndex,waveNumber:waveIndex+1,waveCount:activeWaves.length,completedWaves,
        defeatedCount,totalDefeated:defeatedCount,totalEnemies:activeTotalEnemies,reward,
        intermissionRemaining:waiting ? Math.max(0,nextWaveAt-elapsed) / TICKS : 0
      };
    }
    function spawnWave(index) {
      dodgeUntil=0;dodgeSince=Infinity;enemyDodgeChecks=[];
      waveIndex = index; phase = 'running'; pausedFrom = null; nextWaveAt = null;
      enemies = activeWaves[index].map(unit => ({...archetypes[unit.type],...unit,hp:archetypes[unit.type].maxHp,status:null}));
      comboIndex = 0; meleeHits = 0; heroBusyUntil = elapsed; pendingCounters = []; pendingImpacts = []; pendingBreaths = [];rainLeft=0;
      mageCastIndex=0;orcHasAttacked=false;activeTalents=[...queuedTalents];powerCharged=false;regenAt=sphere?.hp>0?elapsed+3*TICKS:Infinity;
      nextHero = elapsed + heroTicks(sword ? swordSteps[0].interval : HERO_INTERVAL);
      nextEnemies = enemies.map(enemy => elapsed + Math.round(enemy.interval * TICKS));
    }
    function restart() {
      elapsed = 0; remainder = 0; reward = 0; completedWaves = 0; defeatedCount = 0;
      hero = {id:'hero',name:config.name,hp:config.maxHp,maxHp:config.maxHp,damage:config.damage,attackSpeed:config.attackSpeed};
      echoMeter=overloadMeter=archCount=archRemaining=reactionCount=echoCount=chaosCount=0;rebirthUsed=false;immuneUntil=0;powerCharged=false;
      sphere=sphereRank?{hp:sphereCapacity(),maxHp:sphereCapacity(),brokenAt:null}:null;
      dodgeUntil=0;evasionReady=0;arrowMeters={};arrowQueue=[];shotCount=rainLeft=wolfBites=0;rainAt=archerRanks.arrowRain?(33-3*archerRanks.arrowRain)*TICKS:0;retreatAt=0;danceAt=20*TICKS;danceUntil=0;wolfReviveAt=Infinity;roarUntil=0;roarAt=0;
      const maxHp=wolfMax();
      companion={id:'companion',name:'Боевой волк',hp:companionEnabled?maxHp:0,maxHp};
      companionEverSummoned=companionEnabled;
      spawnWave(0);
      return getState();
    }
    function pause() {
      if (phase === 'running' || phase === 'intermission') { pausedFrom = phase; phase = 'paused'; }
      return getState();
    }
    function resume() {
      if (phase === 'paused') { phase = pausedFrom || 'running'; pausedFrom = null; }
      return getState();
    }
    function counterSlot(earliest) {
      const duration = heroTicks(COUNTER_DURATION);
      let candidate = Math.max(earliest,heroBusyUntil);
      for (;;) {
        const reserved = pendingCounters.find(counter => candidate < counter.at + duration && candidate + duration > counter.at);
        if (reserved) { candidate = reserved.at + duration; continue; }
        let regularAt = nextHero,index = comboIndex;
        while (regularAt + heroTicks(swordSteps[index].animationDuration * TICKS) <= candidate) {
          index = (index+1) % swordSteps.length; regularAt += heroTicks(swordSteps[index].interval);
        }
        if (candidate + duration <= regularAt) break;
        candidate = Math.max(candidate,regularAt + heroTicks(swordSteps[index].animationDuration * TICKS));
      }
      return candidate;
    }
    function reserveCounter(targetId) {
      pendingCounters.push({targetId,at:counterSlot(elapsed + heroTicks(COUNTER_DELAY))});
      pendingCounters.sort((a,b) => a.at-b.at);
    }
    function setCompanionEnabled(enabled) {
      companionEnabled=options.heroWeapon==='bow'&&config.projectile==='arrow'&&enabled===true;
      // Switching equipment cannot resurrect a fallen wolf. A first-time
      // equip is allowed to summon one; a new battle restores its health.
      if(companionEnabled&&!companionEverSummoned){
        companion.hp=companion.maxHp;companionEverSummoned=true;
      }
      return companionEnabled;
    }
    // The wolf's bite lands only after the sprite reaches its impact frame.
    // This explicit hit API intentionally does not alter hero cooldowns,
    // enemy attack cadence, or the deterministic advance() schedule.
    function companionStrike(targetId,baseDamage) {
      const events=[];
      if(!companionEnabled||companion.hp<=0||phase!=='running'||hero.hp<=0
        ||!Number.isFinite(baseDamage)||baseDamage<=0)return events;
      const target=enemies.find(enemy=>enemy.id===targetId&&enemy.hp>0);
      if(!target)return events;
      const damage=Math.max(1,Math.floor(baseDamage*(1+.1*archerRanks.wolfBond)-target.armor));
      if(archerRanks.rendingBite&&++wolfBites%3===0){target.arrowDots??=[];target.arrowDots.push({type:'wolfBleed',sourceId:'companion',damage:Math.max(1,damage*(.2+.1*archerRanks.rendingBite)),at:elapsed+TICKS,left:4});events.push({type:'archerSkill',skill:'rendingBite',sourceId:'companion',targetId:target.id,at:elapsed/TICKS});}
      target.hp=Math.max(0,target.hp-damage);
      const at=elapsed/TICKS;
      events.push({type:'attack',sourceId:'companion',targetId:target.id,
        damage,hp:target.hp,at,projectile:'bite',animationDuration:5/12});
      if(target.hp!==0)return events;
      defeatedCount++;reward+=KILL_REWARD;target.status=null;target.arrowDots=[];
      pendingCounters=pendingCounters.filter(counter=>counter.targetId!==target.id);
      pendingImpacts=pendingImpacts.filter(impact=>
        impact.targetId!==target.id
        && (target.type!=='dragon' || impact.sourceId!==target.id));
      pendingBreaths=pendingBreaths.filter(breath=>breath.sourceId!==target.id);
      events.push({type:'death',id:target.id,unitType:target.type,
        reward:KILL_REWARD,totalReward:reward,at});
      if(enemies.some(enemy=>enemy.hp>0))return events;
      completedWaves++;
      pendingCounters=[];pendingImpacts=[];pendingBreaths=[];
      enemies.forEach(enemy=>{enemy.status=null;});
      events.push({type:'wave_clear',waveIndex,waveNumber:waveIndex+1,at});
      if(waveIndex===activeWaves.length-1){
        phase='victory';pausedFrom=null;nextWaveAt=null;
        events.push({type:'end',result:'victory',reward:0,totalReward:reward,at});
      }else{
        phase='intermission';nextWaveAt=elapsed+INTERMISSION;
      }
      return events;
    }
    function updateHeroStats(stats = {}) {
      const oldSpeed = config.attackSpeed;
      if(archer){for(const key of Object.keys(archerRanks))if(stats['archer_'+key]!==undefined)archerRanks[key]=rank(stats['archer_'+key]);companion.maxHp=wolfMax();companion.hp=Math.min(companion.hp,companion.maxHp);}
      if(mage){
        for(const key of advancedKeys)if(stats[key]!==undefined)advanced[key]=rank(stats[key]);
        if(stats.heroBurnRank!==undefined)burnRank=rank(stats.heroBurnRank);
        if(stats.heroShardRank!==undefined)shardRank=rank(stats.heroShardRank);
        if(stats.heroSphereRank!==undefined){
          sphereRank=rank(stats.heroSphereRank);const maxHp=sphereCapacity();
          if(!sphere&&maxHp)sphere={hp:maxHp,maxHp,brokenAt:null};
          else if(sphere){sphere.maxHp=maxHp;sphere.hp=Math.min(sphere.hp,maxHp);}
        }
      }
      config.damage = positive(stats?.heroDamage,config.damage);
      config.maxHp = positive(stats?.heroMaxHp,config.maxHp);
      config.attackSpeed = attackSpeed(stats?.heroAttackSpeed,config.attackSpeed);
      hero.damage = config.damage; hero.maxHp = config.maxHp; hero.attackSpeed = config.attackSpeed;
      // A purchase changes the next battle's maximum but never heals this one.
      hero.hp = Math.min(hero.hp,config.maxHp);
      if (oldSpeed !== config.attackSpeed) {
        const ratio = oldSpeed/config.attackSpeed;
        const rescale = at => elapsed + Math.max(0,Math.round((at-elapsed)*ratio));
        nextHero = rescale(nextHero); heroBusyUntil = rescale(heroBusyUntil);
        const reserved = pendingCounters.map(counter => ({...counter,at:rescale(counter.at)}));
        pendingCounters = [];
        // Integer rounding can close a one-tick gap. Revalidate each existing
        // reservation without adding another reaction delay or another counter.
        for (const counter of reserved) pendingCounters.push({...counter,at:counterSlot(counter.at)});
      }
      return getState();
    }
    function advance(seconds,availability = {}) {
      const events = [];
      if (!['running','intermission'].includes(phase) || !Number.isFinite(seconds) || seconds <= 0) return events;
      const heroCanAttack = availability?.heroCanAttack !== false;
      const orcCanAttack = availability?.orcCanAttack !== false;
      const enemyCanAttack=id=>availability?.enemyCanAttack?.[id]!==false
        &&(currentEnemyTarget().id!=='hero'||availability?.enemyCanAttackHero?.[id]!==false);
      const delta = seconds * TICKS + remainder;
      const ticks = Math.min(Number.MAX_SAFE_INTEGER-elapsed,Math.round(delta));
      remainder = Number.isFinite(delta) ? delta-ticks : 0;
      const until = elapsed + ticks;
      function frozen(enemy) { return enemy.status?.type === 'freeze' && enemy.status.endsAt > elapsed; }
      function advanceClock(time) {
        const passed = time-elapsed;
        if (phase === 'running') {
          if (!heroCanAttack) {
            nextHero += passed; heroBusyUntil += passed;
            pendingCounters.forEach(counter => { counter.at += passed; });
          }
          enemies.forEach((enemy,index) => {
            // Freeze and out-of-range time overlap: hold the timer once for their union.
            if ((enemy.type === 'orc' && !orcCanAttack) || !enemyCanAttack(enemy.id) || frozen(enemy)) nextEnemies[index] += passed;
          });
        }
        elapsed = time;
      }
      function deferNormalShot(){
        // A regular arrow already in flight must keep its original hit time.
        if(nextHero-elapsed>Math.round(archerDodge.flight*TICKS)&&elapsed<dodgeUntil)
          nextHero=Math.max(nextHero,dodgeUntil+Math.round(archerDodge.flight*TICKS+heroTicks(.9*TICKS)*9/13));
      }
      function dodgeShot(enemy,skill){
        if(!enemy||enemy.hp<=0||hero.hp<=0||elapsed<dodgeUntil)return false;
        const at=elapsed/TICKS,releaseTick=elapsed+Math.round(archerDodge.release*TICKS),
          impactTick=releaseTick+Math.round(archerDodge.flight*TICKS);
        dodgeSince=elapsed;dodgeUntil=elapsed+Math.round(archerDodge.duration*TICKS);
        deferNormalShot();
        events.push({type:'archerSkill',skill,sourceId:'hero',targetId:enemy.id,at,dodgeShot:true});
        events.push({type:'arrowLaunch',sourceId:'hero',targetId:enemy.id,at:releaseTick/TICKS,
          impactAt:impactTick/TICKS,retreat:true,dodgeShot:true,animationDuration:archerDodge.duration});
        pendingImpacts.push({sourceId:'hero',targetId:enemy.id,damage:config.damage,arrowKind:'normal',
          dodgeShot:true,at:impactTick});
        pendingImpacts.sort((a,b)=>a.at-b.at);
        return true;
      }
      function canRollEvasion(){
        return archer&&hero.hp>0&&(archerRanks.evasion>0||elapsed<danceUntil);
      }
      function attemptEvasion(enemy){
        if(!canRollEvasion()||elapsed<evasionReady||elapsed<dodgeUntil||!enemy||enemy.hp<=0)return false;
        const chance=(10*archerRanks.evasion+(elapsed<danceUntil?10:0))/100;
        if(dodgeRandom()>=chance||!dodgeShot(enemy,'evasion'))return false;
        evasionReady=elapsed+DODGE_COOLDOWN;
        return true;
      }
      function hit(sourceId,target,damage,projectile,metadata) {
        let reflected=0,evaded=false;
        if(archer&&sourceId!=='hero'&&sourceId!=='companion'&&damage>0){
          if(target.id==='companion'&&archerRanks.guardian)damage*=1-(.05+.05*archerRanks.guardian);
          if(elapsed<roarUntil)damage*=1-.05*archerRanks.alpha;
          if(target.id==='hero'&&!metadata?.dot){
            // Incoming ballistic projectiles aim once, at release. A dodge
            // invalidates shots aimed at the old position, including those
            // that arrive after landing. Fresh shots after movement can hit.
            const flight=projectile==='arrow'?archerDodge.flight:projectile==='magic'?(metadata?.breath?dragonBreath.flight:magicTiming.flightDuration):0;
            const release=elapsed-Math.round(flight*TICKS);
            // Reserved miss or old trajectory, not blanket invulnerability.
            if(metadata?.evaded||(flight>0&&elapsed>=dodgeSince&&release<=dodgeSince&&elapsed<=dodgeSince+Math.round(flight*TICKS))){
              damage=0;evaded=true;
            }
          }
        }
        if(target.id==='hero'&&elapsed<immuneUntil)damage=0;
        if(target.id==='hero'&&sphere?.hp>0&&damage>0){
          const absorbed=Math.min(sphere.hp,damage);sphere.hp-=absorbed;damage-=absorbed;
          regenAt=elapsed+3*TICKS;
          if(hasTalent('revenge')&&sphereRank)reflected=absorbed*.25;
          if(sphere.hp===0){sphere.brokenAt=elapsed/TICKS;regenAt=Infinity;
            if(hasTalent('lastStand')&&sphereRank)events.push({type:'talentKnockback',targets:enemies.filter(e=>e.hp>0&&e.projectile==='melee'&&availability?.enemyCanAttack?.[e.id]!==false&&(e.type!=='orc'||orcCanAttack)).map(e=>e.id),at:elapsed/TICKS});
          }
          events.push({type:'sphere',sourceId,targetId:'hero',absorbed,hp:sphere.hp,maxHp:sphere.maxHp,broken:sphere.hp===0,at:elapsed/TICKS,projectile,...(metadata?.castId?{castId:metadata.castId}:{}),...(metadata?.magic?{magic:metadata.magic}:{})});
        }
        target.hp = Math.max(0,target.hp-damage);
        if(target.id==='hero'&&target.hp===0&&advanced.heroRebirthRank&&!rebirthUsed){
          rebirthUsed=true;target.hp=Math.max(1,Math.floor(target.maxHp*.1*advanced.heroRebirthRank));
          if(hasTalent('immortality'))immuneUntil=elapsed+2*TICKS;
          events.push({type:'mageSkill',skill:'rebirth',sourceId:'hero',targetId:'hero',at:elapsed/TICKS,hp:target.hp});
        }
        events.push({type:'attack',sourceId,targetId:target.id,damage,hp:target.hp,at:elapsed/TICKS,projectile,...metadata,...(evaded?{evaded:true}:{})});
        if (target.hp === 0) {
          const enemy = target.id !== 'hero' && target.id !== 'companion';
          if(target.id==='companion'&&archerRanks.alpha)wolfReviveAt=elapsed+(24-2*archerRanks.alpha)*TICKS;
          if(enemy)target.arrowDots=[];
          if (enemy) { const wasBurning=target.status?.type==='burn';defeatedCount++; reward += KILL_REWARD; target.status = null;
            if(sourceId==='hero'&&hasTalent('vampirism'))hero.hp=Math.min(hero.maxHp,hero.hp+hero.maxHp*.05);
            if(sourceId==='hero'&&hasTalent('ash')&&wasBurning){const neighbor=nearby(target).find(e=>e.hp>0);if(neighbor)applyStatus(neighbor,'fire');}
            if(sourceId==='hero'&&advanced.heroAbsorptionRank&&sphere&&sphere.hp<sphere.maxHp){
              const restored=Math.min(sphere.maxHp-sphere.hp,4*advanced.heroAbsorptionRank);sphere.hp+=restored;sphere.brokenAt=null;if(!Number.isFinite(regenAt))regenAt=elapsed+3*TICKS;
              events.push({type:'mageSkill',skill:'absorption',sourceId:target.id,targetId:'hero',at:elapsed/TICKS,restored});
            }
          }
          events.push({type:'death',id:target.id,unitType:target.type || (target.id==='companion'?'companion':'hero'),reward:enemy ? KILL_REWARD : 0,totalReward:reward,at:elapsed/TICKS});
          pendingCounters = pendingCounters.filter(counter => counter.targetId !== target.id);
          // A dead dragon cannot finish breathing: cancel both unreleased
          // pulses and flames which have not yet hit their targets.
          pendingImpacts = pendingImpacts.filter(impact =>
            impact.targetId !== target.id
            && (target.type!=='dragon'||impact.sourceId !== target.id));
          pendingBreaths = pendingBreaths.filter(breath => breath.sourceId !== target.id);
        }
        if(reflected>0){const attacker=enemies.find(e=>e.id===sourceId&&e.hp>0);if(attacker)hit('hero',attacker,reflected,'reflection',{dot:true});}
      }
      function end(result) {
        phase = result; pausedFrom = null; pendingCounters = []; pendingImpacts = []; pendingBreaths = []; nextWaveAt = null;
        enemies.forEach(enemy => { enemy.status = null; });
        // Rewards belong to individual deaths; terminal events never grant a second bonus.
        events.push({type:'end',result,reward:0,totalReward:reward,at:elapsed/TICKS});
      }
      function clearWave() {
        completedWaves++;
        pendingCounters = []; pendingImpacts = []; pendingBreaths = [];
        enemies.forEach(enemy => { enemy.status = null; });
        events.push({type:'wave_clear',waveIndex,waveNumber:waveIndex+1,at:elapsed/TICKS});
        if (waveIndex === activeWaves.length-1) end('victory');
        else { phase = 'intermission'; nextWaveAt = elapsed + INTERMISSION; }
      }
      function nearby(target){const ids=availability?.nearbyEnemies?.[target.id]||[];return ids.map(id=>enemies.find(e=>e.id===id)).filter(e=>e&&e.id!==target.id&&e.hp>0);}

      function archerArrow(target,damage,kind,metadata){
        if(!target||target.hp<=0)return;
        const r=archerRanks[kind]||0;
        const armor=kind==='piercing'?target.armor*(1-(.1+.1*r)):target.armor;
        const dealt=Math.max(1,damage-armor);
        hit('hero',target,dealt,'arrow',{...metadata,...(kind==='normal'?{}:{arrowType:kind})});
        if(kind==='piercing'){
          const others=(availability?.nearbyEnemies?nearby(target):enemies.filter(e=>e!==target&&e.hp>0)).slice(0,2);
          others.forEach((e,i)=>{if(e.hp>0)hit('hero',e,dealt*Math.pow(.75,i+1),'arrow',{arrowType:kind,dot:true});});
        }
        if(kind==='explosive')for(const e of nearby(target))if(e.hp>0)hit('hero',e,damage*(.3+.1*r),'arrow',{arrowType:kind,dot:true});
        if(target.hp>0&&['poison','barbed'].includes(kind)){
          target.arrowDots??=[];
          const existing=target.arrowDots.filter(x=>x.type===kind);
          const value=kind==='poison'?damage*(.05+.05*r):target.maxHp*(.0025+.0025*r);
          const dot={type:kind,sourceId:'hero',damage:kind==='barbed'&&target.type==='dragon'?Math.min(value,damage*.3):value,at:elapsed+TICKS,left:kind==='poison'?5:4};
          if(existing.length>=(kind==='poison'?3:1))Object.assign(existing[0],dot);else target.arrowDots.push(dot);
        }
      }
      function applyStatus(target,magic) {
        if(magic==='fire'&&hasTalent('permafrost')&&target.status?.type==='freeze'&&target.status.endsAt>elapsed)return;
        const type = magic === 'fire' ? 'burn' : 'freeze';
        const enhanced=type==='burn'&&burnRank>0,duration=Math.max(STATUS_DURATION+(enhanced?burnRank*BURN_INTERVAL:0),advanced.heroFusionRank?Math.round(1.55*TICKS):0);
        target.status = {type,sourceId:'hero',startedAt:elapsed,endsAt:elapsed+duration,nextTick:elapsed+BURN_INTERVAL,...(enhanced?{enhanced:true,damage:statusTiming.burnDamage+burnRank}:{})};
        events.push({type:'status',status:type,sourceId:'hero',targetId:target.id,at:elapsed/TICKS,duration:duration/TICKS,endsAt:target.status.endsAt/TICKS});
      }
      function mageReaction(target,magic,previous){
        if(!advanced.heroFusionRank||!previous||!['fire','ice'].includes(magic))return;
        const skill=magic==='fire'&&previous==='freeze'?'thermal':magic==='ice'&&previous==='burn'?'steam':null;
        if(!skill)return;
        const damage=advanced.heroFusionRank*4;
        events.push({type:'mageSkill',skill,sourceId:'hero',targetId:target.id,at:elapsed/TICKS});
        if(target.hp>0)hit('hero',target,damage,'reaction',{dot:true,magic});
        if(skill==='steam'||hasTalent('shock')){
          const nearby=availability?.nearbyEnemies?.[target.id]||[];
          for(const enemy of enemies)if(enemy.id!==target.id&&enemy.hp>0&&nearby.includes(enemy.id))hit('hero',enemy,Math.max(1,Math.floor(damage*.5)),'reaction',{dot:true,magic});
        }
        reactionCount++;
        if(advanced.heroChaosRank&&reactionCount%3===0){
          events.push({type:'mageSkill',skill:'chaos',sourceId:'hero',targetId:target.id,at:elapsed/TICKS});
          const extra=hasTalent('cataclysm')&&++chaosCount%3===0?2:1;
          for(let pulse=0;pulse<extra;pulse++)for(const enemy of enemies)if(enemy.hp>0)hit('hero',enemy,advanced.heroChaosRank*5,'reaction',{dot:true});
        }
      }
      function dragonPulse(sourceId,burstIndex){
        // Fire belongs exclusively to the hero-facing ranged phase. A living
        // companion is handled by a separate close-range physical swipe.
        const defender=currentEnemyTarget();
        if(defender.id!=='hero')return;
        const hitAt=elapsed+DRAGON_BREATH_FLIGHT;
        const castAt=elapsed/TICKS;
        const castId=`${sourceId}:breath:${elapsed}:${burstIndex}`;
        events.push({
          type:'cast',sourceId,targetId:defender.id,projectile:'breath',
          breath:true,burstIndex,burstCount:dragonBreath.bursts,magic:'fire',
          at:castAt,impactAt:hitAt/TICKS,castId,
          appearDuration:0,flightDuration:dragonBreath.flight,
          impactDuration:dragonBreath.afterglow,animationDuration:.43,
          castInterval:archetypes.dragon.interval
        });
        pendingImpacts.push({sourceId,targetId:defender.id,damage:dragonBreath.damage,
          magic:'fire',at:hitAt,castAt,castId,breath:true,burstIndex});
        pendingImpacts.sort((a,b)=>a.at-b.at);
      }
      function cast(sourceId,target,damage,magic) {
        const close = sourceId === 'hero' && availability?.heroCloseRange === true;
        const timing = close ? closeMagicTiming : magicTiming;
        let interval = sourceId === 'hero' ? heroTicks(close ? CLOSE_MAGIC_INTERVAL : HERO_INTERVAL) : Math.round(enemies.find(enemy=>enemy.id===sourceId).interval*TICKS);
        let echo=false,overloaded=false;
        if(sourceId==='hero'&&mage){
          const archActive=archRemaining>0;
          if(powerCharged&&hasTalent('powerStack')){damage=Math.ceil(damage*1.2);powerCharged=false;}
          if(archRemaining>0){interval=Math.max(1,Math.round(interval*(.9-.05*advanced.heroArchmageRank)));archRemaining--;}
          if(advanced.heroArchmageRank&&++archCount%6===0){archRemaining=3;events.push({type:'mageSkill',skill:'archmage',sourceId:'hero',targetId:'hero',at:elapsed/TICKS});}
          overloadMeter+=advanced.heroOverloadRank*8;if(overloadMeter>=100){overloadMeter-=100;damage=Math.ceil(damage*1.5);overloaded=true;if(hasTalent('timeWarp'))interval=Math.max(1,Math.round(interval*.5));}
          echoMeter+=advanced.heroEchoRank;if(echoMeter>=10){echoMeter-=10;echo=true;}
          if(archActive&&hasTalent('absolute')&&advanced.heroArchmageRank)echo=true;
        }
        const delay = Math.round((timing.appearDuration+timing.flightDuration)*TICKS);
        const castAt = elapsed/TICKS,impactTick = elapsed+delay,castId = `${sourceId}:${elapsed}`;
        events.push({type:'cast',sourceId,targetId:target.id,projectile:'magic',magic,at:castAt,...timing,impactAt:impactTick/TICKS,castId,animationDuration:sourceId === 'hero' ? heroTicks((close ? .36 : .66)*TICKS)/TICKS : .66,castInterval:interval/TICKS});
        pendingImpacts.push({sourceId,targetId:target.id,damage,magic,at:impactTick,castAt,castId,overloaded});
        if(echo){
          const double=hasTalent('doubleEcho')&&advanced.heroEchoRank&&++echoCount%4===0;
          if(hasTalent('powerStack')&&advanced.heroEchoRank)powerCharged=true;
          const alternate=hasTalent('chainEcho')&&advanced.heroEchoRank?nearby(target)[0]:null;
          const echoTarget=alternate||target;
          for(let n=1;n<=(double?2:1);n++){
          const echoAt=impactTick+Math.round(.18*n*TICKS),echoId=castId+':echo'+(n===1?'':':2');
          const releaseAt=castAt+timing.appearDuration,echoReleaseAt=releaseAt+.18*n;
          // Echo is released from the resonating portal, not charged as a second simultaneous cast.
          if(n===1)events.push({type:'mageSkill',skill:'echo',sourceId:'hero',targetId:'hero',at:castAt,releaseAt,echoReleaseAt});
          events.push({type:'cast',sourceId,targetId:echoTarget.id,projectile:'magic',magic,echo:true,at:echoReleaseAt,impactAt:echoAt/TICKS,castId:echoId,appearDuration:0,flightDuration:timing.flightDuration,impactDuration:.32,animationDuration:0,castInterval:interval/TICKS});
          pendingImpacts.push({sourceId,targetId:echoTarget.id,damage:Math.max(1,Math.floor(damage*.5)),magic,echo:true,at:echoAt,castAt:echoReleaseAt,castId:echoId});
          }
        }
        if(sourceId==='hero'&&magic==='ice'&&shardRank>0){
          const shardAt=impactTick+Math.round(.12*TICKS),shardId=castId+':shards';
          events.push({type:'cast',sourceId,targetId:target.id,projectile:'magic',magic:'ice',shards:true,at:castAt,impactAt:shardAt/TICKS,castId:shardId,appearDuration:timing.appearDuration,flightDuration:timing.flightDuration+.12,impactDuration:.32,animationDuration:0,castInterval:interval/TICKS});
          pendingImpacts.push({sourceId,targetId:target.id,damage:shardRank*3,magic:'ice',shards:true,at:shardAt,castAt,castId:shardId});
        }
        pendingImpacts.sort((a,b) => a.at-b.at || Number(b.sourceId==='hero')-Number(a.sourceId==='hero'));
        return interval;
      }
      while (phase === 'running' || phase === 'intermission') {
        if (phase === 'intermission') {
          if (nextWaveAt > until) break;
          advanceClock(nextWaveAt); spawnWave(waveIndex+1);
          events.push({type:'wave',waveIndex,waveNumber:waveIndex+1,waveCount:activeWaves.length,enemies:getState().enemies,at:elapsed/TICKS});
          continue;
        }
        let next = heroCanAttack ? nextHero : Infinity;
        if(hasTalent('regeneration')&&sphere?.hp>0&&sphere.hp<sphere.maxHp){if(regenAt<elapsed)regenAt=elapsed;next=Math.min(next,regenAt);}
        if (heroCanAttack && pendingCounters.length) next = Math.min(next,pendingCounters[0].at);
        if (pendingImpacts.length) next = Math.min(next,pendingImpacts[0].at);
        if(canRollEvasion())for(const impact of pendingImpacts){
          if(!impact.dodgeChecked&&impact.targetId==='hero'&&impact.sourceId!=='hero'&&impact.magic)
            next=Math.min(next,Math.max(elapsed,impact.at-DODGE_LEAD));
        }
        if (pendingBreaths.length) next = Math.min(next,pendingBreaths[0].at);
        enemies.forEach((enemy,index) => {
          if (enemy.hp <= 0) return;
          if ((enemy.type !== 'orc' || orcCanAttack) && enemyCanAttack(enemy.id) && !frozen(enemy)) {
            // Only the first strike is immediate; subsequent strikes retain normal cooldowns.
            if(enemy.type==='orc'&&availability?.immediateOrcContact===true&&!orcHasAttacked)nextEnemies[index]=elapsed;
            next = Math.min(next,nextEnemies[index]);
            if(canRollEvasion()&&currentEnemyTarget().id==='hero'&&!enemyDodgeChecks[index]&&enemy.projectile==='arrow')
              next=Math.min(next,Math.max(elapsed,nextEnemies[index]-DODGE_LEAD));
          }
          for(const dot of enemy.arrowDots||[])next=Math.min(next,dot.at);
          if (enemy.status) {
            next = Math.min(next,enemy.status.endsAt);
            if (enemy.status.type === 'burn') next = Math.min(next,enemy.status.nextTick);
          }
        });
        if(archer&&companionEnabled&&companion.hp<=0&&archerRanks.alpha)next=Math.min(next,Math.max(elapsed,wolfReviveAt));
        if (next > until) break;
        advanceClock(next);
        if(archer&&companionEnabled&&companion.hp<=0&&wolfReviveAt<=elapsed&&archerRanks.alpha){companion.hp=companion.maxHp;wolfReviveAt=Infinity;events.push({type:'archerSkill',skill:'wolfRevive',sourceId:'companion',targetId:'companion',at:elapsed/TICKS});}
        if(archer&&companionEnabled&&companion.hp>0&&archerRanks.alpha&&elapsed>=roarAt){roarUntil=elapsed+5*TICKS;roarAt=elapsed+20*TICKS;events.push({type:'archerSkill',skill:'roar',sourceId:'companion',targetId:'companion',at:elapsed/TICKS});}
        if(hasTalent('regeneration')&&sphere?.hp>0&&sphere.hp<sphere.maxHp&&regenAt===next){sphere.hp=Math.min(sphere.maxHp,sphere.hp+sphere.maxHp*.05);regenAt=elapsed+TICKS;}
        // Ties: hero action, counters, existing status ticks/expiry, impacts, then enemies.
        if (heroCanAttack && nextHero === next) {
          const target = enemies.find(enemy => enemy.hp > 0),step = sword ? swordSteps[comboIndex] : null;
          const damage = config.damage * (step?.heavy ? 1.5 : 1);
          const metadata = step ? {variant:step.variant,comboStep:comboIndex+1,heavy:step.heavy,animationDuration:heroTicks(step.animationDuration*TICKS)/TICKS,counter:false} : {animationDuration:heroTicks((config.projectile === 'arrow' ? .9 : .66)*TICKS)/TICKS};
          // One automatic spell stream, alternating fire and ice. Neither
          // an extra attack nor a manual skill toggle is introduced.
          const element=config.magic==='both'
            ?(mageCastIndex++%2===0?'fire':'ice'):config.magic;
          let interval = config.projectile === 'magic' ? cast('hero',target,Math.max(1,damage-target.armor),element) : heroTicks(HERO_INTERVAL);
          if(archer){
            if(archerRanks.arrowDance&&elapsed>=danceAt){danceUntil=elapsed+5*TICKS;danceAt=elapsed+20*TICKS;events.push({type:'archerSkill',skill:'arrowDance',sourceId:'hero',targetId:'hero',at:elapsed/TICKS});}
            const plan=archerShotPlan(elapsed);
            if(plan.rain&&!rainLeft){rainLeft=plan.count;rainAt=elapsed+(33-3*archerRanks.arrowRain)*TICKS;events.push({type:'archerSkill',skill:'arrowRain',sourceId:'hero',targetId:'hero',at:elapsed/TICKS,count:plan.count});}
            const kind=chooseArrow();shotCount++;
            const shotMeta={...metadata,animationDuration:plan.animationDuration,...(plan.rain?{rainIndex:plan.rainIndex,rainCount:plan.rainCount}:{}),...(plan.double?{double:true}: {}),...(plan.dance?{dance:true,danceIndex:plan.danceIndex}:{})};
            archerArrow(target,damage,kind,shotMeta);
            // Both arrows leave the same bow release and converge on the same
            // target. A killed target cannot be damaged or rewarded twice.
            if(plan.double&&target.hp>0)archerArrow(target,damage*.6,kind,{...shotMeta,extraArrow:true});
            if(plan.rain){rainLeft--;if(rainLeft>0)interval=Math.max(1,heroTicks(.65*TICKS));}
            interval=Math.max(1,Math.round(interval/plan.speed));
          }else if (config.projectile !== 'magic') hit('hero',target,Math.max(1,damage-target.armor),config.projectile,metadata);
          if (sword) {
            heroBusyUntil = elapsed + heroTicks(step.animationDuration*TICKS);
            comboIndex = (comboIndex+1) % swordSteps.length; nextHero += heroTicks(swordSteps[comboIndex].interval);
          } else {nextHero += interval;if(archer)deferNormalShot();}
          if (enemies.every(enemy => enemy.hp === 0)) { clearWave(); continue; }
        }
        while (heroCanAttack && pendingCounters.length && pendingCounters[0].at === next) {
          const counter = pendingCounters.shift(),target = enemies.find(enemy => enemy.id === counter.targetId && enemy.hp > 0);
          if (!target || hero.hp <= 0) continue;
          heroBusyUntil = elapsed + heroTicks(COUNTER_DURATION);
          hit('hero',target,Math.max(1,config.damage-target.armor),'melee',{variant:'halfslash',comboStep:0,heavy:false,animationDuration:heroTicks(COUNTER_DURATION)/TICKS,counter:true});
          if (enemies.every(enemy => enemy.hp === 0)) { clearWave(); break; }
        }
        if (phase !== 'running') continue;
        // Resolve the previous burn tick before a same-tick impact refreshes it;
        // the second tick also lands before the effect expires at exactly .5 s.
        for (const enemy of enemies) {
          if(enemy.hp>0){for(const dot of [...(enemy.arrowDots||[])])if(dot.at===next&&enemy.hp>0){hit(dot.sourceId,enemy,dot.damage,'arrow',{dot:true,arrowType:dot.type});dot.left--;dot.at+=TICKS;}enemy.arrowDots=(enemy.arrowDots||[]).filter(dot=>dot.left>0);if(enemies.every(e=>e.hp===0)){clearWave();break;}}
          const status = enemy.status;
          if (!status || enemy.hp <= 0) continue;
          if (status.type === 'burn' && status.nextTick === next) {
            hit(status.sourceId,enemy,status.damage||statusTiming.burnDamage,'burn',{magic:'fire',dot:true});
            if (enemy.status === status) status.nextTick += BURN_INTERVAL;
            if (enemies.every(unit => unit.hp === 0)) { clearWave(); break; }
          }
          if (enemy.status && enemy.status.endsAt <= next) enemy.status = null;
        }
        if (phase !== 'running') continue;
        // Subsequent breath pulses select the currently living defender at
        // their emission time. If the wolf falls, later tongues aim at hero.
        while(pendingBreaths.length&&pendingBreaths[0].at===next){
          const pulse=pendingBreaths.shift();
          const dragon=enemies.find(enemy=>enemy.id===pulse.sourceId&&enemy.hp>0);
          if(!dragon)continue;
          if(frozen(dragon)){
            pendingBreaths=pendingBreaths.filter(other=>other.sourceId!==dragon.id);
            continue;
          }
          dragonPulse(dragon.id,pulse.index);
        }
        // One roll per approaching projectile, before its impact.
        if(canRollEvasion()){
          for(const impact of [...pendingImpacts]){
            if(impact.dodgeChecked||impact.targetId!=='hero'||impact.sourceId==='hero'||!impact.magic||impact.at-DODGE_LEAD>elapsed)continue;
            impact.dodgeChecked=true;
            if(impact.at>elapsed&&attemptEvasion(enemies.find(e=>e.id===impact.sourceId)))impact.evaded=true;
          }
          for(let index=0;index<enemies.length;index++){
            const enemy=enemies[index];
            if(enemy.hp<=0||enemy.projectile!=='arrow'||enemyDodgeChecks[index]||!enemyCanAttack(enemy.id)||frozen(enemy)||currentEnemyTarget().id!=='hero'||nextEnemies[index]-DODGE_LEAD>elapsed)continue;
            enemyDodgeChecks[index]={evaded:nextEnemies[index]>elapsed&&attemptEvasion(enemy)};
          }
        }
        while (pendingImpacts.length && pendingImpacts[0].at === next) {
          const impact = pendingImpacts.shift(),target = impact.targetId === 'hero' ? hero
            : impact.targetId === 'companion' ? companion : enemies.find(enemy => enemy.id === impact.targetId);
          if (!target || target.hp <= 0) continue;
          if(impact.arrowKind){
            archerArrow(target,impact.damage,impact.arrowKind,{extraArrow:true,retreat:true,dodgeShot:!!impact.dodgeShot});
            if(enemies.every(enemy=>enemy.hp===0)){clearWave();break;}
            continue;
          }
          if(impact.meleeDodge){
            if(enemies.some(e=>e.id===impact.sourceId&&e.hp>0))hit(impact.sourceId,target,impact.damage,'melee',{evaded:true,windup:true,animationDuration:.66});
            continue;
          }
          const previous=target.status?.type;
          hit(impact.sourceId,target,impact.damage,'magic',{magic:impact.magic,impact:true,castAt:impact.castAt,castId:impact.castId,
            breath:Boolean(impact.breath),burstIndex:impact.burstIndex,...(impact.evaded?{evaded:true}:{}),...(impact.shards?{shards:true}:{}),...(impact.echo?{echo:true}:{}),...(impact.overloaded?{overloaded:true}:{})});
          if(impact.overloaded)events.push({type:'mageSkill',skill:'overload',sourceId:'hero',targetId:target.id,at:elapsed/TICKS});
          if(!impact.shards&&!impact.echo&&impact.sourceId==='hero'&&target.id!=='hero'&&['fire','ice'].includes(impact.magic)){
            mageReaction(target,impact.magic,previous);
            if(previous==='freeze'&&hasTalent('storm')&&shardRank)for(const enemy of nearby(target))hit('hero',enemy,shardRank*3,'reaction',{dot:true,magic:'ice'});
            if(target.hp>0)applyStatus(target,impact.magic);
          }
          if (hero.hp === 0) { end('defeat'); break; }
          if (enemies.every(enemy => enemy.hp === 0)) { clearWave(); break; }
        }
        if (phase !== 'running') continue;
        for (let index=0;index<enemies.length;index++) {
          const enemy = enemies[index];
          if (enemy.hp <= 0 || nextEnemies[index] !== next || (enemy.type === 'orc' && !orcCanAttack) || !enemyCanAttack(enemy.id) || frozen(enemy)) continue;
          const defender=currentEnemyTarget();
          if(enemy.type==='orc')orcHasAttacked=true;
          let damage = enemy.damage,blocked = false;
          const arrowEvaded=enemyDodgeChecks[index]?.evaded&&defender.id==='hero';enemyDodgeChecks[index]=null;
          if(archer&&defender.id==='hero'&&enemy.projectile==='melee'&&archerRanks.retreat&&elapsed>=retreatAt&&elapsed>=dodgeUntil&&availability?.heroCanRetreat!==false&&availability?.heroCloseEnemy?.[enemy.id]!==false){
            retreatAt=elapsed+(14-2*archerRanks.retreat)*TICKS*(elapsed<danceUntil?.5:1);
            dodgeShot(enemy,'retreat');
            nextEnemies[index]+=Math.round(enemy.interval*TICKS);continue;
          }
          if(defender.id==='hero'&&enemy.projectile==='melee'&&attemptEvasion(enemy)){
            events.push({type:'enemyWindup',sourceId:enemy.id,targetId:'hero',at:elapsed/TICKS,impactAt:(elapsed+DODGE_LEAD)/TICKS,animationDuration:.66});
            pendingImpacts.push({sourceId:enemy.id,targetId:'hero',damage,meleeDodge:true,at:elapsed+DODGE_LEAD});
            pendingImpacts.sort((a,b)=>a.at-b.at);
            nextEnemies[index]+=Math.round(enemy.interval*TICKS)+DODGE_LEAD;continue;
          }
          if (defender.id==='hero' && sword && enemy.projectile === 'melee' && ++meleeHits % 2 === 0) {
            const blockedDamage = damage*.5; damage -= blockedDamage; blocked = true;
            events.push({type:'block',sourceId:enemy.id,targetId:'hero',blockedDamage,at:elapsed/TICKS});
          }
          if(enemy.type==='dragon'){
            if(defender.id==='companion'){
              // The wolf has reached the hovering dragon: a physical swipe
              // with no fire effect, no delayed flame and no breath queue.
              hit(enemy.id,defender,damage,'claw',
                {animationDuration:.66,dragonSwipe:true});
            }else{
              dragonPulse(enemy.id,0);
              for(let index=1;index<dragonBreath.bursts;index++)
                pendingBreaths.push({sourceId:enemy.id,
                  at:elapsed+DRAGON_BREATH_SPACING*index,index});
              pendingBreaths.sort((a,b)=>a.at-b.at||a.index-b.index);
            }
          }else if (enemy.projectile === 'magic') cast(enemy.id,defender,damage,'shadow');
          else hit(enemy.id,defender,damage,enemy.projectile,enemy.type === 'archer' ? {animationDuration:.6,...(arrowEvaded?{evaded:true}:{})} : undefined);
          nextEnemies[index] += Math.round(enemy.interval*TICKS);
          if (hero.hp === 0) { end('defeat'); break; }
          if (blocked) reserveCounter(enemy.id);
          if(enemies.every(e=>e.hp===0)){clearWave();break;}
        }
      }
      if (phase === 'running' || phase === 'intermission') advanceClock(until);
      return events;
    }
    restart();
    return {getState,getArrowSchedule,advance,pause,resume,restart,updateHeroStats,
      setCompanionEnabled,companionStrike,setTalents,get state(){return getState();}};
  }
  return {createBattle,magicTiming,closeMagicTiming,statusTiming,intermissionDuration,dragonBreath,archerDodge};
});
