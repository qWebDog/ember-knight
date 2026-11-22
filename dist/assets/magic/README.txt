EMBER magic projectiles
Custom pixel-art effects generated from the approved fire, ice and shadow concepts.
Each transparent sheet is 384 x 192: 6 columns, 3 rows, 64 x 64 cells.
Row 0: appearance, six frames over 0.42 seconds.
Row 1: flight, six frames over 0.48 seconds; loopable.
Row 2: impact, six frames over 0.42 seconds.
All source sprites face left. The renderer rotates them around the leading core.
Fire and ice are player choices. Shadow belongs to the NPC mage.
These effects are separate from Universal LPC character assets.

At melee contact, player fire/ice use 0.18s appearance +0.12s flight +0.42s impact; casts repeat every0.8s.
Distant player magic remains 0.42s +0.48s +0.42s, every1.2s. Flight timing is locked at cast time.

Fire and ice status overlays
status-effects.png is the unchanged generated/edited image_gen artwork for EMBER.
Full sheet: 2172 x 724 RGBA, 6 columns x 2 rows, 362 x 362 cells.
Top row: fire. Bottom row: ice. Each row plays once, left to right,
six frames over 0.5 seconds (approximately 83.33 ms per frame).
The approximate foot anchor is (0.5,0.94) within each source cell.
Ice peak centers retain actual source alpha: frame 2 center 224/255,
frame 3 center 227/255. Recommended whole-ice-overlay opacity is 0.65.
No source cells were cropped, resized or otherwise edited during integration.
This status artwork is separate from Universal LPC character artwork;
existing LPC character attribution and the projectile manifest remain unchanged.
See status-effects.json for source provenance, checksum and observed bounds.
