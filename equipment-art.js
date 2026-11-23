/* Lightweight pixel-art cosmetics aligned to the current LPC pose.
 * The original LPC sheet stays intact, which keeps existing attack animation timing.
 * In production these paint operations can be replaced with native per-pose item atlases.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberEquipmentArt=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function rect(ctx,c,x,y,w,h){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),w,h);}
  function poly(ctx,c,coords){
    ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(coords[0],coords[1]);
    for(let i=2;i<coords.length;i+=2)ctx.lineTo(coords[i],coords[i+1]);
    ctx.closePath();ctx.fill();
  }
  function withPose(ctx,pose,draw){
    if(!pose||!ctx||!pose.equipped)return;
    ctx.save();
    ctx.translate(pose.origin||0,pose.origin||0);
    const f=pose.frame||0;
    const walking=pose.kind==='walk';
    const bob=walking && [2,5,6].includes(f)?-1:0;
    ctx.translate(0,bob);
    const face=pose.row===1?-1:1;
    if(face===-1){ctx.translate(64,0);ctx.scale(-1,1);}
    draw(face);
    ctx.restore();
  }
  function drawBack(ctx,pose){
    withPose(ctx,pose,()=>{
      const cape=pose.equipped.cape;
      if(cape==='none'||!['red','purple'].includes(cape))return;
      const main=cape==='red'?'#913946':'#634b91';
      const edge=cape==='red'?'#d2766a':'#a38fd1';
      const shade=cape==='red'?'#442638':'#302a55';
      // The back half must go underneath the native character, not over the sword.
      poly(ctx,'#182127',[22,26,38,26,46,47,43,57,20,57,16,45]);
      poly(ctx,main,[24,27,37,27,44,47,40,55,22,55,18,45]);
      poly(ctx,shade,[23,31,28,33,25,51,21,54,19,44]);
      rect(ctx,edge,36,32,2,21);rect(ctx,edge,28,52,8,2);
    });
  }
  function drawFront(ctx,pose){
    withPose(ctx,pose,()=>{
      const gear=pose.equipped;
      const facing=pose.row===3||pose.row===1;
      // Greaves: leave the native gait visible between separated plates.
      if(gear.boots==='iron'||gear.boots==='royal'){
        const metal=gear.boots==='iron'?'#91acb7':'#987c45';
        const bright=gear.boots==='iron'?'#dce7e6':'#efc86f';
        for(const x of [26,35]){
          rect(ctx,'#273238',x,48,7,8);rect(ctx,metal,x+1,48,5,7);
          rect(ctx,bright,x+1,49,4,1);rect(ctx,'#30383d',x,55,8,2);
          rect(ctx,bright,x+1,54,5,1);
        }
      }
      // Chest plate and shoulder caps. Distinct from the head/weapon.
      if(gear.armor==='iron'||gear.armor==='royal'){
        const royal=gear.armor==='royal';
        const dark=royal?'#342f35':'#384b51',steel=royal?'#66717c':'#8dabb5';
        const highlight=royal?'#e6bb61':'#d6e4e4';
        rect(ctx,'#20282a',25,29,17,14);
        rect(ctx,dark,26,30,15,12);rect(ctx,steel,28,30,11,11);
        rect(ctx,highlight,29,31,8,2);rect(ctx,dark,32,34,3,8);
        rect(ctx,highlight,28,41,11,2);
        for(const x of [22,39]){rect(ctx,'#25343b',x,29,5,6);rect(ctx,steel,x+1,29,4,4);rect(ctx,highlight,x+2,29,2,1);}
        if(royal){rect(ctx,'#e7b75e',25,35,2,6);rect(ctx,'#e7b75e',40,35,2,6);rect(ctx,'#ead18c',33,35,1,4);}
      }
      // Helmet optionally covers the hair while preserving directional animation.
      if(gear.helmet==='iron'||gear.helmet==='royal'){
        const royal=gear.helmet==='royal';
        const base=royal?'#56535b':'#627b85';
        const shine=royal?'#ecc06b':'#c8dce2';
        rect(ctx,'#1e2932',24,12,18,11);
        rect(ctx,base,25,12,16,9);rect(ctx,shine,27,12,12,2);
        rect(ctx,base,23,17,4,8);rect(ctx,base,40,17,4,8);
        rect(ctx,'#243238',26,21,15,2);
        if(facing){rect(ctx,'#213038',37,19,5,6);rect(ctx,shine,40,19,2,1);}
        else {rect(ctx,'#1e2b32',29,21,9,2);rect(ctx,shine,31,17,1,3);}
        if(royal){rect(ctx,'#c58f43',24,16,18,2);rect(ctx,shine,32,8,2,7);rect(ctx,'#f2d68d',34,9,5,2);}
      }
      // Engraved shield face. Base shield remains exactly the native LPC layer.
      if(gear.shield==='steel'||gear.shield==='royal'){
        const royal=gear.shield==='royal';
        const bx=facing?17:37,by=32;
        poly(ctx,'#202b33',[bx,by,bx+11,by,bx+13,by+6,bx+9,by+19,bx+5,by+22,bx+1,by+16]);
        poly(ctx,royal?'#b7874c':'#8eacb7',[bx+2,by+2,bx+10,by+2,bx+11,by+7,bx+8,by+17,bx+5,by+19,bx+3,by+15]);
        rect(ctx,royal?'#383949':'#465e67',bx+5,by+5,3,11);
        rect(ctx,royal?'#f0c76d':'#e0ebee',bx+3,by+5,6,2);
        if(royal){rect(ctx,'#e8b963',bx+5,by+9,3,3);rect(ctx,'#f4db84',bx+6,by+8,1,5);}
      }
      // Weapon accent follows the current row/animation frame.
      // Full weapon replacement needs native LPC weapon animation sheets.
      if(gear.weapon==='steel'||gear.weapon==='ember'){
        const ember=gear.weapon==='ember',metal=ember?'#edb169':'#d9ebeb';
        const handX=facing?48:41,handY=39;
        const attack=pose.kind==='attack';
        const angles=attack?[[-11,-10],[-14,-8],[-10,-15],[-7,-19],[-1,-19],[5,-15],[8,-8]]:[[10,-13]];
        const v=angles[Math.min(pose.frame||0,angles.length-1)];
        const dx=v[0],dy=v[1];
        for(let t=0;t<=10;t++){
          const x=handX+Math.round(dx*t/11),y=handY+Math.round(dy*t/11);
          rect(ctx,'#324148',x,y,3,3);rect(ctx,metal,x+1,y,1,2);
        }
        rect(ctx,ember?'#ef7039':'#d2d5aa',handX-2,handY-2,5,2);
        rect(ctx,ember?'#ffc461':'#9c7e50',handX,handY,2,5);
        if(ember){rect(ctx,'#ff9e3e',handX+dx,handY+dy,2,3);}
      }
      if(gear.cape!=='none'){
        rect(ctx,gear.cape==='red'?'#dc7771':'#a98dca',25,28,3,5);
        rect(ctx,gear.cape==='red'?'#5b293c':'#46375d',39,27,2,6);
      }
    });
  }
  return Object.freeze({drawBack,drawFront});
});
