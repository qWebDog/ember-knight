#!/usr/bin/env python3
"""Build native LPC warrior weapon/shield combinations, replacing the old gear.

Original assets come from the same pinned Universal LPC revision used by
build-loadouts.py. Composes in zPos order, so the *original* sword and shield
are not hidden under a second copy. Default gear is checked pixel-for-pixel
against the game's existing sword loadouts.
"""
from __future__ import annotations
from pathlib import Path
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageColor, ImageChops, ImageOps
import argparse
import json
import urllib.request

PROJECT = Path(__file__).resolve().parents[1]
SCRIPTS = PROJECT / 'scripts'
ROOT = PROJECT / 'dist/assets/characters/loadouts'
OUTPUT = PROJECT / 'dist/assets/equipment/sword-packs'
FRONT = PROJECT / 'dist/assets/equipment/front-layers'
CACHE = PROJECT / '.cache/lpc'
REV = '86a3719ee4a7e2e9fb27c7c152e29a741d3e930a'
BASE = ('https://raw.githubusercontent.com/LiberatedPixelCup/'
        f'Universal-LPC-Spritesheet-Character-Generator/{REV}/')
COLORS = {
    'sand': ('tan', 'white'), 'forest': ('forest', 'green'),
    'blue': ('navy', 'blue'), 'red': ('maroon', 'red'),
    'purple': ('purple', 'lavender'), 'gray': ('gray', 'slate')
}
SKINS = ('light', 'amber', 'olive', 'bronze', 'brown', 'black')
POSES = (('walk', 'walk', 9, 64), ('attack', 'slash', 6, 128),
         ('halfslash', 'halfslash', 6, 128),
         ('backslash', 'backslash', 13, 128),
         ('block', 'combat_idle', 1, 64))
WEAPONS = {'basic': 'steel', 'steel': 'silver', 'ember': 'gold'}
SHIELDS = ('basic', 'steel', 'royal')
SHIELD_PALETTE = {
    'steel': {'wood': ('#233842', '#b3ccd5'), 'trim': ('#52616e', '#f1f7f5')},
    'royal': {'wood': ('#452c36', '#b94e55'), 'trim': ('#76522e', '#f0d083')}
}
parser = argparse.ArgumentParser()
parser.add_argument('--quick', action='store_true', help='One skin/color, for a smoke test')
args = parser.parse_args()

def source(path: str) -> Path:
    target = CACHE / path
    if target.is_file():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    data = urllib.request.urlopen(BASE + path, timeout=45).read()
    target.write_bytes(data)
    return target

@lru_cache(None)
def read(path):
    return Image.open(source(path)).convert('RGBA')

@lru_cache(None)
def palette(name):
    return json.loads(source(f'palette_definitions/{name}/{name}_ulpc.json').read_text())

@lru_cache(None)
def recolored(path, material, color):
    im = read(path)
    if not color: return im
    base = 'light' if material == 'body' else 'white'
    if color == base: return im
    colors = palette(material)
    original, target = colors[base], colors[color]
    mapping = {ImageColor.getrgb(old): ImageColor.getrgb(new)
               for old, new in zip(original, target)}
    new = im.copy()
    new.putdata([(*mapping.get(p[:3], p[:3]), p[3]) if p[3] else p
                 for p in im.getdata()])
    return new

@lru_cache(None)
def shield_color(path, tone, part):
    im = read(path)
    if tone == 'basic': return im
    lo, hi = SHIELD_PALETTE[tone][part]
    shade = ImageOps.grayscale(im)
    colored = ImageOps.colorize(shade, lo, hi).convert('RGBA')
    colored.putalpha(im.getchannel('A'))
    return colored

def appearance_layers(animation, skin, cloth_color):
    main, _ = COLORS[cloth_color]
    base = [
        (10, f'spritesheets/body/bodies/male/{animation}.png', 'body', skin),
        (100, f'spritesheets/head/heads/human/male/{animation}.png', 'body', skin),
    ]
    recipe = json.loads((SCRIPTS / 'sword-recipes.json').read_text())['militia']['layers']
    for layer in recipe:
        path = layer['sources']['walk'].replace('/walk', '/{a}').format(a=animation)
        if 'torso/waist/belt_leather/' in path: continue
        col = layer.get('recolor')
        color = col.get('palette') if col and col.get('material') == 'cloth' else None
        if 'torso/clothes/longsleeve/' in path: color = main
        base.append((layer['zPos'], path, 'cloth', color))
    return [(z, recolored(path, material, color), 64)
            for z, path, material, color in base]

