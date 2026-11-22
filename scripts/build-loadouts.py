from pathlib import Path
from PIL import Image,ImageColor,ImageDraw,ImageFont
import json,urllib.request,concurrent.futures,hashlib,shutil,argparse
parser=argparse.ArgumentParser(description='Compose pinned Universal LPC starter appearances.')
parser.add_argument('--sword-only','--sword-combo-only',dest='sword_only',action='store_true',help='Rebuild all sword poses without rebuilding bow and wand appearances.')
SWORD_ONLY=parser.parse_args().sword_only
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
weapondefs={'sword':['weapons/sword/weapon_sword_arming.json','weapons/shields/heater/shield_heater_wood.json','weapons/shields/heater/shield_heater_trim.json'],'bow':['weapons/ranged/bow/weapon_ranged_bow_normal.json','weapons/ranged/bow/weapon_ranged_bow_arrow.json','torso/backpack/quiver.json'],'wand':['weapons/magic/weapon_magic_wand.json']}
# One starter silhouette per weapon; six official cloth palettes, skin remains independent.
colorways = {
 'sand': ('tan','white'), 'forest': ('forest','green'), 'blue': ('navy','blue'),
 'red': ('maroon','red'), 'purple': ('purple','lavender'), 'gray': ('gray','slate')
}
base_recipes = {('sword','militia'):recipes[('sword','militia')],('bow','wanderer'):recipes[('bow','ranger')],('wand','acolyte'):recipes[('wand','acolyte')]}
recipes = {}
for (weapon,outfit), layers in base_recipes.items():
 for color_id,(main,light) in colorways.items():
  variant=[]
  for z,path,material,color,definition in layers:
   # The classic belt has no revised poses. Omit it from every sword pose
   # instead of pinning an unrelated standing frame over moving clothing.
   if weapon=='sword' and 'torso/waist/belt_leather/' in path:continue
   if weapon=='sword' and 'torso/clothes/longsleeve/' in path:color=main
   elif weapon=='bow':
    if 'cape/tattered/' in path or 'hat/cloth/hood/' in path:color=main
    elif 'torso/clothes/longsleeve/' in path:color='bluegray'
   elif weapon=='wand':
    if any(part in path for part in ['cape/tattered/','hat/cloth/hood/','legs/skirts/']):color=main
    elif 'torso/clothes/longsleeve/' in path:color=light
    elif 'torso/waist/sash/' in path:color='charcoal'
   variant.append((z,path,material,color,definition))
  recipes[(weapon,outfit+'/'+color_id)]=variant
# Fetch missing layers concurrently before composing.
SWORD_COMBO=('halfslash','backslash')
def animations(w):
 if SWORD_ONLY and w!='sword':return []
 return [('walk','walk'),('attack','shoot' if w=='bow' else 'slash')]+([(a,a) for a in SWORD_COMBO]+[('block','combat_idle')] if w=='sword' else [])
def clothing_source(p,a):
 return p.format(a=a),False
needed=set()
for (w,id),ls in recipes.items():
 if not animations(w):continue
 for z,p,m,c,d in ls:
  for _,a in animations(w):needed.add(clothing_source(p,a)[0])
  if d:needed.add(d)
 for d in weapondefs[w]:needed.add(D+d)
needed.add('sources/custom-animations.ts')
fail=[]
def get(p):
 try:source(p);return None
 except Exception as e:return (p,str(e))
with concurrent.futures.ThreadPoolExecutor(8) as pool:fail=[r for r in pool.map(get,needed) if r]
if fail:print('MISSING',fail,flush=True);raise SystemExit(1)

def weapons(w,a):
 if w=='sword':
  if a in ['walk','combat_idle']:paths=[(9,f'weapon/sword/arming/universal/bg/{a}/steel.png'),(140,f'weapon/sword/arming/universal/fg/{a}/steel.png')]
  else:paths=[(8,f'weapon/sword/arming/attack_{a}/bg/steel.png'),(150 if a in SWORD_COMBO else 140,f'weapon/sword/arming/attack_{a}/fg/steel.png')]
  # The original heater matches the classic male WALK/SLASH off hand. The
  # revised family's side WALK/SLASH grips instead overlap the sword hand.
  # Revised cuts and combat poses are shared by both official heater families.
  for z,kind,side in [(2,'wood','bg'),(6,'trim','bg'),(110,'wood','fg'),(115,'trim','fg')]:
   if a in ['walk','slash'] and side=='bg':continue
   paths.append((z,f'shield/heater/original/{kind}/{side}/{a}.png'))
 elif w=='bow':
  if a=='walk':paths=[(-1,'weapon/ranged/bow/normal/walk/background/light.png'),(140,'weapon/ranged/bow/normal/walk/foreground/light.png'),(0,'quiver/walk/quiver.png')]
  else:paths=[(-1,'weapon/ranged/bow/normal/universal/background/shoot/light.png'),(140,'weapon/ranged/bow/normal/universal/foreground/shoot/light.png'),(141,'weapon/ranged/bow/arrow/shoot/arrow.png'),(0,'quiver/shoot/quiver.png')]
 else:paths=[(140,'weapon/magic/wand/male/slash/wand.png')]
 return [(z,'spritesheets/'+p,read('spritesheets/'+p)) for z,p in paths]
