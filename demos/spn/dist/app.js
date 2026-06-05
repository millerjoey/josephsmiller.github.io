import {
  conditionalMarginal,
  displayCategory,
  formatEvidence,
  formatValue,
  hashString,
  logProb,
  mulberry32,
  prepareModel,
  sampleRows
} from "./spn.js";

const DEFAULT_SAMPLE_COUNT = 10;
const RELATIONSHIP_SAMPLE_COUNT = 420;

const state = {
  catalog: [],
  activeItem: null,
  activeVariant: null,
  model: null,
  evidence: {},
  sampleCount: DEFAULT_SAMPLE_COUNT,
  sampleNonce: 0,
  relationship: {
    x: null,
    y: null
  }
};

const els = {
  modelSelect: document.querySelector("#modelSelect"),
  variantPicker: document.querySelector("#variantPicker"),
  variantSelect: document.querySelector("#variantSelect"),
  subtitle: document.querySelector("#modelSubtitle"),
  modelAbout: document.querySelector("#modelAbout"),
  presetButtons: document.querySelector("#presetButtons"),
  evidenceControls: document.querySelector("#evidenceControls"),
  activeEvidence: document.querySelector("#activeEvidence"),
  metrics: document.querySelector("#metrics"),
  charts: document.querySelector("#charts"),
  relationshipControls: document.querySelector("#relationshipControls"),
  relationshipPlot: document.querySelector("#relationshipPlot"),
  samples: document.querySelector("#samples"),
  redrawSamples: document.querySelector("#redrawSamples"),
  sampleCountSelect: document.querySelector("#sampleCountSelect"),
  resetButton: document.querySelector("#resetEvidence")
};

init().catch((error) => {
  document.body.innerHTML = `<main class="fatal">Failed to load demo: ${escapeHtml(error.message)}</main>`;
});

async function init() {
  const catalog = await fetchJson("models/catalog.json");
  state.catalog = catalog.models;
  renderModelSelect();
  els.modelSelect.addEventListener("change", () => {
    const item = state.catalog.find((model) => model.id === els.modelSelect.value) ?? state.catalog[0];
    selectCatalogItem(item);
  });
  els.variantSelect.addEventListener("change", () => {
    const variants = state.activeItem?.variants ?? [];
    const variant = variants.find((item) => item.id === els.variantSelect.value) ?? variants[0];
    state.activeVariant = variant;
    loadModel(variant.path);
  });
  els.resetButton.addEventListener("click", () => {
    state.evidence = {};
    state.sampleNonce += 1;
    renderControls();
    renderOutputs();
  });
  els.redrawSamples.addEventListener("click", () => {
    state.sampleNonce += 1;
    const lp = logProb(state.model, state.evidence);
    renderSamples(lp);
  });
  els.sampleCountSelect.addEventListener("change", () => {
    state.sampleCount = Number(els.sampleCountSelect.value) || DEFAULT_SAMPLE_COUNT;
    state.sampleNonce += 1;
    renderSamples(logProb(state.model, state.evidence));
  });
  await selectCatalogItem(state.catalog[0]);
}

async function selectCatalogItem(item, preferredVariantId = null) {
  state.activeItem = item;
  renderVariantSelect(item, preferredVariantId);
  const path = state.activeVariant?.path ?? item.path;
  await loadModel(path);
}

function renderVariantSelect(item, preferredVariantId = null) {
  const variants = item.variants ?? [];
  if (variants.length === 0) {
    state.activeVariant = null;
    els.variantPicker.hidden = true;
    els.variantSelect.innerHTML = "";
    return;
  }

  const selected = variants.find((variant) => variant.id === preferredVariantId) ?? variants[0];
  state.activeVariant = selected;
  els.variantPicker.hidden = false;
  els.variantSelect.innerHTML = variants.map((variant) => (
    `<option value="${escapeHtml(variant.id)}">${escapeHtml(variant.label)}</option>`
  )).join("");
  els.variantSelect.value = selected.id;
}

