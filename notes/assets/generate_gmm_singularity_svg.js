const fs = require("fs");

const out = "notes/assets/k_score_gmm_singularity.svg";
const data = [-0.32, -0.10, 0.12, 1.05, 1.30];
const clusterData = data.slice(0, 3);
const outliers = data.slice(3);
const ell = 0.15;
const ceSigmaFloor = 0.001;
const kSigmaFloor = 0.0001;

const ink = "#1f2a37";
const muted = "#5b6673";
const accent = "#8b3a3a";

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs, mu = mean(xs)) {
  return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / xs.length);
}

function logit(p) {
  return Math.log(p / (1 - p));
}

function sigmoid(t) {
  return 1 / (1 + Math.exp(-t));
}

function fmt(value) {
  return value.toFixed(2);
}

function fmt3(value) {
  return value.toFixed(3);
}

function normalPdf(x, mu, sigma) {
  return Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (Math.sqrt(2 * Math.PI) * sigma);
}

function kernel(x, y) {
  return Math.exp(-0.5 * ((x - y) / ell) ** 2);
}

function componentKq(x, mu, sigma) {
  return ell / Math.sqrt(ell * ell + sigma * sigma)
    * Math.exp(-0.5 * ((x - mu) ** 2) / (ell * ell + sigma * sigma));
}

function mixtureDensity(x, components) {
  return components.reduce((s, c) => s + c.weight * normalPdf(x, c.mu, c.sigma), 0);
}

function mixtureKq(x, components) {
  return components.reduce((s, c) => s + c.weight * componentKq(x, c.mu, c.sigma), 0);
}

function componentsFromParams(params, sigmaFloor) {
  const [mu1, logSigma1, mu2, logSigma2, weightLogit] = params;
  const weight2 = sigmoid(weightLogit);
  return [
    {
      weight: 1 - weight2,
      mu: mu1,
      sigma: Math.max(Math.exp(logSigma1), sigmaFloor),
    },
    {
      weight: weight2,
      mu: mu2,
      sigma: Math.max(Math.exp(logSigma2), sigmaFloor),
    },
  ];
}

function ordinaryRisk(components) {
  return data.reduce((s, x) => s - Math.log(Math.max(mixtureDensity(x, components), 1e-300)), 0) / data.length;
}

const zGrid = Array.from({ length: 801 }, (_, i) => -8 + i * (16 / 800));
const zDx = zGrid[1] - zGrid[0];

function normalWeight(z, index) {
  const edge = index === 0 || index === zGrid.length - 1 ? 0.5 : 1;
  return edge * Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI) * zDx;
}

function correctionTerm(x, components) {
  let total = 0;
  for (const component of components) {
    let expectation = 0;
    for (let i = 0; i < zGrid.length; i += 1) {
      const y = component.mu + component.sigma * zGrid[i];
      expectation += normalWeight(zGrid[i], i) * kernel(y, x) / Math.max(mixtureKq(y, components), 1e-300);
    }
    total += component.weight * expectation;
  }
  return total;
}

function kRisk(components) {
  return data.reduce((s, x) => {
    const logTerm = -Math.log(Math.max(mixtureKq(x, components), 1e-300));
    return s + logTerm - (correctionTerm(x, components) - 1);
  }, 0) / data.length;
}

function optimize(objective, starts, steps, maxIterations = 1600) {
  let best = null;

  for (const start of starts) {
    let params = start.slice();
    let value = objective(params);
    let step = steps.slice();

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let improved = false;
      for (let j = 0; j < params.length; j += 1) {
        for (const direction of [-1, 1]) {
          const candidate = params.slice();
          candidate[j] += direction * step[j];
          const candidateValue = objective(candidate);
          if (Number.isFinite(candidateValue) && candidateValue < value) {
            params = candidate;
            value = candidateValue;
            improved = true;
          }
        }
      }

      if (!improved) {
        step = step.map((s) => s * 0.7);
      }
      if (Math.max(...step) < 1e-4) {
        break;
      }
    }

    if (!best || value < best.value) {
      best = { params, value };
    }
  }

  return best;
}

