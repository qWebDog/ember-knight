/* Isolated deterministic PvP laboratory. Uses current progression stats,
 * never writes localStorage. PvP-specific targeting: wolf intercepts magic;
 * arrows and bites focus the mage. Distances/armor are explicit test rules. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./progression.js'):root.EmberProgression,typeof module==='object'&&module.exports?require('./combat.js'):root.EmberCombat);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberPvP=api;})(typeof window==='undefined'?null:window,function(prog,combat){
'use strict';
const step=.01,round=n=>Math.round(n*100)/100,clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
function stats(id,rank){const cat=id==='wand'?prog.mageCatalog:prog.archerCatalog;const key=id==='wand'?'mageLevels':'archerLevels';const saved=JSON.stringify({version:1,gold:0,levels:{},[key]:Object.fromEntries(cat.map(s=>[s.id,Math.min(rank,s.maxLevel)]))});return prog.createStore({classId:id,storage:{getItem:k=>k===prog.storageKey?saved:null,setItem(){}}}).getStats();}
// Canvas world units shared by simulation and renderer. The 130px sphere
// atlas has a 50px rim in each 128px cell. Wolf tile is 64px at 1.75x;
// the maximum forward muzzle reach is 56px (including the bite extension).
const geometry=Object.freeze({sphereSize:130,sphereRadius:130*50/128,wolfMuzzle:56,bodyContact:48,shieldContact:Math.ceil(130*50/128+56),wolfSpeed:250});
function createDuel(options={}){
 const mr=clamp(Math.floor(Number(options.mageRank??5)||0),0,5),ar=clamp(Math.floor(Number(options.archerRank??5)||0),0,5),ms=stats('wand',mr),as=stats('bow',ar);
 const talent=new Set((Array.isArray(options.talents)?options.talents:[]).filter(x=>['revenge','doubleEcho','immortality'].includes(x)).slice(0,3));
 const rank=k=>as['archer_'+k]||0,mrank=k=>ms['hero'+k+'Rank']||0;
 const wolfOn=options.wolf!==false,close=options.distance==='close';
 const units={mage:{id:'mage',hp:ms.heroMaxHp,maxHp:ms.heroMaxHp,damage:ms.heroDamage,sphere:mrank('Sphere')?10+10*mrank('Sphere'):0},archer:{id:'archer',hp:as.heroMaxHp,maxHp:as.heroMaxHp,damage:as.heroDamage},wolf:{id:'wolf',hp:wolfOn?70*(1+.15*rank('wolfBond')):0,maxHp:wolfOn?70*(1+.15*rank('wolfBond')):0,damage:7*(1+.1*rank('wolfBond'))}};
 units.mage.sphereMax=units.mage.sphere;
 const mageX=close?140:86,archerX=close?340:394;
 units.mage.x=mageX;units.archer.x=archerX;units.wolf.x=archerX;units.wolf.moving=false;
 const wolfDestination=()=>mageX+(units.mage.sphere>0?geometry.shieldContact:geometry.bodyContact);
 function keepWolfOutside(){if(units.wolf.hp>0&&units.mage.sphere>0)units.wolf.x=Math.max(units.wolf.x,wolfDestination());}
 function moveWolf(){const u=units.wolf;u.moving=false;if(u.hp<=0||frozen('wolf'))return;const target=wolfDestination(),gap=target-u.x;u.moving=Math.abs(gap)>1e-6;u.x+=Math.sign(gap)*Math.min(Math.abs(gap),geometry.wolfSpeed*step);if(Math.abs(u.x-target)<1e-6){u.x=target;u.moving=false;}}

 let t=0,result=null,paused=false,remaining=0,rng=(Number(options.seed??42)>>>0),queue=[],serial=0,events=[],mageNext=1.2/ms.heroAttackSpeed,arrowNext=1.2/as.heroAttackSpeed,wolfNext=close?.6:1.1,wolfRevive=Infinity,roarAt=0,roarUntil=0,danceAt=20,danceUntil=0,rainAt=33-3*rank('arrowRain'),rain=0,shots=0,meters={},arrows=[],casts=0,echoMeter=0,overload=0,archLeft=0,echoCount=0,reactions=0,bites=0,reborn=false,immuneUntil=0,dodgeReady=0,dodgeUntil=0,retreatReady=0;
 const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
 const alive=id=>units[id].hp>0;
 const emit=(type,data={})=>events.push({type,at:round(t),...data});
 function schedule(at,fn){queue.push({at:round(at),fn,serial:serial++});queue.sort((a,b)=>a.at-b.at||a.serial-b.serial);}
 function launch(source,target,damage,kind,delay,fn,visual={}){const at=round(t+delay);emit('launch',{source,target,kind,impactAt:at,...visual});schedule(at,()=>{if(alive(target)&&!result)fn();});}
 function status(id,kind,duration,damage=0){const u=units[id],tag={kind,startedAt:t,until:round(t+duration)};u.status=tag;emit('status',{target:id,kind,until:tag.until});if(kind==='fire'){const tick=()=>{if(u.status!==tag||!alive(id)||t>tag.until+1e-6)return;hit('mage',id,damage,'burn',true);if(t+.25<=tag.until+1e-6)schedule(t+.25,tick);};schedule(t+.25,tick);}}
 function dot(source,target,kind,value,count,limit){const u=units[target];u.dots??={};const a=u.dots[kind]??=[];u.dots[kind]=a;let tag={left:count};if(a.length>=limit){a[0]=tag;}else a.push(tag);const tick=()=>{if(!a.includes(tag)||!alive(target)||result)return;hit(source,target,value,kind,true);if(--tag.left>0)schedule(t+1,tick);else a.splice(a.indexOf(tag),1);};schedule(t+1,tick);}
 function hit(source,target,value,kind,dotHit=false){if(!alive(target)||result)return 0;const u=units[target];let damage=value;if(source==='mage'&&t<roarUntil)damage*=1-.05*rank('alpha');if(target==='mage'&&t<immuneUntil)damage=0;
  if(target==='mage'&&u.sphere>0){const absorbed=Math.min(u.sphere,damage);u.sphere-=absorbed;damage-=absorbed;emit('sphere',{source,target,absorbed,hp:round(u.sphere),kind});if(talent.has('revenge')&&alive(source))hit('mage',source,absorbed*.25,'reflection',true);}
  u.hp=Math.max(0,u.hp-damage);emit('hit',{source,target,kind,damage:round(damage),hp:round(u.hp),dot:dotHit});
  if(u.hp>0)return damage;
  if(target==='mage'&&mrank('Rebirth')&&!reborn){reborn=true;u.hp=Math.floor(u.maxHp*.1*mrank('Rebirth'));if(talent.has('immortality'))immuneUntil=t+2;emit('revive',{target,hp:u.hp});return damage;}
  emit('death',{target});u.status=null;u.dots={};
  if(target==='wolf'){if(rank('alpha'))wolfRevive=t+24-2*rank('alpha');if(source==='mage'&&mrank('Absorption')){units.mage.sphere=Math.min(units.mage.sphereMax,units.mage.sphere+4*mrank('Absorption'));keepWolfOutside();emit('absorb',{target:'mage',hp:units.mage.sphere});}return damage;}
  result=target==='mage'?'archer':'mage';emit('end',{winner:result});return damage;
 }
 function arrow(target,kind,damage=as.heroDamage,delay=.28,visual={}){launch('archer',target,damage,kind,delay,()=>{const penetrated=hit('archer',target,damage,kind);if(!alive(target)||result||penetrated<=0)return;if(kind==='poison')dot('archer',target,'poison',damage*(.05+.05*rank(kind)),5,3);if(kind==='barbed')dot('archer',target,'bleed',units[target].maxHp*(.0025+.0025*rank(kind)),4,1);},visual);}
 function evade(){if(t<dodgeReady||t<dodgeUntil||!alive('archer')||!rank('evasion'))return false;if(random()>=(rank('evasion')*.1+(t<danceUntil?.1:0)))return false;dodgeReady=t+2;dodgeUntil=t+combat.archerDodge.duration;arrowNext=Math.max(arrowNext,dodgeUntil+.28);emit('skill',{source:'archer',kind:'evasion'});schedule(t+combat.archerDodge.release,()=>{if(alive('archer')&&!result)arrow('mage','normal');});return true;}
 function magic(target,kind,damage,delay,secondary=false,visual={}){launch('mage',target,damage,kind,delay,()=>{if(target==='archer'&&t<dodgeUntil){emit('miss',{source:'mage',target,kind});return;}const prev=units[target].status;hit('mage',target,damage,kind);if(result||!alive(target)||secondary)return;if(prev&&prev.until>=t&&prev.kind!==kind&&mrank('Fusion')){emit('skill',{source:'mage',target,kind:'fusion',effect:kind==='ice'?'steam':'thermal'});hit('mage',target,4*mrank('Fusion'),'fusion',true);if(prev.kind==='fire'&&kind==='ice'&&alive('wolf')&&target==='archer'&&close)hit('mage','wolf',2*mrank('Fusion'),'fusion',true);if(++reactions%3===0&&mrank('Chaos')){emit('skill',{source:'mage',kind:'chaos'});for(const id of ['wolf','archer'])if(alive(id))hit('mage',id,5*mrank('Chaos'),'chaos',true);}}if(alive(target)&&!result)status(target,kind,Math.max(.5+(kind==='fire'?mrank('Burn')*.25:0),mrank('Fusion')?1.55:0),1+mrank('Burn'));},visual);if(target==='archer')schedule(t+Math.max(0,delay-.32),()=>{if(alive(target)&&!result)evade();});}
 function cast(){const target=alive('wolf')?'wolf':'archer',kind=casts%2===0?'fire':'ice',near=close||target==='wolf'&&Math.abs(units.wolf.x-mageX)<=geometry.shieldContact+1;const timing=near?combat.closeMagicTiming:combat.magicTiming;let interval=(near?.8:1.2)/ms.heroAttackSpeed,damage=ms.heroDamage;casts++;
  if(archLeft>0){interval*=.9-.05*mrank('Archmage');archLeft--;}if(mrank('Archmage')&&casts%6===0){archLeft=3;emit('skill',{source:'mage',kind:'archmage'});}
  overload+=8*mrank('Overload');if(overload>=100){overload-=100;damage=Math.ceil(damage*1.5);emit('skill',{source:'mage',kind:'overload'});}
  const delay=timing.appearDuration+timing.flightDuration;emit('pose',{source:'mage',duration:(near?.36:.66)/ms.heroAttackSpeed});magic(target,kind,damage,delay,false,{appearDuration:timing.appearDuration});
  echoMeter+=mrank('Echo');if(echoMeter>=10){echoMeter-=10;emit('skill',{source:'mage',kind:'echo'});magic(target,kind,Math.floor(damage*.5),delay+.18,true,{appearDuration:timing.appearDuration+.18,echo:true});if(talent.has('doubleEcho')&&++echoCount%4===0)magic(target,kind,Math.floor(damage*.5),delay+.36,true,{appearDuration:timing.appearDuration+.36,echo:true});}
  if(kind==='ice'&&mrank('Shard'))magic(target,'ice',3*mrank('Shard'),delay+.12,true,{appearDuration:timing.appearDuration,shards:true});
  mageNext=t+interval;
 }
 function shoot(){if(rank('arrowDance')&&t>=danceAt){danceAt=t+20;danceUntil=t+5;emit('skill',{source:'archer',kind:'dance'});}if(rank('arrowRain')&&!rain&&t>=rainAt){rain=4+rank('arrowRain');rainAt=t+33-3*rank('arrowRain');emit('skill',{source:'archer',kind:'rain'});}
  for(const k of ['piercing','poison','explosive','barbed'])if(rank(k)){meters[k]=(meters[k]||0)+1;if(meters[k]>=12-2*rank(k)){meters[k]=0;if(!arrows.includes(k))arrows.push(k);}}
  const kind=arrows.shift()||'normal';shots++;const double=!!rank('doubleShot')&&shots%(14-2*rank('doubleShot'))===0,clip=rain?'arrowRain':double?'doubleShot':t<danceUntil?'dance'+(shots%3):null,duration=(rain?.50:.9)/as.heroAttackSpeed/(t<danceUntil?1+.05*rank('arrowDance'):1),release=duration*(clip==='arrowRain'?6/9:clip==='doubleShot'?8/12:clip?.startsWith('dance')?.6:9/13);emit('pose',{source:'archer',duration,clip});schedule(t+release,()=>{if(!alive('archer')||result)return;arrow('mage',kind,as.heroDamage,.28,{rain:clip==='arrowRain',double:double?1:0});if(double)arrow('mage',kind,.6*as.heroDamage,.28,{rain:clip==='arrowRain',double:2});});
  let interval=(rain>1?.65:1.2)/as.heroAttackSpeed;if(rain)rain--;if(t<danceUntil)interval/=1+.05*rank('arrowDance');arrowNext=t+interval;
 }
 function bite(){const u=units.wolf;emit('pose',{source:'wolf',duration:5/12,rending:!!rank('rendingBite')&&(bites+1)%3===0});schedule(t+.25,()=>{if(!alive('wolf')||result||frozen('wolf'))return;keepWolfOutside();if(Math.abs(u.x-wolfDestination())>geometry.wolfSpeed*.25+1)return;const penetrated=hit('wolf','mage',Math.floor(u.damage),'bite');if(rank('rendingBite')&&++bites%3===0&&!result&&penetrated>0){emit('skill',{source:'wolf',kind:'rend'});dot('wolf','mage','wolfBleed',Math.floor(u.damage)*(.2+.1*rank('rendingBite')),4,8);}});const speed=(t<roarUntil?1+.1*rank('alpha'):1)*(u.hp<u.maxHp*.5?1+.15*rank('guardian'):1);wolfNext=t+Math.max(.5,1.25/speed);}
 function frozen(id){const s=units[id].status;return s?.kind==='ice'&&s.until>t;}
 function advance(dt){events=[];if(paused||result||!Number.isFinite(dt)||dt<=0)return events;remaining+=Math.min(dt,120);while(remaining>=step-1e-9&&!result){remaining-=step;t=round(t+step);for(const u of Object.values(units))if(u.status&&u.status.until<t)u.status=null;
  if(wolfOn&&!alive('wolf')&&t>=wolfRevive){units.wolf.hp=units.wolf.maxHp;units.wolf.x=archerX;units.wolf.moving=true;wolfRevive=Infinity;wolfNext=t+.6;emit('revive',{target:'wolf',hp:units.wolf.hp});}
  if(alive('wolf')&&rank('alpha')&&t>=roarAt){roarUntil=t+5;roarAt=t+20;emit('skill',{source:'wolf',kind:'roar'});}
  keepWolfOutside();moveWolf();if(frozen('archer'))arrowNext+=step;if(frozen('wolf'))wolfNext+=step;
  if(t+1e-6>=mageNext&&alive('mage'))cast();if(t+1e-6>=arrowNext&&t>=dodgeUntil&&!frozen('archer'))shoot();if(alive('wolf')&&t+1e-6>=wolfNext&&!frozen('wolf')&&Math.abs(units.wolf.x-wolfDestination())<1e-6)bite();
  while(queue.length&&queue[0].at<=t+1e-6&&!result)queue.shift().fn();
  if(t>=120&&!result){result='draw';emit('end',{winner:result});}
 }return events;}
 return {advance,pause(){paused=true;},resume(){paused=false;},getState(){return {time:t,paused,result,units:JSON.parse(JSON.stringify(units)),mageRank:mr,archerRank:ar,wolfOn,close,talents:[...talent]};}};
}
return {createDuel,stats,geometry};
});
