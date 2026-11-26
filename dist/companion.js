/* Original LPC wolf animation by Stephen "Redshrike" Challener,
 * contributed by William.Thompsonj, licensed CC BY 4.0.
 * https://opengameart.org/content/lpc-wolf-animation
 * Original 640×384 sprite sheet is preserved without pixel modification.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberCompanion=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const path='assets/companions/wolf.png',tile=64;
  const sprite=Object.freeze({width:640,height:384,tile});
  // Shared with the battlefield movement and enemy range check.
  // Keep the wolf's head outside even a 2x Orc sprite when biting.
  const contact=Object.freeze({enemy:.56,companion:.18});
  // This wolf is NOT a 10×6 grid of full 64px-high animation frames:
  // side-facing actions share 64px rows as separate 32–40px-high strips.
  // Each strip starts at x=320; left-facing artwork is in the lower half.
  const strips=Object.freeze({
    right:Object.freeze({
      idle:Object.freeze({y:56,h:40,count:1,fps:1}),
      howl:Object.freeze({y:56,h:40,count:4,fps:6}),
      walk:Object.freeze({y:96,h:32,count:5,fps:10}),
      run:Object.freeze({y:128,h:32,count:5,fps:12}),
      bite:Object.freeze({y:160,h:32,count:5,fps:12}),
      die:Object.freeze({y:0,h:32,count:4,fps:8})
    }),
    left:Object.freeze({
      idle:Object.freeze({y:248,h:40,count:1,fps:1}),
      howl:Object.freeze({y:248,h:40,count:4,fps:6}),
      walk:Object.freeze({y:288,h:32,count:5,fps:10}),
      run:Object.freeze({y:320,h:32,count:5,fps:12}),
      bite:Object.freeze({y:352,h:32,count:5,fps:12}),
      die:Object.freeze({y:192,h:32,count:4,fps:8})
    })
  });
  const skillDuration=Object.freeze({howl:.9,revive:1.5});
  function frameAt(time,moving=false,reducedMotion=false,direction=3,action=null){
    const side=direction===1?'left':'right';
    if(action==='revive'){
      const age=Math.max(0,Number.isFinite(time)?time:0);
      if(reducedMotion||age>=1.08)return {...frameAt(0,false,false,direction,'idle'),mode:'revive'};
      const spec=strips[side].die,frame=3-Math.min(3,Math.floor(Math.max(0,age-.20+1e-8)/.22));
      return {sx:320+frame*tile,sy:spec.y,sw:tile,sh:spec.h,dx:0,dy:tile-spec.h,dw:tile,dh:spec.h,mode:'revive',frame};
    }
    const desired=typeof action==='string'&&Object.hasOwn(strips[side],action)
      ?action:(moving?'walk':'idle');
    const mode=reducedMotion&&desired!=='die'?'idle':desired;
    const spec=strips[side][mode];
    const elapsed=Math.max(0,Number.isFinite(time)?time:0);
    const step=Math.floor(elapsed*spec.fps);
    const frame=mode==='walk'||mode==='run'?step%spec.count:Math.min(spec.count-1,step);
    return {sx:320+frame*tile,sy:spec.y,sw:tile,sh:spec.h,
      dx:0,dy:tile-spec.h,dw:tile,dh:spec.h,mode,frame};
  }
  // Separate pixel overlay; keeps original sprite pixels and hitbox untouched.
  function paintEffect(ctx,mode,age,direction=3){
    ctx.clearRect(0,0,128,96);
    const pixel=(x,y,color)=>{ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),1,1);};
    if(mode==='howl'){
      const side=direction===1?-1:1,mx=64+side*23,my=43;
      for(let k=0;k<3;k++){
        const t=age-.20-k*.13;if(t<0||t>.55)continue;
        const p=t/.55,r=5+28*p,alpha=Math.min(1,p*5+.25)*(1-p);
        for(let a=-1.25;a<.40;a+=.025){
          const x=mx+side*r*Math.cos(a),y=my+r*Math.sin(a);
          pixel(x,y,'rgba(199,184,121,'+alpha.toFixed(3)+')');
          if(p<.7)pixel(x+side,y,'rgba(231,214,152,'+(alpha*.65).toFixed(3)+')');
        }
      }
    }else if(mode==='revive'){
      const p=Math.min(1,Math.max(0,age/skillDuration.revive)),fade=Math.min(1,p*8+.25)*(1-p);
      for(let k=0;k<2;k++){
        const r=20+k*6+5*p;
        for(let a=0;a<Math.PI*2;a+=.035)
          pixel(64+r*Math.cos(a),79+(3+k*1.3)*Math.sin(a),'rgba(138,220,163,'+(fade*(k?.46:.85)).toFixed(3)+')');
      }
      for(let i=0;i<12;i++){
        const q=(p*1.45+i*.137)%1,x=64+Math.sin(i*2.39)*25+Math.sin(q*4+i)*2,y=76-q*45;
        const alpha=fade*Math.sin(q*Math.PI);if(alpha<.03)continue;
        const color='rgba(167,234,184,'+alpha.toFixed(3)+')';pixel(x,y,color);
        if(i%3===0){pixel(x-1,y,color);pixel(x+1,y,color);pixel(x,y-1,color);pixel(x,y+1,color);}
      }
    }
  }

  // Carry art is authored in the forest/light palette. Transfer only known
  // Ranger clothing/skin pixels; the wolf, bow, outlines and alpha stay intact.
  const carryHood=new Set(['27,85,2','19,69,7','11,43,40','7,57,29','16,46,24','49,91,73']);
  const carryCloth=new Set(['13,22,26','13,30,36','69,97,104','41,60,64','115,145,152','85,126,133','49,58,59','32,41,42','75,80,80']);
  const carrySkin=new Set(['248,213,185','236,200,172','216,186,164']);
  const carryColors={sand:[195,165,116],forest:[85,123,72],blue:[82,110,170],red:[152,82,90],purple:[148,106,180],gray:[139,141,150]};
  const carrySkinColors={light:[248,213,185],amber:[221,169,113],olive:[193,157,105],bronze:[166,113,76],brown:[119,77,52],black:[78,52,38]};
  const rgbKey=(data,i)=>data[i]+','+data[i+1]+','+data[i+2];
  function recolorCarryPixels(pixels,reference,current,{outfitColor='forest',skin='light',dyes={}}={}){
    const votes=new Map(),mapped=new Map();
    for(let i=0;i+3<Math.min(reference.length,current.length);i+=4){
      if(reference[i+3]!==255||current[i+3]!==255)continue;
      const from=rgbKey(reference,i);
      if(!carryHood.has(from)&&!carryCloth.has(from)&&!carrySkin.has(from))continue;
      const to=rgbKey(current,i),v=votes.get(from)||new Map();
      v.set(to,(v.get(to)||0)+1);votes.set(from,v);
    }
    for(const [from,v] of votes)mapped.set(from,[...v].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number));
    const result=new Uint8ClampedArray(pixels);
    const shade=(rgb,base,source)=>{const y=(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)/(source[0]*.2126+source[1]*.7152+source[2]*.0722);return base.map(v=>Math.min(255,Math.round(v*y)));};
    for(let i=0;i<result.length;i+=4){
      if(!result[i+3])continue;
      const key=rgbKey(result,i),rgb=[result[i],result[i+1],result[i+2]];
      const hood=carryHood.has(key),cloth=carryCloth.has(key),face=carrySkin.has(key);
      if(!hood&&!cloth&&!face)continue;
      let to=mapped.get(key);
      // Keep a selected non-forest color even for hand-drawn pixels not found
      // in the native walk sheet. Never recolor the wolf's brown fur.
      const hoodColor=dyes.helmet&&dyes.helmet!=='original'?dyes.helmet:dyes.cape&&dyes.cape!=='original'?dyes.cape:outfitColor;
      if(hood&&carryColors[hoodColor]&&hoodColor!=='forest'&&(!to||to.join(',')===key))to=shade(rgb,carryColors[hoodColor],[85,123,72]);
      if(cloth&&carryColors[dyes.armor]&&(!to||to.join(',')===key))to=shade(rgb,carryColors[dyes.armor],[69,97,104]);
      if(face&&skin!=='light'&&carrySkinColors[skin]&&(!to||to.join(',')===key))to=shade(rgb,carrySkinColors[skin],[248,213,185]);
      if(to)for(let j=0;j<3;j++)result[i+j]=to[j];
    }
    return result;
  }
  function recolorCarryAtlas(atlas,reference,current,appearance,canvasFactory){
    const read=(image,sy=0,h=image?.height||0)=>{
      if(!image||!h)return new Uint8ClampedArray(0);
      const c=canvasFactory();c.width=image.width;c.height=h;
      const ctx=c.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;
      ctx.drawImage(image,0,sy,image.width,h,0,0,image.width,h);
      return ctx.getImageData(0,0,c.width,c.height).data;
    };
    const canvas=canvasFactory();canvas.width=atlas.width;canvas.height=atlas.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false;ctx.drawImage(atlas,0,0);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height);
    const sameGeometry=reference&&current&&reference.width===current.width&&reference.height===current.height&&reference.height===512;
    const a=sameGeometry?read(reference,384,128):new Uint8ClampedArray(0);
    const b=sameGeometry?read(current,384,128):new Uint8ClampedArray(0);
    data.data.set(recolorCarryPixels(data.data,a,b,appearance));
    ctx.putImageData(data,0,0);canvas.src=atlas.src;return canvas;
  }

  function create({element,store,loadImage,canvasFactory}={}){
    const canvas=element?.querySelector?.('canvas')||null;
    let image=null,inflight=null,lastKey=null,idleSince=null;
    let position=null,actorDepth=3,facing=3,motion='idle',engaged=false;
    let biteStarted=null,biteTarget=null,biteLanded=false,nextBiteAt=0;
    let exitHeroX=null,skill=null,fx=null,powerFx=null;
    let rendImage=null,powerImage=null,skillArtPromise=null,rending=false,bondSince=null,furySince=null,lastBond=0,lastFury=false;
    function loadSkillArt(){
      if(skillArtPromise||!loadImage)return;
      skillArtPromise=Promise.allSettled([loadImage('assets/companions/wolf-rend-game.png').then(a=>{if(a.width===768&&a.height===64)rendImage=a;}),loadImage('assets/companions/wolf-power-fx.png').then(a=>{if(a.width===1344&&a.height===64)powerImage=a;})]);
    }
    function clearPower(){if(powerFx){powerFx.remove?.();powerFx=null;}lastBond=0;lastFury=false;bondSince=null;furySince=null;}
    const biteImpact=3/12, biteDuration=5/12, biteInterval=1.25, biteDamage=7;
    const active=()=>store?.classId==='bow'&&store?.getState()?.companion==='wolf';
    function loaded(){return Boolean(image);}
    function clearEffect(){if(fx){fx.remove?.();fx=null;}}
    function reset(){
      skill=null;clearEffect();clearPower();rending=false;
      position=null;actorDepth=3;facing=3;motion='idle';engaged=false;
      idleSince=null;biteStarted=null;biteTarget=null;biteLanded=false;nextBiteAt=0;
      exitHeroX=null;
      lastKey=null;
    }
    // At the end of a carry sequence the original dead sprite is placed
    // back on the road, not summoned as a living follower.
    function placeFallen(x,depth,direction=3){
      if(!active()||!Number.isFinite(x))return false;
      position=x;actorDepth=depth;facing=direction;motion='die';engaged=false;
      skill=null;clearEffect();biteStarted=null;biteTarget=null;biteLanded=false;
      exitHeroX=null;idleSince=null;lastKey=null;return true;
    }
    function startSkill(mode,time){
      if(!active()||!image||!Object.hasOwn(skillDuration,mode))return false;
      if(skill?.mode==='revive'&&mode==='howl'&&time<skill.at+skillDuration.revive)return false;
      skill={mode,at:time};biteStarted=null;biteTarget=null;biteLanded=false;idleSince=null;lastKey=null;
      return true;
    }
    function load(){
      if(image)return Promise.resolve(image);
      if(inflight)return inflight;
      inflight=Promise.resolve().then(()=>loadImage?loadImage(path):new Promise((resolve,reject)=>{
        const asset=new Image();
        asset.onload=()=>resolve(asset);asset.onerror=()=>reject(new Error('Wolf sprite unavailable'));
        asset.src=path;
      })).then(asset=>{
        if(asset.width!==sprite.width||asset.height!==sprite.height)throw new Error('Unexpected LPC wolf geometry');
        image=asset;lastKey=null;return asset;
      }).catch(error=>{inflight=null;throw error;});
      return inflight;
    }
    // The caller supplies authoritative enemy coordinates from the same
    // snapshot the Archer fires at. This controller only decides pursuit,
    // bite-frame timing and when to request an engine-confirmed hit.
    function advance({dt=0,time=0,phase='running',entering=false,heroAlive=true,companionAlive=true,
      heroX=0,anchorX=null,heroSize=64,heroDepth=3,target=null,
      exiting=false,reducedMotion=false,attackSpeed=1,rendingNext=false}={}){
      if(!active()||!image||!Number.isFinite(heroX)){
        if(position!==null)reset();
        return null;
      }
      const size=Math.max(48,heroSize);
      // During wave-out/victory the hero keeps walking to the right for
      // the fade, but the wolf must run back to the STATIC Archer position.
      // The hero's live x is used only for entering the battlefield.
      const restingX=Number.isFinite(anchorX)?anchorX:heroX;
      const home=(entering?heroX:restingX)-size*.83;
      if(position===null){position=home;actorDepth=heroDepth;facing=3;motion='idle';}
      if(!companionAlive||!heroAlive||phase==='defeat'){
        skill=null;clearEffect();motion='die';biteStarted=null;biteTarget=null;biteLanded=false;return null;
      }
      if(entering){
        // The hero enters each wave over ~2.5 seconds; the wolf walks in
        // beside them and never strikes before the battle clock starts.
        position=home;actorDepth=heroDepth;facing=3;motion='walk';engaged=false;
        biteStarted=null;biteTarget=null;biteLanded=false;return null;
      }
      if(phase==='paused')return null;
      if(exiting&&(phase==='intermission'||phase==='victory')){
        // During scene fade the hero walks RIGHT. Never begin a separate
        // leftward return to the old battlefield anchor.
        engaged=false;motion='walk';facing=3;idleSince=null;
        biteStarted=null;biteTarget=null;biteLanded=false;
        return null;
      }
      exitHeroX=null;
      if(skill){
        if(!reducedMotion&&time-skill.at<skillDuration[skill.mode]){motion=skill.mode;return null;}
        skill=null;clearEffect();
      }
      const attacking=phase==='running'&&target&&Number.isFinite(target.x)&&Number.isFinite(target.width)
        &&target.hp>0;
      const destination=attacking
        ?target.x-(target.width*contact.enemy+size*contact.companion):home;
      const destDepth=attacking?target.depth:heroDepth;
      engaged=Boolean(attacking);
      if(biteTarget&&(!attacking||target.id!==biteTarget)){
        biteStarted=null;biteTarget=null;biteLanded=false;
      }
      const gap=destination-position,remaining=Math.abs(gap);
      // An Orc can walk toward the Archer mid-bite. If it leaves reach,
      // abandon the swing; no phantom damage or transfer to a new target.
      if(biteTarget&&remaining>size*.35){
        biteStarted=null;biteTarget=null;biteLanded=false;
      }
      if(biteTarget){
        motion='bite';
        const age=Math.max(0,time-biteStarted);
        if(age>=biteDuration){
          biteStarted=null;biteTarget=null;biteLanded=false;motion='idle';
          return null;
        }
        if(!biteLanded&&age>=biteImpact){
          biteLanded=true;
          return {targetId:biteTarget,damage:biteDamage};
        }
        return null;
      }
      if(remaining>1||Math.abs(actorDepth-destDepth)>.04){
        const speed=Math.max(120,size*(attacking?2.75:2));
        const travel=reducedMotion?remaining:Math.min(remaining,Math.max(0,dt)*speed);
        position+=Math.sign(gap)*travel;
        const fraction=remaining>0?Math.min(1,travel/remaining):1;
        actorDepth+=(destDepth-actorDepth)*fraction;
        if(remaining<=1)actorDepth=destDepth;
        if(remaining>1)facing=gap>=0?3:1;
        motion=remaining>size*.45?'run':'walk';
        idleSince=null;
        return null;
      }
      position=destination;actorDepth=destDepth;
      motion='idle';
      if(attacking&&time>=nextBiteAt){
        facing=destination<=target.x?3:1;
        biteStarted=time;biteTarget=target.id;biteLanded=false;rending=!!rendingNext;
        nextBiteAt=time+Math.max(.5,biteInterval/Math.max(1,attackSpeed));motion='bite';idleSince=null;
      }
      return null;
    }
    // Called after the hero's scene-exit displacement has been rendered.
    // Keep the wolf moving in the SAME direction and at the same pace,
    // without teleporting it across the arena at the instant of victory.
    function followExit({heroX,heroDepth=3}={}){
      // A fallen wolf must not be dragged along by the scene-exit escort.
      if(!active()||!Number.isFinite(heroX)||position===null||motion==='die')return false;
      if(exitHeroX!==null)position+=Math.max(0,heroX-exitHeroX);
      exitHeroX=heroX;skill=null;clearEffect();
      actorDepth=heroDepth;facing=3;motion='walk';engaged=false;
      biteStarted=null;biteTarget=null;biteLanded=false;
      idleSince=null;
      return true;
    }
    function render({time=0,x=0,heroSize=64,depth=3,laneStep=0,moving=false,
      direction=3,action=null,actionAge=0,reducedMotion=false,alive=true,bond=0,fury=false,rendingNext=false}={}){
      if(!element||!canvas||!image||!active()||(!alive&&action!=='die')){
        clearEffect();clearPower();if(element)element.hidden=true;
        return false;
      }
      element.hidden=false;
      const size=Math.max(48,heroSize);
      element.style.left=`${position??(x-size*.83)}px`;
      element.style.setProperty('--lane-offset',`${((position===null?depth:actorDepth)-3)*laneStep}px`);
      // Equal-depth enemies formerly covered the wolf by one z-index.
      // Keep the biting wolf just in front so its muzzle stays visible.
      const layer=Math.round(100+((position===null?depth:actorDepth)-1)*100);
      element.style.zIndex=String(layer+(engaged?6:-1));
      const face=position===null?direction:facing;
      const activeSkill=alive&&!action&&!reducedMotion&&skill&&time-skill.at<skillDuration[skill.mode]?skill:null;
      const animation=action||activeSkill?.mode||(position===null?(moving?'walk':'idle'):motion);
      if(animation!=='idle'){idleSince=null;}
      else if(idleSince===null||time<idleSince){idleSince=time;}
      const idleAge=idleSince===null?0:Math.max(0,time-idleSince);
      const cycle=idleAge>=5?(idleAge-5)%10:-1;
      const howl=animation==='idle'&&!engaged&&!reducedMotion&&cycle>=0&&cycle<.75;
      const mode=howl?'howl':animation;
      const age=action?Math.max(0,actionAge):activeSkill?Math.max(0,time-activeSkill.at):
        mode==='bite'&&biteStarted!==null?Math.max(0,time-biteStarted):
        howl?cycle:time;
      const rect=frameAt(age,mode==='walk'||mode==='run',reducedMotion,face,mode);
      if(alive&&(bond||fury||rendingNext||rending&&mode==='bite'))loadSkillArt();
      const special=!reducedMotion&&mode==='bite'&&rending&&!!rendImage;
      const rendFrame=age<biteImpact?Math.min(2,Math.floor(age/biteImpact*3)):Math.min(7,3+Math.floor((age-biteImpact)/(biteDuration-biteImpact)*5));
      const key=special?`rend:${rendFrame}:${face}`:`${rect.sx}:${rect.sy}:${rect.sh}`;
      if(lastKey!==key){
        const ctx=canvas.getContext('2d');
        canvas.width=special?96:tile;canvas.height=tile;
        ctx.imageSmoothingEnabled=false;
        ctx.clearRect(0,0,canvas.width,tile);
        if(canvas.style){canvas.style.width=special?'150%':'100%';canvas.style.marginLeft=special?'-25%':'';canvas.style.transform=special&&face===1?'scaleX(-1)':'';}
        if(special)ctx.drawImage(rendImage,rendFrame*96,0,96,64,0,0,96,64);
        else ctx.drawImage(image,rect.sx,rect.sy,rect.sw,rect.sh,rect.dx,rect.dy,rect.dw,rect.dh);
        lastKey=key;
      }
      const effectMode=!reducedMotion&&alive&&(mode==='howl'||mode==='revive')?mode:null;
      if(effectMode&&canvasFactory){
        if(!fx){
          fx=canvasFactory();fx.width=128;fx.height=96;fx.className='wolf-skill-fx';
          fx.style.position='absolute';fx.style.width='200%';fx.style.height='150%';
          fx.style.left='-50%';fx.style.top='-25%';fx.style.pointerEvents='none';
          fx.style.imageRendering='pixelated';fx.style.filter='none';fx.style.zIndex='1';
          fx.setAttribute?.('aria-hidden','true');element.appendChild(fx);
        }
        paintEffect(fx.getContext('2d'),effectMode,age,face);
      }else clearEffect();
      // The approved red energy frames are an independent raster layer over the
      // original wolf: no new collision size, no interruption of pursuit or bite.
      const powerActive=alive&&!action&&!effectMode&&(bond>0||fury);
      if(powerActive&&powerImage&&canvasFactory){
        if(!powerFx){powerFx=canvasFactory();powerFx.width=96;powerFx.height=64;powerFx.className='wolf-power-fx';Object.assign(powerFx.style,{position:'absolute',left:'-25%',top:'0',width:'150%',height:'100%',pointerEvents:'none',imageRendering:'pixelated',filter:'none',zIndex:'1'});powerFx.setAttribute?.('aria-hidden','true');element.appendChild(powerFx);}
        if(bond!==lastBond||bondSince===null)bondSince=time;
        if(fury&&!lastFury)furySince=time;
        if(!fury)furySince=null;
        const ctx=powerFx.getContext('2d');ctx.clearRect(0,0,96,64);ctx.imageSmoothingEnabled=false;
        if(bond>0){const frame=reducedMotion?5:Math.min(5,Math.floor(Math.max(0,time-bondSince)*7));ctx.globalAlpha=.25+.15*Math.min(5,bond);ctx.drawImage(powerImage,(8+frame)*96,0,96,64,0,0,96,64);}
        if(fury){const frame=reducedMotion?7:Math.min(7,Math.floor(Math.max(0,time-(furySince??time))*12));ctx.globalAlpha=1;ctx.drawImage(powerImage,frame*96,0,96,64,0,0,96,64);if(mode==='bite'&&!reducedMotion)ctx.drawImage(powerImage,(3+Math.min(3,Math.floor(age*12)))*96,0,96,64,0,0,96,64);}
        ctx.globalAlpha=1;powerFx.style.transform=face===1?'scaleX(-1)':'';lastBond=bond;lastFury=fury;
      }else clearPower();
      element.dataset.wolfBond=alive?String(bond):'0';element.dataset.wolfFury=String(alive&&fury);element.dataset.wolfRending=String(special);
      element.dataset.skillEffect=effectMode||'';
      element.dataset.motion=rect.mode;
      element.dataset.facing=face===1?'left':'right';
      return true;
    }
    function paintPreview(ctx,pose){
      if(!image||!active()||!ctx)return false;
      const row=pose?.row??2;
      // Original forward/backward wolf cells are only 23×63, packed every
      // 32px. Side cells are 64×40. Preserve their aspect ratios.
      if(row===0||row===2){
        const sx=row===0?163:5;
        ctx.drawImage(image,sx,65,23,63,44,30,12,30);
      }else{
        const sy=row===1?248:56;
        ctx.drawImage(image,320,sy,64,40,35,40,29,18);
      }
      return true;
    }
    return Object.freeze({load,loaded,reset,placeFallen,startSkill,advance,followExit,render,paintPreview,
      getPose:()=>({x:position,depth:actorDepth,facing,motion,engaged,biteStarted,biteTarget})});
  }
  return Object.freeze({path,sprite,contact,strips,frameAt,skillDuration,paintEffect,recolorCarryPixels,recolorCarryAtlas,create});
});
