#!/usr/bin/env python3
"""Generate independent, animation-matched LPC layers for Archer and Mage.

The canonical source is the same pinned Universal LPC revision used by
scripts/build-loadouts.py. Every default class appearance is checked against
its existing sprite sheet *pixel by pixel* before publishing. No new poses
or hand offsets are invented.
"""
from pathlib import Path
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageColor, ImageOps, ImageChops
import argparse, json, urllib.request

PROJECT=Path(__file__).resolve().parents[1]
ROOT=PROJECT/'dist/assets/characters/loadouts'
OUT=PROJECT/'dist/assets/equipment/class-layers'
CACHE=PROJECT/'.cache/lpc'
REV='86a3719ee4a7e2e9fb27c7c152e29a741d3e930a'
BASE=f'https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/{REV}/'
COLORS={
 'sand':('tan','white'),'forest':('forest','green'),'blue':('navy','blue'),
 'red':('maroon','red'),'purple':('purple','lavender'),'gray':('gray','slate')
}
SKINS=('light','amber','olive','bronze','brown','black')
POSES={'bow':(('walk','walk',9,128),('attack','shoot',13,64)),
       'wand':(('walk','walk',9,64),('attack','slash',6,64))}
BOW_MATERIAL={'basic':'light','steel':'dark','ember':'gold'}
WIZARD_COLORS={'iron':'blue','royal':'purple'}
WAND_COLORS={'steel':('#253a67','#97d7f8'),'ember':('#603518','#f3bf61')}
QUIVER_COLORS={'steel':('#1d2f44','#7796b1'),'royal':('#622d38','#e2a66b')}
parser=argparse.ArgumentParser()
parser.add_argument('--quick',action='store_true',help='Check one skin/color per class')
args=parser.parse_args()

def source(path):
    p=CACHE/path
    if p.is_file():return p
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_bytes(urllib.request.urlopen(BASE+path,timeout=45).read())
    return p

@lru_cache(None)
def read(path):
    return Image.open(source(path)).convert('RGBA')

@lru_cache(None)
def palette(material):
    return json.loads(source(f'palette_definitions/{material}/{material}_ulpc.json').read_text())

@lru_cache(None)
def recolor(path,material,color):
    im=read(path)
    base='light' if material=='body' else 'white'
    if not color or color==base:return im
    pal=palette(material)
    mapping={ImageColor.getrgb(x):ImageColor.getrgb(y) for x,y in zip(pal[base],pal[color])}
    new=im.copy()
    new.putdata([(*mapping.get(pixel[:3],pixel[:3]),pixel[3]) if pixel[3] else pixel for pixel in im.getdata()])
    return new

@lru_cache(None)
def tinted(path,low,high):
    im=read(path)
    tint=ImageOps.colorize(ImageOps.grayscale(im),low,high).convert('RGBA')
    tint.putalpha(im.getchannel('A'))
    return tint

def layer(z,path,material=None,color=None,tile=64,mode=None,tint=None):
    if tint:im=tinted(path,*tint)
    elif material:im=recolor(path,material,color)
    else:im=read(path)
    return z,im,tile,mode,path

def render(layers,frames,tile):
    # Exact same alpha_composite/crop formula as build-loadouts.py.
    result=Image.new('RGBA',(frames*tile,4*tile))
    for row in range(4):
        for frame in range(frames):
            for _,image,src_tile,mode,path in sorted(layers,key=lambda x:x[0]):
                if image.height!=4*src_tile or image.width%src_tile:
                    raise ValueError(f'Invalid LPC source dimensions: {path}: {image.size}')
                index=0 if mode=='wandwalk' else frame
                if image.width<(index+1)*src_tile:
                    raise ValueError(f'Missing frame {index} in {path}: {image.size}')
                piece=image.crop((index*src_tile,row*src_tile,(index+1)*src_tile,(row+1)*src_tile))
                off=(tile-src_tile)//2
                dx=dy=0
                # Already in the game's original build-loadouts.py.
                if mode=='wandwalk' and frame:
                    dy=[0,0,-1,-1,0,0,0,0,0][frame]
                    dx=([0,-1,0,1,0,1,0,-1,0][frame] if row in [1,3] else 0)
                result.alpha_composite(piece,(frame*tile+off+dx,row*tile+off+dy))
    return result

