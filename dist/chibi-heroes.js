/* Independent chibi equipment atlases. No combat statistics or timing here. */
(function(root){
  'use strict';
  const names={sword:'knight',bow:'archer',wand:'mage',knight:'knight',archer:'archer',mage:'mage'};
  const rows=[2,3,0,1], slots=['armor','cape','helmet','shield','weapon'], skinNames={light:'light',amber:'light',olive:'medium',bronze:'medium',brown:'medium',black:'dark',medium:'medium',dark:'dark'};
  const colors={sand:'#b5a07d',forest:'#648449',blue:'#5678b6',red:'#b44a43',purple:'#8656a6',gray:'#929ba5'};
  const defaults={knight:{armor:'basic',cape:'tattered',helmet:'iron',shield:'basic',weapon:'basic'},archer:{armor:'basic',cape:'tattered',helmet:'basic',shield:'basic',weapon:'basic'},mage:{armor:'basic',cape:'tattered',helmet:'basic',shield:'basic',weapon:'basic'}};
  const cache=new Map(),tints=new WeakMap(),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function load(id,loadImage,skin='light'){
    const name=names[id]||'knight',tone=skinNames[skin]||'light',key=name+'/'+tone;
    if(!cache.has(key))cache.set(key,Promise.all(['body-'+tone,'bare-'+tone,...slots].map(async part=>{
      const im=await loadImage('assets/characters/chibi/'+name+'/'+part+'.png?v=modular-3');
      if((im.naturalWidth||im.width)!==256||(im.naturalHeight||im.height)!==256)throw Error('Invalid chibi atlas '+name+'/'+part);
      return [part.replace(/-(light|medium|dark)$/,''),im];
    })).then(entries=>({name,tone,images:Object.fromEntries(entries)})).catch(e=>{cache.delete(key);throw e;}));
    return cache.get(key);
  }
  function tinted(im,color){
    if(!color||color==='original')return im;
    let map=tints.get(im);if(!map)tints.set(im,map=new Map());if(map.has(color))return map.get(color);
    const c=document.createElement('canvas');c.width=256;c.height=256;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);
    const img=ctx.getImageData(0,0,256,256),a=img.data,target=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
    for(let i=0;i<a.length;i+=4){if(a[i+3]===0)continue;const l=.2126*a[i]+.7152*a[i+1]+.0722*a[i+2];if(l<27)continue;
      // Maintain outlines, lightness and material detail while changing hue.
      const f=l/145;for(let j=0;j<3;j++)a[i+j]=clamp(Math.round(.22*a[i+j]+.78*(f*target[j]+Math.max(0,l-175)*.55)),0,255);
    }
    ctx.putImageData(img,0,0);map.set(color,c);return c;
  }
  function layerColor(name,slot,item,colorsBySlot){
    if(colors[colorsBySlot?.[slot]])return colors[colorsBySlot[slot]];
    if(!item||item===defaults[name][slot])return null;
    if(slot==='helmet')return item==='royal'?'#c5a766':name==='mage'?'#5777be':'#a6b1bb';
    if(slot==='armor')return item==='royal'?'#a4b0b9':name==='mage'?'#8a674c':'#777f86';
    if(slot==='cape')return item==='solid'?'#986d9e':null;
    if(slot==='weapon')return item==='ember'?'#d9aa42':name==='archer'?'#69503f':'#b8d1e2';
    if(slot==='shield')return item==='royal'?'#b05243':'#819bad';return null;
  }
  function draw(ctx,hero,opts={}){
    if(!hero)return;const {direction=3,kind='idle',phase=0,frame=0,x=0,y=0,size=64,look={},dyes={},bare=false}=opts;
    const p=clamp(Number(phase)||0,0,1),wave=Math.sin(Math.PI*p),right=direction===1?-1:1;
    const col=kind==='walk'?((Math.floor(frame)%4+4)%4):0,row=rows[direction]??1,scale=size/64;
    const equipped={...defaults[hero.name],...look};let dx=0,dy=0,angle=0;
    if(kind==='attack'){dx=right*2*wave;angle=right*.06*wave;}
    else if(kind==='block'){dx=-right*2*wave;angle=-right*.07*wave;}
    else if(kind==='dodge'){dx=-right*5*wave;angle=-right*.18*wave;}
    else if(kind==='idle'){dy=-Math.min(1,Math.max(0,frame));}
    ctx.save();ctx.imageSmoothingEnabled=false;ctx.translate(x+size/2+dx*scale,y+58*scale+dy*scale);ctx.rotate(angle);ctx.scale(scale,scale);ctx.translate(-32,-58);
    const layer=(part,im,offsetX=0,offsetY=0,rotation=0,pivotX=32,pivotY=43)=>{
      if(!im)return;ctx.save();ctx.translate(pivotX+offsetX,pivotY+offsetY);if(rotation)ctx.rotate(rotation);ctx.translate(-pivotX,-pivotY);ctx.drawImage(im,col*64,row*64,64,64,0,0,64,64);ctx.restore();
    };
    // The bare body is a reconstructed, unclothed oval; the dressed body keeps
    // the original visible face and the concealed base under the equipment.
    layer('body',hero.images[bare||equipped.helmet==='none'?'bare':'body']);
    if(!bare){
      for(const slot of slots){if(equipped[slot]==='none')continue;
        const im=tinted(hero.images[slot],layerColor(hero.name,slot,equipped[slot],dyes));
        let ox=0,oy=0,rot=0,px=32,py=43;
        if(slot==='weapon'&&kind==='attack'){
          px=direction===1?23:41;py=44;
          if(hero.name==='knight')rot=right*(-.55*Math.sin(p*Math.PI*2));
          else if(hero.name==='mage'){rot=right*-.24*wave;oy=-3*wave;}
          else {rot=right*-.12*wave;ox=-right*2*wave;}
        }
        if(slot==='shield'&&hero.name==='knight'&&kind==='block'){ox=right*4*wave;oy=-3*wave;}
        layer(slot,im,ox,oy,rot,px,py);
      }
    }
    ctx.restore();
  }
  function carry(hero,wolf,dead,canvasFactory,opts={}){
    const atlas=canvasFactory();atlas.width=8*128;atlas.height=128;
    const ctx=atlas.getContext('2d');ctx.imageSmoothingEnabled=false;
    const crouch=[0,6,9,5,0,0,0,0],wolfX=[58,56,53,50,48,48,48,48],wolfY=[63,63,61,53,47,46,47,46];
    for(let i=0;i<8;i++){
      draw(ctx,hero,{...opts,direction:3,kind:i>=5?'walk':'idle',frame:i-4,x:i*128+32,y:32+crouch[i]});
      ctx.drawImage(wolf,dead.sx,dead.sy,dead.sw,dead.sh,i*128+wolfX[i],wolfY[i],64,32);
    }
    atlas.src='chibi-modular-wolf-carry';return atlas;
  }
  root.EmberChibiHeroes={load,draw,carry,rows,defaults,skinNames};
})(typeof window==='object'?window:globalThis);
