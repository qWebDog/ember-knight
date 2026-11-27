'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const dist=path.resolve(__dirname,'../dist');
const read=name=>fs.readFileSync(path.join(dist,name),'utf8');
const html=read('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
const css=['game.css','skills.css','equipment.css','talents.css'].map(read).join('\n');
const ids=['swordThrust','swordOverhead','swordDouble','swordCleave','swordMaster'];
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
   for(const [width,height] of [[390,844],[375,667],[390,600],[320,568],[390,500],[844,390]]){
    const page=await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:true,deviceScaleFactor:1});
    try{
     await page.setContent(html);
     await page.addStyleTag({content:css});
     await page.addScriptTag({content:read('progression.js')});
     await page.addScriptTag({content:read('skills-ui.js')});
     await page.evaluate(height=>{
      document.documentElement.style.setProperty('--app-height',height+'px');
      const data=new Map([['ember.progress.v1',JSON.stringify({version:1,gold:1000,levels:{power:3,swordThrust:3,swordOverhead:3}})]]);
      const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
      window.browserStore=window.EmberProgression.createStore({storage,classId:'sword'});
      window.EmberSkillPanel.mount({root:document.querySelector('#skills-panel'),store:window.browserStore,classId:'sword'});
     },height);
     for(const id of ['power',...ids]){
      const loc=page.locator('[data-skill-id="'+id+'"]');assert.equal(await loc.count(),1);
      if(height<560||width>height)await loc.scrollIntoViewIfNeeded();
      const p=await loc.boundingBox();
      assert.ok(p&&p.width>0&&p.height>0,engine.name()+' '+width+'x'+height+' '+id+' invisible');
      const x=p.x+p.width/2,y=p.y+p.height/2;
      const actual=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-skill-id]')?.dataset.skillId,{x,y});
      assert.equal(actual,id,engine.name()+' '+width+'x'+height+' '+id+' obstructed');
      await page.touchscreen.tap(x,y);
      assert.equal(await page.locator('#skills-panel').getAttribute('data-selected'),id);
      if(id!=='power'){
       assert.equal(await page.locator('#skill-upgrade').isEnabled(),true);
       const before=await page.evaluate(id=>window.browserStore.quote(id).level,id);
       const button=page.locator('#skill-upgrade');const b=await button.boundingBox();assert.ok(b);
       await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);
       assert.equal(await page.evaluate(id=>window.browserStore.quote(id).level,id),before+1);
      }
     }
     console.log(engine.name(),width+'x'+height,'all five touch targets and purchases OK');
    }finally{await page.close();}
   }
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
