'use strict';
const {chromium,webkit}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../dist'),mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
const visibleCanvas=id=>{const c=document.getElementById(id);return !!c&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v);};
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const url='http://127.0.0.1:'+server.address().port;
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch();try{
   for(const cls of ['sword','bow','wand']){
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
    const errors=[],legacy=[],motion=new Set();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/assets\/characters\/(?!chibi-v6\/)|\/assets\/equipment\/icons\//.test(r.url()))legacy.push(r.url());});
    await page.route('https://telegram.org/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
    await page.goto(url+'/create-chibi-v6.html');await page.waitForFunction(()=>document.querySelector('#hero').dataset.spriteState==='chibi');
    await page.locator('[data-skin="brown"]').tap();await page.waitForFunction(()=>document.querySelector('#hero').dataset.spriteState==='chibi');
    await page.locator('#create-button').tap();await page.waitForFunction(()=>[...document.querySelectorAll('[data-weapon] canvas')].every(c=>c.dataset.spriteState==='chibi'));
    await page.locator('[data-weapon="'+cls+'"]').tap();await page.waitForFunction(id=>document.querySelector('#hero').dataset.heroClass===id&&document.querySelector('#hero').dataset.spriteState==='chibi',cls);
    await page.locator('#create-button').tap();await page.waitForFunction(()=>document.querySelector('#hero').dataset.spriteState==='chibi'&&!document.querySelector('#create-button').disabled);
    await page.locator('#create-button').tap();await page.locator('#start-adventure').tap();await page.waitForURL('**/game-chibi-v6.html');
    await page.waitForFunction(visibleCanvas,'player-sprite',{timeout:25000});
    await page.waitForFunction(()=>document.querySelector('[data-fighter="hero"]').dataset.motion==='attack',undefined,{timeout:25000});
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('ember.character.v1')));assert.equal(saved.weapon,cls);
    await page.locator('#profile-button').tap();await page.locator('[data-equipment-slot="helmet"]').tap();
    assert.equal(await page.locator('[data-equipment-item]').count(),2);
    await page.locator('[data-equipment-item="none"]').tap();await page.waitForFunction(()=>document.querySelector('[data-equipment-item="none"]')?.getAttribute('aria-pressed')==='true');
    assert.ok(await page.evaluate(visibleCanvas,'equipment-preview'));
    await page.locator('[data-equipment-item="basic"]').tap();await page.waitForFunction(()=>document.querySelector('[data-equipment-item="basic"]')?.getAttribute('aria-pressed')==='true');
    assert.deepEqual(legacy,[],engine.name()+' '+cls+' legacy assets');assert.deepEqual(errors,[],engine.name()+' '+cls+' runtime errors');
    await page.screenshot({path:'/tmp/chibi-v6-'+engine.name()+'-'+cls+'.png'});await page.close();
    console.log(engine.name(),cls,'creator, actual PvE attack, modular equipment OK');
   }
  }finally{await browser.close();}
 }}finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});