def equipment_layers(animation, weapon, shield):
    # Original zPos and handedness exactly match build-loadouts.py.
    material = WEAPONS[weapon]
    if animation in ('walk', 'combat_idle'):
        sword = [
            (9, f'weapon/sword/arming/universal/bg/{animation}/{material}.png', 64),
            (140, f'weapon/sword/arming/universal/fg/{animation}/{material}.png', 64),
        ]
    else:
        sword = [
            (8, f'weapon/sword/arming/attack_{animation}/bg/{material}.png', 128),
            (150 if animation in ('halfslash', 'backslash') else 140,
             f'weapon/sword/arming/attack_{animation}/fg/{material}.png', 128),
        ]
    result = [(z, read('spritesheets/' + p), tile) for z, p, tile in sword]
    for z, kind, side in ((2, 'wood', 'bg'), (6, 'trim', 'bg'),
                         (110, 'wood', 'fg'), (115, 'trim', 'fg')):
        if animation in ('walk', 'slash') and side == 'bg': continue
        path = f'spritesheets/shield/heater/original/{kind}/{side}/{animation}.png'
        full = path
        result.append((z, shield_color(full, shield, kind), 64))
    return sorted(result, key=lambda layer: layer[0])

def sheet_layers(layers, frames, tile):
    sheet = Image.new('RGBA', (frames * tile, 4 * tile))
    ordered = sorted(layers, key=lambda layer: layer[0])
    for row in range(4):
        for frame in range(frames):
            for _, image, src_tile in ordered:
                if image.height != 4 * src_tile or image.width < frames * src_tile:
                    raise ValueError('Incompatible LPC image dimensions: '
                                     f'{image.size}, expected {frames} x {src_tile}')
                piece = image.crop((frame * src_tile, row * src_tile,
                                    (frame + 1) * src_tile, (row + 1) * src_tile))
                offset = (tile - src_tile) // 2
                sheet.alpha_composite(piece,
                                      (frame * tile + offset, row * tile + offset))
    return sheet

def compose(body, gear, frames, tile):
    # z<10 behind the body, z>=10 on top. The base body is already sorted:
    # body/head/clothing all occupy z10..100. New shield/sword foreground
    # layers run at z110..150, as in the original generator.
    back = [entry for entry in gear if entry[0] < 10]
    front = [entry for entry in gear if entry[0] >= 10]
    output = sheet_layers(back, frames, tile)
    output.alpha_composite(body)
    output.alpha_composite(sheet_layers(front, frames, tile))
    return output

def build_foreground_layers():
    """Sparse native LPC foreground atlases with their original zPos.

    Armor is z60, heater shield foreground z110/115, helmet z130,
    and arming-sword foreground z140/150. Repainting just the actual
    front-layer pixels after a torso overlay restores the correct depth
    without producing 3×3×3×3×36×5 full-image combinations.
    """
    written = 0
    for _, animation, frames, tile in POSES:
        for weapon in WEAPONS:
            gear = equipment_layers(animation, weapon, 'basic')
            top = [(z, im, st) for z, im, st in gear if z >= 140]
            if not top:
                raise ValueError(f'Missing native sword foreground: {weapon}/{animation}')
            dest = FRONT / 'weapon' / weapon
            dest.mkdir(parents=True, exist_ok=True)
            sheet_layers(top, frames, tile).save(dest / f'{animation}.png', optimize=True)
            written += 1
        for shield in SHIELDS:
            gear = equipment_layers(animation, 'basic', shield)
            top = [(z, im, st) for z, im, st in gear if 110 <= z < 130]
            if not top:
                raise ValueError(f'Missing native shield foreground: {shield}/{animation}')
            dest = FRONT / 'shield' / shield
            dest.mkdir(parents=True, exist_ok=True)
            sheet_layers(top, frames, tile).save(dest / f'{animation}.png', optimize=True)
            written += 1
    if written != 30:
        raise ValueError(f'Expected 30 LPC front-layer atlases; got {written}')
    (FRONT / 'CREDITS.md').write_text(
        'Foreground layers for official Universal LPC arming sword and original '
        'heater shield. Sources: https://github.com/LiberatedPixelCup/'
        'Universal-LPC-Spritesheet-Character-Generator at commit ' + REV +
        '. Source artwork and license attribution are detailed in '
        'dist/assets/characters/loadouts/CREDITS.txt. Shield colors are '
        'recolorings of the original heater shape; the underlying '
        'pose geometry and direction frames are unchanged.\n')
    print(f'READY {written} original LPC sword/shield foreground atlases', flush=True)


