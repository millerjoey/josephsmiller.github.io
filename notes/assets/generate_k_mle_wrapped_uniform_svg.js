const fs = require("fs");

const out = "notes/assets/k_mle_wrapped_uniform.svg";
const n = 360;
const xs = Array.from({ length: n }, (_, i) => (i + 0.5) / n);
const xPlot = Array.from({ length: 361 }, (_, i) => i / 360);
const sigma = 0.10;
const ell = 0.08;
const wrapTerms = Array.from({ length: 11 }, (_, i) => i - 5);

const ink = "#1f2a37";
const muted = "#5b6673";
const accent = "#8b3a3a";

function fmt(value) {
  return value.toFixed(2);
}

function fmt3(value) {
  return value.toFixed(3);
}

function wrappedDensity(x, mu) {
  let total = 0;
  for (const k of wrapTerms) {
    total += Math.exp(-0.5 * ((x - mu + k) / sigma) ** 2);
  }
  return total / (Math.sqrt(2 * Math.PI) * sigma);
}

function qProb(mu) {
  const vals = xs.map((x) => wrappedDensity(x, mu));
  const total = vals.reduce((a, b) => a + b, 0);
  return vals.map((v) => v / total);
}

function kernel(x, y) {
  const d = Math.abs(x - y);
  return Math.exp(-(d * d) / (2 * ell * ell));
}

const K = xs.map((xi) => xs.map((xj) => kernel(xi, xj)));
const p = Array(n).fill(1 / n);

function matVec(M, v) {
  return M.map((row) => row.reduce((s, mij, j) => s + mij * v[j], 0));
}

function ceK(q) {
  const t = matVec(K, q);
  const h = -q.reduce((s, qi, i) => s + qi * Math.log(t[i]), 0);
  const grad = Array(n);

  for (let j = 0; j < n; j += 1) {
    let correction = 0;
    for (let i = 0; i < n; i += 1) {
      correction += q[i] * K[i][j] / t[i];
    }
    grad[j] = -Math.log(t[j]) - correction;
  }

  let tangent = 0;
  for (let i = 0; i < n; i += 1) {
    tangent += grad[i] * (p[i] - q[i]);
  }
  return h + tangent;
}

function ordinaryCE(mu) {
  return -xs.reduce((s, x) => s + Math.log(wrappedDensity(x, mu)), 0) / n;
}

function pathFromPoints(points) {
  return points.map(([x, y], i) => `${i ? "L" : "M"} ${fmt(x)},${fmt(y)}`).join(" ");
}

const mus = Array.from({ length: 161 }, (_, i) => i / 160);
const kVals = mus.map((mu) => ceK(qProb(mu)));
const worstIndex = kVals.reduce((best, value, index) => value > kVals[best] ? index : best, 0);
const offCenterMu = mus[worstIndex];

const fits = [
  {
    title: "Off-center candidate",
    subtitle: "one member of the ordinary MLE family",
    mu: offCenterMu,
  },
  {
    title: "Centered candidate",
    subtitle: "same ordinary likelihood",
    mu: 0.5,
  },
];

for (const fit of fits) {
  fit.density = xPlot.map((x) => wrappedDensity(x, fit.mu));
  fit.ce = ordinaryCE(fit.mu);
  fit.kce = ceK(qProb(fit.mu));
}

const width = 980;
const height = 430;
const marginLeft = 64;
const marginRight = 40;
const marginTop = 64;
const gap = 78;
const plotW = (width - marginLeft - marginRight - gap) / 2;
const plotH = 252;
const yMaxDensity = 4.25;

function sx(panel, x) {
  return panel.x + x * panel.w;
}

function sy(panel, y, ymin, ymax) {
  return panel.y + panel.h - ((y - ymin) / (ymax - ymin)) * panel.h;
}

function curvePath(panel, xsIn, ysIn, ymin, ymax) {
  return pathFromPoints(xsIn.map((x, i) => [sx(panel, x), sy(panel, ysIn[i], ymin, ymax)]));
}

function areaPath(panel, xsIn, ysIn, ymin, ymax) {
  const points = [
    [sx(panel, xsIn[0]), sy(panel, ymin, ymin, ymax)],
    ...xsIn.map((x, i) => [sx(panel, x), sy(panel, ysIn[i], ymin, ymax)]),
    [sx(panel, xsIn[xsIn.length - 1]), sy(panel, ymin, ymin, ymax)],
  ];
  return `${pathFromPoints(points)} Z`;
}