function makeStart(componentA, componentB, weightB) {
  return [
    componentA.mu,
    Math.log(componentA.sigma),
    componentB.mu,
    Math.log(componentB.sigma),
    logit(weightB),
  ];
}

function componentFrom(xs) {
  return {
    mu: mean(xs),
    sigma: Math.max(std(xs), 0.02),
  };
}

function reversedStart(start) {
  const weight2 = sigmoid(start[4]);
  return [start[2], start[3], start[0], start[1], logit(1 - weight2)];
}

const naturalCluster = componentFrom(clusterData);
const naturalOutliers = componentFrom(outliers);
const spikeOnHigh = { mu: outliers[1], sigma: ceSigmaFloor };
const broadWithoutHigh = componentFrom([...clusterData, outliers[0]]);
const spikeOnLow = { mu: outliers[0], sigma: ceSigmaFloor };
const broadWithoutLow = componentFrom([...clusterData, outliers[1]]);

const baseStarts = [
  makeStart(naturalCluster, naturalOutliers, 0.4),
  makeStart(naturalOutliers, naturalCluster, 0.6),
  makeStart(broadWithoutHigh, spikeOnHigh, 0.2),
  makeStart(spikeOnHigh, broadWithoutHigh, 0.8),
  makeStart(broadWithoutLow, spikeOnLow, 0.2),
  makeStart(spikeOnLow, broadWithoutLow, 0.8),
  makeStart({ mu: 0.2, sigma: 0.5 }, { mu: 1.25, sigma: 0.08 }, 0.2),
  makeStart({ mu: -0.1, sigma: 0.2 }, { mu: 1.18, sigma: 0.14 }, 0.4),
];
const starts = [...baseStarts, ...baseStarts.map(reversedStart)];
const steps = [0.25, 0.65, 0.25, 0.65, 1.2];

const ceOpt = optimize(
  (params) => ordinaryRisk(componentsFromParams(params, ceSigmaFloor)),
  starts,
  steps,
);
const kOpt = optimize(
  (params) => kRisk(componentsFromParams(params, kSigmaFloor)),
  starts,
  steps,
);

const ceFit = componentsFromParams(ceOpt.params, ceSigmaFloor);
const kFit = componentsFromParams(kOpt.params, kSigmaFloor);
const ceSpikeIndex = ceFit[0].sigma < ceFit[1].sigma ? 0 : 1;
const ceOutlierIndex = ceFit[0].mu > ceFit[1].mu ? 0 : 1;
const kOutlierIndex = kFit[0].mu > kFit[1].mu ? 0 : 1;

const sigmas = Array.from({ length: 150 }, (_, i) => {
  const min = Math.log(ceSigmaFloor);
  const max = Math.log(0.45);
  return Math.exp(min + (max - min) * i / 149);
});

function withVariedSigma(components, componentIndex, sigma) {
  return components.map((component, index) => ({
    ...component,
    sigma: index === componentIndex ? sigma : component.sigma,
  }));
}

const ceScorePath = sigmas.map((sigma) => {
  const components = withVariedSigma(ceFit, ceOutlierIndex, sigma);
  return {
    sigma,
    ceRisk: ordinaryRisk(components),
  };
});
const kScorePath = sigmas.map((sigma) => {
  const components = withVariedSigma(kFit, kOutlierIndex, sigma);
  return {
    sigma,
    kRisk: kRisk(components),
  };
});
const bestCeWidth = ceScorePath.reduce((best, value) => (value.ceRisk < best.ceRisk ? value : best), ceScorePath[0]);
const bestKWidth = kScorePath.reduce((best, value) => (value.kRisk < best.kRisk ? value : best), kScorePath[0]);
const ceExcessMax = Math.max(...ceScorePath.map((value) => value.ceRisk - bestCeWidth.ceRisk));
const kExcessMax = Math.max(...kScorePath.map((value) => value.kRisk - bestKWidth.kRisk));

