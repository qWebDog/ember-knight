'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const folder=path.resolve(__dirname,'../dist/assets/magic');

// Read the delivered RGBA atlas without browser/image-library dependencies.
// Pixel alpha matters here: an opaque ice center would hide the character.
function rgbaPng(file){
 const png=fs.readFileSync(file),data=[];let width,height;
 assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
 for(let at=8;at<png.length;){const length=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8),chunk=png.subarray(at+8,at+8+length);
  if(type==='IHDR'){width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);assert.equal(chunk[8],8);assert.equal(chunk[9],6);assert.equal(chunk[12],0,'noninterlaced RGBA');}
  if(type==='IDAT')data.push(chunk);at+=length+12;
 }
 const raw=zlib.inflateSync(Buffer.concat(data)),stride=width*4,pixels=Buffer.alloc(width*height*4);let at=0;
 function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
 for(let y=0;y<height;y++){const filter=raw[at++];assert.ok(filter>=0&&filter<=4);
  for(let x=0;x<stride;x++){const pos=y*stride+x,left=x>=4?pixels[pos-4]:0,up=y?pixels[pos-stride]:0,ul=y&&x>=4?pixels[pos-stride-4]:0;
   pixels[pos]=(raw[at++]+(filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,ul)))&255;
  }
 }
 assert.equal(at,raw.length);return {width,height,pixels,alpha:(x,y)=>pixels[(y*width+x)*4+3],png};
}

test('status sheet preserves six complete fire/ice cells and real transparent ice interiors',()=>{
 const metadata=JSON.parse(fs.readFileSync(path.join(folder,'status-effects.json'),'utf8'));
 const atlas=rgbaPng(path.join(folder,metadata.file));
 assert.deepEqual([atlas.width,atlas.height],[2172,724]);
 assert.deepEqual([metadata.columns,metadata.rows,metadata.frameWidth,metadata.frameHeight],[6,2,362,362]);
 assert.equal(metadata.duration,.5);assert.equal(metadata.loop,false);
 assert.equal(metadata.effects.fire.row,0);assert.equal(metadata.effects.ice.row,1);
 assert.equal(metadata.effects.ice.recommendedCanvasOpacity,.65);
 for(let row=0;row<2;row++)for(let frame=0;frame<6;frame++){
  for(const [x,y]of[[0,0],[361,0],[0,361],[361,361]])assert.equal(atlas.alpha(frame*362+x,row*362+y),0,'cell corners retain transparent padding');
 }
 for(const frame of[2,3]){
  const alpha=atlas.alpha(frame*362+181,362+181);
  assert.ok(alpha>0&&alpha<255,`peak ice cell${frame} has genuine partial alpha`);
  const effective=alpha/255*metadata.effects.ice.recommendedCanvasOpacity;
  assert.ok(effective<.65,'the rendered peak does not fully cover the fighter');
 }
 assert.equal(crypto.createHash('sha256').update(atlas.png).digest('hex'),metadata.provenance.sha256,'metadata identifies the exact supplied PNG');
});
