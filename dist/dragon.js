/* Red Dragon sprite by Buko Studios, commissioned for PlayCraft.
 * Original upload: ZaPaper, CC BY 3.0.
 * https://opengameart.org/content/red-dragon
 * Four unmodified 820×644 PNG sheets with LPC-oriented flying poses.
 */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EmberDragon=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const path='assets/enemies/dragon/';
  const sheets=Object.freeze({
    right:path+'reddragonfly.png',front:path+'reddragonfly2.png',
    left:path+'reddragonfly3.png',back:path+'reddragonfly4.png'
  });
  const sheet=Object.freeze({width:820,height:644,columns:4,rows:4,frameWidth:205,frameHeight:161});
  async function load(loadImage){
    if(typeof loadImage!=='function')throw new TypeError('Image loader is required');
    const entries=await Promise.all(Object.entries(sheets).map(async ([direction,url])=>{
      const image=await loadImage(url);
      if(image.width!==sheet.width||image.height!==sheet.height)
        throw new Error('Unexpected Red Dragon LPC sheet dimensions: '+direction);
      return [direction,image];
    }));
    return Object.fromEntries(entries);
  }
  function frameAt(time=0,kind='fly',direction='left',reducedMotion=false){
    const facing=Object.hasOwn(sheets,direction)?direction:'left';
    const age=Math.max(0,Number.isFinite(time)?time:0);
    const normalized=reducedMotion?'idle':['fly','attack','hit'].includes(kind)?kind:'idle';
    let index;
    if(normalized==='fly')index=Math.floor(age*9)%8;
    else if(normalized==='attack')index=12+Math.min(3,Math.floor(age*9));
    else if(normalized==='hit')index=9+Math.min(2,Math.floor(age*12));
    else index=2;
    return {direction:facing,kind:normalized,frame:index,sx:index%4*sheet.frameWidth,
      sy:Math.floor(index/4)*sheet.frameHeight,sw:sheet.frameWidth,sh:sheet.frameHeight};
  }
  function draw(ctx,images,frame){
    if(!ctx||!images?.[frame.direction])return false;
    const image=images[frame.direction];
    ctx.imageSmoothingEnabled=false;
    ctx.clearRect(0,0,sheet.frameWidth,sheet.frameHeight);
    ctx.drawImage(image,frame.sx,frame.sy,frame.sw,frame.sh,
      0,0,sheet.frameWidth,sheet.frameHeight);
    return true;
  }
  return Object.freeze({path,sheets,sheet,load,frameAt,draw});
});
