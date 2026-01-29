#!/usr/bin/env python3
"""Convert plot SVGs under ./plots/** to PNGs for faster flipping.

- Uses rsvg-convert (librsvg) which is fast and produces consistent output.
- Writes PNGs next to the SVGs (same basename).
- Skips files that are already up-to-date.

Usage:
  python3 scripts/convert_plots_svg_to_png.py --width 1600
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".", help="Project root (default: .)")
    parser.add_argument("--width", type=int, default=1600, help="Output PNG width in pixels")
    parser.add_argument(
        "--rsvg",
        default="rsvg-convert",
        help="Path to rsvg-convert (default: rsvg-convert)",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    plots = root / "plots"
    if not plots.exists():
        raise SystemExit(f"No plots/ directory at {plots}")

    svgs = sorted(plots.rglob("*.svg"))
    if not svgs:
        print("No SVGs found under plots/.")
        return 0

    converted = 0
    skipped = 0

    for svg in svgs:
        out_png = svg.with_suffix(".png")
        if out_png.exists() and out_png.stat().st_mtime >= svg.stat().st_mtime:
            skipped += 1
            continue

        out_png.parent.mkdir(parents=True, exist_ok=True)
        cmd = [args.rsvg, "-w", str(args.width), "-o", str(out_png), str(svg)]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        converted += 1

    print(f"Converted: {converted}  Skipped: {skipped}  Total SVGs: {len(svgs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
