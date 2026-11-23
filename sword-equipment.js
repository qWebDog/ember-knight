/* Complete LPC sword+shield sprites, with the original weapon removed.
 * These files are produced by scripts/build-equipment-variants.py from the
 * official pinned LPC source and exactly match the starter animation layout.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberSwordEquipment=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const poses=Object.freeze({walk:{frames:9,tile:64},attack:{frames:6,tile:128},
    halfslash:{frames:6,tile:128},backslash:{frames:13,tile:128},block:{frames:1,tile:64}});
  const skinIds=Object.freeze(['light','amber','olive','bronze','brown','black']);
  const colors=Object.freeze(['sand','forest','blue','red','purple','gray']);
  const swordIds=Object.freeze(['basic','steel','ember']);
  const shieldIds=Object.freeze(['basic','steel','royal']);
  function isDefault(look){return look?.weapon==='basic'&&look?.shield==='basic';}
  function path({skin,color,look,pose,standardPath}){
    if(!skinIds.includes(skin)||!colors.includes(color)||!swordIds.includes(look?.weapon)
        ||!shieldIds.includes(look?.shield)||!Object.hasOwn(poses,pose)){
      throw new TypeError('Invalid LPC weapon/shield appearance');
    }
    if(isDefault(look))return standardPath(pose);
    return 'assets/equipment/sword-packs/'+color+'/'+skin+'-'+look.weapon+'-'+look.shield+'-'+pose+'.png';
  }
  function create({skin,color,loadImage,standardPath}={}){
    if(typeof loadImage!=='function'||typeof standardPath!=='function')throw new TypeError('loadImage and standardPath required');
    const cache=new Map();
    function load(look){
      const key=[look?.weapon,look?.shield].join('/');
      if(!swordIds.includes(look?.weapon)||!shieldIds.includes(look?.shield))return Promise.reject(Error('Invalid sword/shield choice'));
      if(cache.has(key))return cache.get(key);
      const pending=Promise.all(Object.entries(poses).map(async ([pose,geometry])=>{
        const url=path({skin,color,look,pose,standardPath});
        const image=await loadImage(url);
        const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
        if(width!==geometry.frames*geometry.tile||height!==4*geometry.tile){
          throw Error('Invalid LPC sword/shield sheet: '+url+' '+width+'x'+height);
        }
        return [pose,image];
      })).then(entries=>Object.fromEntries(entries)).catch(error=>{cache.delete(key);throw error;});
      cache.set(key,pending);
      return pending;
    }
    function peek(look){return cache.get([look?.weapon,look?.shield].join('/'))||null;}
    return Object.freeze({load,peek,path:(look,pose)=>path({skin,color,look,pose,standardPath})});
  }
  return Object.freeze({create,isDefault,path,poses,swordIds,shieldIds});
});