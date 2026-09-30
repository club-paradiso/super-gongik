"""SUPER-GONGIK app icon — V3 form pass (runs on the V2 master).

V2 consolidated colour, but every tone plane still had a traced, jittery
edge. V3 keeps where each tone sits (the art direction) and redraws its edge:

1. flatten a group with the painter's algorithm -> the visible region of
   each tone,
2. morphologically smooth every region (open + close), which rounds the
   traced jitter into deliberate curves and drops crumbs,
3. restack as: silhouette in the dominant tone, then the other tones.
"""
import sys, re
import xml.etree.ElementTree as ET
from svgpathtools import parse_path
from shapely.geometry import Polygon
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


def el(i):
    return byid[i]


def poly_of_d(d, step=4.0):
    out = []
    for piece in re.finditer(r'M[^M]*', d):
        try:
            sp = parse_path(piece.group(0))
        except Exception:
            continue
        pts = []
        for seg in sp:
            k = max(2, int(seg.length(error=1e-2) / step))
            for i in range(k):
                z = seg.point(i / k)
                pts.append((z.real, z.imag))
        if len(pts) >= 3:
            g = make_valid(Polygon(pts)).buffer(0)
            if not g.is_empty:
                out.append(g)
    if not out:
        return Polygon()
    # evenodd compound paths: xor the pieces
    acc = out[0]
    for g in out[1:]:
        acc = acc.symmetric_difference(g)
    return acc.buffer(0)


def fmt(v):
    return '%d' % round(v)


def to_d(g, tol=1.2, min_area=600):
    g = g.buffer(0).simplify(tol, preserve_topology=True)
    geoms = getattr(g, 'geoms', [g])
    out = []
    for poly in geoms:
        if poly.geom_type != 'Polygon' or poly.area < min_area:
            continue
        for ring in [poly.exterior] + list(poly.interiors):
            c = list(ring.coords)[:-1]
            if len(c) < 3:
                continue
            px, py = round(c[0][0]), round(c[0][1])
            s = 'M%d %d' % (px, py)
            for x, y in c[1:]:
                x, y = round(x), round(y)
                if (x, y) == (px, py):
                    continue
                s += 'l%d %d' % (x - px, y - py)
                px, py = x, y
            out.append(s + 'z')
    return re.sub(r' -', '-', ''.join(out))


def flatten(group):
    """Painter's algorithm over every filled path in the group."""
    regions = []  # [color, geom]
    for p in group.iter(N + 'path'):
        f = p.get('fill')
        if not f or f == 'none' or f.startswith('url'):
            continue
        g = poly_of_d(p.get('d'))
        if g.is_empty:
            continue
        g = g.buffer(1.5)   # the 3px same-colour seam strokes
        for r in regions:
            r[1] = r[1].difference(g)
        regions.append([f.upper(), g])
    merged = {}
    for f, g in regions:
        merged[f] = unary_union([merged[f], g]) if f in merged else g
    return merged


def smooth(g, r):
    if r <= 0:
        return g
    return g.buffer(-r, join_style=1).buffer(2 * r, join_style=1).buffer(-r, join_style=1)


def rebuild(gid, radius, min_area, order, base=None, keep_ids=(), sil_smooth=3):
    group = el(gid)
    keep = [e for e in group.iter() if e.get('id') in keep_ids]
    regions = flatten(group)
    sil = unary_union(list(regions.values())).buffer(sil_smooth).buffer(-sil_smooth)
    if base is None:
        base = max(regions, key=lambda k: regions[k].area)
    # wipe the traced children (keep requested ones, e.g. the eye)
    for c in list(group):
        group.remove(c)
    new = lambda pid, g, fill: ET.SubElement(group, N + 'path', {'id': pid, 'd': to_d(g, min_area=min_area), 'fill': fill, 'fill-rule': 'evenodd'})
    new(gid + '_silhouette', sil, base)
    tones = [c for c in order if c in regions and c != base] + [c for c in regions if c not in order and c != base]
    for i, col in enumerate(tones):
        g = smooth(regions[col], radius).intersection(sil)
        if g.area < min_area:
            continue
        new('%s_tone_%d' % (gid, i + 1), g, col)
    for k in keep:
        group.append(k)


