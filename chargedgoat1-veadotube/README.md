# chargedgoat1: veadotube avatar

A pixel-art facecam matched to the Minecraft skin: a smooth blue-grey head with a teal-to-purple square face outline and blocky eyes, and a slate body with rainbow pinstripe edges. When talking, a block rises from the bottom of the face outline.
Every PNG is 768×696 with a transparent background.

| State   | Not talking (idle)    | Talking            |
|---------|-----------------------|--------------------|
| Normal  | `1_idle.png`          | `1_talk.png`       |
| Blink   | `1_idle_blink.png`    | `1_talk_blink.png` |
| Happy   | `2_happy_idle.png`    | `2_happy_talk.png` |
| Shocked | `3_shocked_idle.png`  | `3_shocked_talk.png` |

## Setup in veadotube mini
1. Create a state called **normal**. Set its idle image to `1_idle.png` and its talking image to `1_talk.png`.
2. Turn on blinking for that state and use `1_idle_blink.png` and `1_talk_blink.png`.
3. Create **happy** and **shocked** states from the `2_` and `3_` files, and give each one a hotkey so you can switch reactions live.
4. A small "bounce while talking" setting suits the blocky look.
5. In OBS, add veadotube with a transparent background and place it in a corner like a facecam.

`_preview_sheet.png` shows all eight frames. `_make_avatar.py` is the script that drew them. Run `python _make_avatar.py <output folder>` (needs Pillow) to regenerate them after editing colors or faces.
