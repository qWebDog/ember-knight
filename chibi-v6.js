/* EMBER 6: one bare body, five genuinely independent equipment layers per class. */
(function(root){
'use strict';
const names={sword:'knight',bow:'archer',wand:'mage',knight:'knight',archer:'archer',mage:'mage'};
const rows=[2,3,0,1],groundY=63,slots=['helmet','armor','cape','weapon','shield'];
const skinNames={light:'light',amber:'light',olive:'medium',bronze:'medium',brown:'medium',black:'dark',medium:'medium',dark:'dark'};
const defaults=Object.fromEntries(['knight','archer','mage'].map(n=>[n,Object.fromEntries(slots.map(s=>[s,'basic']))]));
const colors={sand:'#b5a07d',forest:'#648449',blue:'#5678b6',red:'#b44a43',purple:'#8656a6',gray:'#929ba5'};
const cache=new Map(),tints=new WeakMap(),bowLimbs=new WeakMap(),icons=new WeakMap();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const path=n=>'assets/characters/chibi-v6/'+n+'.png';
function load(id,loadImage,skin='light'){
 const name=names[id]||'knight',tone=skinNames[skin]||'light',key=name+'/'+tone;
 if(!cache.has(key))cache.set(key,Promise.all([['body','base-'+tone],...slots.map(s=>[s,name+'-'+s])].map(async([slot,n])=>{
  const im=await loadImage(path(n));if((im.naturalWidth||im.width)!==256||(im.naturalHeight||im.height)!==256)throw Error('Invalid atlas '+n);
  return [slot,im];
 })).then(e=>({name,tone,images:Object.fromEntries(e)})).catch(e=>{cache.delete(key);throw e;}));
 return cache.get(key);
}
function tinted(im,dye){
 const color=colors[dye];if(!color)return im;
 let m=tints.get(im);if(!m)tints.set(im,m=new Map());if(m.has(color))return m.get(color);
 const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(im,0,0);
 const d=g.getImageData(0,0,256,256),a=d.data,t=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
 for(let i=0;i<a.length;i+=4){if(!a[i+3])continue;const l=.213*a[i]+.715*a[i+1]+.072*a[i+2];if(l<30)continue;for(let j=0;j<3;j++)a[i+j]=clamp(Math.round(.2*a[i+j]+.8*t[j]*l/135),0,255);}
 g.putImageData(d,0,0);m.set(color,c);return c;
}
function bowLimb(im){
 if(bowLimbs.has(im))return bowLimbs.get(im);
 const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');g.drawImage(im,0,0);
 // Remove only the original string pixels; leave limb and tips untouched.
 for(let row=0;row<4;row++)for(let col=0;col<4;col++)for(let y=28;y<=53;y++){
  const x=row===3?63-(y<=40?47:46):(y<=40?47:46);
  g.clearRect(col*64+x,row*64+y,1,1);
 }
 bowLimbs.set(im,c);return c;
}
function line(g,x0,y0,x1,y1,color,width=1){
 g.fillStyle=color;const n=Math.max(1,Math.ceil(Math.max(Math.abs(x1-x0),Math.abs(y1-y0))));
 for(let i=0;i<=n;i++)g.fillRect(Math.round(x0+(x1-x0)*i/n),Math.round(y0+(y1-y0)*i/n),width,width);
}
function swingTrail(g,sign,px,py,a,b){
 // Short stepped pixel arc, drawn only during the actual cut.
 const start=(a-53)*Math.PI/180,end=(b-53)*Math.PI/180;
 for(let i=0;i<16;i++){
  const t=i/16,u=(i+1)/16,v=start+(end-start)*t,w=start+(end-start)*u;
  const r=31;
  line(g,px+sign*r*Math.cos(v),py+r*Math.sin(v),px+sign*r*Math.cos(w),py+r*Math.sin(w),i<10?'#8c9fb3':'#d7e6ed',i<10?1:2);
 }
}
// Eight discrete poses: anticipation, wind-up, contact, follow-through, recovery.
const swings={
 basic:[0,-24,-55,-80,12,70,34,0],slash:[0,-24,-55,-80,12,70,34,0],
 halfslash:[0,-12,-35,-48,18,42,21,0],backslash:[0,24,62,95,10,-40,-20,0],
 swordThrust:[0,-14,-22,-15,54,54,24,0],swordOverhead:[0,-25,-62,-98,-55,45,74,0],
 swordDouble:[0,-60,35,75,-45,-72,50,0],swordCleave:[0,-50,-85,-110,0,80,100,0]
};
const shieldMove=[0,1,3,5,6,4,2,0],wandAngles=[0,-15,-32,-50,-22,12,8,0];
function draw(ctx,hero,opts={}){
 if(!hero)return;
 const {direction=3,kind='idle',phase=0,frame=0,x=0,y=0,size=64,look={},dyes={},bare=false,variant='basic',releaseFraction=9/13}=opts;
 const row=rows[direction===0?2:direction]??1,col=kind==='walk'?((Math.floor(frame)%4+4)%4):0,scale=size/64,sign=direction===1?-1:1;
 const p=clamp(Number(phase)||0,0,.999999),k=Math.floor(p*8),eq={...defaults[hero.name],...look};
 const has=s=>!bare&&eq[s]!=='none';
 const crouch=kind==='dodge'?[0,1,3,4,4,2,1,0][k]:0;
 const shift=kind==='dodge'?-sign*[0,1,2,4,4,3,1,0][k]:kind==='attack'&&hero.name==='knight'?sign*[0,-1,-2,-1,2,3,1,0][k]:kind==='bash'?sign*shieldMove[k]:0;
 ctx.save();ctx.imageSmoothingEnabled=false;ctx.translate(x+shift*scale,y);ctx.scale(scale,scale);
 if(crouch){ctx.translate(0,groundY);ctx.scale(1,(64-crouch)/64);ctx.translate(0,-groundY);}
 function layer(slot,ox=0,oy=0,angle=0,px=32,py=53,mirror=false){
  const im=tinted(hero.images[slot],dyes[slot]);if(!im)return;
  ctx.save();ctx.translate(px+ox,py+oy);if(angle)ctx.rotate(angle*Math.PI/180);if(mirror)ctx.scale(-1,1);ctx.translate(-px,-py);
  ctx.drawImage(im,col*64,row*64,64,64,0,0,64,64);ctx.restore();
 }
 if(has('cape'))layer('cape');
 if(has('shield')&&hero.name==='archer')layer('shield');
 layer('body');
 if(has('armor'))layer('armor');
 if(has('helmet'))layer('helmet');
 if(has('shield')&&hero.name==='mage')layer('shield');
 if(has('weapon')){
  const side=direction===1,px=side?16:48;
  if(kind==='attack'&&hero.name==='knight'){
   const angles=swings[variant]||swings.basic,ext=variant==='swordThrust'?[0,-2,-3,0,6,6,2,0][k]:0;
   if(k>=4&&k<=5)swingTrail(ctx,sign,px+sign*ext,54,angles[k-1],angles[k]);
   layer('weapon',sign*ext,0,sign*angles[k],px,54);
  }else if(kind==='attack'&&hero.name==='mage'){
   layer('weapon',0,-[0,1,2,3,3,1,0,0][k],sign*wandAngles[k],px,53);
   if(k>=2&&k<=4){const xx=side?12:52,yy=30-k;ctx.fillStyle='#70b7f1';ctx.fillRect(xx-1,yy-3,3,7);ctx.fillRect(xx-3,yy-1,7,3);ctx.fillStyle='#e0f6ff';ctx.fillRect(xx,yy,1,1);}
  }else if(kind==='attack'&&hero.name==='archer'){
   const before=p<releaseFraction,draw=before?Math.round(10*Math.min(1,p/Math.max(.01,releaseFraction))):0;
   const original=hero.images.weapon,limbs=bowLimb(original),stringX=side?16:47,nock=stringX-sign*draw;
   ctx.save();ctx.translate(px,42);if(variant==='arrowRain')ctx.rotate(sign*-30*Math.PI/180);ctx.translate(-px,-42);
   ctx.drawImage(limbs,col*64,row*64,64,64,0,0,64,64);
   line(ctx,stringX,27,nock,40,'#d8c69a');line(ctx,nock,40,stringX-sign,54,'#d8c69a');
   if(before){
    const tip=nock+sign*25;
    line(ctx,nock,40,tip,40,'#b8a075');
    line(ctx,tip-sign*2,39,tip,40,'#e2e8e6');line(ctx,tip,40,tip-sign*2,41,'#e2e8e6');
    line(ctx,nock,39,nock+sign*3,39,'#eee4d2');
   }
   ctx.restore();
  }else layer('weapon');
 }
 if(has('shield')&&hero.name==='knight'){
  const raise=kind==='block'||kind==='bash'?shieldMove[k]:0;
  layer('shield',sign*raise,-Math.ceil(raise/2),sign*(kind==='bash'?raise*2:0),direction===1?44:20,49);
 }
 ctx.restore();
}
function drawItem(ctx,hero,slot,item='basic',dye='original'){
 if(item==='none'||!hero?.images[slot])return false;
 const im=tinted(hero.images[slot],dye);
 let icon=icons.get(im);if(!icon){
  const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d',{willReadFrequently:true});
  g.drawImage(im,0,64,64,64,0,0,64,64);const a=g.getImageData(0,0,64,64).data;
  let x0=64,y0=64,x1=-1,y1=-1;
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(a[(y*64+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  const w=x1-x0+1,h=y1-y0+1;if(w<=0||h<=0)return false;
  icon={c,x0,y0,w,h};icons.set(im,icon);
 }
 const {c,x0,y0,w,h}=icon,scale=Math.min(2,52/Math.max(w,h));
 ctx.imageSmoothingEnabled=false;ctx.drawImage(c,x0,y0,w,h,Math.round((64-w*scale)/2),Math.round((64-h*scale)/2),Math.round(w*scale),Math.round(h*scale));return true;
}
function carry(hero,wolf,dead,canvasFactory,opts={}){
 const c=canvasFactory();c.width=1024;c.height=128;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
 for(let i=0;i<8;i++){draw(ctx,hero,{...opts,direction:3,kind:i>=5?'walk':'idle',frame:i-4,x:i*128+32,y:32});ctx.drawImage(wolf,dead.sx,dead.sy,dead.sw,dead.sh,i*128+[58,56,53,50,48,48,48,48][i],[63,63,61,53,47,46,47,46][i],64,32);}
 c.src='chibi-v6-wolf-carry';return c;
}
root.EmberChibiHeroes={load,draw,drawItem,carry,defaults,rows,skinNames,groundY};
})(typeof window==='object'?window:globalThis);