#!/usr/bin/env python3

"""Crop bottom whitespace from OED PNGs.

Why:
- The expected-info-gain and uncertainty plots have large blank margins below the x-axis.
- The decision map is cropped tighter, so the three views look like different "shapes".

This script trims *only* the bottom whitespace (keeps full width and top).
It overwrites files in-place.

Usage:
  python3 scripts/crop_bottom_whitespace_pngs.py

Optional args:
  --dry-run
  --margin 20
"""

from __future__ import annotations

import argparse
import glob
import os
from dataclasses import dataclass
from typing import Iterable

from PIL import Image, ImageChops


@dataclass(frozen=True)
class Result:
    path: str
    old_size: tuple[int, int]
    new_size: tuple[int, int] | None


def find_pngs() -> list[str]:
    patterns = [
        "plots/expected_info_gain/expected_info_gain_step_*.png",
        "plots/uncertainty_map/uncertainty_map_step_*.png",
    ]
    out: list[str] = []
    for pat in patterns:
        out.extend(glob.glob(pat))
    out = [p for p in out if os.path.isfile(p)]
    out.sort()
    return out


def compute_new_bottom(img: Image.Image, margin: int) -> int | None:
    """Return new bottom y (exclusive) or None if no change."""

    # Compare against a white background to find non-white content.
    rgba = img.convert("RGBA")
    bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    diff = ImageChops.difference(rgba, bg)

    # Convert difference to a binary mask with tolerance.
    # Pixels very close to white become 0.
    # A higher threshold keeps more content (safer).
    gray = diff.convert("L")
    threshold = 12
    mask = gray.point(lambda p: 255 if p > threshold else 0)
    bbox = mask.getbbox()
    if not bbox:
        return None

    # bbox is (left, top, right, bottom) exclusive.
    # bbox is (left, top, right, bottom) exclusive.
    # Ignore occasional 1px noise at the very bottom.
    if bbox[3] >= img.height - 1:
        return None

    bottom = min(img.height, bbox[3] + margin)
    if bottom >= img.height:
        return None

    # Safety: avoid aggressive crops if detection is wrong.
    # (Info-gain frames have a lot of bottom whitespace; 0.80 is still conservative.)
    if bottom < int(img.height * 0.80):
        return None

    # Only do meaningful crops.
    if img.height - bottom < 10:
        return None

    return bottom


def crop_one(path: str, margin: int, dry_run: bool) -> Result:
    with Image.open(path) as img:
        old_size = (img.width, img.height)
        new_bottom = compute_new_bottom(img, margin)
        if new_bottom is None:
            return Result(path=path, old_size=old_size, new_size=None)

        new_size = (img.width, new_bottom)
        if not dry_run:
            cropped = img.crop((0, 0, img.width, new_bottom))
            # Keep format (PNG) and optimize a bit.
            cropped.save(path, format="PNG", optimize=True)
        return Result(path=path, old_size=old_size, new_size=new_size)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--margin", type=int, default=20)
    args = parser.parse_args(list(argv) if argv is not None else None)

    pngs = find_pngs()
    if not pngs:
        print("No PNGs found.")
        return 0

    changed = 0
    considered = 0
    for p in pngs:
        considered += 1
        r = crop_one(p, margin=args.margin, dry_run=args.dry_run)
        if r.new_size is not None:
            changed += 1
            print(f"CROPPED {r.path}: {r.old_size[0]}x{r.old_size[1]} -> {r.new_size[0]}x{r.new_size[1]}")

    print(f"Done. Considered: {considered}  Cropped: {changed}  Dry-run: {args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