const xDensity = Array.from({ length: 680 }, (_, i) => -0.55 + i * (2.1 / 679));
const ceDensity = xDensity.map((x) => mixtureDensity(x, ceFit));
const kDensity = xDensity.map((x) => mixtureDensity(x, kFit));

function pathFromPoints(points) {
  return points.map(([x, y], i) => `${i ? "L" : "M"} ${fmt(x)},${fmt(y)}`).join(" ");
}

function sx(panel, x, xmin, xmax) {
  return panel.x + (x - xmin) / (xmax - xmin) * panel.w;
}

function sy(panel, y, ymin, ymax) {
  return panel.y + panel.h - (y - ymin) / (ymax - ymin) * panel.h;
}

function slog(panel, sigma, minLog, maxLog) {
  return panel.x + (Math.log(sigma) - minLog) / (maxLog - minLog) * panel.w;
}

function curvePath(panel, xs, ys, xmin, xmax, ymin, ymax) {
  return pathFromPoints(xs.map((x, i) => [sx(panel, x, xmin, xmax), sy(panel, ys[i], ymin, ymax)]));
}

function logCurvePath(panel, series, minLog, maxLog, ymin, ymax, yFn) {
  return pathFromPoints(series.map((d) => [slog(panel, d.sigma, minLog, maxLog), sy(panel, yFn(d), ymin, ymax)]));
}

function addSvgHeader(svg, width, height) {
  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" role="img">`);
  svg.push("  <title>Gaussian mixture collapse under cross-entropy and K-cross-entropy</title>");
  svg.push("  <style>");
  svg.push(`    text { font-family: 'Crimson Pro', 'Times New Roman', serif; fill: ${muted}; }`);
  svg.push("    .label { font-size: 14px; font-weight: 600; fill: #1f2a37; }");
  svg.push("    .small { font-size: 12px; }");
  svg.push(`    .axis { stroke: ${ink}; stroke-opacity: 0.35; stroke-width: 1.2; }`);
  svg.push(`    .zero { stroke: ${ink}; stroke-opacity: 0.22; stroke-width: 1.2; }`);
  svg.push(`    .grid { stroke: ${ink}; stroke-opacity: 0.12; stroke-width: 1; }`);
  svg.push(`    .ce { stroke: ${muted}; stroke-opacity: 0.78; stroke-width: 2.1; fill: none; stroke-dasharray: 1.5 5; stroke-linecap: round; }`);
  svg.push(`    .kline { stroke: ${accent}; stroke-opacity: 0.9; stroke-width: 2.3; fill: none; }`);
  svg.push(`    .density-fill { fill: ${accent}; fill-opacity: 0.2; stroke: none; }`);
  svg.push(`    .spike-marker { stroke: ${muted}; stroke-opacity: 0.55; stroke-width: 1.3; stroke-dasharray: 3 4; }`);
  svg.push(`    .marker { stroke: ${accent}; stroke-opacity: 0.32; stroke-width: 1.2; stroke-dasharray: 4 4; }`);
  svg.push(`    .floor-marker { stroke: ${muted}; stroke-opacity: 0.36; stroke-width: 1.2; stroke-dasharray: 4 4; }`);
  svg.push(`    .dot { fill: ${accent}; fill-opacity: 0.88; stroke: ${accent}; stroke-opacity: 0.95; stroke-width: 1; }`);
  svg.push("  </style>");
  svg.push(`  <rect x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="#ffffff" />`);
}

