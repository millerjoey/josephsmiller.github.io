#!/usr/bin/env python3
"""Strip the per-frame 'NEXT: ad A/B' text label from plot SVGs.

This keeps the plots visually cleaner (no redundant label next to the star), while allowing
us to show the same information in the HTML UI as a metric.

Edits SVGs in-place under ./plots/**.

Usage:
  python3 scripts/strip_next_label_from_svgs.py
"""

from __future__ import annotations

import re
from pathlib import Path

NEXT_RE = re.compile(r"^\s*<text\b[^>]*>\s*NEXT:\s*ad\s*[AB]\s*</text>\s*$")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    plots = root / "plots"
    if not plots.exists():
        raise SystemExit(f"No plots/ directory at {plots}")

    svgs = sorted(plots.rglob("*.svg"))
    if not svgs:
        print("No SVGs found under plots/.")
        return 0

    touched = 0
    for svg in svgs:
        lines = svg.read_text(encoding="utf-8", errors="replace").splitlines(True)
        new_lines = [ln for ln in lines if not NEXT_RE.match(ln)]
        if new_lines != lines:
            svg.write_text("".join(new_lines), encoding="utf-8")
            touched += 1

    print(f"SVGs updated: {touched} / {len(svgs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
