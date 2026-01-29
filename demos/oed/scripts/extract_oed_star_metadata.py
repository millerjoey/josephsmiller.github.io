#!/usr/bin/env python3
"""Extract OED per-frame star (x*) coordinates from SVGs.

We want to show the "next customer" (x*) in the UI alongside the recommended ad.
The plots contain a star marker drawn as a <polygon ... fill='#ffd92f' .../>.

This script:
- Reads expected_info_gain_step_###.svg (default) to locate the star polygon.
- Parses axis tick positions/labels to build an affine map from SVG pixels -> x1/x2.
- Emits a JSON map keyed by labels_used (as string) to {x1, x2}.

Usage:
  python3 scripts/extract_oed_star_metadata.py
  python3 scripts/extract_oed_star_metadata.py --out plots/ab_oed_star.json
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path


STAR_POLY_RE = re.compile(
    r"<polygon\s+points='([^']+)'[^>]*\sfill='#ffd92f'[^>]*/>", re.IGNORECASE
)

# Match tick lines and labels produced by the plotting pipeline.
X_TICK_LINE_RE = re.compile(r"<line\s+x1='([0-9.]+)'\s+y1='460'\s+x2='\1'\s+y2='465'\b")
X_TICK_TEXT_RE = re.compile(r"<text\s+x='([0-9.]+)'\s+y='478'[^>]*>(-?[0-9.]+)</text>")

Y_TICK_LINE_RE = re.compile(r"<line\s+x1='65'\s+y1='([0-9.]+)'\s+x2='70'\s+y2='\1'\b")
Y_TICK_TEXT_RE = re.compile(r"<text\s+x='62'\s+y='([0-9.]+)'[^>]*>(-?[0-9.]+)</text>")


@dataclass(frozen=True)
class Affine1D:
    a: float  # value = a * px + b
    b: float

    def __call__(self, px: float) -> float:
        return self.a * px + self.b


def _parse_points(points: str) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    # points may contain newlines, repeated spaces.
    for token in re.split(r"\s+", points.strip()):
        if not token:
            continue
        if "," not in token:
            continue
        xs, ys = token.split(",", 1)
        try:
            pts.append((float(xs), float(ys)))
        except ValueError:
            continue
    return pts


def _centroid_xy(pts: list[tuple[float, float]]) -> tuple[float, float]:
    if not pts:
        raise ValueError("No points")
    sx = sum(p[0] for p in pts)
    sy = sum(p[1] for p in pts)
    return sx / len(pts), sy / len(pts)


def _fit_affine(p1: tuple[float, float], p2: tuple[float, float]) -> Affine1D:
    (px1, v1), (px2, v2) = p1, p2
    if px2 == px1:
        raise ValueError("Degenerate affine fit")
    a = (v2 - v1) / (px2 - px1)
    b = v1 - a * px1
    return Affine1D(a=a, b=b)


def _extract_ticks(svg_text: str) -> tuple[Affine1D, Affine1D]:
    # Use labeled ticks as the source of truth.
    x_ticks = [(float(m.group(1)), float(m.group(2))) for m in X_TICK_TEXT_RE.finditer(svg_text)]
    y_ticks = [(float(m.group(1)), float(m.group(2))) for m in Y_TICK_TEXT_RE.finditer(svg_text)]

    if len(x_ticks) < 2 or len(y_ticks) < 2:
        raise ValueError("Could not find enough axis ticks")

    # For y, the SVG y increases downward; the affine will naturally reflect that.
    # Use extreme ticks to reduce rounding issues.
    x_ticks_sorted = sorted(x_ticks, key=lambda t: t[0])
    y_ticks_sorted = sorted(y_ticks, key=lambda t: t[0])

    x_map = _fit_affine((x_ticks_sorted[0][0], x_ticks_sorted[0][1]), (x_ticks_sorted[-1][0], x_ticks_sorted[-1][1]))
    y_map = _fit_affine((y_ticks_sorted[0][0], y_ticks_sorted[0][1]), (y_ticks_sorted[-1][0], y_ticks_sorted[-1][1]))

    return x_map, y_map


def _extract_star_xy(svg_text: str) -> tuple[float, float]:
    m = STAR_POLY_RE.search(svg_text)
    if not m:
        raise ValueError("Star polygon not found")
    pts = _parse_points(m.group(1))
    return _centroid_xy(pts)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".", help="Project root (default: .)")
    parser.add_argument(
        "--series",
        default="expected_info_gain",
        choices=["expected_info_gain", "uncertainty_map", "decision_map"],
        help="Which plot series to parse for the star (default: expected_info_gain)",
    )
    parser.add_argument(
        "--out",
        default="plots/ab_oed_star.json",
        help="Output JSON path (relative to root unless absolute)",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    plots_dir = root / "plots" / args.series
    if not plots_dir.exists():
        raise SystemExit(f"Missing plot series dir: {plots_dir}")

    svgs = sorted(plots_dir.glob(f"{args.series}_step_*.svg"))
    if not svgs:
        # expected_info_gain files are named expected_info_gain_step_###.svg (folder is expected_info_gain)
        svgs = sorted(plots_dir.glob("*_step_*.svg"))

    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = root / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    mapping: dict[str, dict[str, float]] = {}
    for svg in svgs:
        # Extract step label count from filename.
        m = re.search(r"_step_(\d{3})\.svg$", svg.name)
        if not m:
            continue
        labels_used = int(m.group(1))

        text = svg.read_text(encoding="utf-8", errors="replace")
        x_map, y_map = _extract_ticks(text)
        star_px_x, star_px_y = _extract_star_xy(text)

        mapping[str(labels_used)] = {
            "x1": float(x_map(star_px_x)),
            "x2": float(y_map(star_px_y)),
        }

    out_path.write_text(json.dumps(mapping, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} with {len(mapping)} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
