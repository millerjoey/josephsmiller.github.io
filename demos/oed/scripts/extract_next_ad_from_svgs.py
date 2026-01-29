#!/usr/bin/env python3
"""Extract per-step NEXT recommended ad (A/B) from the existing plot SVGs.

Looks for lines like:
  <text ...>NEXT: ad A</text>

Writes a small JSON mapping label_count -> "A"|"B" suitable for the demo UI.

Usage:
  python3 scripts/extract_next_ad_from_svgs.py --out plots/ab_oed_next_ad.json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

NEXT_RE = re.compile(r">\s*NEXT:\s*ad\s*([AB])\s*<")
STEP_RE = re.compile(r"_step_(\d{3})\.svg$")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument(
        "--glob",
        default="plots/expected_info_gain/expected_info_gain_step_*.svg",
        help="Which SVGs to parse (default: info gain series)",
    )
    parser.add_argument("--out", default="plots/ab_oed_next_ad.json")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    paths = sorted(root.glob(args.glob))
    if not paths:
        raise SystemExit(f"No files matched: {root / args.glob}")

    mapping: dict[str, str] = {}

    for p in paths:
        m_step = STEP_RE.search(p.name)
        if not m_step:
            continue
        step_num = int(m_step.group(1))
        text = p.read_text(encoding="utf-8", errors="replace")
        m = NEXT_RE.search(text)
        if not m:
            continue
        mapping[str(step_num)] = m.group(1)

    out_path = root / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(mapping, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"Wrote {out_path} with {len(mapping)} steps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
