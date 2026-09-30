# SUPER-GONGIK app icon — V2 premium polish (candidate)

Refinement of the current working icon (Figma `현재 작업중인 버전`, node `95:3`).
Same concept and composition: the Social Service Agent on the cliff facing the
S-shaped dragon at sunset. Only the rendering was changed.

Figma: frame `11_PREMIUM_POLISH_V2` (node `105:2`) on the
`Logo Editable Workspace` page, next to `95:3`. `95:3` and all earlier frames
are unchanged.

**Production icons (`apps/web/public/*`) are not replaced.** This is a
candidate for review.

## Files

| Path                                  | What                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `SUPER_GONGIK_APP_ICON_V2.svg`        | Editable full-bleed vector master, 5000×5000, named layers                     |
| `png/super-gongik-icon-v2-{size}.png` | 1024, 512, 256, 128, 64, 32                                                    |
| `qa/qa_contact_sheet.png`             | All sizes at real pixel size, plus zoomed 128/64/32                            |
| `qa/qa_grayscale_squint.png`          | Grayscale and blur/downscale test, current vs refined                          |
| `qa/qa_launcher_masks.png`            | iOS rounded square, Android rounded square, adaptive circle crop               |
| `qa/qa_before_after.png`              | Current vs refined at 1024, 256, 128, 64                                       |
| `source/figma-95-3_current.svg`       | Untouched export of `95:3`, the input                                          |
| `tools/polish.py`, `tools/qa.py`      | The transform and QA renders (Python: svgpathtools, shapely, cairosvg, Pillow) |

Rebuild:

```sh
python3 tools/polish.py source/figma-95-3_current.svg SUPER_GONGIK_APP_ICON_V2.svg
python3 tools/qa.py source/figma-95-3_current.svg SUPER_GONGIK_APP_ICON_V2.svg <out-dir>
```

## What changed

- **Light system:** one key light, the low sun behind the agent. Warm on the sun
  side, cool night sky above. Clouds near the sun use one warm 4-step ramp.
  Clouds on the far right use a dimmer ramp of the same hues.
- **Sky:** 8 overlapping blotchy "twilight band" shapes, the purple glow blobs and
  stroke-only outlines of the old rounded mask were removed. They are replaced by
  one vertical night-to-dusk gradient and one radial sunset bloom around the sun.
- **Clouds:** the 22%-opacity detail overlay was removed, and the 79% group
  opacity that let the sky bleed through was removed. Each cloud now uses at most
  4 tones. Crumbs smaller than about 14 px at 1024 were removed.
- **Dragon:** 14 body colours were reduced to 6 (cream, warm rim, half-tone, violet,
  deep, core shadow). Tiny tone fragments were pruned. Hairline seams between
  planes were closed.
- **Officer:** uniform, pants, cap and skin were each reduced to base, shadow
  and light. The blurred orange drop-shadow halo was replaced by a vector rim
  light. The rim is placed only where the silhouette sits on a dark backdrop
  (cap, head and boot against the cliff), so it separates the figure without
  outlining it. Patch backing colours now match the uniform. Both patches are kept.
- **Land and water:** everything is at full opacity (it was 62%) with a reduced
  palette. The bottom-right corner is now full-bleed: it was cut on the old
  rounded-mask curve, and the sea and the distant ridge now reach the edge.
- **Stars:** reduced from 29 to 9, none behind the dragon.

## Kept on purpose

The composition, all silhouettes and paths of the agent and the dragon, the
dragon's S-flow, the Taegeukgi and 사회복무 patches, the sun, the clouds, the
distant mountains, the water and the cliff.

## Known limits

- Micro-detail in the patches is invisible below 256 px. This is expected.
- Most tone shapes are still the original traced geometry: they were
  consolidated and pruned, not redrawn. A hand redraw of the dragon's mane
  shading is the next step if more polish is wanted.
- The art is full-bleed. If it is ever shipped as an Android adaptive or PWA
  `maskable` icon, it needs a padded variant: the adaptive crop in
  `qa_launcher_masks.png` clips the agent's hand and the dragon's crest. The
  current manifest icons use the default `any` purpose, so this does not apply
  today.
