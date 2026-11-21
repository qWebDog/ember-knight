from pathlib import Path
from PIL import Image,ImageColor,ImageDraw,ImageFont
import json,urllib.request,concurrent.futures,hashlib,shutil
REV='86a3719ee4a7e2e9fb27c7c152e29a741d3e930a'; BASE=f'https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/{REV}/'
PROJECT=Path(__file__).resolve().parents[1]
ROOT=PROJECT/'dist/assets/characters/loadouts'; CACHE=PROJECT/'.cache/lpc'
CACHES=[CACHE,Path('/workspace/scratch/sword-common/source'),Path('/workspace/scratch/sword-outfit-sources'),Path('/workspace/scratch/wand-source'),ROOT/'bow/source',Path('/workspace/sites/ember-knight/dist/assets/characters/combat/source')]
def source(p):
 for r in CACHES:
  if (r/p).is_file():return r/p
 q=CACHE/p;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(urllib.request.urlopen(BASE+p,timeout=25).read());return q
cloth=json.load(open(source('palette_definitions/cloth/cloth_ulpc.json'))); body=json.load(open(source('palette_definitions/body/body_ulpc.json')))
def read(p):return Image.open(source(p)).convert('RGBA')
def recolor(im,material,color,base=None):
 pal=body if material=='body' else cloth
 base=base or ('light' if material=='body' else 'white')
 if not color or base==color:return im
 mp={ImageColor.getrgb(a):ImageColor.getrgb(b) for a,b in zip(pal[base],pal[color])}
 out=im.copy();out.putdata([(*mp.get(p[:3],p[:3]),p[3]) if p[3] else p for p in im.getdata()]);return out
# Layer tuple: z, source template, material, color, definition.
D='sheet_definitions/'
def L(z,p,color=None,definition=None,material='cloth'):return (z,'spritesheets/'+p,material,color,D+definition if definition else None)
def base():return [L(10,'body/bodies/male/{a}.png','SKIN','body/body.json','body'),L(100,'head/heads/human/male/{a}.png','SKIN','head/heads/human/heads_human_male.json','body')]
def shirt(color):return L(35,'torso/clothes/longsleeve/longsleeve/male/{a}.png',color,'torso/shirts/longsleeve/torso_clothes_longsleeve.json')
def pants(color):return L(20,'legs/pants/male/{a}.png',color,'legs/pants/legs_pants.json')
def boots(color='leather'):return L(25,'feet/boots/basic/male/{a}.png',color,'feet/boots/feet_boots_basic.json')
def hood(color):return L(130,'hat/cloth/hood/adult/{a}.png',color,'headwear/coverings/hoods/hat_hood_cloth.json')
def cape(color):return [L(5,'cape/tattered/bg/{a}.png',color,'torso/cape/cape_tattered.json'),L(85,'cape/tattered/fg/{a}.png',color,'torso/cape/cape_tattered.json')]
def sash(color):return L(90,'torso/waist/sash/male/{a}.png',color,'torso/waist/belt_sash.json')
recipes={}
sword=json.load(open(Path(__file__).with_name('sword-recipes.json')))
for id,d in sword.items():
 ls=[]
 for l in d['layers']:
  rc=l.get('recolor'); color=rc.get('palette') if rc and rc.get('material')=='cloth' else None
  ls.append((l['zPos'],l['sources']['walk'].replace('/walk','/{a}'),'cloth',color,l['definition']))
 recipes[('sword',id)]=base()+ls
