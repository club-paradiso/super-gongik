import sys, cairosvg, io
from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageFont
before_svg, after_svg, out = sys.argv[1], sys.argv[2], sys.argv[3]
def render(svg, n): return Image.open(io.BytesIO(cairosvg.svg2png(url=svg, output_width=n, output_height=n))).convert('RGB')
A = render(after_svg, 1024); B = render(before_svg, 1024)
def down(im, n): return im.resize((n, n), Image.LANCZOS)
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except: F = ImageFont.load_default()
def label(d, xy, t, fill='#222'): d.text(xy, t, fill=fill, font=F)
sizes = [1024, 512, 256, 128, 64, 32]
for n in sizes: down(A, n).save(f'{out}/icon_{n}.png')
# contact sheet: actual pixel sizes, plus 4x nearest zoom of 64/32
W = 1024 + 512 + 256 + 128 + 64 + 32 + 7 * 24
sheet = Image.new('RGB', (W, 1024 + 80 + 300), '#EEECE6'); d = ImageDraw.Draw(sheet)
x = 24
for n in sizes:
    sheet.paste(down(A, n), (x, 60)); label(d, (x, 20), f'{n}px'); x += n + 24
x = 24 + 1024 + 24
y = 60 + 512 + 60
for n in (128, 64, 32):
    z = down(A, n).resize((256, 256), Image.NEAREST); sheet.paste(z, (x, y)); label(d, (x, y - 34), f'{n}px @ zoom'); x += 256 + 24
sheet.save(f'{out}/qa_contact_sheet.png')
# grayscale + blur/squint
g = Image.new('RGB', (4 * 540 + 24, 600), '#EEECE6'); d = ImageDraw.Draw(g)
for i, (im, t) in enumerate([(B, 'CURRENT gray'), (A, 'REFINED gray')]):
    g.paste(ImageOps.grayscale(down(im, 512)).convert('RGB'), (24 + i * 540, 64)); label(d, (24 + i * 540, 20), t)
for i, (im, t) in enumerate([(B, 'CURRENT squint'), (A, 'REFINED squint')]):
    s = down(im, 48).resize((512, 512), Image.BILINEAR).filter(ImageFilter.GaussianBlur(6))
    g.paste(s, (24 + (i + 2) * 540, 64)); label(d, (24 + (i + 2) * 540, 20), t)
g.save(f'{out}/qa_grayscale_squint.png')
# masks: iOS squircle-ish rounded rect (22.37%) and Android adaptive (safe-zone circle 66/108 + rounded square)
def masked(im, n, kind):
    m = Image.new('L', (n * 4, n * 4), 0); dm = ImageDraw.Draw(m)
    if kind == 'ios': dm.rounded_rectangle((0, 0, n * 4 - 1, n * 4 - 1), radius=int(n * 4 * 0.2237), fill=255)
    elif kind == 'android_circle': dm.ellipse((0, 0, n * 4 - 1, n * 4 - 1), fill=255)
    else: dm.rounded_rectangle((0, 0, n * 4 - 1, n * 4 - 1), radius=int(n * 4 * 0.12), fill=255)
    m = m.resize((n, n), Image.LANCZOS)
    bg = Image.new('RGB', (n, n), '#D9D6CE'); bg.paste(down(im, n), (0, 0), m); return bg
def adaptive(im, n):
    # adaptive icon: 108dp layer, 72dp visible; full-bleed art is scaled so the 72dp viewport shows ~center 66.7%
    big = down(im, int(n * 108 / 72)); o = (big.width - n) // 2
    return masked(big.crop((o, o, o + n, o + n)), n, 'android_circle')
mk = Image.new('RGB', (4 * 300 + 5 * 24, 2 * 340 + 40), '#D9D6CE'); d = ImageDraw.Draw(mk)
for r, (im, t) in enumerate([(B, 'CURRENT'), (A, 'REFINED')]):
    tiles = [(masked(im, 300, 'ios'), 'iOS'), (masked(im, 300, 'android'), 'Android'), (adaptive(im, 300), 'Adaptive'), (masked(im, 96, 'ios').resize((96, 96)), '96px')]
    for c, (tile, tt) in enumerate(tiles):
        mk.paste(tile, (24 + c * 324, 50 + r * 340)); label(d, (24 + c * 324, 20 + r * 340), f'{t} {tt}')
mk.save(f'{out}/qa_launcher_masks.png')
# before / after
ba = Image.new('RGB', (2 * 1024 + 72, 1024 + 80 + 400), '#EEECE6'); d = ImageDraw.Draw(ba)
for i, (im, t) in enumerate([(B, 'CURRENT (Figma 95:3)'), (A, 'REFINED (V2)')]):
    ox = 24 + i * (1024 + 24)
    ba.paste(im, (ox, 60)); label(d, (ox, 20), t)
    x = ox; y = 1024 + 100
    for n in (256, 128, 64):
        ba.paste(down(im, n), (x, y)); label(d, (x, y + n + 6), f'{n}px'); x += n + 40
ba.save(f'{out}/qa_before_after.png')
print('done')
