/* Deterministic idle combat. Active time uses microsecond ticks; no wall clock or DOM. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EmberCombat = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const TICKS = 1000000;
  const HERO_INTERVAL = 1.2 * TICKS;
  const CLOSE_MAGIC_INTERVAL = .8 * TICKS;
  const COUNTER_DELAY = .3 * TICKS;
  const COUNTER_DURATION = .36 * TICKS;
  const intermissionDuration = 1.4;
  const INTERMISSION = Math.round(intermissionDuration * TICKS);
  const KILL_REWARD = 5;
  const WOLF_MAX_HP = 70;
  // Five short timed bursts make a breath, not five instant hit events.
  // Spread the old 12-damage fireball over five 3-HP tongues (15 per volley).
  const dragonBreath=Object.freeze({bursts:5,spacing:.26,damage:3,flight:.21,afterglow:.33});
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
    orc:{name:'Орк-щитоносец',maxHp:100,damage:6,interval:2.4,armor:3,projectile:'melee'},
    archer:{name:'Скелет-лучник',maxHp:60,damage:7,interval:1.8,armor:0,projectile:'arrow'},
    mage:{name:'Могильный колдун',maxHp:65,damage:10,interval:3.8,armor:0,projectile:'magic'},
    dragon:{name:'Красный дракон',maxHp:180,damage:12,interval:2.8,armor:3,projectile:'magic'}
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
    const activeWaves=options.dragonBossEnabled===true
      ?[...waveTemplates,[{id:'dragon',type:'dragon'}]]:waveTemplates;
    const activeTotalEnemies=activeWaves.reduce((n,wave)=>n+wave.length,0);
    const config = {
      name:typeof options.heroName === 'string' && options.heroName.trim() ? options.heroName.trim() : 'Странник',
      maxHp:positive(options.heroMaxHp, 200), damage:positive(options.heroDamage, 12),attackSpeed:attackSpeed(options.heroAttackSpeed,1),
      projectile:['melee','arrow','magic'].includes(options.heroProjectile) ? options.heroProjectile : 'melee',
      magic:['fire','ice'].includes(options.heroMagic) ? options.heroMagic : 'fire'
    };
    const sword = options.heroWeapon === 'sword' && config.projectile === 'melee';
    let phase, pausedFrom, elapsed, remainder, hero, enemies, nextHero, nextEnemies, reward;
    let comboIndex, meleeHits, heroBusyUntil, pendingCounters, pendingImpacts, pendingBreaths;
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
    function getArrowSchedule() {
      if(phase!=='running'&&phase!=='paused')return [];
      const target=enemies.find(enemy=>enemy.hp>0);
      if(!target||hero.hp<=0)return [];
      const shots=[];
      if(config.projectile==='arrow'){
        shots.push({sourceId:'hero',targetId:target.id,
          at:nextHero/TICKS,animationDuration:heroTicks(.9*TICKS)/TICKS});
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
        phase, elapsed:elapsed / TICKS, hero:{...hero},
        companion:companionEnabled?{...companion,alive:companion.hp>0}:null,
        enemyTargetId:currentEnemyTarget().id,
        enemies:enemies.map(enemy => ({...enemy,status:enemy.status ? {type:enemy.status.type,startedAt:enemy.status.startedAt/TICKS,endsAt:enemy.status.endsAt/TICKS} : null,alive:enemy.hp > 0})),
        targetId:target ? target.id : null,
        waveIndex,waveNumber:waveIndex+1,waveCount:activeWaves.length,completedWaves,
        defeatedCount,totalDefeated:defeatedCount,totalEnemies:activeTotalEnemies,reward,
        intermissionRemaining:waiting ? Math.max(0,nextWaveAt-elapsed) / TICKS : 0
      };
    }
    function spawnWave(index) {
      waveIndex = index; phase = 'running'; pausedFrom = null; nextWaveAt = null;
      enemies = activeWaves[index].map(unit => ({...archetypes[unit.type],...unit,hp:archetypes[unit.type].maxHp,status:null}));
      comboIndex = 0; meleeHits = 0; heroBusyUntil = elapsed; pendingCounters = []; pendingImpacts = []; pendingBreaths = [];
      nextHero = elapsed + heroTicks(sword ? swordSteps[0].interval : HERO_INTERVAL);
      nextEnemies = enemies.map(enemy => elapsed + Math.round(enemy.interval * TICKS));
    }
    function restart() {
      elapsed = 0; remainder = 0; reward = 0; completedWaves = 0; defeatedCount = 0;
      hero = {id:'hero',name:config.name,hp:config.maxHp,maxHp:config.maxHp,damage:config.damage,attackSpeed:config.attackSpeed};
      const maxHp=positive(options.companionMaxHp,WOLF_MAX_HP);
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
      const damage=Math.max(1,Math.floor(baseDamage-target.armor));
      target.hp=Math.max(0,target.hp-damage);
      const at=elapsed/TICKS;
      events.push({type:'attack',sourceId:'companion',targetId:target.id,
        damage,hp:target.hp,at,projectile:'bite',animationDuration:5/12});
      if(target.hp!==0)return events;
      defeatedCount++;reward+=KILL_REWARD;target.status=null;
      pendingCounters=pendingCounters.filter(counter=>counter.targetId!==target.id);
      pendingImpacts=pendingImpacts.filter(impact=>impact.targetId!==target.id);
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
      function hit(sourceId,target,damage,projectile,metadata) {
        target.hp = Math.max(0,target.hp-damage);
        events.push({type:'attack',sourceId,targetId:target.id,damage,hp:target.hp,at:elapsed/TICKS,projectile,...metadata});
        if (target.hp === 0) {
          const enemy = target.id !== 'hero' && target.id !== 'companion';
          if (enemy) { defeatedCount++; reward += KILL_REWARD; target.status = null; }
          events.push({type:'death',id:target.id,unitType:target.type || (target.id==='companion'?'companion':'hero'),reward:enemy ? KILL_REWARD : 0,totalReward:reward,at:elapsed/TICKS});
          pendingCounters = pendingCounters.filter(counter => counter.targetId !== target.id);
          pendingImpacts = pendingImpacts.filter(impact => impact.targetId !== target.id);
          pendingBreaths = pendingBreaths.filter(breath => breath.sourceId !== target.id);
        }
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
      function applyStatus(target,magic) {
        const type = magic === 'fire' ? 'burn' : 'freeze';
        target.status = {type,sourceId:'hero',startedAt:elapsed,endsAt:elapsed+STATUS_DURATION,nextTick:elapsed+BURN_INTERVAL};
        events.push({type:'status',status:type,sourceId:'hero',targetId:target.id,at:elapsed/TICKS,duration:statusTiming.duration,endsAt:target.status.endsAt/TICKS});
      }
      function dragonPulse(sourceId,burstIndex){
        const defender=currentEnemyTarget();
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
        const interval = sourceId === 'hero' ? heroTicks(close ? CLOSE_MAGIC_INTERVAL : HERO_INTERVAL) : Math.round(enemies.find(enemy=>enemy.id===sourceId).interval*TICKS);
        const delay = Math.round((timing.appearDuration+timing.flightDuration)*TICKS);
        const castAt = elapsed/TICKS,impactTick = elapsed+delay,castId = `${sourceId}:${elapsed}`;
        events.push({type:'cast',sourceId,targetId:target.id,projectile:'magic',magic,at:castAt,...timing,impactAt:impactTick/TICKS,castId,animationDuration:sourceId === 'hero' ? heroTicks((close ? .36 : .66)*TICKS)/TICKS : .66,castInterval:interval/TICKS});
        pendingImpacts.push({sourceId,targetId:target.id,damage,magic,at:impactTick,castAt,castId});
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
        if (heroCanAttack && pendingCounters.length) next = Math.min(next,pendingCounters[0].at);
        if (pendingImpacts.length) next = Math.min(next,pendingImpacts[0].at);
        if (pendingBreaths.length) next = Math.min(next,pendingBreaths[0].at);
        enemies.forEach((enemy,index) => {
          if (enemy.hp <= 0) return;
          if ((enemy.type !== 'orc' || orcCanAttack) && enemyCanAttack(enemy.id) && !frozen(enemy)) next = Math.min(next,nextEnemies[index]);
          if (enemy.status) {
            next = Math.min(next,enemy.status.endsAt);
            if (enemy.status.type === 'burn') next = Math.min(next,enemy.status.nextTick);
          }
        });
        if (next > until) break;
        advanceClock(next);
        // Ties: hero action, counters, existing status ticks/expiry, impacts, then enemies.
        if (heroCanAttack && nextHero === next) {
          const target = enemies.find(enemy => enemy.hp > 0),step = sword ? swordSteps[comboIndex] : null;
          const damage = config.damage * (step?.heavy ? 1.5 : 1);
          const metadata = step ? {variant:step.variant,comboStep:comboIndex+1,heavy:step.heavy,animationDuration:heroTicks(step.animationDuration*TICKS)/TICKS,counter:false} : {animationDuration:heroTicks((config.projectile === 'arrow' ? .9 : .66)*TICKS)/TICKS};
          const interval = config.projectile === 'magic' ? cast('hero',target,Math.max(1,damage-target.armor),config.magic) : heroTicks(HERO_INTERVAL);
          if (config.projectile !== 'magic') hit('hero',target,Math.max(1,damage-target.armor),config.projectile,metadata);
          if (sword) {
            heroBusyUntil = elapsed + heroTicks(step.animationDuration*TICKS);
            comboIndex = (comboIndex+1) % swordSteps.length; nextHero += heroTicks(swordSteps[comboIndex].interval);
          } else nextHero += interval;
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
          const status = enemy.status;
          if (!status || enemy.hp <= 0) continue;
          if (status.type === 'burn' && status.nextTick === next) {
            hit(status.sourceId,enemy,statusTiming.burnDamage,'burn',{magic:'fire',dot:true});
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
        while (pendingImpacts.length && pendingImpacts[0].at === next) {
          const impact = pendingImpacts.shift(),target = impact.targetId === 'hero' ? hero
            : impact.targetId === 'companion' ? companion : enemies.find(enemy => enemy.id === impact.targetId);
          if (!target || target.hp <= 0) continue;
          hit(impact.sourceId,target,impact.damage,'magic',{magic:impact.magic,impact:true,castAt:impact.castAt,castId:impact.castId,
            breath:Boolean(impact.breath),burstIndex:impact.burstIndex});
          if (impact.sourceId === 'hero' && target.id !== 'hero' && target.hp > 0 && ['fire','ice'].includes(impact.magic)) applyStatus(target,impact.magic);
          if (hero.hp === 0) { end('defeat'); break; }
          if (enemies.every(enemy => enemy.hp === 0)) { clearWave(); break; }
        }
        if (phase !== 'running') continue;
        for (let index=0;index<enemies.length;index++) {
          const enemy = enemies[index];
          if (enemy.hp <= 0 || nextEnemies[index] !== next || (enemy.type === 'orc' && !orcCanAttack) || !enemyCanAttack(enemy.id) || frozen(enemy)) continue;
          const defender=currentEnemyTarget();
          let damage = enemy.damage,blocked = false;
          if (defender.id==='hero' && sword && enemy.projectile === 'melee' && ++meleeHits % 2 === 0) {
            const blockedDamage = damage*.5; damage -= blockedDamage; blocked = true;
            events.push({type:'block',sourceId:enemy.id,targetId:'hero',blockedDamage,at:elapsed/TICKS});
          }
          if(enemy.type==='dragon'){
            dragonPulse(enemy.id,0);
            for(let index=1;index<dragonBreath.bursts;index++)
              pendingBreaths.push({sourceId:enemy.id,at:elapsed+DRAGON_BREATH_SPACING*index,index});
            pendingBreaths.sort((a,b)=>a.at-b.at||a.index-b.index);
          }else if (enemy.projectile === 'magic') cast(enemy.id,defender,damage,'shadow');
          else hit(enemy.id,defender,damage,enemy.projectile,enemy.type === 'archer' ? {animationDuration:.6} : undefined);
          nextEnemies[index] += Math.round(enemy.interval*TICKS);
          if (hero.hp === 0) { end('defeat'); break; }
          if (blocked) reserveCounter(enemy.id);
        }
      }
      if (phase === 'running' || phase === 'intermission') advanceClock(until);
      return events;
    }
    restart();
    return {getState,getArrowSchedule,advance,pause,resume,restart,updateHeroStats,
      setCompanionEnabled,companionStrike,get state(){return getState();}};
  }
  return {createBattle,magicTiming,closeMagicTiming,statusTiming,intermissionDuration,dragonBreath};
});
