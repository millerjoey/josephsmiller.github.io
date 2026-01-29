#!/usr/bin/env python3
"""Strip embedded legend boxes from plot SVGs under ./plots/**.

These plots were generated with legend panels inside the SVG viewport (top-right)
which cover part of the heatmap. For the web demo we render the legend in HTML
below the image instead.

This script performs a *very targeted* line-based removal of the legend elements
(background rect + its marker shapes + legend text) for each plot family:
- plots/decision_map/*.svg
- plots/uncertainty_map/*.svg
- plots/expected_info_gain/*.svg

It intentionally does NOT touch any other elements (axes, colorbars, points,
heatmap rectangles, etc.).

Usage:
  python3 scripts/strip_legends_from_svgs.py
"""

from __future__ import annotations

import re
from pathlib import Path


def _compile_all(patterns: list[str]) -> list[re.Pattern[str]]:
    return [re.compile(p) for p in patterns]


# NOTE:
# Earlier we removed legends line-by-line, but some SVGs place multiple tags on a single
# long line (e.g., a <polygon/> followed by the legend <rect/> and items).
# To be robust we do global substitutions across the entire SVG text.
SUBS_BY_FOLDER: dict[str, list[tuple[re.Pattern[str], str]]] = {
    "decision_map": [
        # Legend background panel.
        (re.compile(r"\s*<rect x='447\.8' y='80' width='232\.2' height='104\.0' fill='white' fill-opacity='0\.88' stroke='#333' stroke-width='1'\s*/>"), ""),
        # Legend swatches and boundary samples.
        (re.compile(r"\s*<rect x='457\.8' y='91\.0' width='10' height='10'[^>]*/>"), ""),
        (re.compile(r"\s*<rect x='457\.8' y='105\.0' width='10' height='10'[^>]*/>"), ""),
        (re.compile(r"\s*<rect x='457\.8' y='119\.0' width='10' height='10'[^>]*/>"), ""),
        (re.compile(r"\s*<rect x='457\.8' y='133\.0' width='10' height='10'[^>]*/>"), ""),
        (re.compile(r"\s*<line x1='457\.8' y1='151\.0' x2='475\.8' y2='151\.0'[^>]*/>"), ""),
        (re.compile(r"\s*<line x1='457\.8' y1='165\.0' x2='475\.8' y2='165\.0'[^>]*/>"), ""),
        # Legend text (match by content to be resilient to attribute changes).
        (re.compile(r"\s*<text\b[^>]*>\s*True optimal: A\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*True optimal: B\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*Disagree: true A, learned B\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*Disagree: true B, learned A\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*Boundary \(learned\)\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*Boundary \(true\)\s*</text>"), ""),
    ],
    "uncertainty_map": [
        # Legend background panel.
        (re.compile(r"\s*<rect x='305\.8' y='80' width='264\.2' height='90\.0' fill='white' fill-opacity='0\.9' stroke='#333' stroke-width='1'\s*/>"), ""),
        # Legend formula and text.
        (re.compile(r"\s*<text\b[^>]*>\s*Uncertainty = 1 − \|2·P\(A better\) − 1\|\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*sale \(y=1\)\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*no sale \(y=0\)\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*ad A \(z=0\)\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*ad B \(z=1\)\s*</text>"), ""),
        # Legend marker shapes (by exact coordinates so we don't touch data points).
        (re.compile(r"\s*<circle cx='319\.8' cy='111\.0' r='3'[^>]*/>"), ""),
        (re.compile(r"\s*<circle cx='319\.8' cy='125\.0' r='3'[^>]*/>"), ""),
        (re.compile(r"\s*<circle cx='319\.8' cy='139\.0' r='3'[^>]*/>"), ""),
        (re.compile(r"\s*<rect x='316\.8' y='150\.0' width='6' height='6'[^>]*/>"), ""),
    ],
    "expected_info_gain": [
        # Legend background panel.
        (re.compile(r"\s*<rect x='448\.2' y='80' width='121\.8' height='76\.0' fill='white' fill-opacity='0\.9' stroke='#333' stroke-width='1'\s*/>"), ""),
        # Legend text.
        (re.compile(r"\s*<text\b[^>]*>\s*sale \(y=1\)\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*no sale \(y=0\)\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*ad A \(z=0\)\s*</text>"), ""),
        (re.compile(r"\s*<text\b[^>]*>\s*ad B \(z=1\)\s*</text>"), ""),
        # Legend marker shapes (by exact coordinates so we don't touch data points).
        (re.compile(r"\s*<circle cx='462\.2' cy='97\.0' r='3'[^>]*/>"), ""),
        (re.compile(r"\s*<circle cx='462\.2' cy='111\.0' r='3'[^>]*/>"), ""),
        (re.compile(r"\s*<circle cx='462\.2' cy='125\.0' r='3'[^>]*/>"), ""),
        (re.compile(r"\s*<rect x='459\.2' y='136\.0' width='6' height='6'[^>]*/>"), ""),
    ],
}


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    plots = root / "plots"
    if not plots.exists():
        raise SystemExit(f"No plots/ directory at {plots}")

    svgs = sorted(plots.rglob("*.svg"))
    if not svgs:
        print("No SVGs found under plots/.")
        return 0

    total_touched = 0
    total_considered = 0

    for svg in svgs:
        folder = svg.parent.name
        subs = SUBS_BY_FOLDER.get(folder)
        if not subs:
            continue

        total_considered += 1
        text = svg.read_text(encoding="utf-8", errors="replace")
        new_text = text
        for pat, repl in subs:
            new_text = pat.sub(repl, new_text)

        if new_text != text:
            svg.write_text(new_text, encoding="utf-8")
            total_touched += 1

    print(f"SVGs updated: {total_touched} / {total_considered} (considered)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
