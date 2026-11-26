/* Original LPC wolf animation by Stephen "Redshrike" Challener,
 * contributed by William.Thompsonj, licensed CC BY 4.0.
 * https://opengameart.org/content/lpc-wolf-animation
 * The original wolf.png is preserved for attribution and rollback.
 * Active gray wolf uses the approved generated art, normalized to the same crop geometry.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberCompanion=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const path='assets/companions/wolf-gray.png',tile=64;
  const sprite=Object.freeze({width:640,height:384,tile});
  // Shared with the battlefield movement and enemy range check.
  // Keep the wolf's head outside even a 2x Orc sprite when biting.
  const contact=Object.freeze({enemy:.56,companion:.18});
  // The atlas retains the previous 10×6 layout of cropped animation strips:
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
  function create({element,store,loadImage,canvasFactory}={}){
    const canvas=element?.querySelector?.('canvas')||null;
    let image=null,inflight=null,lastKey=null,idleSince=null;
    let position=null,actorDepth=3,facing=3,motion='idle',engaged=false;
    let biteStarted=null,biteTarget=null,biteLanded=false,nextBiteAt=0;
    let exitHeroX=null,skill=null,fx=null;
    const biteImpact=3/12, biteDuration=5/12, biteInterval=1.25, biteDamage=7;
    const active=()=>store?.classId==='bow'&&store?.getState()?.companion==='wolf';
    function loaded(){return Boolean(image);}
    function clearEffect(){if(fx){fx.remove?.();fx=null;}}
    function reset(){
      skill=null;clearEffect();
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
        if(asset.width!==sprite.width||asset.height!==sprite.height)throw new Error('Unexpected gray wolf atlas geometry');
        image=asset;lastKey=null;return asset;
      }).catch(error=>{inflight=null;throw error;});
      return inflight;
    }
    // The caller supplies authoritative enemy coordinates from the same
    // snapshot the Archer fires at. This controller only decides pursuit,
    // bite-frame timing and when to request an engine-confirmed hit.
    function advance({dt=0,time=0,phase='running',entering=false,heroAlive=true,companionAlive=true,
      heroX=0,anchorX=null,heroSize=64,heroDepth=3,target=null,
      exiting=false,reducedMotion=false,attackSpeed=1}={}){
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
        biteStarted=time;biteTarget=target.id;biteLanded=false;
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
      direction=3,action=null,actionAge=0,reducedMotion=false,alive=true}={}){
      if(!element||!canvas||!image||!active()||(!alive&&action!=='die')){
        clearEffect();if(element)element.hidden=true;
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
      const key=`${rect.sx}:${rect.sy}:${rect.sh}`;
      if(lastKey!==key){
        const ctx=canvas.getContext('2d');
        canvas.width=tile;canvas.height=tile;
        ctx.imageSmoothingEnabled=false;
        ctx.clearRect(0,0,tile,tile);
        ctx.drawImage(image,rect.sx,rect.sy,rect.sw,rect.sh,
          rect.dx,rect.dy,rect.dw,rect.dh);
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
      element.dataset.skillEffect=effectMode||'';
      element.dataset.motion=rect.mode;
      element.dataset.facing=face===1?'left':'right';
      return true;
    }
    function paintPreview(ctx,pose){
      if(!image||!active()||!ctx)return false;
      const row=pose?.row??2;
      // Approved atlas contains lateral views only; retain the same wolf
      // silhouette in all equipment portraits instead of using the old animal.
      const sy=row===0||row===1?248:56;
      ctx.drawImage(image,320,sy,64,40,35,40,29,18);
      return true;
    }
    return Object.freeze({load,loaded,reset,placeFallen,startSkill,advance,followExit,render,paintPreview,
      getPose:()=>({x:position,depth:actorDepth,facing,motion,engaged,biteStarted,biteTarget})});
  }
  return Object.freeze({path,sprite,contact,strips,frameAt,skillDuration,paintEffect,create});
});