for w in ['sword','bow','wand']:
 for _,a in animations(w):weapons(w,a)

def cell(im,frame,row,src_tile):return im.crop((frame*src_tile,row*src_tile,(frame+1)*src_tile,(row+1)*src_tile))
allcredits={}; outputmeta=json.load(open(ROOT/'manifest.json')) if SWORD_ONLY else {}
for (w,id),ls in recipes.items():
 if not animations(w):continue
 dest=ROOT/w/id;dest.mkdir(parents=True,exist_ok=True)
 meta={'generator':'Universal LPC Character Generator','revision':REV,'weapon':w,'outfit':id.split('/')[0],'outfitColor':id.split('/')[1],'layers':[],'notes':[]}
 defs=set([l[4] for l in ls if l[4]]+[D+d for d in weapondefs[w]])
 for d in defs:allcredits[d]=json.load(open(source(d)))
 for skin in ['light','amber','olive','bronze','brown','black']:
  for outa,a in animations(w):
   frames=1 if outa=='block' else 9 if a=='walk' else 13 if a in ['shoot','backslash'] else 6
   tile=128 if (w=='sword' and a in ('slash',)+SWORD_COMBO) or (w=='bow' and a=='walk') else 64
   origin=(tile-64)//2
   sheet=Image.new('RGBA',(frames*tile,4*tile))
   layers=[]
   for z,p,m,c,d in ls:
    path,still=clothing_source(p,a);im=read(path)
    if c:im=recolor(im,m,skin if c=='SKIN' else c)
    layers.append((z,path,im,64,'still' if still else None))
   for z,path,im in weapons(w,a):
    st=128 if (w=='sword' and '/arming/attack_' in path) or (w=='bow' and a=='walk' and 'bow/normal/walk' in path) else 64
    mode='wandwalk' if w=='wand' and a=='walk' else None
    layers.append((z,path,im,st,mode))
   for z,path,im,st,mode in layers:
    # Some official walk weapon sheets reserve 13 columns although WALK uses9.
    assert im.height==4*st and im.width%st==0 and (mode or im.width>=frames*st),(path,im.size,frames,st)
   for row in range(4):
    for frame in range(frames):
     for z,path,im,st,mode in sorted(layers,key=lambda x:x[0]):
      f=0 if mode else frame
      piece=cell(im,f,row,st)
      # Official wand has no native walk. Move its standing frame with the source gait's hands.
      dx=dy=0
      if mode=='wandwalk' and frame:
       dy=[0,0,-1,-1,0,0,0,0,0][frame]
       dx=([0,-1,0,1,0,1,0,-1,0][frame] if row in [1,3] else 0)
      offset=(tile-st)//2
      sheet.alpha_composite(piece,(frame*tile+offset+dx,row*tile+offset+dy))
   sheet.save(dest/f'{skin}-{outa}.png')
   if outa=='walk':
    sheet.crop((origin,2*tile+origin,origin+64,2*tile+origin+64)).save(dest/f'{skin}-preview.png')
   if skin=='light':
    meta[outa]={'file':f'{{skin}}-{outa}.png','tile':tile,'origin':origin,'frames':frames,'rows':['north','west','south','east']}
    if w=='sword':
     meta[outa].update({'animation':a+'_128' if tile==128 else a,'animationDefinition':'definitions/sources/custom-animations.ts','layers':[{'z':z,'source':path,'sourceURL':BASE+path,'sourceTile':st,'frameMode':'native pose 0' if outa=='block' else 'native','sha256':hashlib.sha256(source(path).read_bytes()).hexdigest()} for z,path,im,st,mode in sorted(layers,key=lambda x:x[0])]})
  if skin=='light':
   for z,p,m,c,d in ls:meta['layers'].append({'z':z,'source':p,'material':m,'palette':c,'definition':d})
 if w=='wand':meta['notes'].append('Wand has native slash only. WALK uses the official standing wand with a 0–1px gait-compatible translation; no custom weapon pixels drawn.')
 if w=='sword':
  meta['handedness']={'shieldFamily':'heater/original','transform':'none: original native pixels and direction rows, no mirroring, translation or frozen frames','classicPoseFix':'Original WALK/SLASH shield cells grip the classic male off hand; revised side-facing cells overlap the sword hand.','revisedCuts':'Original and revised HALFSLASH/BACKSLASH/combat shield cells are byte-identical; distinct wrists verified from exposed native hand pixels.','exampleGripPixels':{'walk-east-0':{'shieldHand':[26,47],'swordHand':[37,43]},'halfslash-east-3':{'shieldHand':[50,37],'swordHand':[59,43]},'halfslash-west-3':{'shieldHand':[13,37],'swordHand':[4,43]},'combat_idle-east-0':{'shieldHand':[42,40],'swordHand':[30,44]}}}
  note='Native ORIGINAL wooden heater shield with metal trim matches the classic male off hand in WALK/SLASH; native HALFSLASH/BACKSLASH/combat poses are identical in the original/revised families. BLOCK uses original combat_idle pose 0 for all layers. No mirrored, translated or held shield cells during attacks. Distinct source hand pixels verified. Unsupported classic leather belt omitted from every sword pose.'
  if note not in meta['notes']:meta['notes'].append(note)
 (dest/'manifest.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2));outputmeta[f'{w}/{id}']=meta
 print('READY',w,id,flush=True)
# Keep source definitions + full attribution accessible, rather than huge duplicate PNG originals.
for appearance in outputmeta.values():
 for definition in {layer['definition'] for layer in appearance['layers'] if layer.get('definition')}|{D+d for d in weapondefs[appearance['weapon']]}:
  allcredits[definition]=json.load(open(source(definition)))
lines=['EMBER STARTER LOADOUTS — UNIVERSAL LPC','Pinned revision: '+REV,'Original repository: https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator','Changes: original layers composed in zPos order, official body/cloth palettes, standing frame crops. Weapon oversized layouts preserved.','Layer licenses and all authors below. OGA-BY3.0 and CC-BY-SA3.0 terms retained as offered by each component.','']
for p,d in sorted(allcredits.items()):
 q=ROOT/'definitions'/p;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source(p),q)
 lines.append('DEFINITION: '+p)
 for c in d.get('credits',[]):lines+=['Asset: '+c.get('file',''),'Authors: '+', '.join(c.get('authors',[])),'Licenses: '+', '.join(c.get('licenses',[])),'Sources: '+', '.join(c.get('urls',[])),'']
