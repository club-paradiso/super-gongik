#!/usr/bin/env python3
"""Compare native iOS captures with the Figma page 52 reference renders.

Usage:
  python3 apps/ios/scripts/figma-compare.py \
      --figma docs/design/figma-reference \
      --app <captures from FigmaCaptureTests> \
      --out <report dir> [--baseline <approved app captures>]

Inputs
  * Figma renders: ``<screen>-<theme>-<scheme>__<node>.png`` at 1x, 393 pt
    wide, full frame height (exported through the Figma MCP, see
    docs/design/figma-reference/README.md).
  * App captures: ``<screen>-<theme>-<scheme>-<segment>.png`` from
    ``SuperGongikUITests/FigmaCaptureTests.swift`` (same date and data as the
    Figma sample: -SGToday 2026-03-14, -SGSeedFixture figma).

What it measures (first viewport only)
  The Figma frame is a long canvas; the app capture is one screen. The top
  ``VIEWPORT`` points of both are compared after scaling the app to 393 pt.
  The status bar and the bottom bar zone are masked: Figma does not draw the
  status bar, and its tab bar sits at the end of the long frame, not at the
  bottom of the first viewport.

  * ``similarity`` = 1 - mean absolute RGB difference / 255 (masked area)
  * ``changed`` = share of pixels whose largest channel difference > 40

  These are coarse signals for triage, not a verdict. Intentional deviations
  (owner decisions newer than the Figma frames) are listed in
  ``deviations.json`` next to the references and printed with each row.

Outputs
  * ``<case>-compare.png``: Figma | App | difference heat map (first viewport)
  * ``<case>-sheet.png``: the whole Figma frame beside every app segment
  * ``<case>-before-after.png`` when ``--baseline`` has the same capture
  * ``report.md`` and ``report.json``

Nothing here updates a baseline: approving new captures is a manual commit.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps, ImageStat

WIDTH = 393
VIEWPORT = 852  # iPhone 16 / 15 / 14 Pro: 393 x 852 pt
STATUS_BAR = 54
BOTTOM_BAR = 96
CHANGED_THRESHOLD = 40

FIGMA_NAME = re.compile(r"^(?P<case>[a-z]+-[a-z]+-[a-z]+)__(?P<node>\d+-\d+)\.png$")


def load_rgb(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def to_width(image: Image.Image, width: int = WIDTH) -> Image.Image:
    if image.width == width:
        return image
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.LANCZOS)


def viewport(image: Image.Image) -> Image.Image:
    canvas = Image.new("RGB", (WIDTH, VIEWPORT), (128, 128, 128))
    canvas.paste(image.crop((0, 0, WIDTH, min(VIEWPORT, image.height))), (0, 0))
    return canvas


def mask(image: Image.Image) -> Image.Image:
    masked = image.copy()
    draw = ImageDraw.Draw(masked)
    draw.rectangle((0, 0, WIDTH, STATUS_BAR), fill=(128, 128, 128))
    draw.rectangle((0, VIEWPORT - BOTTOM_BAR, WIDTH, VIEWPORT), fill=(128, 128, 128))
    return masked


def measure(figma: Image.Image, app: Image.Image) -> tuple[float, float, Image.Image]:
    a, b = mask(figma), mask(app)
    diff = ImageChops.difference(a, b)
    mean = sum(ImageStat.Stat(diff).mean) / 3
    similarity = 1 - mean / 255
    peak = diff.convert("RGB").split()
    largest = ImageChops.lighter(ImageChops.lighter(peak[0], peak[1]), peak[2])
    area = WIDTH * (VIEWPORT - STATUS_BAR - BOTTOM_BAR)
    changed = sum(largest.point(lambda v: 255 if v > CHANGED_THRESHOLD else 0).histogram()[255:]) / area
    heat = ImageOps.colorize(ImageOps.autocontrast(largest), black=(10, 10, 30), white=(255, 70, 70))
    return similarity, changed, heat


def labelled(images: list[tuple[str, Image.Image]], gap: int = 12) -> Image.Image:
    header = 24
    width = sum(image.width for _, image in images) + gap * (len(images) - 1)
    height = max(image.height for _, image in images) + header
    sheet = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    x = 0
    for title, image in images:
        draw.text((x + 4, 5), title, fill=(20, 20, 20))
        sheet.paste(image, (x, header))
        x += image.width + gap
    return sheet


def segments(app_dir: Path, case: str) -> list[Path]:
    found = sorted(app_dir.glob(f"{case}-[0-9].png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
    return found


def verdict(similarity: float) -> str:
    if similarity >= 0.92:
        return "close"
    if similarity >= 0.80:
        return "differs"
    return "major difference"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--figma", type=Path, required=True)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    deviations_file = args.figma / "deviations.json"
    deviations = json.loads(deviations_file.read_text()) if deviations_file.exists() else {}

    rows = []
    for figma_path in sorted(args.figma.glob("*.png")):
        match = FIGMA_NAME.match(figma_path.name)
        if not match:
            continue
        case, node = match["case"], match["node"].replace("-", ":")
        screen = case.split("-")[0]
        app_segments = segments(args.app, case)
        row = {"case": case, "figma_node": node, "screen": screen,
               "known_deviations": deviations.get(screen, [])}
        if not app_segments:
            row["status"] = "NOT CAPTURED"
            rows.append(row)
            continue
        figma_full = to_width(load_rgb(figma_path))
        app_first = viewport(to_width(load_rgb(app_segments[0])))
        figma_first = viewport(figma_full)
        similarity, changed, heat = measure(figma_first, app_first)
        row.update(status="COMPARED", similarity=round(similarity, 4), changed=round(changed, 4),
                   verdict=verdict(similarity), segments=len(app_segments))
        labelled([(f"Figma {node}", figma_first), ("App (iOS Simulator)", app_first), ("Difference", heat)]) \
            .save(args.out / f"{case}-compare.png", optimize=True)
        app_column = [to_width(load_rgb(p)) for p in app_segments]
        stacked = Image.new("RGB", (WIDTH, sum(i.height for i in app_column) + 8 * (len(app_column) - 1)), (255, 255, 255))
        y = 0
        for image in app_column:
            stacked.paste(image, (0, y))
            y += image.height + 8
        labelled([(f"Figma {node} (full frame)", figma_full), (f"App, {len(app_column)} scroll steps", stacked)]) \
            .save(args.out / f"{case}-sheet.png", optimize=True)
        if args.baseline:
            before_path = args.baseline / app_segments[0].name
            if before_path.exists():
                before = viewport(to_width(load_rgb(before_path)))
                b_similarity, _, b_heat = measure(before, app_first)
                row["baseline_similarity"] = round(b_similarity, 4)
                labelled([("Before (baseline)", before), ("After (this build)", app_first), ("Difference", b_heat)]) \
                    .save(args.out / f"{case}-before-after.png", optimize=True)
            else:
                row["baseline_similarity"] = None
        rows.append(row)

    (args.out / "report.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    lines = [
        "# Figma ↔ iOS comparison (first viewport)",
        "",
        "Figma file `hy0KYmsJxVzj2JwJtbfIpS`, page 52. App: iOS Simulator, `-SGToday 2026-03-14 -SGSeedFixture figma`,",
        "Reduce Motion on. Status bar and bottom-bar zone masked. Similarity is a coarse triage signal, not a verdict;",
        "read it together with the known deviations (owner decisions newer than the Figma frames).",
        "",
        "| Case | Figma node | Status | Similarity | Changed px | Triage | Baseline Δ | Known deviations |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        known = "<br>".join(row["known_deviations"]) or "—"
        if row["status"] != "COMPARED":
            lines.append(f"| {row['case']} | `{row['figma_node']}` | {row['status']} | — | — | — | — | {known} |")
            continue
        base = row.get("baseline_similarity")
        base_text = "no baseline" if base is None else f"{base:.3f}"
        lines.append(f"| {row['case']} | `{row['figma_node']}` | compared | {row['similarity']:.3f} | "
                     f"{row['changed'] * 100:.1f}% | {row['verdict']} | {base_text} | {known} |")
    (args.out / "report.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    missing = [row["case"] for row in rows if row["status"] != "COMPARED"]
    if missing:
        print(f"\nNOT CAPTURED: {', '.join(missing)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
