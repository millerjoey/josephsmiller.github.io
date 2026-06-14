const fs = require("fs");

const n = 512;
const xs = Array.from({ length: n }, (_, i) => (i + 0.5) / n);
const xPlot = Array.from({ length: 421 }, (_, i) => i / 420);
const ell = 0.04;

const ink = "#1f2a37";
const muted = "#5b6673";
const accent = "#8b3a3a";

function fmt(value) {
  return value.toFixed(2);
}

function fmt3(value) {
  return value.toFixed(3);
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

function ceKGrid(q) {
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

function normalizeDensity(vals) {
  const integral = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.map((v) => v / integral);
}

function densityToProb(density) {
  const total = density.reduce((a, b) => a + b, 0);
  return density.map((v) => v / total);
}

function ordinaryCE(density) {
  return -density.reduce((s, v) => s + Math.log(Math.max(v, 1e-300)), 0) / density.length;
}

function coverageFromProb(q) {
  const t = matVec(K, q);
  const mean = t.reduce((a, b) => a + b, 0) / t.length;
  return t.map((v) => v / mean);
}

function pathFromPoints(points) {
  return points.map(([x, y], i) => `${i ? "L" : "M"} ${fmt(x)},${fmt(y)}`).join(" ");
}

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

function addSvgHeader(svg, width, height, title) {
  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" role="img">`);
  svg.push(`  <title>${title}</title>`);
  svg.push("  <style>");
  svg.push(`    text { font-family: 'Crimson Pro', 'Times New Roman', serif; fill: ${muted}; }`);
  svg.push("    .label { font-size: 14px; font-weight: 600; }");
  svg.push("    .small { font-size: 12px; }");
  svg.push("    .axis-label { fill: #5b6673; }");
  svg.push(`    .accent-text { fill: ${accent}; }`);
  svg.push(`    .axis { stroke: ${ink}; stroke-opacity: 0.35; stroke-width: 1.2; }`);
  svg.push(`    .grid { stroke: ${ink}; stroke-opacity: 0.12; stroke-width: 1; }`);
  svg.push(`    .truth { stroke: ${muted}; stroke-opacity: 0.55; stroke-width: 1.7; fill: none; stroke-dasharray: 5 5; }`);
  svg.push(`    .density-fill { fill: ${accent}; fill-opacity: 0.32; stroke: none; }`);
  svg.push(`    .coverage { stroke: ${accent}; stroke-opacity: 0.88; stroke-width: 2.1; fill: none; }`);
  svg.push(`    .stem { stroke: ${accent}; stroke-opacity: 0.58; stroke-width: 1.4; }`);
  svg.push(`    .dot { fill: ${accent}; fill-opacity: 0.78; stroke: ${accent}; stroke-opacity: 0.95; stroke-width: 1; }`);
  svg.push("  </style>");
  svg.push(`  <rect x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="#ffffff" />`);
}

function addAxes(svg, panel, title, subtitle, yTicks, ymin, ymax, yLabel, showYLabel) {
  svg.push(`  <text class="label" x="${fmt(panel.x)}" y="${fmt(panel.y - 30)}" fill="${ink}">${title}</text>`);
  svg.push(`  <text class="small" x="${fmt(panel.x)}" y="${fmt(panel.y - 12)}">${subtitle}</text>`);
  svg.push(`  <rect x="${fmt(panel.x)}" y="${fmt(panel.y)}" width="${fmt(panel.w)}" height="${fmt(panel.h)}" fill="none" stroke="#000000" stroke-opacity="0.05" />`);
  svg.push(`  <line class="axis" x1="${fmt(panel.x)}" y1="${fmt(panel.y + panel.h)}" x2="${fmt(panel.x + panel.w)}" y2="${fmt(panel.y + panel.h)}" />`);
  svg.push(`  <line class="axis" x1="${fmt(panel.x)}" y1="${fmt(panel.y)}" x2="${fmt(panel.x)}" y2="${fmt(panel.y + panel.h)}" />`);

  for (const yTick of yTicks) {
    const y = sy(panel, yTick, ymin, ymax);
    const yLabelText = Number.isInteger(yTick) ? `${yTick}` : yTick.toFixed(1);
    svg.push(`  <line class="grid" x1="${fmt(panel.x)}" y1="${fmt(y)}" x2="${fmt(panel.x + panel.w)}" y2="${fmt(y)}" />`);
    svg.push(`  <text class="small" x="${fmt(panel.x - 34)}" y="${fmt(y + 4)}">${yLabelText}</text>`);
  }
  svg.push(`  <text class="small" x="${fmt(panel.x - 18)}" y="${fmt(sy(panel, ymin, ymin, ymax) + 4)}">0</text>`);

  for (const [tick, label] of [[0, "0"], [0.5, "0.5"], [1, "1"]]) {
    const x = sx(panel, tick);
    svg.push(`  <line class="axis" x1="${fmt(x)}" y1="${fmt(panel.y + panel.h)}" x2="${fmt(x)}" y2="${fmt(panel.y + panel.h + 6)}" />`);
    svg.push(`  <text class="small" x="${fmt(x - 7)}" y="${fmt(panel.y + panel.h + 24)}">${label}</text>`);
  }

  if (showYLabel) {
    const labelX = panel.x - 50;
    const labelY = panel.y + panel.h / 2;
    svg.push(`  <text class="small axis-label" x="${fmt(labelX)}" y="${fmt(labelY)}" text-anchor="middle" transform="rotate(-90 ${fmt(labelX)} ${fmt(labelY)})">${yLabel}</text>`);
  }
  svg.push(`  <text class="small" x="${fmt(panel.x + panel.w / 2 - 4)}" y="${fmt(panel.y + panel.h + 44)}">x</text>`);
}

function bitReverse(index, bits) {
  let out = 0;
  for (let i = 0; i < bits; i += 1) {
    out = (out << 1) | ((index >> i) & 1);
  }
  return out;
}

function makeChunkShuffleDensity(chunks, sigma) {
  const rawBase = xs.map((x) => Math.exp(-0.5 * ((x - 0.5) / sigma) ** 2));
  const base = normalizeDensity(rawBase);
  const sourceOrder = Array.from({ length: chunks }, (_, i) => i)
    .sort((a, b) => Math.abs((a + 0.5) / chunks - 0.5) - Math.abs((b + 0.5) / chunks - 0.5));
  const targetOrder = Array.from({ length: chunks }, (_, i) => bitReverse(i, Math.log2(chunks)));
  const sourceForTarget = Array(chunks);

  for (let i = 0; i < chunks; i += 1) {
    sourceForTarget[targetOrder[i]] = sourceOrder[i];
  }

  const baseAt = (x) => {
    const raw = Math.exp(-0.5 * ((x - 0.5) / sigma) ** 2);
    const integral = rawBase.reduce((a, b) => a + b, 0) / rawBase.length;
    return raw / integral;
  };

  const shuffledAt = (x) => {
    const target = Math.min(chunks - 1, Math.floor(x * chunks));
    const local = x * chunks - target;
    const source = sourceForTarget[target];
    return baseAt((source + local) / chunks);
  };

  const shuffled = xs.map(shuffledAt);
  return {
    base,
    shuffled,
    basePlot: xPlot.map(baseAt),
    shuffledPlot: xPlot.map(shuffledAt),
  };
}

function renderChunkShuffle() {
  const width = 980;
  const height = 430;
  const marginLeft = 64;
  const marginRight = 40;
  const marginTop = 64;
  const gap = 78;
  const plotW = (width - marginLeft - marginRight - gap) / 2;
  const plotH = 252;
  const yMax = 4.2;
  const data = makeChunkShuffleDensity(32, 0.12);

  const examples = [
    {
      title: "Contiguous Gaussian",
      subtitle: "same likelihood under a measure-preserving shuffle",
      density: data.base,
      densityPlot: data.basePlot,
    },
    {
      title: "Shuffled equal-width pieces",
      subtitle: "high-mass pieces distributed across the interval",
      density: data.shuffled,
      densityPlot: data.shuffledPlot,
    },
  ];

  for (const example of examples) {
    example.q = densityToProb(example.density);
    example.ce = ordinaryCE(example.density);
    example.kce = ceKGrid(example.q);
    const coverage = coverageFromProb(example.q);
    example.coveragePlot = xPlot.map((x) => {
      const idx = Math.max(0, Math.min(n - 1, Math.floor(x * n)));
      return coverage[idx];
    });
  }

  const svg = [];
  addSvgHeader(svg, width, height, "A Gaussian density cut into pieces and shuffled");

  examples.forEach((example, index) => {
    const panel = {
      x: marginLeft + index * (plotW + gap),
      y: marginTop,
      w: plotW,
      h: plotH,
    };
    addAxes(svg, panel, example.title, example.subtitle, [1, 2, 3, 4], 0, yMax, "density", index === 0);
    svg.push(`  <path class="density-fill" d="${areaPath(panel, xPlot, example.densityPlot, 0, yMax)}" />`);
    svg.push(`  <path class="truth" d="${curvePath(panel, xPlot, xPlot.map(() => 1), 0, yMax)}" />`);
    svg.push(`  <path class="coverage" d="${curvePath(panel, xPlot, example.coveragePlot, 0, yMax)}" />`);

    const y = panel.y + panel.h + 70;
    svg.push(`  <line class="truth" x1="${fmt(panel.x)}" y1="${fmt(y - 7)}" x2="${fmt(panel.x + 30)}" y2="${fmt(y - 7)}" />`);
    svg.push(`  <text class="small" x="${fmt(panel.x + 38)}" y="${fmt(y - 3)}">uniform P</text>`);
    svg.push(`  <rect class="density-fill" x="${fmt(panel.x + 124)}" y="${fmt(y - 16)}" width="26.00" height="12.00" />`);
    svg.push(`  <text class="small" x="${fmt(panel.x + 158)}" y="${fmt(y - 3)}">density q</text>`);
    svg.push(`  <line class="coverage" x1="${fmt(panel.x + 238)}" y1="${fmt(y - 7)}" x2="${fmt(panel.x + 268)}" y2="${fmt(y - 7)}" />`);
    svg.push(`  <text class="small" x="${fmt(panel.x + 276)}" y="${fmt(y - 3)}">normalized Kq</text>`);
    svg.push(`  <text class="small" x="${fmt(panel.x)}" y="${fmt(y + 18)}">ordinary CE = ${fmt3(example.ce)}</text>`);
  });

  svg.push("</svg>");
  fs.writeFileSync("notes/assets/k_mle_shuffled_chunks.svg", `${svg.join("\n")}\n`);
}

function kqAtomsAt(x, atoms, weights) {
  let total = 0;
  for (let i = 0; i < atoms.length; i += 1) {
    total += weights[i] * kernel(x, atoms[i]);
  }
  return total;
}

function ceKAtoms(atoms, weights) {
  let logTerm = 0;
  let correctionTerm = 0;
  const kqAtAtoms = atoms.map((a) => kqAtomsAt(a, atoms, weights));

  for (const x of xs) {
    logTerm += Math.log(kqAtomsAt(x, atoms, weights));
    let correction = 0;
    for (let j = 0; j < atoms.length; j += 1) {
      correction += weights[j] * kernel(atoms[j], x) / kqAtAtoms[j];
    }
    correctionTerm += correction;
  }

  return 1 - logTerm / xs.length - correctionTerm / xs.length;
}

function atomExample(count) {
  const atoms = Array.from({ length: count }, (_, i) => i / (count - 1));
  const weights = Array(count).fill(1 / count);
  const coverageRaw = xPlot.map((x) => kqAtomsAt(x, atoms, weights));
  const mean = coverageRaw.reduce((a, b) => a + b, 0) / coverageRaw.length;
  return {
    count,
    atoms,
    weights,
    coverage: coverageRaw.map((v) => v / mean),
    kce: ceKAtoms(atoms, weights),
  };
}

function renderAtomApproximation() {
  const width = 980;
  const height = 430;
  const marginLeft = 64;
  const marginRight = 40;
  const marginTop = 64;
  const gap = 78;
  const plotW = (width - marginLeft - marginRight - gap) / 2;
  const plotH = 252;
  const yMax = 1.9;
  const examples = [atomExample(11), atomExample(31)];

  const svg = [];
  addSvgHeader(svg, width, height, "Finite-atom approximations under ordinary log loss and K-loss");

  examples.forEach((example, index) => {
    const panel = {
      x: marginLeft + index * (plotW + gap),
      y: marginTop,
      w: plotW,
      h: plotH,
    };
    addAxes(
      svg,
      panel,
      `${example.count} equally weighted atoms`,
      index === 0 ? "zero density between support points" : "finer support, same kernel",
      [0.5, 1.0, 1.5],
      0,
      yMax,
      "relative Kq",
      index === 0,
    );
    svg.push(`  <path class="truth" d="${curvePath(panel, xPlot, xPlot.map(() => 1), 0, yMax)}" />`);
    svg.push(`  <path class="coverage" d="${curvePath(panel, xPlot, example.coverage, 0, yMax)}" />`);

    for (const atom of example.atoms) {
      const x = sx(panel, atom);
      svg.push(`  <line class="stem" x1="${fmt(x)}" y1="${fmt(sy(panel, 0, 0, yMax))}" x2="${fmt(x)}" y2="${fmt(sy(panel, 0.18, 0, yMax))}" />`);
      svg.push(`  <circle class="dot" cx="${fmt(x)}" cy="${fmt(sy(panel, 0.18, 0, yMax))}" r="2.5" />`);
    }

    const y = panel.y + panel.h + 70;
    svg.push(`  <line class="truth" x1="${fmt(panel.x)}" y1="${fmt(y - 7)}" x2="${fmt(panel.x + 30)}" y2="${fmt(y - 7)}" />`);
    svg.push(`  <text class="small" x="${fmt(panel.x + 38)}" y="${fmt(y - 3)}">uniform reference</text>`);
    svg.push(`  <line class="coverage" x1="${fmt(panel.x + 160)}" y1="${fmt(y - 7)}" x2="${fmt(panel.x + 190)}" y2="${fmt(y - 7)}" />`);
    svg.push(`  <text class="small" x="${fmt(panel.x + 198)}" y="${fmt(y - 3)}">normalized Kq</text>`);
    svg.push(`  <text class="small" x="${fmt(panel.x)}" y="${fmt(y + 18)}">ordinary CE = ∞</text>`);
  });

  svg.push("</svg>");
  fs.writeFileSync("notes/assets/k_mle_discrete_atoms.svg", `${svg.join("\n")}\n`);
}

renderChunkShuffle();
renderAtomApproximation();