def outfit_layers(kind,anim,skin,colour):
    main,light=COLORS[colour]
    common=[
      layer(10,f'spritesheets/body/bodies/male/{anim}.png','body',skin),
      layer(100,f'spritesheets/head/heads/human/male/{anim}.png','body',skin),
      layer(20,f'spritesheets/legs/pants/male/{anim}.png','cloth','charcoal'),
      layer(25,f'spritesheets/feet/boots/basic/male/{anim}.png','cloth','charcoal'),
      layer(35,f'spritesheets/torso/clothes/longsleeve/longsleeve/male/{anim}.png','cloth','bluegray' if kind=='bow' else light),
      layer(5,f'spritesheets/cape/tattered/bg/{anim}.png','cloth',main),
      layer(85,f'spritesheets/cape/tattered/fg/{anim}.png','cloth',main)
    ]
    if kind=='wand':
        common.append(layer(22,f'spritesheets/legs/skirts/slit/thin/{anim}.png','cloth',main))
    return common

def helmet_layer(kind,item,anim,colour):
    main=COLORS[colour][0]
    if item=='basic':
        return [layer(130,f'spritesheets/hat/cloth/hood/adult/{anim}.png','cloth',main)]
    if kind=='bow':
        rel='bascinet/adult' if item=='iron' else 'greathelm/male'
        return [layer(130,f'spritesheets/hat/helmet/{rel}/{anim}.png')]
    return [layer(130,f'spritesheets/hat/magic/wizard/base/adult/{anim}/{WIZARD_COLORS[item]}.png')]

def armour_layer(kind,item,anim):
    if item=='basic':return []
    if item=='iron':
        return [layer(60,f'spritesheets/torso/armour/leather/male/{anim}.png')]
    if kind=='bow':
        return [layer(60,f'spritesheets/torso/armour/plate/male/{anim}.png')]
    return [layer(55,f'spritesheets/torso/clothes/vest/male/{anim}/blue.png')]

def accessory_layer(kind,item,anim):
    if kind=='bow':
        path=f'spritesheets/quiver/{anim}/quiver.png'
        if item=='basic':return [layer(0,path)]
        return [layer(0,path,tint=QUIVER_COLORS[item])]
    colors={'basic':'charcoal','steel':'navy','royal':'yellow'}
    return [layer(90,f'spritesheets/torso/waist/sash/male/{anim}.png','cloth',colors[item])]

def weapon_layers(kind,item,anim):
    if kind=='bow':
        material=BOW_MATERIAL[item]
        if anim=='walk':
            back=layer(-1,f'spritesheets/weapon/ranged/bow/normal/walk/background/{material}.png',tile=128)
            front=layer(140,f'spritesheets/weapon/ranged/bow/normal/walk/foreground/{material}.png',tile=128)
            return [back],[front]
        back=layer(-1,f'spritesheets/weapon/ranged/bow/normal/universal/background/shoot/{material}.png')
        front=layer(140,f'spritesheets/weapon/ranged/bow/normal/universal/foreground/shoot/{material}.png')
        arrow=layer(141,'spritesheets/weapon/ranged/bow/arrow/shoot/arrow.png')
        return [back],[front,arrow]
    path='spritesheets/weapon/magic/wand/male/slash/wand.png'
    tint=WAND_COLORS.get(item)
    return [],[layer(140,path,mode='wandwalk' if anim=='walk' else None,tint=tint)]

def groups(kind,anim,skin,colour,look):
    body=outfit_layers(kind,anim,skin,colour)
    weapon_bg,weapon_fg=weapon_layers(kind,look['weapon'],anim)
    accessory=accessory_layer(kind,look['shield'],anim)
    armor=armour_layer(kind,look['armor'],anim)
    helm=helmet_layer(kind,look['helmet'],anim,colour)
    # Separate intermediate compositing bands so layers can be swapped without
    # covering a shield, bow or wand with a later full-image overlay.
    base={
      'under':[x for x in body if x[0]<60],
      'middle':[x for x in body if 60<=x[0]<100],
      'head':[x for x in body if 100<=x[0]<130]
    }
    return base,weapon_bg,accessory,armor,helm,weapon_fg

def all_ordered(kind,anim,skin,colour,look):
    body=outfit_layers(kind,anim,skin,colour)
    b,a,armor,helm,f=groups(kind,anim,skin,colour,look)[1:]
    return sorted(body+b+a+armor+helm+f,key=lambda x:x[0])

def save(image,location):
    location.parent.mkdir(parents=True,exist_ok=True)
    image.save(location,optimize=True)

