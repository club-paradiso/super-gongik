"""SUPER-GONGIK app icon — premium polish pass (v2).

Input : Figma export of node 95:3 ("현재 작업중인 버전"), 5000x5000.
Output: editable, layer-named SVG master.

Every change is attribute/geometry level on the existing traced artwork:
same shapes, same composition, fewer tones, fewer fragments, one light system.
"""
import re, sys, math, copy
import xml.etree.ElementTree as ET
from svgpathtools import parse_path, Path
from shapely.geometry import Polygon, MultiPolygon, Point, box
from shapely.ops import unary_union
from shapely.validation import make_valid

SVGNS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVGNS)
N = '{%s}' % SVGNS

SRC, DST = sys.argv[1], sys.argv[2]
tree = ET.parse(SRC)
root = tree.getroot()
parent = {c: p for p in root.iter() for c in p}
byid = {e.get('id'): e for e in root.iter() if e.get('id')}
ORIG_D = {e.get('id'): e.get('d') for e in root.iter() if e.get('id') and e.get('d')}
defs = root.find(N + 'defs')

SUN_C = (1417.0, 3278.4)   # sun centre = the single key light (behind the officer)
SUN_R = 1102.4


def el(i):
    return byid[i]


def remove(i):
    e = byid.pop(i, None)
    if e is not None:
        parent[e].remove(e)


def paths_in(e):
    return [p for p in e.iter(N + 'path')]


def set_fill(p, color):
    p.set('fill', color)
    if p.get('stroke') and p.get('stroke') != 'none':
        # traced shapes carry a same-colour 0.5 hairline; keep it in sync
        p.set('stroke', color)


def recolor(group_id, mapping, default=None):
    for p in paths_in(el(group_id)):
        f = (p.get('fill') or '').upper()
        if f in mapping:
            set_fill(p, mapping[f])
        elif default:
            set_fill(p, default)


# ---------------------------------------------------------------- geometry
def subpaths(d):
    path = parse_path(d)
    return path.continuous_subpaths()


def bbox_area(sp):
    x0, x1, y0, y1 = sp.bbox()
    return (x1 - x0) * (y1 - y0), max(x1 - x0, y1 - y0)


def fmt(v):
    s = ('%.1f' % v).rstrip('0').rstrip('.')
    return '0' if s == '-0' else s


def sp_to_d(sp):
    out = []
    for seg in sp:
        n = type(seg).__name__
        if not out:
            out.append('M%s %s' % (fmt(seg.start.real), fmt(seg.start.imag)))
        if n == 'Line':
            out.append('L%s %s' % (fmt(seg.end.real), fmt(seg.end.imag)))
        elif n == 'CubicBezier':
            out.append('C%s %s %s %s %s %s' % tuple(fmt(v) for v in (
                seg.control1.real, seg.control1.imag, seg.control2.real,
                seg.control2.imag, seg.end.real, seg.end.imag)))
        elif n == 'QuadraticBezier':
            out.append('Q%s %s %s %s' % tuple(fmt(v) for v in (
                seg.control.real, seg.control.imag, seg.end.real, seg.end.imag)))
        else:  # arcs never appear in Figma exports, but stay safe
            out.append('L%s %s' % (fmt(seg.end.real), fmt(seg.end.imag)))
    out.append('Z')
    return ''.join(out)


KEPT = {}   # path id -> indices of original 'M' pieces kept (replayed in Figma)


def pieces(d):
    return [m.group(0) for m in re.finditer(r'M[^M]*', d)]


def prune(p, min_area, min_span=0):
    """Drop sub-shapes too small to read as intentional form (tonal crumbs)."""
    d = p.get('d')
    if not d:
        return 0
    pc = pieces(d)
    keep = []
    for i, piece in enumerate(pc):
        try:
            x0, x1, y0, y1 = parse_path(piece).bbox()
        except Exception:
            keep.append(i)
            continue
        if (x1 - x0) * (y1 - y0) >= min_area and max(x1 - x0, y1 - y0) >= min_span:
            keep.append(i)
    pid = p.get('id')
    prev = KEPT.get(pid)
    if prev is not None:   # second pass on an already-pruned path: map back to original indices
        keep = [prev[i] for i in keep]
    if len(keep) == len(prev if prev is not None else pc):
        return 0
    KEPT[pid] = keep
    if not keep:
        parent[p].remove(p)
        return 1
    orig = ORIG_D[pid]
    op = pieces(orig)
    p.set('d', ''.join(op[i] for i in keep))
    return 1