function addDensityAxes(svg, panel) {
  svg.push(`  <text class="label" x="${fmt(panel.x)}" y="${fmt(panel.y - 30)}">Optimized mixture fits</text>`);
  svg.push(`  <text class="small" x="${fmt(panel.x)}" y="${fmt(panel.y - 12)}">CE with a variance floor versus Gaussian K-CE</text>`);
  svg.push(`  <rect x="${fmt(panel.x)}" y="${fmt(panel.y)}" width="${fmt(panel.w)}" height="${fmt(panel.h)}" fill="none" stroke="#000000" stroke-opacity="0.05" />`);
  svg.push(`  <line class="axis" x1="${fmt(panel.x)}" y1="${fmt(panel.y + panel.h)}" x2="${fmt(panel.x + panel.w)}" y2="${fmt(panel.y + panel.h)}" />`);
  svg.push(`  <line class="axis" x1="${fmt(panel.x)}" y1="${fmt(panel.y)}" x2="${fmt(panel.x)}" y2="${fmt(panel.y + panel.h)}" />`);

  for (const tick of [1, 2, 3]) {
    const y = sy(panel, tick, 0, 3.4);
    svg.push(`  <line class="grid" x1="${fmt(panel.x)}" y1="${fmt(y)}" x2="${fmt(panel.x + panel.w)}" y2="${fmt(y)}" />`);
    svg.push(`  <text class="small" x="${fmt(panel.x - 28)}" y="${fmt(y + 4)}">${tick}</text>`);
  }

  for (const [tick, label] of [[-0.5, "-0.5"], [0, "0"], [0.5, "0.5"], [1, "1"], [1.5, "1.5"]]) {
    const x = sx(panel, tick, -0.55, 1.55);
    svg.push(`  <line class="axis" x1="${fmt(x)}" y1="${fmt(panel.y + panel.h)}" x2="${fmt(x)}" y2="${fmt(panel.y + panel.h + 6)}" />`);
    svg.push(`  <text class="small" x="${fmt(x - 10)}" y="${fmt(panel.y + panel.h + 24)}">${label}</text>`);
  }

  const labelX = panel.x - 46;
  const labelY = panel.y + panel.h / 2;
  svg.push(`  <text class="small" x="${fmt(labelX)}" y="${fmt(labelY)}" text-anchor="middle" transform="rotate(-90 ${fmt(labelX)} ${fmt(labelY)})">density</text>`);
  svg.push(`  <text class="small" x="${fmt(panel.x + panel.w / 2 - 4)}" y="${fmt(panel.y + panel.h + 44)}">x</text>`);
}