async function loadModel(path) {
  const raw = await fetchJson(path);
  state.model = prepareModel(raw);
  state.evidence = {};
  state.sampleCount = Number(els.sampleCountSelect.value) || DEFAULT_SAMPLE_COUNT;
  state.sampleNonce += 1;
  state.relationship = { x: null, y: null };
  els.subtitle.textContent = raw.subtitle ?? "";
  els.modelAbout.textContent = raw.about ?? "Static SPN model loaded from JSON. Training is expected to happen offline before deployment.";
  els.modelSelect.value = state.activeItem?.id ?? raw.id;
  if (state.activeVariant) els.variantSelect.value = state.activeVariant.id;
  renderPresets();
  renderControls();
  renderOutputs();
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function renderModelSelect() {
  els.modelSelect.innerHTML = state.catalog.map((model) => (
    `<option value="${escapeHtml(model.id)}">${escapeHtml(model.title)}</option>`
  )).join("");
}

function renderPresets() {
  const presets = state.model.presets ?? [];
  els.presetButtons.innerHTML = presets.map((preset, index) => (
    `<button type="button" class="preset" data-preset="${index}">${escapeHtml(preset.name)}</button>`
  )).join("");
  els.presetButtons.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = presets[Number(button.dataset.preset)];
      state.evidence = structuredClone(preset.evidence);
      state.sampleNonce += 1;
      renderControls();
      renderOutputs();
    });
  });
}

function renderControls() {
  els.evidenceControls.innerHTML = "";
  for (const feature of state.model.features) {
    els.evidenceControls.appendChild(createFeatureControl(feature));
  }
}

function createFeatureControl(feature) {
  const current = state.evidence[feature.name] ?? { kind: "missing" };
  const wrapper = document.createElement("section");
  wrapper.className = "evidence-row";
  wrapper.dataset.feature = feature.name;

  const label = document.createElement("div");
  label.className = "field-label";
  label.innerHTML = `<span>${escapeHtml(feature.label)}</span><small>${escapeHtml(feature.kind)}</small>`;

  const mode = document.createElement("select");
  mode.className = "mode-select";
  mode.setAttribute("aria-label", `${feature.label} evidence mode`);
  const modes = feature.kind === "categorical"
    ? [["missing", "Unknown"], ["exact", "Exact"], ["set", "Set"]]
    : [["missing", "Unknown"], ["exact", "Exact"], ["interval", "Interval"]];
  mode.innerHTML = modes.map(([value, text]) => (
    `<option value="${value}">${text}</option>`
  )).join("");
  mode.value = current.kind === "impossible" ? "missing" : current.kind;

  const editor = document.createElement("div");
  editor.className = "field-editor";

  const syncEditor = () => {
    editor.innerHTML = "";
    buildEditor(feature, mode.value, current, editor);
  };

  mode.addEventListener("change", () => {
    const next = defaultEvidenceForMode(feature, mode.value);
    updateEvidence(feature.name, next);
    buildEditor(feature, mode.value, next, editor);
    renderOutputs();
  });

  wrapper.append(label, mode, editor);
  syncEditor();
  return wrapper;
}