def prune_group(group_id, min_area, skip_base=True, min_span=0):
    n = 0
    for p in paths_in(el(group_id)):
        if skip_base and (p.get('id') or '').endswith('_base'):
            continue
        n += prune(p, min_area, min_span)
    return n


def sp_polygon(sp, step=6.0):
    pts = []
    for seg in sp:
        k = max(2, int(seg.length(error=1e-2) / step))
        for i in range(k):
            z = seg.point(i / k)
            pts.append((z.real, z.imag))
    if len(pts) < 3:
        return None
    g = make_valid(Polygon(pts))
    return g if not g.is_empty else None


def shape_of(ids):
    polys = []
    for i in ids:
        for p in paths_in(el(i)):
            for sp in subpaths(p.get('d')):
                g = sp_polygon(sp)
                if g is not None:
                    polys.append(g.buffer(0))
    return unary_union(polys)


def geom_to_d(g, simplify=1.2):
    g = g.simplify(simplify, preserve_topology=True)
    geoms = g.geoms if hasattr(g, 'geoms') else [g]
    out = []
    for poly in geoms:
        if poly.geom_type != 'Polygon' or poly.area < 400:
            continue
        for ring in [poly.exterior] + list(poly.interiors):
            c = list(ring.coords)
            out.append('M' + 'L'.join('%s %s' % (fmt(x), fmt(y)) for x, y in c[:-1]) + 'Z')
    return ''.join(out)


def new(tag, attrs, parent_el=None, index=None):
    e = ET.Element(N + tag, attrs)
    if parent_el is not None:
        if index is None:
            parent_el.append(e)
        else:
            parent_el.insert(index, e)
        parent[e] = parent_el
    if attrs.get('id'):
        byid[attrs['id']] = e
    return e


def grad(gid, kind, stops, **attrs):
    g = new(kind, dict(id=gid, gradientUnits='userSpaceOnUse', **{k.replace('_', '-'): str(v) for k, v in attrs.items()}), defs)
    for off, col, op in stops:
        a = {'offset': str(off), 'stop-color': col}
        if op != 1:
            a['stop-opacity'] = str(op)
        new('stop', a, g)
    return g


# =================================================================== PALETTE
# One controlled palette. Light = low sunset sun behind the officer (warm),
# fill = cool night sky from above-right.
P = dict(
    sky_top='#070E36', sky_mid='#141A5C', sky_low='#2F2573', sky_horizon='#6A3978',
    sun_core='#FFE7A3', sun_mid='#FFC45E', sun_edge='#FF9458',
    # clouds near the sun (left + bottom cluster)
    cw_light='#FFD493', cw_base='#F7A06C', cw_shade='#D8637A', cw_deep='#6F4A9C',
    # clouds far from the sun (right side) — same hues, lower chroma/value
    cc_light='#E9A98C', cc_base='#C77687', cc_shade='#91528A', cc_deep='#4A3A88',
    # dragon
    dr_cream='#F5ECDB', dr_warm='#F2C48A', dr_half='#7C68D2', dr_violet='#5645C2',
    dr_deep='#302C7C', dr_core='#141A52',
    # officer
    uni='#1B3E7C', uni_far='#132C5E', uni_shade='#0F2552', uni_light='#2A5294',
    pants='#1C2750', pants_far='#121A3A', boots='#0B1128', cap='#15244B',
    hair='#0B0F26', skin='#F39A6C', skin_shade='#B8543F',
    rim_warm='#FFB36B', rim_cool='#7C86D6',
    # land & water
    cliff='#090B1D', cliff_plane='#151942', cliff_top='#262B68', cliff_warm='#C86A4E',
    mtn_far='#3B3A8E', mtn_mid='#27297A', mtn_dark='#161A48', land_warm='#E99A6C',
    sea='#20246C', sea_deep='#141A52', sea_mid='#3F3FA0', sea_glint='#F7B47A',
)

# ================================================================ BACKGROUND
# 1) Full-bleed sky: vertical night-to-dusk gradient instead of 8 blotchy bands.
sky = el('sky_base_2')
grad('sky_grad', 'linearGradient', [
    (0, P['sky_top'], 1), (0.42, P['sky_mid'], 1), (0.72, P['sky_low'], 1), (1, P['sky_horizon'], 1)],
    x1=2500, y1=0, x2=2500, y2=5000)
sky.set('d', 'M0 0H5000V5000H0Z')
sky.set('fill', 'url(#sky_grad)')
# 2) Sunset bloom: one controlled radial gradient around the sun (no blur filter).
grad('sunset_bloom_grad', 'radialGradient', [
    (0, '#FF9A5C', 0.78), (0.38, '#E0607A', 0.42), (0.7, '#7A3D86', 0.16), (1, '#3A2A7A', 0)],
    cx=SUN_C[0], cy=SUN_C[1], r=3000)
