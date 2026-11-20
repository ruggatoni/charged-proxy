"""veadotube avatar for chargedgoat1, matched to the Minecraft skin:
- smooth blue-grey head with a thin square face outline fading teal -> blue -> purple -> magenta
- blocky 'eyes' attached to the inside left/right of that outline
- soft slate / mauve body with thin rainbow pinstripes running down the edges of each limb
Usage: python _make_avatar.py <output folder>   (needs Pillow)
"""
import colorsys, os, sys, random
from PIL import Image, ImageFilter, ImageChops

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
W, H, S = 64, 58, 12
T = (0, 0, 0, 0)

def hexc(h): h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
def mix(a, b, t): return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3)) + (255,)
def shade(c, f): return tuple(max(0, min(255, int(v * f))) for v in c[:3]) + (255,)
def hue(h, s=0.85, v=0.75):
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, s, v); return (int(r * 255), int(g * 255), int(b * 255), 255)

HEAD = (16, 2, 48, 34)
TORSO = (16, 34, 48, H)
ARM_L = (2, 36, 16, H)
ARM_R = (48, 36, 62, H)
# face frame (outer box) and thickness
FX0, FY0, FX1, FY1, TH = 21, 5, 44, 29, 2

def head_color(x, y):
    hx0, hy0, hx1, hy1 = HEAD
    u = (x - hx0) / (hx1 - hx0); v = (y - hy0) / (hy1 - hy0)
    c = mix(hexc('#8792b4'), hexc('#7c6f9c'), u * 0.55 + v * 0.45)   # blue-grey -> lavender
    r = random.Random(x * 131 + y * 7)
    c = shade(c, 0.97 + r.random() * 0.05)                          # very faint grain
    if y == hy0: c = shade(c, 1.12)
    if x == hx0: c = shade(c, 1.05)
    if x == hx1 - 1: c = shade(c, 0.86)
    if y >= hy1 - 2: c = shade(c, 0.88)
    return c

def body_color(x, y, region):
    x0, y0, x1, y1 = region
    u = (x - x0) / max(1, x1 - x0 - 1); v = (y - y0) / max(1, y1 - y0 - 1)
    top = hexc('#6f7699') if region != ARM_R else hexc('#7a7d96')
    bot = hexc('#6a5f7c') if region != ARM_R else hexc('#6e7484')
    c = mix(top, bot, v)
    if region == TORSO: c = mix(c, hexc('#755e72'), 0.25 * (1 - abs(u - 0.5) * 2))  # mauve centre
    r = random.Random(x * 17 + y * 101)
    return shade(c, 0.96 + r.random() * 0.06)

def frame_color(x, y):
    """Teal top-left -> blue -> indigo -> purple -> magenta bottom-right."""
    t = ((x - FX0) / (FX1 - FX0) * 0.55 + (y - FY0) / (FY1 - FY0) * 0.45)
    stops = [(0.0, '#1585b5'), (0.3, '#1a3fc0'), (0.55, '#2a1fb0'), (0.8, '#5a1aa8'), (1.0, '#8a1590')]
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if t <= b: return mix(hexc(ca), hexc(cb), (t - a) / (b - a))
    return hexc(stops[-1][1])

def build_base():
    img = Image.new('RGBA', (W, H), T); px = img.load()
    for reg in (TORSO, ARM_L, ARM_R):
        for y in range(reg[1], reg[3]):
            for x in range(reg[0], reg[2]):
                px[x, y] = body_color(x, y, reg)
    # rainbow pinstripes down the limb edges (like the skin's coloured seams)
    def stripe(x, y0, y1, h0, h1, v=0.62):
        for y in range(y0, y1):
            t = (y - y0) / max(1, y1 - y0 - 1)
            px[x, y] = hue(h0 + (h1 - h0) * t, 0.9, v)
    stripe(ARM_L[0] + 2, ARM_L[1] + 2, H, 0.66, 0.98)          # blue -> purple -> red
    stripe(ARM_L[2] - 2, ARM_L[1] + 3, H, 0.74, 1.0, 0.55)
    stripe(TORSO[0] + 3, TORSO[1] + 3, H, 0.78, 1.02, 0.5)     # purple -> dark red
    stripe(TORSO[2] - 4, TORSO[1] + 4, H, 1.0, 1.2, 0.45)      # dark red -> olive
    stripe(ARM_R[0] + 2, ARM_R[1] + 3, H, 1.06, 1.3, 0.55)     # orange -> green
    stripe(ARM_R[2] - 3, ARM_R[1] + 2, H, 1.12, 1.48, 0.7)     # yellow -> green -> teal
    # waistline hint
    for x in range(TORSO[0] + 6, TORSO[2] - 6):
        if x % 3: px[x, H - 3] = mix(px[x, H - 3], hexc('#d8dccb'), 0.55)
    # shoulder tops
    for x in range(ARM_L[0], ARM_L[2]):
        for y in (ARM_L[1], ARM_L[1] + 1):
            px[x, y] = hexc('#a9b3ee') if y == ARM_L[1] else hexc('#8f9be0')
    for x in (ARM_L[0] + 3, ARM_L[0] + 4, ARM_L[0] + 8, ARM_L[0] + 9, ARM_L[0] + 11):
        px[x, ARM_L[1] + 1] = hexc('#2440e0')
    for x in range(ARM_R[0], ARM_R[2]):
        t = (x - ARM_R[0]) / (ARM_R[2] - ARM_R[0])
        px[x, ARM_R[1]] = mix(hexc('#e8b2bd'), hexc('#a9dbe8'), t)
        px[x, ARM_R[1] + 1] = mix(hexc('#d89aa6'), hexc('#8fc6d6'), t)
    px[ARM_R[0] + 3, ARM_R[1] + 1] = hexc('#e2621a'); px[ARM_R[0] + 4, ARM_R[1] + 1] = hexc('#e2621a')
    px[ARM_R[0] + 7, ARM_R[1] + 1] = hexc('#d02020'); px[ARM_R[0] + 10, ARM_R[1] + 1] = hexc('#30c060')
    # inner shading where arms meet torso, and the head's shadow on the body
    for y in range(TORSO[1], H):
        px[TORSO[0], y] = shade(px[TORSO[0], y], 0.75); px[TORSO[2] - 1, y] = shade(px[TORSO[2] - 1, y], 0.75)
    for x in range(TORSO[0], TORSO[2]):
        for dy, f in ((0, 0.7), (1, 0.82), (2, 0.92)): px[x, TORSO[1] + dy] = shade(px[x, TORSO[1] + dy], f)
    # head
    for y in range(HEAD[1], HEAD[3]):
        for x in range(HEAD[0], HEAD[2]):
            px[x, y] = head_color(x, y)
    # small light corner ticks like the skin's head edges
    px[HEAD[0] + 1, HEAD[1] + 1] = hexc('#a7a0d6'); px[HEAD[2] - 2, HEAD[1] + 1] = hexc('#a7a0d6')
    # face frame
    for y in range(FY0, FY1):
        for x in range(FX0, FX1):
            if x < FX0 + TH or x >= FX1 - TH or y < FY0 + TH or y >= FY1 - TH:
                px[x, y] = frame_color(x, y)
    return img

