/* Assemble original Universal LPC Archer and Mage layers by z-order.
 * No fixed-position item drawings or superimposed old weapon copies.
 * Compositing happens ONLY when equipment changes, not on every frame.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberClassEquipment=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const base='assets/equipment/class-layers/';
  const poses=Object.freeze({
    bow:Object.freeze({walk:Object.freeze({frames:9,tile:128}),attack:Object.freeze({frames:13,tile:64})}),
    wand:Object.freeze({walk:Object.freeze({frames:9,tile:64}),attack:Object.freeze({frames:6,tile:64})})
  });
  const classIds=Object.freeze(['bow','wand']);
  const skins=Object.freeze(['light','amber','olive','bronze','brown','black']);
  const colors=Object.freeze(['sand','forest','blue','red','purple','gray']);
  const choices=Object.freeze({
    helmet:Object.freeze(['basic','iron','royal']),
    armor:Object.freeze(['basic','iron','royal']),
    weapon:Object.freeze(['basic','steel','ember']),
    shield:Object.freeze(['basic','steel','royal']),
    cape:Object.freeze(['tattered','solid'])
  });
  function check(classId,skin,color,look,pose){
    if(!classIds.includes(classId)||!skins.includes(skin)||!colors.includes(color)
      ||!Object.prototype.hasOwnProperty.call(poses[classId],pose)
      ||Object.entries(choices).some(([slot,ids])=>!ids.includes(look?.[slot]))){
      throw new TypeError('Invalid ranged or magic LPC equipment selection');
    }
  }
  function isDefault(look,dyes={}){return Object.entries(choices).every(([slot,ids])=>(look?.[slot]||(slot==='cape'?'tattered':null))===ids[0])&&['helmet','armor','cape'].every(slot=>!dyes[slot]||dyes[slot]==='original');}
  function paths({classId,skin,color,look,pose,dyes={}}){
    check(classId,skin,color,look,pose);
    const folder=base+classId+'/';
    const core=part=>folder+'base/'+color+'/'+skin+'/'+pose+'-'+part+'.png';
    const helmet=folder+'helmet/'+look.helmet+'/'+color+'/'+pose+'.png';
    const armor=look.armor==='basic'
      ?(dyes.armor&&dyes.armor!=='original'?[folder+'armor/basic/'+color+'/'+pose+'.png']:[])
      :[folder+'armor/'+look.armor+'/'+pose+'.png'];
    const cape=look.cape||'tattered';
    const capeBack=cape==='none'?[]:[folder+'cape/'+cape+'/'+color+'/'+pose+'-back.png'];
    const capeFront=cape==='none'?[]:[folder+'cape/'+cape+'/'+color+'/'+pose+'-front.png'];
    const item=folder+'weapon/'+look.weapon+'/'+pose;
    const accessory=folder+'shield/'+look.shield+'/'+pose+'.png';
    if(classId==='bow')return [
      item+'-back.png',accessory,...capeBack,core('under'),...armor,core('middle'),
      ...capeFront,core('head'),helmet,item+'-front.png'
    ];
    return [
      ...capeBack,core('under'),...armor,core('middle'),...capeFront,accessory,
      core('head'),helmet,item+'-front.png'
    ];
  }
  function create({classId,skin,color,loadImage,standardPath,canvasFactory,dye}={}){
    if(!classIds.includes(classId)||typeof loadImage!=='function'
      ||typeof standardPath!=='function'||typeof canvasFactory!=='function'){
      throw new TypeError('Class-specific LPC compositor dependencies missing');
    }
    const cache=new Map();
    async function buildPose(look,pose,key,dyes){
      const meta=poses[classId][pose],width=meta.frames*meta.tile,height=4*meta.tile;
      if(isDefault(look,dyes)){
        const image=await loadImage(standardPath(pose));
        const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
        if(w!==width||h!==height)throw new Error('Invalid original LPC '+classId+'/'+pose);
        return image;
      }
      const sources=paths({classId,skin,color,look,pose,dyes});
      const parts=await Promise.all(sources.map(async path=>{
        const image=await loadImage(path);
        const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
        if(w!==width||h!==height)throw new Error('Incompatible LPC layer: '+path+' ('+w+'x'+h+')');
        const slot=path.includes('/helmet/')?'helmet':path.includes('/armor/')?'armor':path.includes('/cape/')?'cape':null;
        return slot&&dyes?.[slot]&&dyes[slot]!=='original'&&dye?dye.apply(image,dyes[slot]):image;
      }));
      const canvas=canvasFactory();
      if(!canvas||typeof canvas.getContext!=='function')throw new Error('Canvas unavailable');
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');
      if(!ctx)throw new Error('Canvas 2D unavailable');
      ctx.imageSmoothingEnabled=false;
      for(const image of parts)ctx.drawImage(image,0,0);
      // Actor's existing last-frame cache compares image.src.
      canvas.src='composed-lpc:'+classId+'/'+color+'/'+skin+'/'+key+'/'+pose;
      return canvas;
    }
    function load(look,dyes={}){
      const safe={helmet:look?.helmet,armor:look?.armor,weapon:look?.weapon,shield:look?.shield,cape:look?.cape||'tattered'};
      check(classId,skin,color,safe,'walk');
      const key=Object.values(safe).join('/')+'#'+['helmet','armor','cape'].map(slot=>dyes[slot]||'original').join('/');
      if(!cache.has(key)){
        const pending=Promise.all(['walk','attack'].map(async pose=>[pose,await buildPose(safe,pose,key,dyes)]))
          .then(entries=>Object.fromEntries(entries)).catch(error=>{cache.delete(key);throw error;});
        cache.set(key,pending);
      }
      return cache.get(key);
    }
    return Object.freeze({load,paths:look=>Object.fromEntries(Object.keys(poses[classId]).map(pose=>[pose,paths({classId,skin,color,look,pose})])),isDefault});
  }
  return Object.freeze({create,paths,isDefault,poses,choices});
});