function addRiskAxes(svg, panel, minLog, maxLog) {
  svg.push(`  <text class="label" x="${fmt(panel.x)}" y="${fmt(panel.y - 30)}">Risk along the second-component variance</text>`);
  svg.push(`  <text class="small" x="${fmt(panel.x)}" y="${fmt(panel.y - 12)}">hold all other fitted parameters fixed; vary σ₂</text>`);
  svg.push(`  <rect x="${fmt(panel.x)}" y="${fmt(panel.y)}" width="${fmt(panel.w)}" height="${fmt(panel.h)}" fill="none" stroke="#000000" stroke-opacity="0.05" />`);
  svg.push(`  <line class="axis" x1="${fmt(panel.x)}" y1="${fmt(panel.y + panel.h)}" x2="${fmt(panel.x + panel.w)}" y2="${fmt(panel.y + panel.h)}" />`);
  svg.push(`  <line class="axis" x1="${fmt(panel.x)}" y1="${fmt(panel.y)}" x2="${fmt(panel.x)}" y2="${fmt(panel.y + panel.h)}" />`);

  for (const tick of [0, 0.5, 1]) {
    const y = sy(panel, tick, 0, 1.05);
    svg.push(`  <line class="${tick === 0 ? "zero" : "grid"}" x1="${fmt(panel.x)}" y1="${fmt(y)}" x2="${fmt(panel.x + panel.w)}" y2="${fmt(y)}" />`);
    svg.push(`  <text class="small" x="${fmt(panel.x - 24)}" y="${fmt(y + 4)}">${tick.toFixed(1)}</text>`);
  }

  for (const [sigma, label] of [[0.001, "0.001"], [0.005, "0.005"], [0.02, "0.02"], [0.1, "0.1"], [0.3, "0.3"]]) {
    const x = slog(panel, sigma, minLog, maxLog);
    svg.push(`  <line class="axis" x1="${fmt(x)}" y1="${fmt(panel.y + panel.h)}" x2="${fmt(x)}" y2="${fmt(panel.y + panel.h + 6)}" />`);
    svg.push(`  <text class="small" x="${fmt(x - 16)}" y="${fmt(panel.y + panel.h + 24)}">${label}</text>`);
  }

  const optimumX = slog(panel, bestKWidth.sigma, minLog, maxLog);
  svg.push(`  <line class="marker" x1="${fmt(optimumX)}" y1="${fmt(panel.y)}" x2="${fmt(optimumX)}" y2="${fmt(panel.y + panel.h)}" />`);
  svg.push(`  <text class="small" x="${fmt(optimumX - 10)}" y="${fmt(panel.y + 18)}" text-anchor="end">K-CE best σ ≈ ${fmt(bestKWidth.sigma)}</text>`);
  svg.push(`  <line class="floor-marker" x1="${fmt(panel.x)}" y1="${fmt(panel.y)}" x2="${fmt(panel.x)}" y2="${fmt(panel.y + panel.h)}" />`);
  svg.push(`  <text class="small" x="${fmt(panel.x + 6)}" y="${fmt(panel.y + 18)}">σ floor</text>`);
  const labelX = panel.x - 46;
  const labelY = panel.y + panel.h / 2;
  svg.push(`  <text class="small" x="${fmt(labelX)}" y="${fmt(labelY)}" text-anchor="middle" transform="rotate(-90 ${fmt(labelX)} ${fmt(labelY)})">relative excess empirical risk</text>`);
  svg.push(`  <text class="small" x="${fmt(panel.x + panel.w / 2 - 74)}" y="${fmt(panel.y + panel.h + 44)}">second-component width σ₂</text>`);
}

const width = 980;
const height = 430;
const marginLeft = 64;
const marginRight = 40;
const gap = 78;
const top = 64;
const panelW = (width - marginLeft - marginRight - gap) / 2;
const panelH = 250;
const densityPanel = { x: marginLeft, y: top, w: panelW, h: panelH };
const riskPanel = { x: marginLeft + panelW + gap, y: top, w: panelW, h: panelH };
const minLog = Math.log(ceSigmaFloor);
const maxLog = Math.log(0.45);

const svg = [];
addSvgHeader(svg, width, height);
svg.push("  <defs>");
svg.push(`    <clipPath id="density-clip"><rect x="${fmt(densityPanel.x)}" y="${fmt(densityPanel.y)}" width="${fmt(densityPanel.w)}" height="${fmt(densityPanel.h)}" /></clipPath>`);
svg.push("  </defs>");
addDensityAxes(svg, densityPanel);
svg.push(`  <g clip-path="url(#density-clip)">`);
svg.push(`    <path class="density-fill" d="${curvePath(densityPanel, xDensity, kDensity, -0.55, 1.55, 0, 3.4)} L ${fmt(sx(densityPanel, 1.55, -0.55, 1.55))},${fmt(sy(densityPanel, 0, 0, 3.4))} L ${fmt(sx(densityPanel, -0.55, -0.55, 1.55))},${fmt(sy(densityPanel, 0, 0, 3.4))} Z" />`);
svg.push(`    <path class="kline" d="${curvePath(densityPanel, xDensity, kDensity, -0.55, 1.55, 0, 3.4)}" />`);
svg.push(`    <path class="ce" d="${curvePath(densityPanel, xDensity, ceDensity, -0.55, 1.55, 0, 3.4)}" />`);
svg.push(`  </g>`);

const ceSpike = ceFit[ceSpikeIndex];
const ceSpikeX = sx(densityPanel, ceSpike.mu, -0.55, 1.55);
svg.push(`  <line class="spike-marker" x1="${fmt(ceSpikeX)}" y1="${fmt(densityPanel.y)}" x2="${fmt(ceSpikeX)}" y2="${fmt(densityPanel.y + densityPanel.h)}" />`);
svg.push(`  <text class="small" x="${fmt(ceSpikeX - 12)}" y="${fmt(densityPanel.y + 16)}" text-anchor="end">CE spike clipped</text>`);