function buildEditor(feature, mode, current, editor) {
  editor.innerHTML = "";
  if (mode === "missing") {
    editor.appendChild(readonlyPill("marginalized"));
    return;
  }

  if (feature.kind === "categorical") {
    if (mode === "exact") {
      const select = document.createElement("select");
      select.innerHTML = feature.values.map((value) => (
        `<option value="${escapeHtml(value)}">${escapeHtml(displayCategory(value))}</option>`
      )).join("");
      select.value = current.kind === "exact" ? current.value : feature.values[0];
      select.addEventListener("change", () => {
        updateEvidence(feature.name, { kind: "exact", value: select.value });
        renderOutputs();
      });
      editor.appendChild(select);
      return;
    }

    const active = new Set(current.kind === "set" ? current.values : feature.values);
    const setBox = document.createElement("div");
    setBox.className = "check-grid";
    for (const value of feature.values) {
      const id = `${feature.name}-${value}`;
      const label = document.createElement("label");
      label.className = "check-item";
      label.innerHTML = `<input type="checkbox" id="${escapeHtml(id)}" value="${escapeHtml(value)}" ${active.has(value) ? "checked" : ""}> <span>${escapeHtml(displayCategory(value))}</span>`;
      label.querySelector("input").addEventListener("change", () => {
        const values = Array.from(setBox.querySelectorAll("input:checked")).map((input) => input.value);
        updateEvidence(feature.name, values.length === feature.values.length ? { kind: "missing" } : { kind: "set", values });
        renderOutputs();
      });
      setBox.appendChild(label);
    }
    editor.appendChild(setBox);
    return;
  }

  if (mode === "exact") {
    const input = numberInput(feature, current.kind === "exact" ? current.value : "");
    input.addEventListener("input", () => {
      const value = parseNumber(input.value);
      updateEvidence(feature.name, value === null ? { kind: "missing" } : { kind: "exact", value });
      renderOutputs();
    });
    editor.appendChild(input);
    return;
  }

  const lower = numberInput(feature, current.kind === "interval" && current.lower !== undefined ? current.lower : "");
  lower.placeholder = "-inf";
  const upper = numberInput(feature, current.kind === "interval" && current.upper !== undefined ? current.upper : "");
  upper.placeholder = "+inf";
  const glue = document.createElement("span");
  glue.className = "range-glue";
  glue.textContent = "to";
  const onChange = () => {
    const lo = parseNumber(lower.value);
    const hi = parseNumber(upper.value);
    if (lo === null && hi === null) {
      updateEvidence(feature.name, { kind: "missing" });
    } else if (lo !== null && hi !== null && lo > hi) {
      updateEvidence(feature.name, { kind: "impossible" });
    } else {
      updateEvidence(feature.name, {
        kind: "interval",
        ...(lo === null ? {} : { lower: lo }),
        ...(hi === null ? {} : { upper: hi })
      });
    }
    renderOutputs();
  };
  lower.addEventListener("input", onChange);
  upper.addEventListener("input", onChange);
  editor.append(lower, glue, upper);
}

function defaultEvidenceForMode(feature, mode) {
  if (mode === "missing") return { kind: "missing" };
  if (mode === "exact") {
    return feature.kind === "categorical"
      ? { kind: "exact", value: feature.values[0] }
      : { kind: "missing" };
  }
  if (mode === "set") return { kind: "set", values: [] };
  return { kind: "missing" };
}

function updateEvidence(name, evidence) {
  if (!evidence || evidence.kind === "missing") {
    delete state.evidence[name];
  } else {
    state.evidence[name] = evidence;
  }
}

function renderOutputs() {
  const lp = logProb(state.model, state.evidence);
  renderActiveEvidence();
  renderMetrics(lp);
  renderCharts(lp);
  renderRelationshipControls();
  renderRelationship(lp);
  renderSamples(lp);
}

function renderActiveEvidence() {
  const entries = state.model.features
    .filter((feature) => state.evidence[feature.name])
    .map((feature) => `<span class="chip"><b>${escapeHtml(feature.label)}</b><span>${escapeHtml(evidenceLabel(feature, state.evidence[feature.name]))}</span></span>`);
  els.activeEvidence.innerHTML = entries.length > 0 ? entries.join("") : `<span class="empty-state">No evidence</span>`;
}

function renderMetrics(lp) {
  const mass = Number.isFinite(lp) ? Math.exp(lp) : 0;
  els.metrics.innerHTML = [
    metric("log p(e)", Number.isFinite(lp) ? lp.toFixed(3) : "-inf"),
    metric("p(e) / density", formatScientific(mass)),
    metric("active fields", String(Object.keys(state.evidence).length))
  ].join("");
}

