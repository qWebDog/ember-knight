/* Archer airborne countershot: native equipped LPC upper-body pixels plus new 64px leg poses. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberArcherDodge=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const cache=new WeakMap();
  const poses=[
    [0,0,0,null],
    [1,-1,3,[[29,51,25,55,23,59],[34,51,39,54,35,59]]],
    [4,-5,1,[[29,49,25,54,20,58],[34,49,39,53,43,57]]],
    [5,-6,-4,[[29,44,23,49,21,54],[34,44,39,48,44,51]]],
    [8,-6,-7,[[29,41,23,46,25,51],[34,41,40,45,35,49]]],
    [9,-4,-6,[[29,42,22,47,18,53],[34,42,37,47,32,51]]],
    [9,-2,-3,[[29,45,23,51,18,58],[34,45,38,50,41,55]]],
    [1,2,4,[[29,52,23,55,19,59],[34,52,39,55,35,59]]],
    [0,1,2,[[29,50,27,55,25,59],[34,50,37,54,35,58]]],
    [0,0,0,null]
  ];
  function build(attack,canvasFactory=()=>document.createElement('canvas')){
    if(cache.has(attack))return cache.get(attack);
    const atlas=canvasFactory();atlas.width=640;atlas.height=64;
    const ctx=atlas.getContext('2d');ctx.imageSmoothingEnabled=false;
    const native=canvasFactory();native.width=native.height=64;
    const nc=native.getContext('2d',{willReadFrequently:true});nc.imageSmoothingEnabled=false;
    const frame=canvasFactory();frame.width=frame.height=64;
    const fc=frame.getContext('2d');fc.imageSmoothingEnabled=false;
    function stroke(x0,y0,x1,y1,width,color){
      fc.fillStyle=color;let dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1,err=dx+dy;
      for(;;){fc.fillRect(x0-Math.floor(width/2),y0-Math.floor(width/2),width,width);if(x0===x1&&y0===y1)break;const e=2*err;if(e>=dy){err+=dy;x0+=sx;}if(e<=dx){err+=dx;y0+=sy;}}
    }
    function leg(p,front){
      const [hx,hy,kx,ky,ax,ay]=p,mid=front?'#2a3034':'#1c2222',hi=front?'#4a5057':'#2a3034';
      stroke(hx,hy,kx,ky,front?8:7,'#000');stroke(kx,ky,ax,ay,front?8:7,'#000');
      stroke(hx,hy,kx,ky,front?6:5,mid);stroke(kx,ky,ax,ay,5,mid);
      stroke(hx+1,hy,kx+1,ky,2,hi);stroke(kx+1,ky,ax+1,ay-1,1,hi);
      fc.fillStyle='#000';fc.fillRect(ax-3,ay-3,6,6);fc.fillRect(ax,ay,7,3);
      fc.fillStyle='#2a3034';fc.fillRect(ax-2,ay-2,4,4);fc.fillRect(ax+1,ay,5,2);
      if(front){fc.fillStyle='#4a5057';fc.fillRect(ax+1,ay,4,1);}
    }
    for(let i=0;i<poses.length;i++){
      const [source,lean,dy,legs]=poses[i];nc.clearRect(0,0,64,64);fc.clearRect(0,0,64,64);
      nc.drawImage(attack,source*64,192,64,64,0,0,64,64);
      if(!legs){ctx.drawImage(native,i*64,0);continue;}
      const image=nc.getImageData(0,0,64,64),data=image.data;
      for(let y=49;y<64;y++)for(let x=y<56?24:22;x<(y<56?39:41);x++){
        const k=(y*64+x)*4,rr=data[k],gg=data[k+1],bb=data[k+2];
        if(y<57&&x>=35&&((rr>gg&&gg>bb&&rr>65)||(rr>120&&gg>120&&bb>120)))continue;
        data[k+3]=0;
      }
      nc.putImageData(image,0,0);
      leg(legs[0],false);leg(legs[1],true);
      for(let y=0;y<64;y++){
        const dx=Math.round(lean*Math.min(1,Math.max(0,(49-y)/14)));
        if(y+dy>=0&&y+dy<64)fc.drawImage(native,0,y,64,1,dx,y+dy,64,1);
      }
      ctx.drawImage(frame,i*64,0);
    }
    atlas.src='dodge:'+attack.src;const descriptor={image:atlas,row:0,tile:64,origin:0,frames:10};
    cache.set(attack,descriptor);return descriptor;
  }
  function frameAt(age,timing){
    let t=Math.max(0,age);
    for(let i=0;i<timing.frames.length;i++){if(t<timing.frames[i]-1e-7)return i;t-=timing.frames[i];}
    return timing.frames.length-1;
  }
  function offset(age,timing){
    const i=frameAt(age,timing),start=timing.frames.slice(0,i).reduce((a,b)=>a+b,0);
    const p=Math.max(0,Math.min(1,(age-start)/timing.frames[i]));
    const a=timing.offsets[i],b=timing.offsets[Math.min(i+1,9)];
    return (a+(b-a)*p)/48;
  }
  // Skill atlases are raster compositions of the current equipped LPC sheet.
  // Each clip maps to ONE engine release; no extra damage or fake projectiles.
  const skillCache=new WeakMap();
  const clips={
    doubleShot:{frames:[0,1,2,4,5,6,7,8,9,10,11,12],release:8},
    arrowRain:{frames:[0,1,4,5,7,8,9,11,12],release:6},
    dance0:{frames:[0,1,4,8,9,12],release:4},
    dance1:{frames:[1,4,8,9,12],release:3},
    dance2:{frames:[0,1,5,8,9,12],release:4}
  };
  function buildSkills(attack,canvasFactory=()=>document.createElement('canvas')){
    if(skillCache.has(attack))return skillCache.get(attack);
    const canvas=(w,h)=>{const c=canvasFactory();c.width=w;c.height=h;c.getContext('2d').imageSmoothingEnabled=false;return c;};
    const native=canvas(64,64),nc=native.getContext('2d',{willReadFrequently:true});
    const work=canvas(64,64),wc=work.getContext('2d');
    function drawPose(ctx,frame,col,tilt,lean){
      nc.clearRect(0,0,64,64);nc.drawImage(attack,frame*64,192,64,64,0,0,64,64);
      if(!tilt&&!lean){ctx.drawImage(native,col*64,0);return;}
      // Pixel-nearest upper-body rotation, around the waist. Preserve every
      // equipped pixel and never resample colors or use a generic substitute.
      if(tilt){
        const src=nc.getImageData(0,0,64,64),dst=wc.getImageData(0,0,64,64),data=dst.data;
        data.fill(0);
        const a=tilt*Math.PI/180,c=Math.cos(a),t=Math.sin(a),cx=32,cy=47;
        for(let y=48;y<64;y++)for(let x=0;x<64;x++){const j=(y*64+x)*4;data.set(src.data.subarray(j,j+4),j);}
        for(let y=0;y<64;y++)for(let x=0;x<64;x++){
          const u=Math.round(cx+(x-cx)*c+(y-cy)*t),v=Math.round(cy-(x-cx)*t+(y-cy)*c);
          if(u<0||u>=64||v<0||v>=48)continue;
          const i=(v*64+u)*4,j=(y*64+x)*4;if(src.data[i+3])data.set(src.data.subarray(i,i+4),j);
        }
        wc.putImageData(dst,0,0);ctx.drawImage(work,col*64,0);
      }else{
        for(let y=0;y<64;y++){
          const dx=Math.round(lean*Math.max(0,Math.min(1,(58-y)/24)));
          ctx.drawImage(native,0,y,64,1,col*64+dx,y,64,1);
        }
      }
    }
    const descriptors={};
    for(const [name,clip] of Object.entries(clips)){
      const atlas=canvas(clip.frames.length*64,64),ctx=atlas.getContext('2d');
      const tilt=[0,-8,-18,-32,-37,-37,-37,-12,0];
      const dance=name.startsWith('dance'),lean=dance?(name==='dance1'?-2:2):0;
      for(let i=0;i<clip.frames.length;i++){
        drawPose(ctx,clip.frames[i],i,name==='arrowRain'?tilt[i]:0,dance?Math.round(lean*Math.sin(i/(clip.frames.length-1)*Math.PI)):0);
      }
      atlas.src='archer-skill:'+name+':'+attack.src;
      descriptors[name]={image:atlas,row:0,tile:64,origin:0,frames:clip.frames.length,releaseFrame:clip.release,skill:name};
    }
    skillCache.set(attack,descriptors);return descriptors;
  }
  function skillName(shot){
    return shot.rainIndex?'arrowRain':shot.double?'doubleShot':shot.dance?('dance'+((shot.danceIndex||0)%3)):null;
  }
  return Object.freeze({build,frameAt,offset,buildSkills,skillName});
});