bg = el('02_BACKGROUND')
new('rect', {'id': 'sunset_bloom', 'x': '0', 'y': '0', 'width': '5000', 'height': '5000',
             'fill': 'url(#sunset_bloom_grad)'}, bg, index=1)
# 3) Sun: cleaner radial ramp + one flat halo ring (graphic, not glow).
g0 = defs.find(".//*[@id='paint0_linear_95_3']")
defs.remove(g0)
grad('paint0_linear_95_3', 'radialGradient', [
    (0, P['sun_core'], 1), (0.55, P['sun_mid'], 1), (1, P['sun_edge'], 1)],
    cx=SUN_C[0] - 180, cy=SUN_C[1] - 260, r=SUN_R * 1.25)
sun_g = el('sun_disc')
new('circle', {'id': 'sun_halo', 'cx': fmt(SUN_C[0]), 'cy': fmt(SUN_C[1]), 'r': fmt(SUN_R * 1.2),
               'fill': '#FFB86A', 'fill-opacity': '0.11'}, sun_g, index=0)
# 4) Remove the noise layers: purple glow blobs, twilight bands, stroke-only
#    rounded-mask outlines (the curved artefact at bottom-right).
remove('sun_glow')
remove('twilight_gradient_or_bands')
# 5) Stars: keep only readable ones, away from the dragon's head/mane.
stars = el('stars')
stars.set('opacity', '0.9')
dragon_zone = box(1750, 150, 4500, 2300)
for p in list(paths_in(stars)):
    sp = subpaths(p.get('d'))
    x0, x1, y0, y1 = sp[0].bbox()
    c = Point((x0 + x1) / 2, (y0 + y1) / 2)
    big = max(x1 - x0, y1 - y0)
    if big < 30 or dragon_zone.contains(c) or (x0 > 2600 and y0 > 1500):
        remove(p.get('id'))

# ================================================================ MIDGROUND
mid = el('07_MIDGROUND_WATER')
mid.attrib.pop('opacity', None)
warm = ['#EBB06E', '#EA925C', '#E88494', '#E78162', '#D25C76', '#E6655F', '#EBCB92', '#EBBF5F']
recolor('mountains_back', {**{c: P['land_warm'] for c in warm},
                           '#303481': P['mtn_far'], '#503873': '#4B3882', '#7A436F': '#4B3882'})
recolor('mountains_mid', {**{c: P['land_warm'] for c in warm},
                          '#303481': P['mtn_mid'], '#4C48B4': '#3D3C98', '#7452A4': '#3D3C98',
                          '#131739': P['mtn_dark'], '#5E3430': P['mtn_dark']})
recolor('shoreline', {**{c: P['sea_glint'] for c in warm},
                      '#303481': P['mtn_mid'], '#01134E': P['mtn_dark'],
                      '#4C48B4': P['sea_mid'], '#7452A4': P['sea_mid']})
recolor('water_base', {'#4C48B4': P['sea'], '#01134E': P['sea_deep'], '#303481': P['sea_deep'],
                       '#011C67': P['sea_deep'], '#131739': P['sea_deep']})
recolor('water_highlights', {'#7452A4': P['sea_mid'], '#4C48B4': P['sea_mid'],
                             '#E78162': P['sea_glint'], '#EBBF5F': P['sea_glint'], '#8E7E94': P['sea_mid']})
for g in ['mountains_back', 'mountains_mid', 'shoreline', 'water_base', 'water_highlights']:
    prune_group(g, 55 * 55)
# Sea plane under the traced water so the bottom-right corner is full-bleed
# (the trace stopped at the old rounded-mask curve).
new('path', {'id': 'sea_fill', 'd': 'M2600 4520H5000V5000H2600Z', 'fill': P['sea']}, mid, index=0)

# Carry the distant ridge to the right edge (trace ended on a diagonal mask cut).
mb = el('mountains_back')
new('path', {'id': 'mountains_back_extension_glow', 'd': 'M4450 4329H5000V4430H4450Z', 'fill': P['land_warm']}, mb, index=0)
new('path', {'id': 'mountains_back_extension', 'd': 'M4400 4440C4560 4400 4700 4378 4820 4392C4900 4400 4960 4420 5000 4432V4612C4820 4606 4600 4570 4400 4545Z', 'fill': P['mtn_far']}, mb, index=1)

