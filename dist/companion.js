/* Original LPC wolf animation by Stephen "Redshrike" Challener,
 * contributed by William.Thompsonj, licensed CC BY 4.0.
 * Source: https://opengameart.org/content/lpc-wolf-animation
 * All original pixels retained in assets/companions/wolf.png.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberCompanion=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const path='assets/companions/wolf.png',tile=64;
  const sprite={width:640,height:384,tile};
  // Right-side 64×64 frames in the original six-row sheet. The first
  // horizontal movement strip is animated left to right.
  function frameAt(time,moving=false,reducedMotion=false){
    const frame=moving&&!reducedMotion?Math.floor(Math.max(0,time)*8)%5:0;
    return {sx:(5+frame)*tile,sy:0,sw:tile,sh:tile};
  }
  function create({element,store,loadImage}={}){
    const canvas=element?.querySelector?.('canvas')||null;
    let image=null,inflight=null,lastKey=null;
    function loaded(){return Boolean(image);}
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
    function render({time=0,x=0,heroSize=64,depth=3,laneStep=0,moving=false,reducedMotion=false,alive=true}={}){
      if(!element||!canvas||!image||store?.getState()?.companion!=='wolf'||!alive){
        if(element)element.hidden=true;return false;
      }
      element.hidden=false;
      const size=Math.max(48,heroSize);
      element.style.left=`${x-size*.83}px`;
      element.style.setProperty('--lane-offset',`${(depth-3)*laneStep}px`);
      element.style.zIndex=String(Math.round(100+(depth-1)*100-1));
      const rect=frameAt(time,moving,reducedMotion);
      const key=`${rect.sx}:${rect.sy}`;
      if(lastKey!==key){
        const ctx=canvas.getContext('2d');
        canvas.width=tile;canvas.height=tile;
        ctx.imageSmoothingEnabled=false;
        ctx.clearRect(0,0,tile,tile);
        ctx.drawImage(image,rect.sx,rect.sy,tile,tile,0,0,tile,tile);
        lastKey=key;
      }
      return true;
    }
    function paintPreview(ctx,pose){
      if(!image||store?.getState()?.companion!=='wolf'||!ctx)return false;
      // Front/back poses are drawn from the original left-half wolf rows.
      const row=pose?.row??2;
      const sx=row===0||row===2?0:320;
      const sy=row===0?128:0;
      ctx.drawImage(image,sx,sy,tile,tile,40,36,24,24);
      return true;
    }
    return Object.freeze({load,loaded,render,paintPreview});
  }
  return Object.freeze({path,sprite,frameAt,create});
});