animation_definition=ROOT/'definitions/sources/custom-animations.ts';animation_definition.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source('sources/custom-animations.ts'),animation_definition)
combo_credit='SWORD COMBO ANIMATIONS — '+REV+'\nNative halfslash_128: 6 frames; native backslash_128: 13 frames. Matching original body, human head, shirt, pants, boots and steel arming-sword layers, with original oversized128 tiles. ORIGINAL heater wood/trim sources are used consistently: their classic male WALK/SLASH off-hand grip differs from the revised family; HALFSLASH/BACKSLASH/combat frames are shared unchanged. Sword and shield attach to distinct exposed native hand pixels. Block uses the matching original combat_idle pose 0. Unsupported classic belt omitted consistently. Official body and cloth recolors only. No shield cells frozen, mirrored, translated or redrawn; no frames reversed. Per-component authors and OGA-BY3.0 / CC-BY-SA3.0 options above apply; source paths and hashes are recorded in each outfit-color manifest.\n'
(ROOT/'CREDITS.txt').write_text('\n'.join(lines)+'\n'+combo_credit)
(ROOT/'manifest.json').write_text(json.dumps(outputmeta,ensure_ascii=False,indent=2))
if SWORD_ONLY:
 print('DONE native sword poses:216 PNGs (6cloth colors x6skin colors x6poses including preview).',flush=True)
 raise SystemExit(0)
board=Image.new('RGB',(1152,576),'#202b24')
for j,w in enumerate(['sword','bow','wand']):
 for i,id in enumerate([k[1] for k in recipes if k[0]==w]):
  im=Image.open(ROOT/w/id/'light-preview.png').resize((192,192),Image.Resampling.NEAREST);board.paste(im,(i*192,j*192),im)
CACHE.mkdir(parents=True,exist_ok=True)
board.save(CACHE/'loadout-colors-contact.png')
# Remove superseded wardrobe alternatives and uncolored sheets; saved records are normalized by the catalogue.
keep={'sword':'militia','bow':'wanderer','wand':'acolyte'}
for w,base_id in keep.items():
 for folder in (ROOT/w).iterdir():
  if folder.is_dir() and folder.name not in [base_id,'source']:shutil.rmtree(folder)
 base_folder=ROOT/w/base_id
 for old in list(base_folder.glob('*.png'))+[base_folder/'manifest.json']:
  if old.is_file():old.unlink()
print('DONE three starter outfits, six cloth colors, six skin colors;432 animated/preview PNGs including native sword combo and guard pose.',flush=True)