# ================================================================== CLOUDS
clouds = el('03_CLOUDS')
clouds.attrib.pop('opacity', None)
remove('cloud_small_details')        # 22%-opacity overlay = pure watercolor noise


def lum(hexc):
    h = hexc.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def tone_clouds(gid, ramp):
    """Collapse every fragment of a cloud onto a 4-step ramp by value."""
    light, base, shade, deep = ramp
    for p in paths_in(el(gid)):
        f = (p.get('fill') or '#000').upper()
        name = p.get('id') or ''
        L = lum(f)
        if name.endswith('_base'):
            set_fill(p, base)
        elif L < 0.33:
            set_fill(p, deep)
        elif '_light_' in name or L > 0.72:
            set_fill(p, light)
        else:
            set_fill(p, shade if L < 0.6 else base)


WARM = (P['cw_light'], P['cw_base'], P['cw_shade'], P['cw_deep'])
COOL = (P['cc_light'], P['cc_base'], P['cc_shade'], P['cc_deep'])
for g in ['cloud_left_top', 'cloud_left_mid', 'cloud_bottom_cluster']:
    tone_clouds(g, WARM)
for g in ['cloud_right_top', 'cloud_right_mid']:
    tone_clouds(g, COOL)
for g in ['cloud_left_top', 'cloud_left_mid', 'cloud_bottom_cluster', 'cloud_right_top', 'cloud_right_mid']:
    prune_group(g, 70 * 70, min_span=60)

# ================================================================== DRAGON
DR = {
    '#ECE2D0': P['dr_cream'],
    '#ECCD9A': P['dr_warm'], '#ECB379': P['dr_warm'], '#ECC16B': P['dr_warm'], '#ECBEA4': P['dr_warm'],
    '#5952BA': P['dr_violet'], '#5740C7': P['dr_violet'],
    '#7D5BAB': P['dr_half'], '#AE74B7': P['dr_half'],
    '#3E408A': P['dr_deep'], '#5C437D': P['dr_deep'], '#834E79': P['dr_deep'],
    '#12205A': P['dr_core'], '#122972': P['dr_core'],
}
recolor('04_DRAGON', DR)
for g in ['dragon_snout', 'dragon_upper_jaw', 'dragon_horns', 'dragon_mane_primary',
          'dragon_mane_secondary', 'dragon_neck', 'dragon_lower_jaw', 'dragon_body_purple_inner',
          'dragon_body_shadow', 'dragon_tail', 'dragon_highlights']:
    prune_group(g, 50 * 50, min_span=45)
for g in ['dragon_mane_primary', 'dragon_horns', 'dragon_mane_secondary', 'dragon_tail']:
    for p in paths_in(el(g)):
        if p.get('fill') == P['dr_warm']:
            prune(p, 110 * 110, 90)
# Eye = the dragon's focal accent: hotter core, tighter glow.
el('eye_core').set('fill', '#FFF6E4') if 'eye_core' in byid else None
for p in paths_in(el('dragon_eye_glow')):
    p.set('fill', '#FF9ED2')

# ================================================================= OFFICER
off = el('05_OFFICER')
off.attrib.pop('filter', None)       # orange blurred halo -> vector rim light below
recolor('torso_uniform', {}, P['uni'])
recolor('right_arm', {}, P['uni'])
recolor('left_arm', {}, P['uni_far'])
recolor('left_leg', {}, P['pants_far'])
recolor('right_leg', {}, P['pants'])
recolor('boots', {'#0D1530': P['boots'], '#213451': '#1E2B52', '#1D3159': '#1E2B52'})
recolor('cap', {}, P['cap'])
recolor('hair_head_neck', {'#102248': P['cap'], '#0B0D20': P['hair'], '#131738': P['hair']})
recolor('face_visible_profile', {'#EC9468': P['skin'], '#C05642': P['skin_shade']})
recolor('left_hand', {'#F78864': P['skin'], '#9F4232': P['skin_shade'], '#243D68': P['uni_far']})
recolor('right_hand', {'#F78864': P['skin'], '#C05642': P['skin_shade']})
us = el('uniform_shadows')
us.attrib.pop('opacity', None)
recolor('uniform_shadows', {'#0D1530': P['pants_far'], '#0E1933': P['hair']})
t1 = el('torso_uniform_shade_1')
t1.set('stroke', P['uni_shade'])
recolor('uniform_highlights', {'#243D68': P['uni_light'], '#24477A': P['uni_light'],
                               '#FBCB61': P['rim_warm'], '#64362E': P['uni_far'],
                               '#FBF1D6': P['uni_light']})