function addAxes(svg, panel, title, subtitle, showYLabel) {
  svg.push(`  <text class="label" x="${fmt(panel.x)}" y="${fmt(panel.y - 30)}" fill="${ink}">${title}</text>`);
  svg.push(`  <text class="small" x="${fmt(panel.x)}" y="${fmt(panel.y - 12)}">${subtitle}</text>`);
  svg.push(`  <rect x="${fmt(panel.x)}" y="${fmt(panel.y)}" width="${fmt(panel.w)}" height="${fmt(panel.h)}" fill="none" stroke="#000000" stroke-opacity="0.05" />`);
  svg.push(`  <line class="axis" x1="${fmt(panel.x)}" y1="${fmt(panel.y + panel.h)}" x2="${fmt(panel.x + panel.w)}" y2="${fmt(panel.y + panel.h)}" />`);
  svg.push(`  <line class="axis" x1="${fmt(panel.x)}" y1="${fmt(panel.y)}" x2="${fmt(panel.x)}" y2="${fmt(panel.y + panel.h)}" />`);

  for (const yTick of [1, 2, 3, 4]) {
    const y = sy(panel, yTick, 0, yMaxDensity);
    svg.push(`  <line class="grid" x1="${fmt(panel.x)}" y1="${fmt(y)}" x2="${fmt(panel.x + panel.w)}" y2="${fmt(y)}" />`);
    svg.push(`  <text class="small" x="${fmt(panel.x - 32)}" y="${fmt(y + 4)}">${yTick}</text>`);
  }
  svg.push(`  <text class="small" x="${fmt(panel.x - 18)}" y="${fmt(sy(panel, 0, 0, yMaxDensity) + 4)}">0</text>`);

  for (const [tick, label] of [[0, "0"], [0.5, "0.5"], [1, "1"]]) {
    const x = sx(panel, tick);
    svg.push(`  <line class="axis" x1="${fmt(x)}" y1="${fmt(panel.y + panel.h)}" x2="${fmt(x)}" y2="${fmt(panel.y + panel.h + 6)}" />`);
    svg.push(`  <text class="small" x="${fmt(x - 7)}" y="${fmt(panel.y + panel.h + 24)}">${label}</text>`);
  }

  if (showYLabel) {
    const labelX = panel.x - 50;
    const labelY = panel.y + panel.h / 2;
    svg.push(`  <text class="small axis-label" x="${fmt(labelX)}" y="${fmt(labelY)}" text-anchor="middle" transform="rotate(-90 ${fmt(labelX)} ${fmt(labelY)})">density</text>`);
  }
  svg.push(`  <text class="small" x="${fmt(panel.x + panel.w / 2 - 4)}" y="${fmt(panel.y + panel.h + 44)}">x</text>`);
}

function addLegend(svg, panel, fit) {
  const y = panel.y + panel.h + 70;
  svg.push(`  <line class="muted-curve" x1="${fmt(panel.x)}" y1="${fmt(y - 7)}" x2="${fmt(panel.x + 30)}" y2="${fmt(y - 7)}" />`);
  svg.push(`  <text class="small" x="${fmt(panel.x + 38)}" y="${fmt(y - 3)}">uniform P</text>`);
  svg.push(`  <rect class="density-fill" x="${fmt(panel.x + 128)}" y="${fmt(y - 16)}" width="30.00" height="12.00" />`);
  svg.push(`  <text class="small" x="${fmt(panel.x + 166)}" y="${fmt(y - 3)}">q(x; μ = ${fmt(fit.mu)})</text>`);
  svg.push(`  <text class="small" x="${fmt(panel.x)}" y="${fmt(y + 18)}">ordinary CE = ${fmt3(fit.ce)}</text>`);
}

const svg = [];
svg.push('<?xml version="1.0" encoding="UTF-8"?>');
svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" role="img">`);
svg.push("  <title>Two ordinary MLE candidates for a wrapped Gaussian model</title>");
svg.push("  <style>");
svg.push(`    text { font-family: 'Crimson Pro', 'Times New Roman', serif; fill: ${muted}; }`);
svg.push("    .label { font-size: 14px; font-weight: 600; }");
svg.push("    .small { font-size: 12px; }");
svg.push("    .axis-label { fill: #5b6673; }");
svg.push(`    .accent-text { fill: ${accent}; }`);
svg.push(`    .axis { stroke: ${ink}; stroke-opacity: 0.35; stroke-width: 1.2; }`);
svg.push(`    .grid { stroke: ${ink}; stroke-opacity: 0.12; stroke-width: 1; }`);
svg.push(`    .muted-curve { stroke: ${muted}; stroke-opacity: 0.58; stroke-width: 1.8; fill: none; stroke-dasharray: 5 5; }`);
svg.push(`    .density-fill { fill: ${accent}; fill-opacity: 0.32; stroke: none; }`);
svg.push("  </style>");
svg.push(`  <rect x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="#ffffff" />`);

fits.forEach((fit, index) => {
  const panel = {
    x: marginLeft + index * (plotW + gap),
    y: marginTop,
    w: plotW,
    h: plotH,
  };
  addAxes(svg, panel, fit.title, fit.subtitle, index === 0);
  svg.push(`  <path class="density-fill" d="${areaPath(panel, xPlot, fit.density, 0, yMaxDensity)}" />`);
  svg.push(`  <path class="muted-curve" d="${curvePath(panel, xPlot, xPlot.map(() => 1), 0, yMaxDensity)}" />`);
  addLegend(svg, panel, fit);
});

svg.push("</svg>");

fs.writeFileSync(out, `${svg.join("\n")}\n`);