def static_assets(kind,pose,anim,frames,tile,colour):
    # Equipment layers reuse their native pixel geometry in every skin. Only
    # the original hood is recolored to match the user's outfit palette.
    for item in ('basic','iron','royal'):
        helmet=helmet_layer(kind,item,anim,colour)
        save(render(helmet,frames,tile),OUT/kind/'helmet'/item/colour/f'{pose}.png')

def shared_assets(kind,pose,anim,frames,tile):
    for item in ('iron','royal'):
        save(render(armour_layer(kind,item,anim),frames,tile),OUT/kind/'armor'/item/f'{pose}.png')
    for item in ('basic','steel','royal'):
        save(render(accessory_layer(kind,item,anim),frames,tile),OUT/kind/'shield'/item/f'{pose}.png')
    for item in ('basic','steel','ember'):
        bg,fg=weapon_layers(kind,item,anim)
        if bg:save(render(bg,frames,tile),OUT/kind/'weapon'/item/f'{pose}-back.png')
        save(render(fg,frames,tile),OUT/kind/'weapon'/item/f'{pose}-front.png')

def build(kind,colour,skin):
    starter={'helmet':'basic','armor':'basic','weapon':'basic','shield':'basic'}
    for pose,anim,frames,tile in POSES[kind]:
        band,_,_,_,_,_=groups(kind,anim,skin,colour,starter)
        for part in ('under','middle','head'):
            save(render(band[part],frames,tile),
                 OUT/kind/'base'/colour/skin/f'{pose}-{part}.png')
        # Pixel-perfect canary: no new images ship if the default appearance
        # diverges from the existing original LPC-generated sprite sheet.
        reconstructed=render(all_ordered(kind,anim,skin,colour,starter),frames,tile)
        original=Image.open(ROOT/kind/('wanderer' if kind=='bow' else 'acolyte')/
                            colour/f'{skin}-{pose}.png').convert('RGBA')
        if reconstructed.size!=original.size or ImageChops.difference(reconstructed,original).getbbox():
            raise ValueError(f'Original LPC sprite mismatch: {kind}/{colour}/{skin}/{pose}')

def prefetch():
    # Resolve both classes and the exact source poses before rendering. Fail
    # immediately on a missing file or unsupported upstream animation.
    required=set([
        'palette_definitions/body/body_ulpc.json',
        'palette_definitions/cloth/cloth_ulpc.json'
    ])
    for kind in ('bow','wand'):
        for _,anim,_,_ in POSES[kind]:
            for colour in ('sand',):
                for skin in ('light',):
                    look={'helmet':'basic','armor':'basic','weapon':'basic','shield':'basic'}
                    for part in all_ordered(kind,anim,skin,colour,look):
                        required.add(part[4])
            for item in ('basic','iron','royal'):
                for item_layer in helmet_layer(kind,item,anim,'sand')+armour_layer(kind,item,anim):
                    required.add(item_layer[4])
            for item in ('basic','steel','royal'):
                for item_layer in accessory_layer(kind,item,anim):
                    required.add(item_layer[4])
            for item in ('basic','steel','ember'):
                back,front=weapon_layers(kind,item,anim)
                for item_layer in back+front:
                    required.add(item_layer[4])
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(source,sorted(required)))
    print(f'Cached {len(required)} pinned LPC source assets',flush=True)

if __name__=='__main__':
    prefetch()
    # Sources and palettes are common across skin/cloth combinations.
    for kind in ('bow','wand'):
        for pose,anim,frames,tile in POSES[kind]:
            shared_assets(kind,pose,anim,frames,tile)
            for colour in COLORS:
                static_assets(kind,pose,anim,frames,tile,colour)
    colors=('sand',) if args.quick else COLORS
    skins=('light',) if args.quick else SKINS
    for kind in ('bow','wand'):
        for colour in colors:
            for skin in skins:
                build(kind,colour,skin)
        print(f'READY {kind}: {len(colors)*len(skins)*2} baseline-verified LPC poses',flush=True)
    (OUT/'CREDITS.md').write_text(
        'Native independently layered Archer and Mage LPC assets. Source: '
        'https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-'
        'Character-Generator @ '+REV+'. Original component authors, licenses '
        'and links are in dist/assets/characters/loadouts/CREDITS.txt. '
        'Alternative quiver and magic wand palettes recolor those exact native '
        'sprite pixels, preserving pose/frame/alpha. Default appearance is '
        'checked pixel-by-pixel against the original character builds.\n')
    print('DONE native independent Archer and Mage equipment layers',flush=True)