function renderCharts(lp) {
  if (!Number.isFinite(lp)) {
    els.charts.innerHTML = `<section class="panel empty-panel">Evidence has zero probability under this model.</section>`;
    return;
  }
  els.charts.innerHTML = "";
  for (const feature of state.model.features) {
    const marginal = conditionalMarginal(state.model, state.evidence, feature);
    const max = Math.max(...marginal.map((item) => item.probability), 1e-12);
    const card = document.createElement("section");
    card.className = "chart-card";
    card.innerHTML = `
      <header>
        <h3>${escapeHtml(feature.label)}</h3>
        <span>${escapeHtml(evidenceLabel(feature, state.evidence[feature.name]))}</span>
      </header>
      <div class="bar-list">
        ${marginal.map((item) => `
          <div class="bar-row">
            <span class="bar-label">${escapeHtml(item.label)}</span>
            <div class="bar-track"><i style="width:${toWidth(item.probability / max)}%"></i></div>
            <b>${escapeHtml(formatPercent(item.probability))}</b>
          </div>
        `).join("")}
      </div>
    `;
    els.charts.appendChild(card);
  }
}

function renderRelationshipControls() {
  const available = availableRelationshipFeatures();
  if (available.length < 2) {
    state.relationship = { x: null, y: null };
    els.relationshipControls.innerHTML = `<p class="panel-note">Relationship plots need at least two variables that are not fixed exactly by the current evidence.</p>`;
    return;
  }

  const names = new Set(available.map((feature) => feature.name));
  if (!names.has(state.relationship.x)) state.relationship.x = available[0].name;
  if (!names.has(state.relationship.y) || state.relationship.y === state.relationship.x) {
    state.relationship.y = available.find((feature) => feature.name !== state.relationship.x).name;
  }

  const xOptions = available.map((feature) => optionHtml(feature, state.relationship.x)).join("");
  const yOptions = available
    .filter((feature) => feature.name !== state.relationship.x)
    .map((feature) => optionHtml(feature, state.relationship.y))
    .join("");

  els.relationshipControls.innerHTML = `
    <label>
      <span>X</span>
      <select id="relationshipX">${xOptions}</select>
    </label>
    <label>
      <span>Y</span>
      <select id="relationshipY">${yOptions}</select>
    </label>
    <p class="relationship-note">Exact-conditioned variables are omitted. Interval and set-valued variables remain available inside their constrained support.</p>
  `;

  const xSelect = els.relationshipControls.querySelector("#relationshipX");
  const ySelect = els.relationshipControls.querySelector("#relationshipY");
  xSelect.addEventListener("change", () => {
    state.relationship.x = xSelect.value;
    if (state.relationship.y === state.relationship.x) {
      state.relationship.y = available.find((feature) => feature.name !== state.relationship.x).name;
    }
    renderRelationshipControls();
    renderRelationship(logProb(state.model, state.evidence));
  });
  ySelect.addEventListener("change", () => {
    state.relationship.y = ySelect.value;
    renderRelationship(logProb(state.model, state.evidence));
  });
}

function renderRelationship(lp) {
  if (!Number.isFinite(lp)) {
    els.relationshipPlot.innerHTML = `<div class="empty-panel">No conditional relationship to draw.</div>`;
    return;
  }

  const available = availableRelationshipFeatures();
  if (available.length < 2) {
    els.relationshipPlot.innerHTML = `<div class="empty-panel">Fix fewer variables exactly to inspect a conditional relationship.</div>`;
    return;
  }

  const xFeature = state.model.featureIndex[state.relationship.x];
  const yFeature = state.model.featureIndex[state.relationship.y];
  if (!xFeature || !yFeature || xFeature.name === yFeature.name) {
    els.relationshipPlot.innerHTML = `<div class="empty-panel">Choose two different variables.</div>`;
    return;
  }

  const rng = mulberry32(hashString(`${state.model.id}:${state.sampleNonce}:relationship:${xFeature.name}:${yFeature.name}:${JSON.stringify(state.evidence)}`));
  const rows = sampleRows(state.model, state.evidence, RELATIONSHIP_SAMPLE_COUNT, rng);

  if (isNumericFeature(xFeature) && isNumericFeature(yFeature)) {
    renderScatter(rows, xFeature, yFeature);
  } else if (isNumericFeature(xFeature) || isNumericFeature(yFeature)) {
    renderCategoricalNumeric(rows, xFeature, yFeature);
  } else {
    renderContingency(rows, xFeature, yFeature);
  }
}

