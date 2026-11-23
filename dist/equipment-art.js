/* Native Universal LPC equipment: frame-matched walk, slash, halfslash,
 * backslash and combat_idle layers. No invented pixels or pose offsets.
 * The original 64x64 LPC cells are centered in the game's oversized
 * 128x128 sword-attack cells using the same origin as build-loadouts.py.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberEquipmentArt=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const directory='assets/equipment/lpc/';
  const frameSize=64, rows=4;
  const lengths=Object.freeze({walk:9,slash:6,halfslash:6,backslash:13,combat_idle:1});
  const variants=Object.freeze({
    helmet:Object.freeze(['iron','royal']),
    armor:Object.freeze(['iron','royal'])
  });
  function poseAnimation(pose){
    if(pose?.kind==='block')return 'combat_idle';
    if(pose?.kind==='attack')return ['slash','halfslash','backslash'].includes(pose.variant)?pose.variant:'slash';
    return 'walk';
  }
  function imagePath(slot,id,animation){
    if(!variants[slot]?.includes(id)||!Object.prototype.hasOwnProperty.call(lengths,animation))return null;
    return directory+slot+'/'+id+'/'+animation+'.png';
  }
  function validateSprite(image,path,animation){
    if(!image||image.naturalWidth===0||image.naturalHeight===0)throw new Error('Invalid LPC image: '+path);
    const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
    if(width<lengths[animation]*frameSize||height!==rows*frameSize||width%frameSize!==0){
      throw new Error('Incompatible LPC animation sheet: '+path+' ('+width+'x'+height+')');
    }
    return image;
  }
  function create({loadImage}={}){
    if(typeof loadImage!=='function')throw new TypeError('loadImage is required');
    const cache=new Map();
    function load(slot,id,animation){
      const path=imagePath(slot,id,animation);
      if(!path)return Promise.reject(new Error('Unsupported LPC item: '+slot+'/'+id));
      if(!cache.has(path)){
        const promise=Promise.resolve().then(()=>loadImage(path)).then(img=>validateSprite(img,path,animation))
          .catch(error=>{cache.delete(path);throw error;});
        cache.set(path,promise);
      }
      return cache.get(path);
    }
    async function ensureLook(equipped){
      const jobs=[];
      for(const slot of Object.keys(variants)){
        const id=equipped?.[slot];
        if(!variants[slot].includes(id))continue;
        for(const animation of Object.keys(lengths))jobs.push(load(slot,id,animation));
      }
      await Promise.all(jobs);
    }
    const resolved=new Map();
    async function ensure(slot,id){
      if(!variants[slot]?.includes(id))return;
      const items=await Promise.all(Object.keys(lengths).map(async animation=>{
        const img=await load(slot,id,animation);
        return [imagePath(slot,id,animation),img];
      }));
      for(const [path,img]of items)resolved.set(path,img);
    }
    async function prepareLook(equipped){
      await Promise.all(Object.keys(variants).map(slot=>ensure(slot,equipped?.[slot])));
    }
    function draw(ctx,pose){
      if(!ctx||!pose||!pose.equipped)return 0;
      const animation=poseAnimation(pose);
      const row=pose.row,frame=pose.frame;
      if(!Number.isInteger(row)||row<0||row>=rows||!Number.isInteger(frame)||frame<0)return 0;
      const tile=pose.tile||64,origin=Number.isFinite(pose.origin)?pose.origin:(tile-frameSize)/2;
      if(tile<frameSize||origin<0||origin+frameSize>tile)return 0;
      const col=Math.min(frame,lengths[animation]-1);
      let count=0;
      // Original helmet and chest plates use native LPC animation cells.
      // These sprite layers overlay the current merged character image.
      for(const slot of ['armor','helmet']){
        const id=pose.equipped[slot],path=imagePath(slot,id,animation);
        if(!path)continue;
        const image=resolved.get(path);
        if(!image)continue;
        ctx.drawImage(image,col*frameSize,row*frameSize,frameSize,frameSize,origin,origin,frameSize,frameSize);
        count++;
      }
      return count;
    }
    return Object.freeze({draw,ensure,prepareLook,ensureLook,poseAnimation,imagePath,loaded:()=>resolved.size});
  }
  return Object.freeze({create,poseAnimation,imagePath,lengths});
});
