#!/usr/bin/env python3
"""Produce small transparent PNG item portraits from original LPC asset layers.

Run after build-equipment-variants.py and build-class-equipment.py.
Uses the SAME pinned LPC PNGs, palette files and generated pose atlases.
Never invents icon silhouettes or includes the full hero in an item portrait.
"""
from pathlib import Path
from PIL import Image, ImageColor
import json

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'dist'
ASSETS=DIST/'assets/equipment'
CACHE=ROOT/'.cache/lpc'
OUT=ASSETS/'icons'
COLORS={
 'sand':('tan','white'), 'forest':('forest','green'),
 'blue':('navy','blue'), 'red':('maroon','red'),
 'purple':('purple','lavender'), 'gray':('gray','slate')
}
CLASSES=('sword','bow','wand')
SLOTS={
 'helmet':('none','iron','royal'),
 'armor':('basic','iron','royal'),
 'weapon':('basic','steel','ember'),
 'shield':('basic','steel','royal')
}
IMAGE_SIZE=64
HEAD='spritesheets/head/heads/human/male/walk.png'
SHIRT='spritesheets/torso/clothes/longsleeve/longsleeve/male/walk.png'
SKIRT='spritesheets/legs/skirts/slit/thin/walk.png'
MATERIALS={'basic':'steel','steel':'silver','ember':'gold'}
records=[]

def cached(path):
    file=CACHE/path
    if not file.is_file():
        raise FileNotFoundError(f'Original LPC sprite missing from pinned cache: {file}')
    return Image.open(file).convert('RGBA')

def generated(path):
    file=ASSETS/path
    if not file.is_file():
        raise FileNotFoundError(f'Expected generated LPC layer: {file}')
    return Image.open(file).convert('RGBA')

def cloth(layer,name):
    colors=json.loads((CACHE/'palette_definitions/cloth/cloth_ulpc.json').read_text())
    lookup={ImageColor.getrgb(a):ImageColor.getrgb(b) for a,b in zip(colors['white'],colors[name])}
    image=layer.copy()
    image.putdata([(*lookup.get(p[:3],p[:3]),p[3]) if p[3] else p for p in image.getdata()])
    return image

def parts(class_id,slot,item,color):
    if class_id=='sword':
        if slot=='helmet':
            return [(cached(HEAD),64)] if item=='none' else [(generated(f'lpc/helmet/{item}/walk.png'),64)]
        if slot=='armor':
            return [(cloth(cached(SHIRT),COLORS[color][0]),64)] if item=='basic' else [(generated(f'lpc/armor/{item}/walk.png'),64)]
        if slot=='weapon':
            metal=MATERIALS[item]
            return [(cached(f'spritesheets/weapon/sword/arming/universal/bg/walk/{metal}.png'),64),
                    (generated(f'front-layers/weapon/{item}/walk.png'),64)]
        return [(generated(f'front-layers/shield/{item}/walk.png'),64)]
    if slot=='helmet':
        return [(generated(f'class-layers/{class_id}/helmet/{item}/{color}/walk.png'),128 if class_id=='bow' else 64)]
    if slot=='armor' and item=='basic':
        if class_id=='bow':
            return [(cloth(cached(SHIRT),'bluegray'),64)]
        return [(cloth(cached(SKIRT),COLORS[color][0]),64),
                (cloth(cached(SHIRT),COLORS[color][1]),64)]
    tile=128 if class_id=='bow' else 64
    if slot=='armor':
        return [(generated(f'class-layers/{class_id}/armor/{item}/walk.png'),tile)]
    if slot=='shield':
        return [(generated(f'class-layers/{class_id}/shield/{item}/walk.png'),tile)]
    if class_id=='bow':
        return [(generated(f'class-layers/bow/weapon/{item}/walk-back.png'),128),
                (generated(f'class-layers/bow/weapon/{item}/walk-front.png'),128)]
    return [(generated(f'class-layers/wand/weapon/{item}/walk-front.png'),64)]

def select_frame(layers):
    # Evaluate original direction rows; favor the frontal pose, but prefer
    # a side view if it shows more of a bow, sword, or other narrow object.
    tile=max(layer_tile for _,layer_tile in layers)
    if any(layer_tile!=tile for _,layer_tile in layers):
        raise ValueError('Item icon layers must use matching LPC tiles')
    candidates=[]
    for row in (2,1,3,0):
        for frame in (0,2,1):
            picture=Image.new('RGBA',(tile,tile))
            for im,layer_tile in layers:
                if im.height!=4*tile or im.width<(frame+1)*tile:
                    raise ValueError('Invalid source item sprite sheet dimensions')
                piece=im.crop((frame*tile,row*tile,(frame+1)*tile,(row+1)*tile))
                picture.alpha_composite(piece)
            alpha=picture.getchannel('A')
            bbox=alpha.getbbox()
            if not bbox:
                continue
            bw,bh=bbox[2]-bbox[0],bbox[3]-bbox[1]
            # Count visible pixels and reward a clear item outline, not
            # transparency in 64x64/128x128 LPC animation cells.
            visible=sum(a>16 for a in alpha.getdata())
            score=(max(bw,bh)*2+visible*.05)+(3 if row==2 else 0)
            candidates.append((score,picture,bbox))
    if not candidates:
        raise ValueError('Empty original LPC item artwork')
    _,picture,bbox=max(candidates,key=lambda x:x[0])
    return picture.crop(bbox)

def icon(layers):
    figure=select_frame(layers)
    # Keep the native pixel silhouette; do not blur edges or add a color swatch.
    inner=IMAGE_SIZE-10
    scale=min(inner/figure.width,inner/figure.height)
    target=(max(1,round(figure.width*scale)),max(1,round(figure.height*scale)))
    sized=figure.resize(target,Image.Resampling.NEAREST)
    picture=Image.new('RGBA',(IMAGE_SIZE,IMAGE_SIZE))
    picture.alpha_composite(sized,((IMAGE_SIZE-target[0])//2,(IMAGE_SIZE-target[1])//2))
    if not picture.getchannel('A').getbbox():
        raise ValueError('Generated icon is empty')
    return picture

def color_dependent(class_id,slot,item):
    return ((slot=='armor' and item=='basic' and class_id in ('sword','wand'))
        or (slot=='helmet' and item=='basic' and class_id in ('bow','wand')))

def write_icon(class_id,slot,item,color):
    result=icon(parts(class_id,slot,item,color))
    relative=f'{class_id}/{slot}/{item}/'+color+'.png' if color_dependent(class_id,slot,item) else f'{class_id}/{slot}/{item}.png'
    target=OUT/relative
    target.parent.mkdir(parents=True,exist_ok=True)
    result.save(target,optimize=True)
    records.append({'class':class_id,'slot':slot,'item':item,'color':color if color_dependent(class_id,slot,item) else None,'path':'assets/equipment/icons/'+relative})

if __name__=='__main__':
    for class_id in CLASSES:
        for slot,items in SLOTS.items():
            if class_id!='sword' and slot=='helmet':
                ids=('basic','iron','royal')
            else:
                ids=items
            for item in ids:
                colors=COLORS.keys() if color_dependent(class_id,slot,item) else ('sand',)
                for color in colors:
                    write_icon(class_id,slot,item,color)
    (OUT/'manifest.json').write_text(json.dumps({
        'source':'Original Universal LPC equipment PNGs, same pin as generators',
        'iconSize':IMAGE_SIZE,
        'icons':records
    },ensure_ascii=False,indent=2)+'\n')
    print(f'Created {len(records)} cropped, transparent LPC item icons',flush=True)
