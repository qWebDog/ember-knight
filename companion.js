/* Original LPC wolf animation by Stephen "Redshrike" Challener,
 * contributed by William.Thompsonj, licensed CC BY 4.0.
 * https://opengameart.org/content/lpc-wolf-animation
 * Original 640×384 sprite sheet is preserved without pixel modification.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberCompanion=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const path='assets/companions/wolf.png',tile=64;
  const sprite=Object.freeze({width:640,height:384,tile});
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
  function frameAt(time,moving=false,reducedMotion=false,direction=3,action=null){
    const side=direction===1?'left':'right';
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
  function create({element,store,loadImage}={}){
    const canvas=element?.querySelector?.('canvas')||null;
    let image=null,inflight=null,lastKey=null,idleSince=null;
    let position=null,actorDepth=3,facing=3,motion='idle',engaged=false;
    let biteStarted=null,biteTarget=null,biteLanded=false,nextBiteAt=0;
    const biteImpact=3/12, biteDuration=5/12, biteInterval=1.25, biteDamage=7;
    const active=()=>store?.classId==='bow'&&store?.getState()?.companion==='wolf';
    function loaded(){return Boolean(image);}
    function reset(){
      position=null;actorDepth=3;facing=3;motion='idle';engaged=false;
      idleSince=null;biteStarted=null;biteTarget=null;biteLanded=false;nextBiteAt=0;
      lastKey=null;
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
    function advance({dt=0,time=0,phase='running',entering=false,heroAlive=true,
      heroX=0,heroSize=64,heroDepth=3,target=null,reducedMotion=false}={}){
      if(!active()||!image||!Number.isFinite(heroX)){
        if(position!==null)reset();
        return null;
      }
      const size=Math.max(48,heroSize),home=heroX-size*.83;
      if(position===null){position=home;actorDepth=heroDepth;facing=3;motion='idle';}
      if(!heroAlive||phase==='defeat'){motion='die';return null;}
      if(entering){
        // The hero enters each wave over ~2.5 seconds; the wolf walks in
        // beside them and never strikes before the battle clock starts.
        position=home;actorDepth=heroDepth;facing=3;motion='walk';engaged=false;
        biteStarted=null;biteTarget=null;biteLanded=false;return null;
      }
      if(phase==='paused')return null;
      const attacking=phase==='running'&&target&&Number.isFinite(target.x)&&Number.isFinite(target.width)
        &&target.hp>0;
      const destination=attacking?target.x-(target.width*.32+size*.18):home;
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
        nextBiteAt=time+biteInterval;motion='bite';idleSince=null;
      }
      return null;
    }
    function render({time=0,x=0,heroSize=64,depth=3,laneStep=0,moving=false,
      direction=3,action=null,actionAge=0,reducedMotion=false,alive=true}={}){
      if(!element||!canvas||!image||!active()||(!alive&&action!=='die')){
        if(element)element.hidden=true;
        return false;
      }
      element.hidden=false;
      const size=Math.max(48,heroSize);
      element.style.left=`${position??(x-size*.83)}px`;
      element.style.setProperty('--lane-offset',`${((position===null?depth:actorDepth)-3)*laneStep}px`);
      element.style.zIndex=String(Math.round(100+((position===null?depth:actorDepth)-1)*100-1));
      const face=position===null?direction:facing;
      const animation=action||(position===null?(moving?'walk':'idle'):motion);
      if(animation!=='idle'){idleSince=null;}
      else if(idleSince===null||time<idleSince){idleSince=time;}
      const idleAge=idleSince===null?0:Math.max(0,time-idleSince);
      const cycle=idleAge>=5?(idleAge-5)%10:-1;
      const howl=animation==='idle'&&!engaged&&!reducedMotion&&cycle>=0&&cycle<.75;
      const mode=howl?'howl':animation;
      const age=action?Math.max(0,actionAge):
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
    return Object.freeze({load,loaded,reset,advance,render,paintPreview,
      getPose:()=>({x:position,depth:actorDepth,facing,motion,engaged,biteStarted,biteTarget})});
  }
  return Object.freeze({path,sprite,strips,frameAt,create});
});