# ---- expressions: blocks attached to the inside of the frame ----
def blk(x0, y0, w, h): return {(x, y) for x in range(x0, x0 + w) for y in range(y0, y0 + h)}
IL, IR = FX0 + TH, FX1 - TH  # inner left x, inner right x (exclusive)

def eyes(kind):
    if kind == 'open':     # as on the skin: left block mid-height, right block slightly higher
        return blk(IL, 15, 4, 4) | blk(IR - 4, 14, 4, 4)
    if kind == 'blink':
        return blk(IL, 17, 4, 1) | blk(IR - 4, 16, 4, 1)
    if kind == 'happy':    # squinted: thin blocks with a raised inner tip
        return blk(IL, 16, 4, 2) | blk(IL + 3, 15, 1, 1) | blk(IR - 4, 15, 4, 2) | blk(IR - 4, 14, 1, 1)
    if kind == 'wide':
        return blk(IL, 13, 5, 7) | blk(IR - 5, 12, 5, 7)

BY = FY1 - TH  # bottom inner edge y (exclusive)
def mouth(kind):
    if kind == 'none': return set()
    if kind == 'talk':     # a block rising from the bottom edge
        return blk(29, BY - 3, 6, 3)
    if kind == 'grin':
        return blk(27, BY - 2, 10, 2) | blk(29, BY - 4, 6, 2)
    if kind == 'small':
        return blk(30, BY - 2, 4, 2)
    if kind == 'o':
        return blk(30, BY - 5, 4, 1) | blk(29, BY - 4, 1, 4) | blk(34, BY - 4, 1, 4) | blk(30, BY - 1, 4, 1)

def outline(img):
    a = img.split()[3]
    ring = ImageChops.subtract(a.filter(ImageFilter.MaxFilter(3)), a)
    o = Image.new('RGBA', img.size, hexc('#1a1924')); o.putalpha(ring)
    return Image.alpha_composite(o, img)

def render(base, eye, mth, name):
    img = base.copy(); px = img.load()
    for (x, y) in eyes(eye) | mouth(mth):
        px[x, y] = frame_color(x, y)
    out = outline(img).resize((W * S, H * S), Image.NEAREST)
    out.save(os.path.join(OUT, name + '.png'))
    return out

base = build_base()
frames = [
    ('open', 'none', '1_idle'), ('blink', 'none', '1_idle_blink'),
    ('open', 'talk', '1_talk'), ('blink', 'talk', '1_talk_blink'),
    ('happy', 'small', '2_happy_idle'), ('happy', 'grin', '2_happy_talk'),
    ('wide', 'none', '3_shocked_idle'), ('wide', 'o', '3_shocked_talk'),
]
imgs = [render(base, e, m, n) for e, m, n in frames]

cols, pad = 4, 30
tw, th = imgs[0].size[0] // 2, imgs[0].size[1] // 2
sheet = Image.new('RGBA', (cols * (tw + pad) + pad, 2 * (th + pad) + pad), hexc('#2b4a2a'))
for i, im in enumerate(imgs):
    sheet.alpha_composite(im.resize((tw, th), Image.NEAREST), (pad + (i % cols) * (tw + pad), pad + (i // cols) * (th + pad)))
sheet.save(os.path.join(OUT, '_preview_sheet.png'))
print('done')