el('right_leg_light_1').set('stroke', P['rim_warm'])
prune_group('uniform_highlights', 45 * 45)

# Rim light: thin sun-coloured edge around the backlit silhouette.
body_ids = ['torso_uniform', 'left_arm', 'right_arm', 'left_leg', 'right_leg', 'boots', 'cap',
            'hair_head_neck', 'face_visible_profile', 'left_hand', 'right_hand']
S = shape_of(body_ids).buffer(0)
S = S.buffer(2).buffer(-2)
rim = S.difference(S.buffer(-16))
# sample the finished backdrop (everything except the officer) to decide where a rim is needed
import cairosvg, io
from PIL import Image
probe = copy.deepcopy(root)
for g in probe.iter(N + 'g'):
    if g.get('id') in ('05_OFFICER', '06_FOREGROUND'):
        g.set('opacity', '0') if g.get('id') == '05_OFFICER' else None
BG = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=ET.tostring(probe), output_width=500, output_height=500))).convert('L')
CELL = 30
cells_dark, cells_mid = [], []
minx, miny, maxx, maxy = rim.bounds
y = miny
while y < maxy:
    x = minx
    while x < maxx:
        c = box(x, y, x + CELL, y + CELL)
        if c.intersects(rim):
            # look just outside the silhouette: sample a ring around the cell
            v = []
            for dx in (-45, 0, 45):
                for dy in (-45, 0, 45):
                    px, py = x + CELL / 2 + dx, y + CELL / 2 + dy
                    if 0 <= px < 5000 and 0 <= py < 5000 and not S.contains(Point(px, py)):
                        v.append(BG.getpixel((int(px / 10), int(py / 10))))
            if v:
                m = sum(v) / len(v)
                (cells_dark if m < 95 else cells_mid if m < 150 else []).append(c)
        x += CELL
    y += CELL
near = Point(*SUN_C).buffer(SUN_R + 500, resolution=64)
dark = unary_union(cells_dark)
rim_w = rim.intersection(dark).intersection(near)
rim_c = S.difference(S.buffer(-10)).intersection(dark).difference(near)
rimg = new('g', {'id': 'rim_light'}, off)
new('path', {'id': 'rim_light_warm', 'd': geom_to_d(rim_w), 'fill': P['rim_warm']}, rimg)
new('path', {'id': 'rim_light_cool', 'd': geom_to_d(rim_c), 'fill': P['rim_cool'], 'fill-opacity': '0.85'}, rimg)
for cover in ('flag_old_footprint_cover', 'patch_old_footprint_cover'):
    el(cover).set('fill', P['uni'])
# keep patches above the rim
for pid in ['korea_flag_patch', 'social_service_patch']:
    e = el(pid)
    off.remove(e)
    off.append(e)

# =============================================================== FOREGROUND
recolor('cliff_main', {}, P['cliff'])
ch = el('cliff_highlight')
ch.attrib.pop('opacity', None)
recolor('cliff_highlight', {'#131738': P['cliff_plane'], '#00124E': P['cliff_plane'], '#323685': P['cliff_top'],
                            '#64362E': P['cliff_warm'], '#C05642': P['cliff_warm']})
ga = el('grass_or_edge_accents')
ga.set('opacity', '0.8')
recolor('grass_or_edge_accents', {}, P['cliff_warm'])
prune_group('cliff_highlight', 95 * 95, skip_base=False, min_span=80)
prune_group('grass_or_edge_accents', 80 * 80, skip_base=False, min_span=70)

# Close trace seams: same-colour hairlines on interior tone shapes, widened
# just enough that abutting planes meet without a light crack.
for gid in ('04_DRAGON', '03_CLOUDS', '06_FOREGROUND', '07_MIDGROUND_WATER'):
    for p in paths_in(el(gid)):
        if p.get('stroke') and p.get('fill') not in (None, 'none') and not (p.get('id') or '').endswith('_base'):
            p.set('stroke-width', '3')

# ============================================================== TIDY / NAME
top = root.find(N + 'g')
top.set('id', 'SUPER_GONGIK_APP_ICON_V2')
for r in list(top):
    if r.tag == N + 'rect':
        r.set('fill', P['sky_top'])
# drop orphan defs
used = set(re.findall(r'url\(#([^)]+)\)', ET.tostring(root, encoding='unicode')))
for d in list(defs):
    if d.get('id') not in used:
        defs.remove(d)

tree.write(DST, encoding='utf-8', xml_declaration=False)
import json
json.dump(KEPT, open(DST + '.kept.json', 'w'))
print('ok', DST)