def build(color, skin):
    written = 0
    for outa, animation, frames, tile in POSES:
        body = sheet_layers(appearance_layers(animation, skin, color), frames, tile)
        default = compose(body, equipment_layers(animation, 'basic', 'basic'), frames, tile)
        baseline = Image.open(ROOT / f'sword/militia/{color}/{skin}-{outa}.png').convert('RGBA')
        if baseline.size != default.size or ImageChops.difference(baseline, default).getbbox():
            raise ValueError(f'Default sprite differs from original LPC loadout: '
                             f'{color}/{skin}/{outa}')
        dest = OUTPUT / color
        dest.mkdir(parents=True, exist_ok=True)
        for weapon in WEAPONS:
            for shield in SHIELDS:
                if weapon == shield == 'basic': continue
                gear = equipment_layers(animation, weapon, shield)
                result = compose(body, gear, frames, tile)
                target = dest / f'{skin}-{weapon}-{shield}-{outa}.png'
                result.save(target, optimize=True)
                written += 1
    return written

def prefetch():
    needed = set()
    for _, animation, _, _ in POSES:
        needed.add(f'spritesheets/body/bodies/male/{animation}.png')
        needed.add(f'spritesheets/head/heads/human/male/{animation}.png')
        for layer in json.loads((SCRIPTS / 'sword-recipes.json').read_text())['militia']['layers']:
            item = layer['sources']['walk'].replace('/walk', '/{a}').format(a=animation)
            if 'torso/waist/belt_leather/' not in item: needed.add(item)
        for weapon in WEAPONS:
            material = WEAPONS[weapon]
            for side in ('bg', 'fg'):
                pattern = (f'weapon/sword/arming/universal/{side}/{animation}/{material}.png'
                           if animation in ('walk','combat_idle') else
                           f'weapon/sword/arming/attack_{animation}/{side}/{material}.png')
                needed.add('spritesheets/' + pattern)
        for kind in ('wood','trim'):
            for side in ('bg','fg'):
                if animation in ('walk', 'slash') and side == 'bg': continue
                needed.add(f'spritesheets/shield/heater/original/{kind}/{side}/{animation}.png')
    needed.update(('palette_definitions/body/body_ulpc.json',
                   'palette_definitions/cloth/cloth_ulpc.json'))
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(source, sorted(needed)))
    print(f'Fetched/cached {len(needed)} pinned original LPC resources', flush=True)

if __name__ == '__main__':
    prefetch()
    build_foreground_layers()
    colors = ('sand',) if args.quick else COLORS.keys()
    skins = ('light',) if args.quick else SKINS
    count = 0
    for color in colors:
        for skin in skins:
            count += build(color, skin)
            print(f'READY {color}/{skin}: {count} PNGs', flush=True)
    expected = (1 if args.quick else len(COLORS) * len(SKINS)) * len(POSES) * 8
    if count != expected:
        raise RuntimeError(f'Expected {expected} variant images, generated {count}')
    (OUTPUT / 'README.md').write_text(
        'Generated from original Universal LPC source revision ' + REV +
        '\n8 alternate weapon+shield combinations for 6 outfit colors, 6 skin'
        ' colors and 5 warrior poses. Native weapon color materials: steel'
        ' (default), silver, gold. Official heater shield shapes recolored'
        ' through greyscale while retaining original animated geometry.\n'
        'For author and license attribution see the existing LPC CREDITS'
        ' and dist/assets/equipment/lpc/CREDITS.md.\n')
    print(f'DONE {count} fully composed LPC framesheets', flush=True)
