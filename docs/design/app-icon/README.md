# SUPER-GONGIK app icon — premium polish (candidate)

This is a refinement of the current working icon, Figma `현재 작업중인 버전` (node `95:3`).
The concept and composition are unchanged: the Social Service Agent stands on the cliff and faces the S-shaped dragon at sunset. Only the rendering changed, in two passes.

| Pass   | File                           | Figma frame                      |
| ------ | ------------------------------ | -------------------------------- |
| **V3** | `SUPER_GONGIK_APP_ICON_V3.svg` | `12_PREMIUM_POLISH_V3` (`111:2`) |
| V2     | `SUPER_GONGIK_APP_ICON_V2.svg` | `11_PREMIUM_POLISH_V2` (`105:2`) |

- **V3 is the candidate.** V2 is kept for history.
- Both Figma frames sit on the `Logo Editable Workspace` page, to the right of `95:3`.
- `95:3` and every earlier frame are unchanged.

**Production icons (`apps/web/public/*`) are not replaced.**

## Files

| Path                                  | What                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `SUPER_GONGIK_APP_ICON_V3.svg`        | Editable full-bleed vector master, 5000×5000, named layers                                       |
| `png/super-gongik-icon-v3-{size}.png` | 1024, 512, 256, 128, 64, 32                                                                      |
| `qa/qa_current_v2_v3.png`             | Current vs V2 vs V3                                                                              |
| `qa/qa_before_after.png`              | Current vs V3 at 1024, 256, 128, 64                                                              |
| `qa/qa_contact_sheet.png`             | V3 at every size, plus zoomed 128/64/32                                                          |
| `qa/qa_grayscale_squint.png`          | Grayscale and blur/downscale test                                                                |
| `qa/qa_launcher_masks.png`            | iOS rounded square, Android rounded square, adaptive circle crop                                 |
| `source/figma-95-3_current.svg`       | Untouched export of `95:3`, the input                                                            |
| `tools/`                              | `polish.py` (V2), `polish_v3.py` (V3), `qa.py` (Python: svgpathtools, shapely, cairosvg, Pillow) |

Rebuild:

```sh
python3 tools/polish.py source/figma-95-3_current.svg SUPER_GONGIK_APP_ICON_V2.svg
python3 tools/polish_v3.py SUPER_GONGIK_APP_ICON_V2.svg SUPER_GONGIK_APP_ICON_V3.svg
python3 tools/qa.py source/figma-95-3_current.svg SUPER_GONGIK_APP_ICON_V3.svg <out-dir>
```

## V2 — colour and light

- **Light:** one key light, the low sun behind the agent. The sun side is warm and the night sky is cool.
- **Sky:** the 8 blotchy "twilight band" shapes, the purple glow blobs and the old rounded-mask outlines were removed. They are replaced by one vertical gradient and one radial sunset bloom.
- **Clouds:** they are now opaque, with 4 tones or fewer. The 22% detail overlay was removed.
- **Dragon:** 14 body colours were reduced to 6.
- **Agent:**
  - Tones were consolidated.
  - The blurred orange halo was replaced by a vector rim light.
  - The rim is drawn only where the backdrop behind the silhouette is dark.
- **Bottom-right corner:** it is now full-bleed. It used to stop at the old rounded-mask curve.

## V3 — form

V2 left every tone plane with a jittery, traced edge. That edge is the main reason the art still read as a painting rather than an illustration.

V3 keeps where each tone sits and redraws its edge:

1. Flatten each group with the painter's algorithm. This gives the visible region of each tone.
2. Smooth each region morphologically (open, then close). This rounds the trace jitter into deliberate curves and drops crumbs.
3. Restack the result: the silhouette in the dominant tone, then the other tones on top.

Changes by area:

- **Dragon:**
  - It now reads as a clean two-tone ribbon: a cream front with a violet side along the whole S.
  - The sky-coloured core shadow read as holes in the body, so it was folded into the dragon's deep violet.
  - The half-tone violet was merged into the main violet.
- **Clouds and water:** same flatten-and-smooth treatment.
- **Cliff:** redrawn from its silhouette as one dark foreground mass with two stepped planes that face up toward the light. Each plane has a smoothed lower edge (the edge where light turns to shadow). A thin rim is warm near the agent's feet and cool further away. The scattered orange rock fragments are gone.
- **Agent:** a cool sky-light plane on the shoulders, the upper arms and the cap crown gives the uniform volume.

## Kept on purpose

- The composition.
- Every silhouette and path of the agent.
- The dragon's outline and S-flow.
- The Taegeukgi and 사회복무 patches.
- The sun, the clouds, the distant ridge, the water and the cliff.

## Known limits

- The patches are illegible below 256 px. This is expected.
- The morphological smoothing gives the dragon's tone shapes rounded ends. Hand-drawn, tapered ends would be the next step if more polish is wanted.
- The art is full-bleed. An Android adaptive or PWA `maskable` icon would need a padded variant, because the adaptive crop in `qa_launcher_masks.png` clips the agent's hand and the dragon's crest. The current manifest icons use the default `any` purpose, so this does not apply today.