for (const x of data) {
  svg.push(`  <circle class="dot" cx="${fmt(sx(densityPanel, x, -0.55, 1.55))}" cy="${fmt(sy(densityPanel, 0.12, 0, 3.4))}" r="3.1" />`);
}

let legendY = densityPanel.y + densityPanel.h + 70;
svg.push(`  <line class="kline" x1="${fmt(densityPanel.x)}" y1="${fmt(legendY - 7)}" x2="${fmt(densityPanel.x + 30)}" y2="${fmt(legendY - 7)}" />`);
svg.push(`  <text class="small" x="${fmt(densityPanel.x + 38)}" y="${fmt(legendY - 3)}">K-CE fit</text>`);
svg.push(`  <line class="ce" x1="${fmt(densityPanel.x + 150)}" y1="${fmt(legendY - 7)}" x2="${fmt(densityPanel.x + 180)}" y2="${fmt(legendY - 7)}" />`);
svg.push(`  <text class="small" x="${fmt(densityPanel.x + 188)}" y="${fmt(legendY - 3)}">CE fit with σ ≥ ${fmt3(ceSigmaFloor)}</text>`);
svg.push(`  <text class="small" x="${fmt(densityPanel.x)}" y="${fmt(legendY + 18)}">Gaussian similarity scale ℓ = ${fmt(ell)}</text>`);

addRiskAxes(svg, riskPanel, minLog, maxLog);
svg.push(`  <path class="kline" d="${logCurvePath(riskPanel, kScorePath, minLog, maxLog, 0, 1.05, (d) => (d.kRisk - bestKWidth.kRisk) / kExcessMax)}" />`);
svg.push(`  <path class="ce" d="${logCurvePath(riskPanel, ceScorePath, minLog, maxLog, 0, 1.05, (d) => (d.ceRisk - bestCeWidth.ceRisk) / ceExcessMax)}" />`);

legendY = riskPanel.y + riskPanel.h + 70;
svg.push(`  <line class="kline" x1="${fmt(riskPanel.x)}" y1="${fmt(legendY - 7)}" x2="${fmt(riskPanel.x + 30)}" y2="${fmt(legendY - 7)}" />`);
svg.push(`  <text class="small" x="${fmt(riskPanel.x + 38)}" y="${fmt(legendY - 3)}">Gaussian K-CE</text>`);
svg.push(`  <line class="ce" x1="${fmt(riskPanel.x + 140)}" y1="${fmt(legendY - 7)}" x2="${fmt(riskPanel.x + 170)}" y2="${fmt(legendY - 7)}" />`);
svg.push(`  <text class="small" x="${fmt(riskPanel.x + 178)}" y="${fmt(legendY - 3)}">ordinary CE</text>`);
svg.push(`  <text class="small" x="${fmt(riskPanel.x)}" y="${fmt(legendY + 18)}">each curve is shown as excess over its own displayed minimum</text>`);

svg.push("</svg>");
fs.writeFileSync(out, `${svg.join("\n")}\n`);

function componentSummary(components) {
  return components
    .slice()
    .sort((a, b) => a.mu - b.mu)
    .map((c) => `w=${fmt3(c.weight)}, mu=${fmt3(c.mu)}, sigma=${fmt3(c.sigma)}`)
    .join(" | ");
}

console.log(`wrote ${out}`);
console.log(`CE fit: ${componentSummary(ceFit)}; risk=${fmt3(ceOpt.value)}`);
console.log(`K-CE fit: ${componentSummary(kFit)}; risk=${fmt3(kOpt.value)}`);
console.log(`CE slice best sigma=${fmt3(bestCeWidth.sigma)}; K-CE slice best sigma=${fmt3(bestKWidth.sigma)}`);
