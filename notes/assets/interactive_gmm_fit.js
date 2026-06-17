(function () {
  const root = document.getElementById("gmm-fit-lab");
  if (!root) return;

  const svg = root.querySelector('[data-role="plot"]');
  const sampleCountInput = root.querySelector('[data-role="sample-count"]');
  const componentsInput = root.querySelector('[data-role="components"]');
  const ellInput = root.querySelector('[data-role="ell"]');
  const statusNode = root.querySelector('[data-role="status"]');
  const ceSummaryNode = root.querySelector('[data-role="ce-summary"]');
  const kSummaryNode = root.querySelector('[data-role="k-summary"]');
  const sampleSummaryNode = root.querySelector('[data-role="sample-summary"]');
  const ns = "http://www.w3.org/2000/svg";
  const domain = [-0.75, 1.75];
  const panel = { x: 58, y: 44, w: 718, h: 330 };
  const accent = "#8b3a3a";
  const muted = "#5b6673";
  const ink = "#1f2a37";
  const ceDash = "2 6";
  const minNumericalSigma = 1e-8;
  const maxSigma = 1.4;
  const minDisplaySigmaValue = 0.0001;
  const minCoordinateStep = 0.006;
  const maxSweeps = 90;
  const hermiteNodes = [
    -4.4999907073, -3.6699503734, -2.9671669279, -2.3257324862,
    -1.7199925752, -1.1361155852, -0.5650695833, 0,
    0.5650695833, 1.1361155852, 1.7199925752, 2.3257324862,
    2.9671669279, 3.6699503734, 4.4999907073,
  ];
  const hermiteWeights = [
    1.5224758043e-9, 1.0591155477e-6, 0.0001000044412, 0.0027780688429,
    0.0307800338725, 0.1584889157959, 0.4120286874989, 0.5641003087264,
    0.4120286874989, 0.1584889157959, 0.0307800338725, 0.0027780688429,
    0.0001000044412, 1.0591155477e-6, 1.5224758043e-9,
  ];
  const quadrature = hermiteNodes.map((node, index) => ({
    z: Math.SQRT2 * node,
    weight: hermiteWeights[index] / Math.sqrt(Math.PI),
  }));

  const state = {
    samples: defaultSamples(),
    running: false,
    frame: null,
    ce: null,
    k: null,
    initialized: false,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function fmt(value, digits = 3) {
    if (!Number.isFinite(value)) return "-";
    return value.toFixed(digits);
  }

  function fmtSigma(value) {
    if (!Number.isFinite(value)) return "-";
    if (Math.abs(value) < 0.001) return value.toExponential(1);
    return fmt(value, 3);
  }

  function mean(xs) {
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  function std(xs) {
    if (xs.length < 2) return 0.08;
    const mu = mean(xs);
    return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / xs.length);
  }

  function defaultSamples() {
    return [-0.04, 0.06, 0.86];
  }

  function fitCurrentSamples() {
    resetOptimizers();
    startRun();
  }

  function sampleData() {
    const n = clamp(Number(sampleCountInput.value) || 3, 3, 40);
    return Array.from({ length: n }, () => {
      const localRegion = Math.random() < 0.72;
      const center = localRegion ? 0.04 : 0.86;
      const width = localRegion ? 0.30 : 0.42;
      return clamp(center + (Math.random() - 0.5) * width, domain[0], domain[1]);
    }).sort((a, b) => a - b);
  }

  function normalPdf(x, mu, sigma) {
    const z = (x - mu) / sigma;
    return Math.exp(-0.5 * z * z) / (Math.sqrt(2 * Math.PI) * sigma);
  }

  function kernel(x, y, ell) {
    const z = (x - y) / ell;
    return Math.exp(-0.5 * z * z);
  }

  function componentKq(x, component, ell) {
    const variance = ell * ell + component.sigma * component.sigma;
    return ell / Math.sqrt(variance) * Math.exp(-0.5 * ((x - component.mu) ** 2) / variance);
  }

  function softmax(logits) {
    const maxLogit = Math.max(...logits);
    const raw = logits.map((x) => Math.exp(x - maxLogit));
    const total = raw.reduce((a, b) => a + b, 0);
    return raw.map((x) => x / total);
  }

  function paramsToComponents(params, k, sigmaMin) {
    const mus = params.slice(0, k).map((x) => clamp(x, domain[0] - 0.35, domain[1] + 0.35));
    const sigmas = params.slice(k, 2 * k).map((x) => Math.max(Math.exp(clamp(x, Math.log(sigmaMin), Math.log(maxSigma))), sigmaMin));
    const weights = softmax(params.slice(2 * k, 3 * k).map((x) => clamp(x, -7, 7)));
    return mus.map((mu, i) => ({ mu, sigma: sigmas[i], weight: weights[i] }));
  }

  function mixtureDensity(x, components) {
    return components.reduce((s, c) => s + c.weight * normalPdf(x, c.mu, c.sigma), 0);
  }

  function minDisplaySigma() {
    return minDisplaySigmaValue;
  }

  function componentsForPlot(components) {
    const minSigma = minDisplaySigma();
    return components.map((component) => ({
      ...component,
      sigma: Math.max(component.sigma, minSigma),
    }));
  }

  function isPointMassComponent(component, sigmaMin) {
    return component.sigma <= Math.max(sigmaMin * 1.05, minDisplaySigmaValue);
  }

  function componentsAbovePointMassLimit(components, sigmaMin) {
    return components.filter((component) => !isPointMassComponent(component, sigmaMin));
  }

  function plotXValues(components) {
    const values = Array.from({ length: 420 }, (_, i) => (
      domain[0] + ((domain[1] - domain[0]) * i) / 419
    ));
    for (const component of components) {
      const sigma = Math.max(component.sigma, minDisplaySigma());
      for (let i = -10; i <= 10; i += 1) {
        values.push(clamp(component.mu + (i * sigma) / 4, domain[0], domain[1]));
      }
    }
    for (const x of state.samples) values.push(x);
    return Array.from(new Set(values.map((x) => x.toFixed(6))))
      .map(Number)
      .sort((a, b) => a - b);
  }

  function hasDisplayWidenedComponent(components) {
    const minSigma = minDisplaySigma();
    return components.some((component) => component.sigma < minSigma);
  }

  function yMaxFromDensities(densityGroups) {
    const values = densityGroups.flat();
    if (!values.length) return 0.7;
    return Math.max(0.7, percentile(values, 0.985) * 1.18);
  }

  function mixtureKq(x, components, ell) {
    return components.reduce((s, c) => s + c.weight * componentKq(x, c, ell), 0);
  }

  function ceRiskFromParams(params, k, sigmaMin) {
    const components = paramsToComponents(params, k, sigmaMin);
    const total = state.samples.reduce((s, x) => s - Math.log(Math.max(mixtureDensity(x, components), 1e-300)), 0);
    return total / state.samples.length;
  }

  function kRiskFromParams(params, k, ell, sigmaMin) {
    const components = paramsToComponents(params, k, sigmaMin);
    const correctionTerms = Array(state.samples.length).fill(0);

    for (const component of components) {
      for (const point of quadrature) {
        const y = component.mu + component.sigma * point.z;
        const denominator = Math.max(mixtureKq(y, components, ell), 1e-300);
        const scale = component.weight * point.weight / denominator;
        for (let i = 0; i < state.samples.length; i += 1) {
          correctionTerms[i] += scale * kernel(y, state.samples[i], ell);
        }
      }
    }

    const total = state.samples.reduce((s, x, index) => {
      const logTerm = -Math.log(Math.max(mixtureKq(x, components, ell), 1e-300));
      return s + logTerm - (correctionTerms[index] - 1);
    }, 0);
    return total / state.samples.length;
  }

  function quantileGroups(samples, k) {
    const sorted = samples.slice().sort((a, b) => a - b);
    const groups = [];
    for (let i = 0; i < k; i += 1) {
      const start = Math.floor((i * sorted.length) / k);
      const end = Math.max(start + 1, Math.floor(((i + 1) * sorted.length) / k));
      groups.push(sorted.slice(start, end));
    }
    return groups;
  }

  function componentFromGroup(group) {
    return {
      mu: mean(group),
      sigma: Math.max(std(group), 0.06),
      weight: group.length / state.samples.length,
    };
  }

  function normalizeWeights(components) {
    const totalWeight = components.reduce((s, c) => s + c.weight, 0);
    return components.map((c) => ({ ...c, weight: c.weight / totalWeight }));
  }

  function quantileComponents(samples, k) {
    return normalizeWeights(quantileGroups(samples, k).map(componentFromGroup));
  }

  function spikeStart(samples, k, spike, sigmaMin) {
    const rest = samples.filter((x) => x !== spike);
    const groups = quantileGroups(rest.length ? rest : samples, Math.max(1, k - 1)).map(componentFromGroup);
    groups.push({
      mu: spike,
      sigma: sigmaMin,
      weight: 1 / samples.length,
    });
    return normalizeWeights(groups).slice(0, k);
  }

  function startKey(components) {
    return components
      .slice()
      .sort((a, b) => a.mu - b.mu)
      .map((c) => `${fmt(c.mu, 2)}:${fmt(c.sigma, 3)}:${fmt(c.weight, 2)}`)
      .join("|");
  }

  function uniqueStarts(starts) {
    const seen = new Set();
    return starts.filter((components) => {
      const key = startKey(components);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function initialComponentSets(k, mode, sigmaMin) {
    const sorted = state.samples.slice().sort((a, b) => a - b);
    const starts = [quantileComponents(sorted, k)];
    if (k > 1) {
      const median = sorted[Math.floor(sorted.length / 2)];
      const farthest = sorted.reduce((best, x) => (
        Math.abs(x - median) > Math.abs(best - median) ? x : best
      ), sorted[0]);
      let gapLeft = sorted[0];
      let gapRight = sorted[sorted.length - 1];
      let largestGap = -Infinity;
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const gap = sorted[i + 1] - sorted[i];
        if (gap > largestGap) {
          largestGap = gap;
          gapLeft = sorted[i];
          gapRight = sorted[i + 1];
        }
      }
      const spikeCandidates = [sorted[0], sorted[sorted.length - 1], farthest, gapLeft, gapRight];
      for (const spike of spikeCandidates) {
        starts.push(spikeStart(sorted, k, spike, sigmaMin));
      }
    }
    if (mode === "k") {
      starts.push(...starts.map((components) => components.map((c) => ({
        ...c,
        sigma: Math.max(c.sigma, Math.max(Number(ellInput.value) || 0.15, 0.01) * 0.55),
      }))));
    }
    return uniqueStarts(starts).slice(0, 6);
  }

  function componentsToParams(components) {
    const mus = components.map((c) => c.mu);
    const logSigmas = components.map((c) => Math.log(Math.max(c.sigma, minNumericalSigma)));
    const logits = components.map((c) => Math.log(Math.max(c.weight, 1e-4)));
    return [...mus, ...logSigmas, ...logits];
  }

  function makeOptimizer(kind) {
    const k = Math.min(Number(componentsInput.value) || 2, state.samples.length);
    const sigmaMin = minNumericalSigma;
    const ell = Math.max(Number(ellInput.value) || 0.15, 0.01);
    const starts = initialComponentSets(k, kind, sigmaMin);
    const steps = [
      ...Array(k).fill(0.12),
      ...Array(k).fill(0.22),
      ...Array(k).fill(0.35),
    ];
    const objective = kind === "ce"
      ? (p) => ceRiskFromParams(p, k, sigmaMin)
      : (p) => kRiskFromParams(p, k, ell, sigmaMin);
    return createOptimizerEnsemble(starts, steps, objective, kind, k, sigmaMin, ell);
  }

  function sanitizeParam(params, index, k, sigmaMin) {
    if (index < k) return clamp(params[index], domain[0] - 0.35, domain[1] + 0.35);
    if (index < 2 * k) return clamp(params[index], Math.log(sigmaMin), Math.log(maxSigma));
    return clamp(params[index], -7, 7);
  }

  function createOptimizer(params, steps, objective, kind, k, sigmaMin, ell) {
    const opt = {
      params: params.slice(),
      steps: steps.slice(),
      objective,
      kind,
      k,
      sigmaMin,
      ell,
      value: objective(params),
      sweeps: 0,
      stalled: 0,
    };

    opt.sweep = function () {
      let improved = false;
      for (let j = 0; j < opt.params.length; j += 1) {
        let bestValue = opt.value;
        let bestParams = opt.params;
        for (const direction of [-1, 1]) {
          const candidate = opt.params.slice();
          candidate[j] += direction * opt.steps[j];
          candidate[j] = sanitizeParam(candidate, j, opt.k, opt.sigmaMin);
          const value = opt.objective(candidate);
          if (Number.isFinite(value) && value < bestValue) {
            bestValue = value;
            bestParams = candidate;
          }
        }
        if (bestParams !== opt.params) {
          opt.params = bestParams;
          opt.value = bestValue;
          improved = true;
        }
      }
      if (!improved) {
        opt.steps = opt.steps.map((step) => step * 0.78);
        opt.stalled += 1;
      } else {
        opt.stalled = 0;
      }
      opt.sweeps += 1;
    };

    opt.done = function () {
      return Math.max(...opt.steps) < minCoordinateStep || opt.sweeps >= maxSweeps;
    };

    opt.components = function () {
      return paramsToComponents(opt.params, opt.k, opt.sigmaMin).slice().sort((a, b) => a.mu - b.mu);
    };

    return opt;
  }

  function createOptimizerEnsemble(starts, steps, objective, kind, k, sigmaMin, ell) {
    const optimizers = starts.map((components) => createOptimizer(
      componentsToParams(components),
      steps,
      objective,
      kind,
      k,
      sigmaMin,
      ell,
    ));
    const ensemble = {
      optimizers,
      kind,
      k,
      sigmaMin,
      ell,
      get best() {
        return optimizers.reduce((best, opt) => (opt.value < best.value ? opt : best), optimizers[0]);
      },
      get value() {
        return this.best.value;
      },
      get sweeps() {
        return Math.max(...optimizers.map((opt) => opt.sweeps));
      },
      get starts() {
        return optimizers.length;
      },
    };

    ensemble.sweep = function () {
      optimizers.forEach((opt) => {
        if (!opt.done()) opt.sweep();
      });
    };

    ensemble.done = function () {
      return optimizers.every((opt) => opt.done());
    };

    ensemble.components = function () {
      return ensemble.best.components();
    };

    return ensemble;
  }

  function resetOptimizers() {
    stopRun();
    if (state.samples.length < 2) {
      state.ce = null;
      state.k = null;
      state.initialized = false;
      render("Add samples");
      return;
    }
    state.ce = makeOptimizer("ce");
    state.k = makeOptimizer("k");
    state.initialized = true;
    render("Ready");
  }

  function clearFits(status) {
    stopRun();
    state.ce = null;
    state.k = null;
    state.initialized = false;
    render(status || "Ready");
  }

  function stepOptimizers(count) {
    if (!state.initialized) resetOptimizers();
    if (!state.ce || !state.k) return;
    for (let i = 0; i < count; i += 1) {
      if (!state.ce.done()) state.ce.sweep();
      if (!state.k.done()) state.k.sweep();
    }
    const done = state.ce.done() && state.k.done();
    render(done ? "Fit complete" : "Fitting");
    if (done) stopRun();
  }

  function startRun() {
    if (state.running) return;
    if (!state.initialized) resetOptimizers();
    if (!state.ce || !state.k) return;
    state.running = true;
    function tick() {
      if (!state.running) return;
      stepOptimizers(4);
      if (state.running) {
        state.frame = requestAnimationFrame(tick);
      }
    }
    tick();
  }

  function stopRun() {
    state.running = false;
    if (state.frame) {
      cancelAnimationFrame(state.frame);
      state.frame = null;
    }
  }

  function svgEl(name, attrs = {}, text) {
    const node = document.createElementNS(ns, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text != null) node.textContent = text;
    return node;
  }

  function xScale(x) {
    return panel.x + ((x - domain[0]) / (domain[1] - domain[0])) * panel.w;
  }

  function yScale(y, yMax) {
    return panel.y + panel.h - (Math.min(y, yMax) / yMax) * panel.h;
  }

  function pathFor(xs, ys, yMax) {
    return xs.map((x, i) => `${i ? "L" : "M"} ${xScale(x).toFixed(2)},${yScale(ys[i], yMax).toFixed(2)}`).join(" ");
  }

  function areaPathFor(xs, ys, yMax) {
    if (!xs.length) return "";
    const baseline = panel.y + panel.h;
    return [
      `M ${xScale(xs[0]).toFixed(2)},${baseline.toFixed(2)}`,
      ...xs.map((x, i) => `L ${xScale(x).toFixed(2)},${yScale(ys[i], yMax).toFixed(2)}`),
      `L ${xScale(xs[xs.length - 1]).toFixed(2)},${baseline.toFixed(2)}`,
      "Z",
    ].join(" ");
  }

  function addText(group, x, y, text, attrs = {}) {
    group.appendChild(svgEl("text", {
      x,
      y,
      fill: attrs.fill || muted,
      "font-size": attrs.size || 13,
      "font-weight": attrs.weight || 400,
      "text-anchor": attrs.anchor || "start",
      transform: attrs.transform || "",
    }, text));
  }

  function percentile(values, p) {
    if (!values.length) return 1;
    const sorted = values.slice().sort((a, b) => a - b);
    const index = clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1);
    return sorted[index];
  }

  function appendTextRow(parent, className, text) {
    const row = document.createElement("div");
    row.className = className;
    row.textContent = text;
    parent.appendChild(row);
  }

  function fmtDisplaySigma(component, sigmaMin) {
    if (isPointMassComponent(component, sigmaMin)) return "0";
    return fmtSigma(component.sigma);
  }

  function appendComponentRow(parent, component, sigmaMin) {
    const row = document.createElement("div");
    row.className = "fit-component";
    [
      `w ${fmt(component.weight, 2)}`,
      `μ ${fmt(component.mu, 2)}`,
      `σ ${fmtDisplaySigma(component, sigmaMin)}`,
    ].forEach((text) => {
      const cell = document.createElement("span");
      cell.textContent = text;
      row.appendChild(cell);
    });
    parent.appendChild(row);
  }

  function renderSummary(node, optimizer, components) {
    node.replaceChildren();
    if (!optimizer) {
      node.textContent = "-";
      return;
    }
    const singularCount = components.filter((component) => isPointMassComponent(component, optimizer.sigmaMin)).length;
    if (optimizer.kind === "ce" && singularCount) {
      appendTextRow(node, "fit-risk", `risk -> -∞ · best of ${optimizer.starts} starts`);
      appendTextRow(node, "fit-risk", `${singularCount} point-mass component${singularCount === 1 ? "" : "s"}`);
    } else {
      appendTextRow(node, "fit-risk", `risk ${fmt(optimizer.value)} · best of ${optimizer.starts} starts`);
      if (singularCount) {
        appendTextRow(node, "fit-risk", `${singularCount} point-mass limit${singularCount === 1 ? "" : "s"}; score finite`);
      }
    }
    components.forEach((component) => appendComponentRow(node, component, optimizer.sigmaMin));
  }

  function renderSamples(node) {
    node.replaceChildren();
    if (!state.samples.length) {
      node.textContent = "-";
      return;
    }
    appendTextRow(node, "", state.samples.map((x) => fmt(x, 2)).join(", "));
  }

  function render(status) {
    const title = svg.querySelector("title");
    const desc = svg.querySelector("desc");
    svg.replaceChildren(title, desc);
    const group = svgEl("g");
    svg.appendChild(group);

    group.appendChild(svgEl("rect", { x: 0, y: 0, width: 840, height: 480, fill: "#fff" }));
    group.appendChild(svgEl("rect", {
      x: panel.x,
      y: panel.y,
      width: panel.w,
      height: panel.h,
      fill: "none",
      stroke: "rgba(31, 42, 55, 0.08)",
    }));

    const ceComponents = state.ce ? state.ce.components() : [];
    const kComponents = state.k ? state.k.components() : [];
    const cePlotComponents = componentsForPlot(ceComponents);
    const kPlotComponents = componentsForPlot(kComponents);
    const xs = plotXValues([...cePlotComponents, ...kPlotComponents]);
    const ceDensity = cePlotComponents.length ? xs.map((x) => mixtureDensity(x, cePlotComponents)) : [];
    const kDensity = kPlotComponents.length ? xs.map((x) => mixtureDensity(x, kPlotComponents)) : [];
    const ceAxisComponents = componentsForPlot(componentsAbovePointMassLimit(ceComponents, state.ce ? state.ce.sigmaMin : minNumericalSigma));
    const kAxisComponents = componentsForPlot(componentsAbovePointMassLimit(kComponents, state.k ? state.k.sigmaMin : minNumericalSigma));
    const ceAxisDensity = ceAxisComponents.length ? xs.map((x) => mixtureDensity(x, ceAxisComponents)) : [];
    const kAxisDensity = kAxisComponents.length ? xs.map((x) => mixtureDensity(x, kAxisComponents)) : [];
    const yMax = yMaxFromDensities([ceAxisDensity, kAxisDensity]);

    for (const tick of [0, 0.5, 1]) {
      const y = panel.y + panel.h - tick * panel.h;
      group.appendChild(svgEl("line", {
        x1: panel.x,
        y1: y,
        x2: panel.x + panel.w,
        y2: y,
        stroke: tick === 0 ? "rgba(31, 42, 55, 0.35)" : "rgba(31, 42, 55, 0.12)",
      }));
      addText(group, panel.x - 10, y + 4, fmt(tick * yMax, 1), { anchor: "end", size: 12 });
    }

    for (const tick of [-0.5, 0, 0.5, 1, 1.5]) {
      const x = xScale(tick);
      group.appendChild(svgEl("line", {
        x1: x,
        y1: panel.y + panel.h,
        x2: x,
        y2: panel.y + panel.h + 6,
        stroke: "rgba(31, 42, 55, 0.35)",
      }));
      addText(group, x, panel.y + panel.h + 24, String(tick), { anchor: "middle", size: 12 });
    }

    addText(group, panel.x + panel.w / 2, panel.y + panel.h + 44, "x", { anchor: "middle", size: 12 });
    addText(group, panel.x - 42, panel.y + panel.h / 2, "density", {
      anchor: "middle",
      size: 12,
      transform: `rotate(-90 ${panel.x - 42} ${panel.y + panel.h / 2})`,
    });

    if (kDensity.length) {
      group.appendChild(svgEl("path", {
        d: areaPathFor(xs, kDensity, yMax),
        fill: accent,
        "fill-opacity": 0.13,
        stroke: "none",
      }));
      group.appendChild(svgEl("path", {
        d: pathFor(xs, kDensity, yMax),
        fill: "none",
        stroke: accent,
        "stroke-width": 2.4,
      }));
    }
    if (ceDensity.length) {
      group.appendChild(svgEl("path", {
        d: pathFor(xs, ceDensity, yMax),
        fill: "none",
        stroke: muted,
        "stroke-width": 2.2,
        "stroke-dasharray": ceDash,
        "stroke-linecap": "round",
      }));
    }
    for (const x of state.samples) {
      group.appendChild(svgEl("circle", {
        cx: xScale(x),
        cy: panel.y + panel.h - 10,
        r: 4,
        fill: accent,
        "fill-opacity": 0.88,
      }));
    }

    const legendY = 424;
    group.appendChild(svgEl("line", { x1: panel.x, y1: legendY, x2: panel.x + 34, y2: legendY, stroke: accent, "stroke-width": 2.4 }));
    addText(group, panel.x + 44, legendY + 4, "proper K-CE fit", { size: 13 });
    group.appendChild(svgEl("line", { x1: panel.x + 190, y1: legendY, x2: panel.x + 224, y2: legendY, stroke: muted, "stroke-width": 2.2, "stroke-dasharray": ceDash, "stroke-linecap": "round" }));
    addText(group, panel.x + 234, legendY + 4, "ordinary CE fit", { size: 13 });
    statusNode.textContent = status || "Ready";
    renderSummary(ceSummaryNode, state.ce, ceComponents);
    renderSummary(kSummaryNode, state.k, kComponents);
    renderSamples(sampleSummaryNode);
  }

  function pointerToX(event) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    if (
      transformed.x < panel.x ||
      transformed.x > panel.x + panel.w ||
      transformed.y < panel.y ||
      transformed.y > panel.y + panel.h
    ) {
      return null;
    }
    const x = domain[0] + ((transformed.x - panel.x) / panel.w) * (domain[1] - domain[0]);
    return clamp(x, domain[0], domain[1]);
  }

  root.addEventListener("click", (event) => {
    const action = event.target && event.target.getAttribute("data-action");
    if (!action) return;
    if (action === "sample") {
      state.samples = sampleData();
      fitCurrentSamples();
    } else if (action === "clear") {
      stopRun();
      state.samples = defaultSamples();
      sampleCountInput.value = String(state.samples.length);
      fitCurrentSamples();
    }
  });

  svg.addEventListener("pointerdown", (event) => {
    const x = pointerToX(event);
    if (x == null) return;
    stopRun();
    state.samples.push(x);
    state.samples.sort((a, b) => a - b);
    sampleCountInput.value = String(state.samples.length);
    resetOptimizers();
    startRun();
  });

  [componentsInput, ellInput].forEach((input) => {
    input.addEventListener("change", () => {
      fitCurrentSamples();
    });
  });

  sampleCountInput.addEventListener("change", () => {
    state.samples = sampleData();
    fitCurrentSamples();
  });

  fitCurrentSamples();
}());