recipes[('bow','scout')]=base()+[pants('brown'),boots(),shirt('green'),hood('forest'),sash('brown')]
recipes[('bow','hunter')]=base()+[pants('gray'),boots('brown'),shirt('tan'),L(60,'torso/armour/leather/male/{a}.png',None,'torso/armour/torso_armour_leather.json'),sash('brown')]
recipes[('bow','ranger')]=base()+[pants('charcoal'),boots('charcoal'),shirt('navy'),hood('forest')]+cape('forest')
recipes[('wand','apprentice')]=base()+[pants('navy'),boots(),shirt('white'),L(55,'torso/clothes/vest/male/{a}/blue.png',None,'torso/vest/torso_clothes_vest.json'),sash('tan')]
recipes[('wand','acolyte')]=base()+[pants('charcoal'),L(22,'legs/skirts/slit/thin/{a}.png','purple','legs/skirts/legs_skirts_slit.json'),boots('charcoal'),shirt('lavender'),hood('purple'),sash('purple')]+cape('purple')
recipes[('wand','adept')]=base()+[pants('charcoal'),L(22,'legs/skirts/slit/thin/{a}.png','navy','legs/skirts/legs_skirts_slit.json'),boots('charcoal'),shirt('navy'),L(130,'hat/magic/wizard/base/adult/{a}/navy.png',None,'headwear/hats/magic/hat_magic_wizard.json'),L(131,'hat/magic/wizard/belt/adult/{a}.png','yellow','headwear/hats/magic/hat_magic_wizard_belt.json'),sash('yellow')]
weapondefs={'sword':['weapons/sword/weapon_sword_arming.json','weapons/shields/shield_round.json'],'bow':['weapons/ranged/bow/weapon_ranged_bow_normal.json','weapons/ranged/bow/weapon_ranged_bow_arrow.json','torso/backpack/quiver.json'],'wand':['weapons/magic/weapon_magic_wand.json']}
# Fetch missing layers concurrently before composing.
needed=set()
for (w,id),ls in recipes.items():
 for z,p,m,c,d in ls:
  for a in ['walk','shoot' if w=='bow' else 'slash']:needed.add(p.format(a=a))
  if d:needed.add(d)
 for d in weapondefs[w]:needed.add(D+d)
fail=[]
def get(p):
 try:source(p);return None
 except Exception as e:return (p,str(e))
with concurrent.futures.ThreadPoolExecutor(8) as pool:fail=[r for r in pool.map(get,needed) if r]
if fail:print('MISSING',fail,flush=True);raise SystemExit(1)

def weapons(w,a):
 if w=='sword':
  if a=='walk':paths=[(9,'weapon/sword/arming/universal/bg/walk/steel.png'),(110,'shield/round/walk/brown.png'),(140,'weapon/sword/arming/universal/fg/walk/steel.png')]
  else:paths=[(8,'weapon/sword/arming/attack_slash/bg/steel.png'),(110,'shield/round/slash/brown.png'),(140,'weapon/sword/arming/attack_slash/fg/steel.png')]
 elif w=='bow':
  if a=='walk':paths=[(-1,'weapon/ranged/bow/normal/walk/background/light.png'),(140,'weapon/ranged/bow/normal/walk/foreground/light.png'),(0,'quiver/walk/quiver.png')]
  else:paths=[(-1,'weapon/ranged/bow/normal/universal/background/shoot/light.png'),(140,'weapon/ranged/bow/normal/universal/foreground/shoot/light.png'),(141,'weapon/ranged/bow/arrow/shoot/arrow.png'),(0,'quiver/shoot/quiver.png')]
 else:paths=[(140,'weapon/magic/wand/male/slash/wand.png')]
 return [(z,'spritesheets/'+p,read('spritesheets/'+p)) for z,p in paths]
for w in ['sword','bow','wand']:
 for a in ['walk','shoot' if w=='bow' else 'slash']:weapons(w,a)

