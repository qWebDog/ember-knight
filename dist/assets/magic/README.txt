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
