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
  // Muzzle coordinates in the *original 205×161 frame*, measured from
  // the left/top of the left-facing atlas cell (not from the fighter box).
  // Different wing/attack frames shift the dragon's head slightly.
  const muzzleLeft=Object.freeze([
    [40,91],[42,91],[39,94],[37,96],
    [39,94],[40,96],[39,94],[41,92],
    [40,92],[40,91],[38,94],[38,96],
    [39,94],[40,92],[39,91],[40,94]
  ].map(Object.freeze));
  function mouthAt(canvasRect,frame){
    if(!canvasRect||!Number.isFinite(canvasRect.left)||!Number.isFinite(canvasRect.top)
      ||!Number.isFinite(canvasRect.width)||!Number.isFinite(canvasRect.height))
      throw new TypeError('Visible dragon canvas rectangle is required');
    const id=Math.min(15,Math.max(0,Math.floor(frame?.frame||0)));
    const p=muzzleLeft[id];
    // Source artwork faces left in combat. Recompute the origin every frame
    // from the rendered canvas bounds, so the flame tracks the moving jaw,
    // responsive scaling and slight vertical hovering.
    const left=frame?.direction==='right';
    return {
      x:canvasRect.left+(left?sheet.frameWidth-p[0]:p[0])*
        canvasRect.width/sheet.frameWidth,
      y:canvasRect.top+p[1]*canvasRect.height/sheet.frameHeight
    };
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
  return Object.freeze({path,sheets,sheet,muzzleLeft,load,frameAt,mouthAt,draw});
});