# ------------------------------------------------------------------ dragon
# one composite for the whole creature; the eye stays vector-exact on top
eye_ids = ('dragon_eye_glow', 'dragon_eye_left_or_visible')
dragon = el('04_DRAGON')
eye = [c for c in dragon if c.get('id') in eye_ids]
for c in eye:
    dragon.remove(c)
# fold the half-tone into violet: two shadow values read better than three
for p in dragon.iter(N + 'path'):
    f = (p.get('fill') or '').upper()
    if f == '#7C68D2':
        p.set('fill', '#5645C2')
    elif f == '#141A52':   # sky-valued core shadow read as holes in the body
        p.set('fill', '#302C7C')
rebuild('04_DRAGON', radius=16, min_area=55 * 55,
        order=['#5645C2', '#302C7C', '#F2C48A'], base='#F5ECDB')
for c in eye:
    dragon.append(c)

# ------------------------------------------------------------------ clouds
for gid in ['cloud_left_top', 'cloud_left_mid', 'cloud_bottom_cluster', 'cloud_right_top', 'cloud_right_mid']:
    rebuild(gid, radius=34, min_area=90 * 90,
            order=['#D8637A', '#91528A', '#6F4A9C', '#FFD493', '#E9A98C'], sil_smooth=10)

# ------------------------------------------------------------ midground
rebuild('07_MIDGROUND_WATER', radius=12, min_area=60 * 60,
        order=['#3B3A8E', '#4B3882', '#27297A', '#3D3C98', '#161A48', '#141A52', '#3F3FA0', '#E99A6C', '#F7B47A'],
        base='#20246C', sil_smooth=2)

# ------------------------------------------------------------------ cliff
from shapely.affinity import translate
from shapely.geometry import Point
SUN = (1417.0, 3278.4)


def opening(g, r):
    return g.buffer(-r, join_style=1).buffer(r, join_style=1)


def top_band(S, t, r):
    """Up-facing plane of S: S minus itself pushed down t, with the lower
    boundary (the terminator) smoothed by an opening of radius r."""
    return S.difference(opening(translate(S, 0, t), r))


fg = el('06_FOREGROUND')
CLIFF = unary_union([poly_of_d(p.get('d')) for p in el('cliff_main').iter(N + 'path')]).buffer(3).buffer(-3)
for c in list(fg):
    fg.remove(c)
cg = ET.SubElement(fg, N + 'g', {'id': 'cliff'})
mk = lambda pid, g, fill: ET.SubElement(cg, N + 'path', {'id': pid, 'd': to_d(g, min_area=40 * 40), 'fill': fill, 'fill-rule': 'evenodd'})
mk('cliff_silhouette', CLIFF, '#090B1D')
mk('cliff_face_plane', top_band(CLIFF, 360, 90), '#10123A')
mk('cliff_top_plane', top_band(CLIFF, 130, 45), '#1C2052')
rim = top_band(CLIFF, 22, 6)
near = Point(*SUN).buffer(2100)
mk('cliff_rim_warm', rim.intersection(near), '#E7895E')
mk('cliff_rim_cool', rim.difference(near), '#34397F')

# ---------------------------------------------------------------- officer
# cool sky light on the up-facing planes (shoulders, cap crown, forearms)
off = el('05_OFFICER')
def shp(ids):
    return unary_union([poly_of_d(p.get('d')) for i in ids for p in el(i).iter(N + 'path')
                        if p.get('fill') not in (None, 'none') and (p.get('id') or '').endswith('_base')])
cloth = shp(['torso_uniform', 'right_arm', 'left_arm']).buffer(2).buffer(-2)
capS = shp(['cap']).buffer(2).buffer(-2)
sky = ET.Element(N + 'g', {'id': 'sky_light'})
for pid, g, fill in [('sky_light_uniform', top_band(cloth, 70, 22), '#2B5AA6'),
                     ('sky_light_cap', top_band(capS, 45, 12), '#253A6E')]:
    ET.SubElement(sky, N + 'path', {'id': pid, 'd': to_d(g, min_area=30 * 30), 'fill': fill, 'fill-rule': 'evenodd'})
kids = list(off)
off.insert(kids.index(el('uniform_highlights')) + 1, sky)

tree.write(DST, encoding='utf-8', xml_declaration=False)
print('ok', DST)
