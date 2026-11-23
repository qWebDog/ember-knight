/* LPC clothing dyes. Transform only the selected original layer, never the
 * whole hero/sword sheet. Preserve source alpha and four-direction geometry.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberEquipmentDye=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const palette=Object.freeze([
    Object.freeze({id:'original',name:'Оригинальный',hex:'#a7a397'}),
    Object.freeze({id:'sand',name:'Песочный',hex:'#c4a371'}),
    Object.freeze({id:'forest',name:'Зелёный',hex:'#5f956a'}),
    Object.freeze({id:'blue',name:'Синий',hex:'#577fc5'}),
    Object.freeze({id:'red',name:'Красный',hex:'#bd5962'}),
    Object.freeze({id:'purple',name:'Фиолетовый',hex:'#9867c3'}),
    Object.freeze({id:'gray',name:'Серый',hex:'#97a4ac'})
  ]);
  const allowed=Object.freeze(['helmet','armor','cape']);
  const ids=new Set(palette.map(item=>item.id));
  function valid(color){return ids.has(color);}
  function create({canvasFactory}={}){
    if(typeof canvasFactory!=='function')throw new TypeError('A Canvas factory is required');
    const cache=new WeakMap();
    function apply(image,color){
      if(color==='original'||!valid(color))return image;
      let variants=cache.get(image);
      if(!variants){variants=new Map();cache.set(image,variants);}
      if(variants.has(color))return variants.get(color);
      const canvas=canvasFactory(),w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
      if(!w||!h||!canvas?.getContext)throw new Error('Invalid native LPC dye source');
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw new Error('LPC dye renderer unavailable');
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(image,0,0);
      const pixels=ctx.getImageData(0,0,w,h);
      const paint=palette.find(c=>c.id===color).hex;
      const rgb=[1,3,5].map(i=>parseInt(paint.slice(i,i+2),16));
      const d=pixels.data;
      for(let i=0;i<d.length;i+=4){
        if(!d[i+3])continue;
        // Preserve directional shading and exact original alpha.
        const y=(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2])/255;
        const f=.42+y*.91;
        for(let j=0;j<3;j++)d[i+j]=Math.max(0,Math.min(255,Math.round(rgb[j]*f)));
      }
      ctx.putImageData(pixels,0,0);
      canvas.src='lpc-dye:'+color+':'+(image.src||'layer');
      variants.set(color,canvas);
      return canvas;
    }
    return Object.freeze({apply});
  }
  return Object.freeze({palette,allowed,valid,create});
});