function renderScatter(rows, xFeature, yFeature) {
  const points = rows
    .map((row) => ({ x: Number(row[xFeature.name]), y: Number(row[yFeature.name]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length === 0) {
    els.relationshipPlot.innerHTML = `<div class="empty-panel">No finite sample points for these variables.</div>`;
    return;
  }

  const width = 680;
  const height = 330;
  const margin = { left: 62, right: 22, top: 18, bottom: 48 };
  const xExtent = paddedExtent(points.map((point) => point.x), xFeature.domain);
  const yExtent = paddedExtent(points.map((point) => point.y), yFeature.domain);
  const xScale = (value) => margin.left + ((value - xExtent[0]) / (xExtent[1] - xExtent[0])) * (width - margin.left - margin.right);
  const yScale = (value) => height - margin.bottom - ((value - yExtent[0]) / (yExtent[1] - yExtent[0])) * (height - margin.top - margin.bottom);
  const dots = points.map((point) => (
    `<circle cx="${xScale(point.x).toFixed(2)}" cy="${yScale(point.y).toFixed(2)}" r="3.2"></circle>`
  )).join("");

  els.relationshipPlot.innerHTML = `
    <div class="plot-title">Conditional scatter from ${points.length} samples</div>
    <svg class="scatter-plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="Conditional scatter plot">
      <line class="axis" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}"></line>
      <line class="axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}"></line>
      <text class="axis-label" x="${width / 2}" y="${height - 12}">${escapeHtml(xFeature.label)}</text>
      <text class="axis-label" transform="translate(16 ${height / 2}) rotate(-90)">${escapeHtml(yFeature.label)}</text>
      <text class="tick-label" x="${margin.left}" y="${height - margin.bottom + 20}">${escapeHtml(formatValue(xFeature, xExtent[0]))}</text>
      <text class="tick-label end" x="${width - margin.right}" y="${height - margin.bottom + 20}">${escapeHtml(formatValue(xFeature, xExtent[1]))}</text>
      <text class="tick-label end" x="${margin.left - 8}" y="${margin.top + 4}">${escapeHtml(formatValue(yFeature, yExtent[1]))}</text>
      <text class="tick-label end" x="${margin.left - 8}" y="${height - margin.bottom + 4}">${escapeHtml(formatValue(yFeature, yExtent[0]))}</text>
      <g class="scatter-points">${dots}</g>
    </svg>
  `;
}

function renderCategoricalNumeric(rows, firstFeature, secondFeature) {
  const catFeature = isNumericFeature(firstFeature) ? secondFeature : firstFeature;
  const numFeature = isNumericFeature(firstFeature) ? firstFeature : secondFeature;
  const groups = new Map(categoryValues(catFeature).map((value) => [value, []]));
  for (const row of rows) {
    const key = row[catFeature.name];
    const value = Number(row[numFeature.name]);
    if (!groups.has(key) || !Number.isFinite(value)) continue;
    groups.get(key).push(value);
  }
  const summaries = Array.from(groups.entries())
    .map(([category, values]) => summarizeGroup(category, values))
    .filter((item) => item.count > 0);
  if (summaries.length === 0) {
    els.relationshipPlot.innerHTML = `<div class="empty-panel">No finite conditional samples for these variables.</div>`;
    return;
  }

  const width = 760;
  const rowHeight = 54;
  const margin = { left: 130, right: 108, top: 28, bottom: 48 };
  const height = margin.top + margin.bottom + rowHeight * summaries.length;
  const extent = paddedExtent(summaries.flatMap((item) => [item.p05, item.p95]), numFeature.domain);
  const xScale = (value) => margin.left + ((value - extent[0]) / (extent[1] - extent[0])) * (width - margin.left - margin.right);
  const rowsSvg = summaries.map((item, index) => {
    const y = margin.top + index * rowHeight + rowHeight / 2;
    const q1 = xScale(item.q1);
    const q3 = xScale(item.q3);
    const median = xScale(item.median);
    const p05 = xScale(item.p05);
    const p95 = xScale(item.p95);
    const boxWidth = Math.max(2, q3 - q1);
    return `
      <g class="box-row">
        <text class="box-label" x="0" y="${y + 5}">${escapeHtml(displayCategory(item.category))}</text>
        <line class="box-whisker" x1="${p05.toFixed(2)}" y1="${y}" x2="${p95.toFixed(2)}" y2="${y}"></line>
        <line class="box-cap" x1="${p05.toFixed(2)}" y1="${y - 10}" x2="${p05.toFixed(2)}" y2="${y + 10}"></line>
        <line class="box-cap" x1="${p95.toFixed(2)}" y1="${y - 10}" x2="${p95.toFixed(2)}" y2="${y + 10}"></line>
        <rect class="box-iqr" x="${Math.min(q1, q3).toFixed(2)}" y="${y - 14}" width="${boxWidth.toFixed(2)}" height="28" rx="5"></rect>
        <line class="box-median" x1="${median.toFixed(2)}" y1="${y - 15}" x2="${median.toFixed(2)}" y2="${y + 15}"></line>
        <text class="box-value" x="${width}" y="${y + 5}">${escapeHtml(formatValue(numFeature, item.median))} / n=${item.count}</text>
      </g>
    `;
  }).join("");

  els.relationshipPlot.innerHTML = `
    <div class="plot-title">${escapeHtml(numFeature.label)} by ${escapeHtml(catFeature.label)} from ${rows.length} conditional samples</div>
    <div class="plot-note">Box shows Q1-Q3; center line is median; whiskers show 5th-95th percentiles.</div>
    <svg class="box-plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="Conditional box plot">
      <line class="axis" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}"></line>
      <text class="tick-label" x="${margin.left}" y="${height - margin.bottom + 22}">${escapeHtml(formatValue(numFeature, extent[0]))}</text>
      <text class="tick-label end" x="${width - margin.right}" y="${height - margin.bottom + 22}">${escapeHtml(formatValue(numFeature, extent[1]))}</text>
      ${rowsSvg}
    </svg>
  `;
}

function summarizeGroup(category, values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    category,
    count: sorted.length,
    p05: quantileSorted(sorted, 0.05),
    q1: quantileSorted(sorted, 0.25),
    median: quantileSorted(sorted, 0.5),
    q3: quantileSorted(sorted, 0.75),
    p95: quantileSorted(sorted, 0.95)
  };
}

function quantileSorted(sorted, p) {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const position = p * (sorted.length - 1);
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  const weight = position - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

function renderContingency(rows, xFeature, yFeature) {
  const xValues = categoryValues(xFeature);
  const yValues = categoryValues(yFeature);
  const counts = new Map();
  for (const y of yValues) {
    for (const x of xValues) counts.set(`${y}\u0000${x}`, 0);
  }
  for (const row of rows) {
    const x = row[xFeature.name];
    const y = row[yFeature.name];
    const key = `${y}\u0000${x}`;
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  const body = yValues.map((y) => `
    <tr>
      <th>${escapeHtml(displayCategory(y))}</th>
      ${xValues.map((x) => {
        const count = counts.get(`${y}\u0000${x}`) ?? 0;
        return `<td>${count}<span>${formatPercent(count / rows.length)}</span></td>`;
      }).join("")}
    </tr>
  `).join("");

  els.relationshipPlot.innerHTML = `
    <div class="plot-title">Conditional contingency from ${rows.length} samples</div>
    <div class="table-wrap">
      <table class="contingency-table">
        <thead>
          <tr>
            <th>${escapeHtml(yFeature.label)} \\ ${escapeHtml(xFeature.label)}</th>
            ${xValues.map((value) => `<th>${escapeHtml(displayCategory(value))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderSamples(lp) {
  if (!Number.isFinite(lp)) {
    els.samples.innerHTML = `<div class="empty-panel">No conditional samples.</div>`;
    return;
  }
  const rng = mulberry32(hashString(`${state.model.id}:${state.sampleNonce}:samples:${state.sampleCount}:${JSON.stringify(state.evidence)}`));
  const rows = sampleRows(state.model, state.evidence, state.sampleCount, rng);
  const headers = state.model.features.map((feature) => `<th>${escapeHtml(feature.label)}</th>`).join("");
  const body = rows.map((row) => `
    <tr>
      ${state.model.features.map((feature) => `<td>${escapeHtml(formatValue(feature, row[feature.name]))}</td>`).join("")}
    </tr>
  `).join("");
  els.samples.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function availableRelationshipFeatures() {
  return state.model.features.filter((feature) => !isFixedByEvidence(feature, state.evidence[feature.name]));
}

function optionHtml(feature, selected) {
  return `<option value="${escapeHtml(feature.name)}" ${feature.name === selected ? "selected" : ""}>${escapeHtml(feature.label)}</option>`;
}

function isFixedByEvidence(feature, evidence) {
  if (!evidence) return false;
  if (evidence.kind === "exact") return true;
  if (feature.kind === "categorical" && evidence.kind === "set") return evidence.values.length <= 1;
  if (evidence.kind === "interval") {
    return evidence.lower !== undefined && evidence.upper !== undefined && evidence.lower === evidence.upper;
  }
  return false;
}

function isNumericFeature(feature) {
  return feature.kind === "continuous" || feature.kind === "count";
}

function categoryValues(feature) {
  const evidence = state.evidence[feature.name];
  if (evidence?.kind === "set") return evidence.values;
  return feature.values;
}

function paddedExtent(values, domain) {
  const finite = values.filter(Number.isFinite);
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (domain) {
    lo = Math.min(domain[0], lo);
    hi = Math.max(domain[1], hi);
    if (lo !== hi) return [lo, hi];
  }
  if (lo === hi) {
    const pad = Math.max(1, Math.abs(lo) * 0.05);
    return [lo - pad, hi + pad];
  }
  const pad = 0.05 * (hi - lo);
  return [lo - pad, hi + pad];
}

function metric(label, value) {
  return `<section class="metric"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></section>`;
}

function evidenceLabel(feature, evidence) {
  if (evidence?.kind === "set" && evidence.values.length === 0) return "none selected";
  return formatEvidence(feature, evidence);
}

function readonlyPill(text) {
  const pill = document.createElement("span");
  pill.className = "readonly-pill";
  pill.textContent = text;
  return pill;
}

function numberInput(feature, value) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = feature.kind === "count" ? "1" : "0.1";
  input.value = value === "" ? "" : String(value);
  if (feature.domain) {
    input.min = String(feature.domain[0]);
    input.max = String(feature.domain[1]);
  }
  return input;
}

function parseNumber(value) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatScientific(value) {
  if (value === 0) return "0";
  if (value >= 0.001 && value < 1000) return value.toPrecision(3);
  return value.toExponential(2);
}

function formatPercent(value) {
  return `${(100 * value).toFixed(value < 0.01 && value > 0 ? 2 : 1)}%`;
}

function toWidth(value) {
  return Math.max(0, Math.min(100, 100 * value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
