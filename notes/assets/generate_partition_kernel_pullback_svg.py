#!/usr/bin/env python3

from __future__ import annotations

import argparse
import math
from pathlib import Path


def stdnorm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def stdnorm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def fmt(value: float) -> str:
    return f"{value:.2f}"


def path_from_points(points: list[tuple[float, float]]) -> str:
    if not points:
        raise ValueError("Need at least one point to build a path.")
    commands = [f"M {fmt(points[0][0])},{fmt(points[0][1])}"]
    commands.extend(f"L {fmt(x)},{fmt(y)}" for x, y in points[1:])
    return " ".join(commands)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))

def xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the partition-kernel pullback figure as an SVG.")
    parser.add_argument(
        "--out",
        default=str(Path(__file__).with_name("partition_kernel_pullback.svg")),
        help="Output SVG path (default: notes/assets/partition_kernel_pullback.svg).",
    )
    args = parser.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Parameters (in standard deviation units).
    x_min, x_max = -3.0, 3.0
    delta = 0.4

    # Bin boundaries anchored at the mean (0): ..., -0.8, -0.4, 0, 0.4, 0.8, ...
    k_min = math.ceil(x_min / delta)
    k_max = math.floor(x_max / delta)
    x_lines = [round(delta * k, 10) for k in range(k_min, k_max + 1)]

    # Extra bin boundaries for the uniform panel (same spacing, but extending into the tails).
    x_uniform_min, x_uniform_max = -6.0, 6.0
    k_uniform_min = math.ceil(x_uniform_min / delta)
    k_uniform_max = math.floor(x_uniform_max / delta)
    x_lines_uniform = [round(delta * k, 10) for k in range(k_uniform_min, k_uniform_max + 1)]

    # Highlight one bin on the right tail.
    highlight_left = 1.2
    highlight_right = 1.6
    if highlight_left not in x_lines or highlight_right not in x_lines:
        raise ValueError("Highlight endpoints must coincide with bin boundaries.")

    u_lines = [stdnorm_cdf(x) for x in x_lines]
    u_lines_uniform = [stdnorm_cdf(x) for x in x_lines_uniform]
    highlight_u_left = stdnorm_cdf(highlight_left)
    highlight_u_right = stdnorm_cdf(highlight_right)

    # Layout.
    width, height = 980.0, 680.0
    margin_left, margin_right = 64.0, 40.0
    margin_top, margin_bottom = 42.0, 80.0
    gap = 78.0
    plot_w = (width - margin_left - margin_right - gap) / 2.0
    top_plot_h = 264.0
    middle_gap = 120.0
    bar_plot_h = height - margin_top - margin_bottom - top_plot_h - middle_gap
    if bar_plot_h < 160:
        raise ValueError("Figure layout error: bar_plot_h too small.")

    left_x0 = margin_left
    right_x0 = margin_left + plot_w + gap
    y0 = margin_top
    y_bar0 = y0 + top_plot_h + middle_gap

    # Scales.
    y_max_gauss = 0.42
    y_max_unif = 1.2

    def gx(x: float) -> float:
        return left_x0 + (x - x_min) / (x_max - x_min) * plot_w

    def gy(y: float) -> float:
        return y0 + (y_max_gauss - y) / y_max_gauss * top_plot_h

    def ux(u: float) -> float:
        return right_x0 + u * plot_w

    def uy(y: float) -> float:
        return y0 + (y_max_unif - y) / y_max_unif * top_plot_h

    def by(y: float) -> float:
        y_max_bar = 0.18
        return y_bar0 + (y_max_bar - y) / y_max_bar * bar_plot_h

    # Curves.
    gauss_points: list[tuple[float, float]] = []
    for i in range(241):
        x = x_min + (x_max - x_min) * i / 240.0
        gauss_points.append((gx(x), gy(stdnorm_pdf(x))))

    highlight_points: list[tuple[float, float]] = [(gx(highlight_left), gy(0.0))]
    for i in range(81):
        x = highlight_left + (highlight_right - highlight_left) * i / 80.0
        highlight_points.append((gx(x), gy(stdnorm_pdf(x))))
    highlight_points.append((gx(highlight_right), gy(0.0)))

    # Styling.
    ink = "#1f2a37"
    muted = "#5b6673"
    accent = "#8b3a3a"
    accent_soft = "#8b3a3a"

    axis_stroke = f"{ink}"
    axis_opacity = "0.35"
    grid_opacity = "0.12"

    svg: list[str] = []
    svg.append('<?xml version="1.0" encoding="UTF-8"?>')
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(width)} {fmt(height)}" role="img">')
    svg.append("  <title>Partition kernel on a Gaussian and its pullback to a uniform</title>")
    svg.append("  <style>")
    svg.append(f"    text {{ font-family: 'Crimson Pro', 'Times New Roman', serif; fill: {muted}; }}")
    svg.append("    .label { font-size: 13px; }")
    svg.append("    .small { font-size: 12px; }")
    svg.append(f"    .axis {{ stroke: {axis_stroke}; stroke-opacity: {axis_opacity}; stroke-width: 1.2; }}")
    svg.append(f"    .grid {{ stroke: {axis_stroke}; stroke-opacity: {grid_opacity}; stroke-width: 1; }}")
    svg.append(f"    .curve {{ stroke: {ink}; stroke-width: 2.2; fill: none; }}")
    svg.append(f"    .bin {{ stroke: {accent}; stroke-opacity: 0.35; stroke-width: 1.6; }}")
    svg.append(f"    .bin-strong {{ stroke: {accent}; stroke-opacity: 0.75; stroke-width: 2.1; }}")
    svg.append(f"    .fill {{ fill: {accent_soft}; fill-opacity: 0.32; stroke: none; }}")
    svg.append(f"    .bar {{ fill: none; stroke: {accent}; stroke-opacity: 0.65; stroke-width: 1.2; }}")
    svg.append(f"    .bar-highlight {{ fill: {accent_soft}; fill-opacity: 0.32; stroke: {accent}; stroke-opacity: 0.85; stroke-width: 1.4; }}")
    svg.append("  </style>")

    svg.append(f'  <rect x="0" y="0" width="{fmt(width)}" height="{fmt(height)}" fill="#ffffff" />')

    # Titles.
    svg.append(f'  <text class="label" x="{fmt(left_x0)}" y="{fmt(y0 - 18)}" fill="{ink}">Gaussian pdf (x-space)</text>')
    svg.append(f'  <text class="label" x="{fmt(right_x0)}" y="{fmt(y0 - 18)}" fill="{ink}">Uniform pdf (u-space)</text>')

    # Arrow label.
    arrow_y = y0 - 22
    arrow_x1 = left_x0 + plot_w + 12
    arrow_x2 = right_x0 - 12
    svg.append(
        f'  <defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="8" refY="3.5" orient="auto">'
        f'<polygon points="0 0, 10 3.5, 0 7" fill="{muted}" /></marker></defs>'
    )
    svg.append(
        f'  <line x1="{fmt(arrow_x1)}" y1="{fmt(arrow_y)}" x2="{fmt(arrow_x2)}" y2="{fmt(arrow_y)}" '
        f'stroke="{muted}" stroke-width="1.4" marker-end="url(#arrowhead)" opacity="0.7" />'
    )
    svg.append(
        f'  <text class="small" x="{fmt((arrow_x1 + arrow_x2) / 2.0 - 28)}" y="{fmt(arrow_y - 6)}" fill="{muted}">u = Φ(x)</text>'
    )

    # Axes rectangles.
    for x0_plot in (left_x0, right_x0):
        svg.append(
            f'  <rect x="{fmt(x0_plot)}" y="{fmt(y0)}" width="{fmt(plot_w)}" height="{fmt(top_plot_h)}" fill="none" stroke="#000000" stroke-opacity="0.05" />'
        )

    # Gaussian axes.
    svg.append(f'  <line class="axis" x1="{fmt(left_x0)}" y1="{fmt(y0 + top_plot_h)}" x2="{fmt(left_x0 + plot_w)}" y2="{fmt(y0 + top_plot_h)}" />')
    svg.append(f'  <line class="axis" x1="{fmt(left_x0)}" y1="{fmt(y0)}" x2="{fmt(left_x0)}" y2="{fmt(y0 + top_plot_h)}" />')

    # Uniform axes.
    svg.append(f'  <line class="axis" x1="{fmt(right_x0)}" y1="{fmt(y0 + top_plot_h)}" x2="{fmt(right_x0 + plot_w)}" y2="{fmt(y0 + top_plot_h)}" />')
    svg.append(f'  <line class="axis" x1="{fmt(right_x0)}" y1="{fmt(y0)}" x2="{fmt(right_x0)}" y2="{fmt(y0 + top_plot_h)}" />')

    # Simple y-grid lines.
    for y_tick in (0.2, 0.4):
        y_svg = gy(y_tick)
        svg.append(f'  <line class="grid" x1="{fmt(left_x0)}" y1="{fmt(y_svg)}" x2="{fmt(left_x0 + plot_w)}" y2="{fmt(y_svg)}" />')
        svg.append(f'  <text class="small" x="{fmt(left_x0 - 28)}" y="{fmt(y_svg + 4)}">{y_tick:.1f}</text>')
    svg.append(f'  <text class="small" x="{fmt(left_x0 - 18)}" y="{fmt(gy(0.0) + 4)}">0</text>')

    for y_tick in (1.0,):
        y_svg = uy(y_tick)
        svg.append(f'  <line class="grid" x1="{fmt(right_x0)}" y1="{fmt(y_svg)}" x2="{fmt(right_x0 + plot_w)}" y2="{fmt(y_svg)}" />')
        svg.append(f'  <text class="small" x="{fmt(right_x0 - 18)}" y="{fmt(y_svg + 4)}">{y_tick:.0f}</text>')
    svg.append(f'  <text class="small" x="{fmt(right_x0 - 18)}" y="{fmt(uy(0.0) + 4)}">0</text>')

    # X ticks.
    for tick in (-3, -2, -1, 0, 1, 2, 3):
        x_svg = gx(float(tick))
        svg.append(f'  <line class="axis" x1="{fmt(x_svg)}" y1="{fmt(y0 + top_plot_h)}" x2="{fmt(x_svg)}" y2="{fmt(y0 + top_plot_h + 6)}" />')
        svg.append(f'  <text class="small" x="{fmt(x_svg - 6)}" y="{fmt(y0 + top_plot_h + 24)}">{tick}</text>')
    svg.append(f'  <text class="small" x="{fmt(left_x0 + plot_w / 2.0 - 54)}" y="{fmt(y0 + top_plot_h + 44)}">x (σ units)</text>')

    for tick, label in ((0.0, "0"), (0.5, "0.5"), (1.0, "1")):
        x_svg = ux(tick)
        svg.append(f'  <line class="axis" x1="{fmt(x_svg)}" y1="{fmt(y0 + top_plot_h)}" x2="{fmt(x_svg)}" y2="{fmt(y0 + top_plot_h + 6)}" />')
        svg.append(f'  <text class="small" x="{fmt(x_svg - 7)}" y="{fmt(y0 + top_plot_h + 24)}">{label}</text>')
    svg.append(f'  <text class="small" x="{fmt(right_x0 + plot_w / 2.0 - 8)}" y="{fmt(y0 + top_plot_h + 44)}">u</text>')

    # Highlight fills.
    svg.append(f'  <path class="fill" d="{path_from_points(highlight_points)} Z" />')
    svg.append(
        f'  <rect class="fill" x="{fmt(ux(highlight_u_left))}" y="{fmt(uy(1.0))}" width="{fmt(ux(highlight_u_right) - ux(highlight_u_left))}" height="{fmt(uy(0.0) - uy(1.0))}" />'
    )

    # Partition/bin boundary lines.
    for x in x_lines:
        klass = "bin-strong" if x in (highlight_left, highlight_right) else "bin"
        svg.append(
            f'  <line class="{klass}" x1="{fmt(gx(x))}" y1="{fmt(gy(0.0))}" x2="{fmt(gx(x))}" y2="{fmt(gy(stdnorm_pdf(x)))}" />'
        )

    for u in u_lines_uniform:
        klass = "bin-strong" if abs(u - highlight_u_left) < 1e-12 or abs(u - highlight_u_right) < 1e-12 else "bin"
        svg.append(
            f'  <line class="{klass}" x1="{fmt(ux(u))}" y1="{fmt(uy(0.0))}" x2="{fmt(ux(u))}" y2="{fmt(uy(1.0))}" />'
        )

    # Gaussian curve.
    svg.append(f'  <path class="curve" d="{path_from_points(gauss_points)}" />')

    # Uniform density line.
    svg.append(f'  <line class="curve" x1="{fmt(ux(0.0))}" y1="{fmt(uy(1.0))}" x2="{fmt(ux(1.0))}" y2="{fmt(uy(1.0))}" />')

    # --- Bottom panel: distribution of the coarse variable Y ---
    svg.append(f'  <text class="label" x="{fmt(margin_left)}" y="{fmt(y_bar0 - 18)}" fill="{ink}">Distribution of the coarse variable Y</text>')

    bar_x0 = margin_left
    bar_w = width - margin_left - margin_right

    svg.append(
        f'  <rect x="{fmt(bar_x0)}" y="{fmt(y_bar0)}" width="{fmt(bar_w)}" height="{fmt(bar_plot_h)}" fill="none" stroke="#000000" stroke-opacity="0.05" />'
    )
    svg.append(
        f'  <line class="axis" x1="{fmt(bar_x0)}" y1="{fmt(y_bar0 + bar_plot_h)}" x2="{fmt(bar_x0 + bar_w)}" y2="{fmt(y_bar0 + bar_plot_h)}" />'
    )
    svg.append(
        f'  <line class="axis" x1="{fmt(bar_x0)}" y1="{fmt(y_bar0)}" x2="{fmt(bar_x0)}" y2="{fmt(y_bar0 + bar_plot_h)}" />'
    )

    # Discrete bins: include two tail bins so the mass sums to 1.
    inner_edges = x_lines
    bins: list[tuple[float | None, float | None]] = [(None, inner_edges[0])]
    bins.extend((inner_edges[i], inner_edges[i + 1]) for i in range(len(inner_edges) - 1))
    bins.append((inner_edges[-1], None))

    probs: list[float] = []
    for left, right in bins:
        if left is None and right is not None:
            probs.append(stdnorm_cdf(right))
        elif left is not None and right is None:
            probs.append(1.0 - stdnorm_cdf(left))
        elif left is not None and right is not None:
            probs.append(stdnorm_cdf(right) - stdnorm_cdf(left))
        else:
            raise ValueError("Invalid bin interval.")

    y_max_bar = 0.18
    for y_tick in (0.05, 0.10, 0.15):
        y_svg = by(y_tick)
        svg.append(f'  <line class="grid" x1="{fmt(bar_x0)}" y1="{fmt(y_svg)}" x2="{fmt(bar_x0 + bar_w)}" y2="{fmt(y_svg)}" />')
        svg.append(f'  <text class="small" x="{fmt(bar_x0 - 38)}" y="{fmt(y_svg + 4)}">{y_tick:.2f}</text>')
    svg.append(f'  <text class="small" x="{fmt(bar_x0 - 18)}" y="{fmt(by(0.0) + 4)}">0</text>')
    svg.append(f'  <text class="small" x="{fmt(bar_x0 - 48)}" y="{fmt(y_bar0 + 14)}">P(Y)</text>')

    n_bars = len(bins)
    bar_gap = 4.0
    per_bar = (bar_w - bar_gap * (n_bars - 1)) / n_bars

    def bin_label(left: float | None, right: float | None) -> str:
        if left is None:
            return "…"
        if right is None:
            return "…"
        return f"X ∈ [{left:.1f},{right:.1f})"

    for idx, ((left, right), p) in enumerate(zip(bins, probs)):
        x_left = bar_x0 + idx * (per_bar + bar_gap)
        y_top = by(clamp(p, 0.0, y_max_bar))
        height_px = y_bar0 + bar_plot_h - y_top

        is_highlight = left == highlight_left and right == highlight_right
        klass = "bar-highlight" if is_highlight else "bar"
        svg.append(f'  <rect class="{klass}" x="{fmt(x_left)}" y="{fmt(y_top)}" width="{fmt(per_bar)}" height="{fmt(height_px)}" />')

        label = xml_escape(bin_label(left, right))
        label_x = x_left + per_bar / 2.0
        label_y = y_bar0 + bar_plot_h + 20.0
        svg.append(
            f'  <text class="small" x="{fmt(label_x)}" y="{fmt(label_y)}" text-anchor="end" transform="rotate(-55 {fmt(label_x)},{fmt(label_y)})">{label}</text>'
        )

    svg.append("</svg>")

    out_path.write_text("\n".join(svg) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