def cell(im,frame,row,src_tile):return im.crop((frame*src_tile,row*src_tile,(frame+1)*src_tile,(row+1)*src_tile))
allcredits={}; outputmeta={}
for (w,id),ls in recipes.items():
 dest=ROOT/w/id;dest.mkdir(parents=True,exist_ok=True)
 meta={'generator':'Universal LPC Character Generator','revision':REV,'weapon':w,'outfit':id,'layers':[],'notes':[]}
 defs=set([l[4] for l in ls if l[4]]+[D+d for d in weapondefs[w]])
 for d in defs:allcredits[d]=json.load(open(source(d)))
 for skin in ['light','amber','olive','bronze','brown','black']:
  for outa,a in [('walk','walk'),('attack','shoot' if w=='bow' else 'slash')]:
   frames=9 if a=='walk' else 13 if a=='shoot' else 6
   tile=128 if (w=='sword' and a=='slash') or (w=='bow' and a=='walk') else 64
   origin=(tile-64)//2
   sheet=Image.new('RGBA',(frames*tile,4*tile))
   layers=[]
   for z,p,m,c,d in ls:
    path=p.format(a=a);im=read(path)
    if c:im=recolor(im,m,skin if c=='SKIN' else c)
    layers.append((z,path,im,64,False))
   for z,path,im in weapons(w,a):
    st=128 if (w=='sword' and 'attack_slash' in path) or (w=='bow' and a=='walk' and 'bow/normal/walk' in path) else 64
    layers.append((z,path,im,st,w=='wand' and a=='walk'))
   for row in range(4):
    for frame in range(frames):
     for z,path,im,st,wandwalk in sorted(layers,key=lambda x:x[0]):
      f=0 if wandwalk else frame
      piece=cell(im,f,row,st)
      # Official wand has no native walk. Move its standing frame with the source gait's hands.
      dx=dy=0
      if wandwalk and frame:
       dy=[0,0,-1,-1,0,0,0,0,0][frame]
       dx=([0,-1,0,1,0,1,0,-1,0][frame] if row in [1,3] else 0)
      offset=(tile-st)//2
      sheet.alpha_composite(piece,(frame*tile+offset+dx,row*tile+offset+dy))
   sheet.save(dest/f'{skin}-{outa}.png')
   if outa=='walk':
    sheet.crop((origin,2*tile+origin,origin+64,2*tile+origin+64)).save(dest/f'{skin}-preview.png')
   if skin=='light':
    meta[outa]={'file':f'{{skin}}-{outa}.png','tile':tile,'origin':origin,'frames':frames,'rows':['north','west','south','east']}
  if skin=='light':
   for z,p,m,c,d in ls:meta['layers'].append({'z':z,'source':p,'material':m,'palette':c,'definition':d})
 if w=='wand':meta['notes'].append('Wand has native slash only. WALK uses the official standing wand with a 0–1px gait-compatible translation; no custom weapon pixels drawn.')
 (dest/'manifest.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2));outputmeta[f'{w}/{id}']=meta
 print('READY',w,id,flush=True)
# Keep source definitions + full attribution accessible, rather than huge duplicate PNG originals.
lines=['EMBER STARTER LOADOUTS — UNIVERSAL LPC','Pinned revision: '+REV,'Original repository: https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator','Changes: original layers composed in zPos order, official body/cloth palettes, standing frame crops. Weapon oversized layouts preserved.','Layer licenses and all authors below. OGA-BY3.0 and CC-BY-SA3.0 terms retained as offered by each component.','']
for p,d in sorted(allcredits.items()):
 q=ROOT/'definitions'/p;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source(p),q)
 lines.append('DEFINITION: '+p)
 for c in d.get('credits',[]):lines+=['Asset: '+c.get('file',''),'Authors: '+', '.join(c.get('authors',[])),'Licenses: '+', '.join(c.get('licenses',[])),'Sources: '+', '.join(c.get('urls',[])),'']
(ROOT/'CREDITS.txt').write_text('\n'.join(lines))
(ROOT/'manifest.json').write_text(json.dumps(outputmeta,ensure_ascii=False,indent=2))
board=Image.new('RGB',(768,768),'#202b24')
for j,w in enumerate(['sword','bow','wand']):
 for i,id in enumerate([k[1] for k in recipes if k[0]==w]):
  im=Image.open(ROOT/w/id/'light-preview.png').resize((256,256),Image.Resampling.NEAREST);board.paste(im,(i*256,j*256),im)
board.save(CACHE/'loadouts-contact.png')
print('DONE nine presets,54 skin variants,108 animated sheets +54 previews',flush=True)
