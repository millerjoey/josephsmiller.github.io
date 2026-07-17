import {
  logProb,
  prepareModel,
  rootPosterior,
} from "../../spn/dist/spn.js";

const DATA_URL = "models/customer_orders.json";

const state = {
  demo: null,
  scenario: null,
  tableName: "Customer",
  view: "explore",
  conditions: defaultConditions(),
};

function defaultConditions() {
  return {
    region: "",
    signup: "",
    incomeMin: "",
    incomeMax: "",
    profileLoyalty: "",
    profileRiskMin: "",
    profileRiskMax: "",
    profileContact: "",
    orderCountMin: "",
    orderCountExact: "",
    orderStatus: "",
    orderChannel: "",
    orderAmountMin: "",
    orderAmountMax: "",
    orderDiscountMin: "",
    orderDiscountMax: "",
    orderMatchCountMin: "",
    lineItemCategory: "",
    lineItemPriceMin: "",
    lineItemPriceMax: "",
    lineItemQuantityMin: "",
    lineItemQuantityMax: "",
    lineItemMatchCountMin: "",
  };
}

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value ?? "");
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(2);
  }
  return value.toFixed(digits);
}

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return `${(value * 100).toFixed(1)}%`;
}

async function init() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Unable to load ${DATA_URL}: ${response.status}`);
  }
  state.demo = await response.json();
  state.scenario = state.demo.scenarios[0];
  prepareQueryModel();
  renderStatic();
  renderViewSwitcher();
  renderConditionBuilder();
  renderScenarioList();
  renderScenario();
  renderQueryExplore();
}

function prepareQueryModel() {
  const spns = state.demo.queryModel?.spns ?? {};
  state.demo.queryModel.preparedSpns = prepareSpnTree(spns);
}

function prepareSpnTree(value) {
  if (!value) return null;
  if (value.root && value.features) return prepareModel(value);
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, prepareSpnTree(child)])
  );
}

function renderStatic() {
  const { demo } = state;
  $("#rootCount").textContent = demo.dataset.rootRecords;
  $("#orderCount").textContent = demo.dataset.orderRows;
  $("#lineItemCount").textContent = demo.dataset.lineItemRows;
  $("#modelCe").textContent = formatNumber(demo.model.crossEntropyPerRoot, 2);
  $("#modelName").textContent = demo.title;
  $("#modelSubtitle").textContent = demo.subtitle;

  $("#modelFacts").innerHTML = [
    ["Model", demo.model.name],
    ["Root", demo.model.rootPart],
    ["Factorization", demo.model.factorization],
    ["Child set score", demo.model.childSetLikelihood],
    ["Summaries", `${demo.model.partStructureProxyPolicy}, ${demo.model.summaryRole}`],
    ["Shared h/z", demo.model.useExplicitLatentHz ? `${demo.model.explicitLatentHzChildAssignment} z` : "inactive"],
    ["Latent edges", demo.model.useLatentEdgeStates ? "active" : "inactive"],
  ]
    .map(([key, value]) => `
      <div>
        <dt>${escapeHtml(key)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `)
    .join("");

  $("#schemaTree").innerHTML = demo.schema.parts
    .map((part) => `
      <article class="schema-node">
        <h3 class="schema-name">${escapeHtml(part.name)}</h3>
        <p class="schema-role">${escapeHtml(part.role)}</p>
        <p class="schema-desc">${escapeHtml(part.description)}</p>
        <ul class="field-list">
          ${part.fields.map((field) => `<li>${escapeHtml(field)}</li>`).join("")}
        </ul>
      </article>
    `)
    .join("");

  $("#structureEdges").innerHTML = demo.structure.edges
    .map((edge) => `
      <article class="edge-card">
        <h3 class="edge-title">${escapeHtml(edge.parent)} -> ${escapeHtml(edge.child)}</h3>
        <div class="edge-meta">
          <span><strong>Element:</strong> ${escapeHtml(edge.elementModel)}</span>
          <span><strong>Summary proxies:</strong> ${escapeHtml(edge.summaryProxyCount)}</span>
          <span><strong>Parent context:</strong> ${edge.parentContextActive ? "yes" : "no"}</span>
          <span><strong>Latent state:</strong> ${edge.latentEdgeStateActive ? "yes" : "no"}</span>
        </div>
        <div class="edge-tags">
          ${edge.terms.map((term) => `<span class="tag">${escapeHtml(term)}</span>`).join("")}
        </div>
      </article>
    `)
    .join("");
}

function renderViewSwitcher() {
  document.body.dataset.view = state.view;
  for (const button of document.querySelectorAll(".view-button")) {
    button.classList.toggle("is-active", button.dataset.view === state.view);
    button.setAttribute("aria-pressed", button.dataset.view === state.view ? "true" : "false");
    button.onclick = () => {
      state.view = button.dataset.view;
      renderViewSwitcher();
      renderScenario();
      renderQueryExplore();
    };
  }
}

function renderConditionBuilder() {
  const controls = Object.fromEntries(
    (state.demo.queryModel?.controls ?? []).map((control) => [control.id, control])
  );
  $("#conditionBuilder").innerHTML = `
    <div class="condition-group">
      <h3>Customer</h3>
      ${categoricalControl("region", controls["customer.region"], "Any region")}
      ${categoricalControl("signup", controls["customer.signup_channel"], "Any channel")}
      ${numericRangeControl("income", controls["customer.income"])}
    </div>
    <div class="condition-group">
      <h3>Customer Profile</h3>
      ${categoricalControl("profileLoyalty", controls["profile.loyalty_tier"], "Any loyalty tier")}
      ${numericRangeControl("profileRisk", controls["profile.risk_score"])}
      ${categoricalControl("profileContact", controls["profile.preferred_contact"], "Any contact")}
    </div>
    <div class="condition-group">
      <h3>Orders</h3>
      ${countLowerControl("orderCountMin", controls["order.count"], "Total orders", "Any total count")}
      ${categoricalControl("orderStatus", controls["order.status"], "Any status")}
      ${categoricalControl("orderChannel", controls["order.channel"], "Any channel")}
      ${numericRangeControl("orderAmount", controls["order.amount"])}
      ${numericRangeControl("orderDiscount", controls["order.discount"])}
      ${countLowerControl("orderMatchCountMin", controls["order.count"], "Matching order rows", "At least one if order/line-item fields are set", 1)}
    </div>
    <div class="condition-group">
      <h3>Line Items In The Same Order</h3>
      ${categoricalControl("lineItemCategory", controls["line_item.product_category"], "Any category")}
      ${numericRangeControl("lineItemPrice", controls["line_item.price"])}
      ${numericRangeControl("lineItemQuantity", controls["line_item.quantity"])}
      ${domainCountLowerControl("lineItemMatchCountMin", state.demo.queryModel.domains.lineItemCount, "Matching line-item rows", "At least one if line-item fields are set", 1)}
    </div>
  `;

  for (const input of document.querySelectorAll("[data-condition]")) {
    input.addEventListener("input", () => {
      state.conditions[input.dataset.condition] = input.value;
      renderQueryExplore();
    });
  }

  $("#resetConditions").addEventListener("click", () => {
    state.conditions = defaultConditions();
    renderConditionBuilder();
    renderQueryExplore();
  });
}

function categoricalControl(conditionKey, control, emptyLabel) {
  if (!control) return "";
  return `
    <div class="condition-control">
      <label for="cond-${escapeHtml(conditionKey)}">${escapeHtml(control.label)}</label>
      <select id="cond-${escapeHtml(conditionKey)}" data-condition="${escapeHtml(conditionKey)}">
        <option value="">${escapeHtml(emptyLabel)}</option>
        ${control.levels.map((level) => `
          <option value="${escapeHtml(level.value)}"${String(state.conditions[conditionKey]) === String(level.value) ? " selected" : ""}>
            ${escapeHtml(level.label)}
          </option>
        `).join("")}
      </select>
    </div>
  `;
}

function numericRangeControl(prefix, control) {
  if (!control) return "";
  const minKey = `${prefix}Min`;
  const maxKey = `${prefix}Max`;
  return `
    <div class="condition-control">
      <span class="range-label">${escapeHtml(control.label)}</span>
      <div class="range-pair">
        <input
          type="number"
          data-condition="${escapeHtml(minKey)}"
          min="${escapeHtml(control.min)}"
          max="${escapeHtml(control.max)}"
          step="${escapeHtml(control.step ?? 1)}"
          placeholder="min"
          value="${escapeHtml(state.conditions[minKey])}"
          aria-label="${escapeHtml(control.label)} minimum"
        >
        <input
          type="number"
          data-condition="${escapeHtml(maxKey)}"
          min="${escapeHtml(control.min)}"
          max="${escapeHtml(control.max)}"
          step="${escapeHtml(control.step ?? 1)}"
          placeholder="max"
          value="${escapeHtml(state.conditions[maxKey])}"
          aria-label="${escapeHtml(control.label)} maximum"
        >
      </div>
    </div>
  `;
}

function countLowerControl(conditionKey, control, label = null, emptyLabel = "Any count", minOverride = null) {
  if (!control) return "";
  const options = [];
  const first = minOverride ?? control.min;
  for (let value = first; value <= control.max; value += 1) {
    options.push(value);
  }
  return `
    <div class="condition-control">
      <label for="cond-${escapeHtml(conditionKey)}">${escapeHtml(label ?? control.label)}</label>
      <select id="cond-${escapeHtml(conditionKey)}" data-condition="${escapeHtml(conditionKey)}">
        <option value="">${escapeHtml(emptyLabel)}</option>
        ${options.map((value) => `
          <option value="${escapeHtml(value)}"${String(state.conditions[conditionKey]) === String(value) ? " selected" : ""}>
            at least ${escapeHtml(value)}
          </option>
        `).join("")}
      </select>
    </div>
  `;
}

function domainCountLowerControl(conditionKey, domain, label, emptyLabel, minOverride = 0) {
  const values = [...new Set((domain ?? []).map(Number))]
    .filter((value) => Number.isInteger(value) && value >= minOverride)
    .sort((a, b) => a - b);
  return `
    <div class="condition-control">
      <label for="cond-${escapeHtml(conditionKey)}">${escapeHtml(label)}</label>
      <select id="cond-${escapeHtml(conditionKey)}" data-condition="${escapeHtml(conditionKey)}">
        <option value="">${escapeHtml(emptyLabel)}</option>
        ${values.map((value) => `
          <option value="${escapeHtml(value)}"${String(state.conditions[conditionKey]) === String(value) ? " selected" : ""}>
            at least ${escapeHtml(value)}
          </option>
        `).join("")}
      </select>
    </div>
  `;
}

function renderScenarioList() {
  $("#scenarioList").innerHTML = state.demo.scenarios
    .map((scenario) => `
      <button
        type="button"
        class="scenario-button${scenario.id === state.scenario.id ? " is-active" : ""}"
        data-scenario-id="${escapeHtml(scenario.id)}"
        aria-pressed="${scenario.id === state.scenario.id ? "true" : "false"}"
      >
        <span class="scenario-title">${escapeHtml(scenario.label)}</span>
        <span class="scenario-meta">${escapeHtml(scenario.customerId)} · ${escapeHtml(scenario.latentSegment)}</span>
      </button>
    `)
    .join("");

  for (const button of document.querySelectorAll(".scenario-button")) {
    button.addEventListener("click", () => {
      const next = state.demo.scenarios.find((scenario) => scenario.id === button.dataset.scenarioId);
      if (!next) return;
      state.scenario = next;
      renderScenarioList();
      renderScenario();
      renderQueryExplore();
    });
  }
}

function renderScenario() {
  const scenario = state.scenario;
  $("#modelName").textContent = scenario.label;
  $("#modelSubtitle").textContent = scenario.description;
  renderEvidence(scenario);
  renderMetrics(scenario);
  renderTableBrowser(scenario);
  renderFactorBars(scenario);
  renderCharts(scenario);
  renderRecord(scenario.record);
}

function renderQueryExplore() {
  if (!state.demo?.queryModel) return;
  if (state.view === "explore") {
    $("#modelName").textContent = "Field-Conditioned RSPN Query";
    $("#modelSubtitle").textContent =
      "Conditions are evaluated against exported RSPN SPN factors in the browser. Root fields are marginalized by the root SPN; child evidence updates sibling predictions through a shared parent-regime posterior.";
    renderQueryEvidenceChips();
  }
  renderQueryResults();
  renderQueryCharts();
}

function renderQueryEvidenceChips() {
  const labels = activeConditionLabels();
  $("#activeEvidence").innerHTML = labels.length
    ? labels.map((label) => `<span class="chip"><span>${escapeHtml(label.key)}</span>${escapeHtml(label.value)}</span>`).join("")
    : `<span class="chip"><span>evidence</span>none</span>`;
}

function activeConditionLabels() {
  const controls = Object.fromEntries(
    (state.demo.queryModel?.controls ?? []).map((control) => [control.id, control])
  );
  const out = [];
  const region = levelLabel(controls["customer.region"], state.conditions.region);
  if (region) out.push({ key: "region", value: region });
  const signup = levelLabel(controls["customer.signup_channel"], state.conditions.signup);
  if (signup) out.push({ key: "signup", value: signup });
  if (state.conditions.incomeMin || state.conditions.incomeMax) {
    out.push({
      key: "income",
      value: `${state.conditions.incomeMin || "-inf"} to ${state.conditions.incomeMax || "+inf"}`,
    });
  }
  const loyalty = levelLabel(controls["profile.loyalty_tier"], state.conditions.profileLoyalty);
  if (loyalty) out.push({ key: "profile loyalty", value: loyalty });
  addRangeLabel(out, "profile risk", state.conditions.profileRiskMin, state.conditions.profileRiskMax);
  const contact = levelLabel(controls["profile.preferred_contact"], state.conditions.profileContact);
  if (contact) out.push({ key: "profile contact", value: contact });
  if (state.conditions.orderCountMin) {
    out.push({ key: "total orders", value: `at least ${state.conditions.orderCountMin}` });
  }
  const status = levelLabel(controls["order.status"], state.conditions.orderStatus);
  if (status) out.push({ key: "order status", value: status });
  const channel = levelLabel(controls["order.channel"], state.conditions.orderChannel);
  if (channel) out.push({ key: "order channel", value: channel });
  addRangeLabel(out, "order amount", state.conditions.orderAmountMin, state.conditions.orderAmountMax);
  addRangeLabel(out, "order discount", state.conditions.orderDiscountMin, state.conditions.orderDiscountMax);
  if ((hasOrderLocalPredicate(state.conditions) || hasLineItemPredicate(state.conditions)) && state.conditions.orderMatchCountMin) {
    out.push({ key: "matching orders", value: `at least ${state.conditions.orderMatchCountMin}` });
  }
  const category = levelLabel(controls["line_item.product_category"], state.conditions.lineItemCategory);
  if (category) out.push({ key: "line item", value: category });
  addRangeLabel(out, "line price", state.conditions.lineItemPriceMin, state.conditions.lineItemPriceMax);
  addRangeLabel(out, "line qty", state.conditions.lineItemQuantityMin, state.conditions.lineItemQuantityMax);
  if (hasLineItemPredicate(state.conditions) && state.conditions.lineItemMatchCountMin) {
    out.push({ key: "matching line items", value: `at least ${state.conditions.lineItemMatchCountMin}` });
  }
  return out;
}

function addRangeLabel(out, key, lower, upper) {
  if (!lower && !upper) return;
  out.push({ key, value: `${lower || "-inf"} to ${upper || "+inf"}` });
}

function levelLabel(control, value) {
  if (!control || value === "") return "";
  return control.levels.find((level) => String(level.value) === String(value))?.label ?? String(value);
}

function renderQueryResults() {
  const diagnostic = queryDiagnostics(state.conditions);
  $("#queryResults").innerHTML = `
    <div class="query-result-main">
      <span>Probability of evidence</span>
      <strong>${escapeHtml(formatPercent(diagnostic.total))}</strong>
      <p>Compiled from root evidence, count factors, parent-context child-row factors, and recursive exchangeable child-set predicates.</p>
    </div>
    <dl class="query-list">
      <div>
        <dt>Parent-regime posterior</dt>
        <dd>${escapeHtml(formatPosterior(diagnostic.hPosterior))}</dd>
      </div>
      <div>
        <dt>Root likelihood</dt>
        <dd>${escapeHtml(formatPercent(diagnostic.root))}</dd>
      </div>
      <div>
        <dt>Profile-set likelihood</dt>
        <dd>${escapeHtml(formatPercent(diagnostic.profileSet))}</dd>
      </div>
      <div>
        <dt>Profile row match</dt>
        <dd>${diagnostic.profileRowMatch === null ? "not conditioned" : escapeHtml(formatPercent(diagnostic.profileRowMatch))}</dd>
      </div>
      <div>
        <dt>Order-set likelihood</dt>
        <dd>${escapeHtml(formatPercent(diagnostic.orderSet))}</dd>
      </div>
      <div>
        <dt>Per-order row match</dt>
        <dd>${diagnostic.orderRowMatch === null ? "not conditioned" : escapeHtml(formatPercent(diagnostic.orderRowMatch))}</dd>
      </div>
      <div>
        <dt>Line-item set within matching order</dt>
        <dd>${diagnostic.lineItemSet === null ? "not conditioned" : escapeHtml(formatPercent(diagnostic.lineItemSet))}</dd>
      </div>
      <div>
        <dt>Per-line-item row match</dt>
        <dd>${diagnostic.lineItemRowMatch === null ? "not conditioned" : escapeHtml(formatPercent(diagnostic.lineItemRowMatch))}</dd>
      </div>
    </dl>
  `;
}

function formatPosterior(items) {
  if (!items?.length) return "n/a";
  return items
    .map((item) => `h${item.index}: ${(item.probability * 100).toFixed(1)}%`)
    .join(" · ");
}

function renderQueryCharts() {
  const charts = [
    categoricalQueryChart("Customer region", "region", "customer.region"),
    categoricalQueryChart("Signup channel", "signup", "customer.signup_channel"),
    countQueryChart("Orders per customer"),
    orderStatusQueryChart(),
    lineItemCategoryQueryChart(),
  ];
  $("#charts").innerHTML = charts.map(renderQueryChart).join("");
}

function renderQueryChart(chart) {
  const maxValue = Math.max(...chart.items.map((item) => numeric(item.value)), 1);
  return `
    <article class="chart-card">
      <h3 class="chart-title">${escapeHtml(chart.title)}</h3>
      <div class="chart-items">
        ${chart.items.map((item) => {
          const width = numeric(item.value) > 0 ? Math.max(2, (numeric(item.value) / maxValue) * 100) : 0;
          return `
            <div class="chart-item">
              <span class="chart-label">${escapeHtml(item.label)}</span>
              <div class="bar-track" aria-hidden="true">
                <div class="bar-fill" style="width:${width}%"></div>
              </div>
              <span class="chart-value">${escapeHtml(formatPercent(item.value))}</span>
            </div>
          `;
        }).join("")}
      </div>
    </article>
  `;
}

function categoricalQueryChart(title, conditionKey, controlId) {
  const control = state.demo.queryModel.controls.find((item) => item.id === controlId);
  const base = queryProbability(state.conditions);
  return {
    title,
    items: control.levels.map((level) => ({
      label: level.label,
      value: base > 0
        ? queryProbability(withCondition(state.conditions, conditionKey, String(level.value))) / base
        : 0,
    })),
  };
}

function countQueryChart(title) {
  const base = queryProbability(state.conditions);
  return {
    title,
    items: state.demo.queryModel.domains.orderCount.map((count) => ({
      label: String(count),
      value: base > 0
        ? queryProbability(withCondition(state.conditions, "orderCountExact", String(count))) / base
        : 0,
    })),
  };
}

function orderStatusQueryChart() {
  if (state.demo.queryModel?.kind === "shared_parent_regime_rspn_query_model") {
    return categoricalQueryChart("Order status", "orderStatus", "order.status");
  }
  const control = state.demo.queryModel.controls.find((item) => item.id === "order.status");
  const contextEvidence = {
    ...customerEvidenceFor("customerOrderContext", state.conditions),
    ...orderLocalEvidenceFor("customerOrderContext", state.conditions, ["status"]),
  };
  const spn = preparedSpn("customerOrderContext");
  const scope = state.demo.queryModel.scopeMaps.customerOrderContext.status;
  return {
    title: "Per-order status",
    items: control.levels.map((level) => ({
      label: level.label,
      value: childMarginal(spn, contextEvidence, scope, Number(level.value)),
    })),
  };
}

function lineItemCategoryQueryChart() {
  if (state.demo.queryModel?.kind === "shared_parent_regime_rspn_query_model") {
    return categoricalQueryChart("Line-item category", "lineItemCategory", "line_item.product_category");
  }
  const control = state.demo.queryModel.controls.find((item) => item.id === "line_item.product_category");
  const spn = preparedSpn("orderLineItemContext");
  const scope = state.demo.queryModel.scopeMaps.orderLineItemContext.product_category;
  const evidence = {
    ...orderLocalEvidenceFor("orderLineItemContext", state.conditions),
    ...lineItemLocalEvidenceFor("orderLineItemContext", state.conditions, ["product_category"]),
  };
  return {
    title: "Per-line-item category",
    items: control.levels.map((level) => ({
      label: level.label,
      value: childMarginal(spn, evidence, scope, Number(level.value)),
    })),
  };
}

function withCondition(conditions, key, value) {
  const next = { ...conditions };
  if (next[key] !== "" && String(next[key]) !== String(value)) {
    next.__impossible = true;
  }
  next[key] = value;
  return next;
}

function queryProbability(conditions) {
  return queryDiagnostics(conditions).total;
}

function queryDiagnostics(conditions) {
  if (state.demo.queryModel?.kind === "shared_parent_regime_rspn_query_model") {
    return sharedRegimeQueryDiagnostics(conditions);
  }
  if (conditions.__impossible) return emptyQueryDiagnostics();
  const root = rootEvidenceProbability(conditions);
  if (root <= 0) return emptyQueryDiagnostics();
  const profile = profileSetDiagnostics(conditions);
  const order = orderSetDiagnostics(conditions);
  return {
    total: root * profile.probability * order.probability,
    root,
    profileSet: profile.probability,
    profileRowMatch: profile.rowMatch,
    orderSet: order.probability,
    orderRowMatch: order.rowMatch,
    lineItemSet: order.lineItemSet,
    lineItemRowMatch: order.lineItemRowMatch,
    hPosterior: [],
  };
}

function emptyQueryDiagnostics() {
  return {
    total: 0,
    root: 0,
    profileSet: 0,
    profileRowMatch: null,
    orderSet: 0,
    orderRowMatch: null,
    lineItemSet: null,
    lineItemRowMatch: null,
    hPosterior: [],
  };
}

function sharedRegimeQueryDiagnostics(conditions) {
  if (conditions.__impossible) return emptyQueryDiagnostics();
  const root = rootEvidenceProbability(conditions);
  if (root <= 0) return emptyQueryDiagnostics();
  const hPrior = hPosteriorFromRoot(conditions);
  if (!hPrior.length) return emptyQueryDiagnostics();

  let mixture = 0;
  let profileMarginal = 0;
  let orderMarginal = 0;
  let profileRowNumerator = 0;
  let profileRowDenominator = 0;
  let orderRowNumerator = 0;
  let orderRowDenominator = 0;
  let lineSetNumerator = 0;
  let lineSetDenominator = 0;
  let lineRowNumerator = 0;
  let lineRowDenominator = 0;
  const terms = [];

  for (const h of hPrior) {
    const profile = profileSetDiagnosticsForH(conditions, h.index);
    const order = orderSetDiagnosticsForH(conditions, h.index);
    const term = h.probability * profile.probability * order.probability;
    mixture += term;
    profileMarginal += h.probability * profile.probability;
    orderMarginal += h.probability * order.probability;
    if (profile.rowMatch !== null) {
      profileRowNumerator += h.probability * profile.probability * profile.rowMatch;
      profileRowDenominator += h.probability * profile.probability;
    }
    if (order.rowMatch !== null) {
      orderRowNumerator += h.probability * order.probability * order.rowMatch;
      orderRowDenominator += h.probability * order.probability;
    }
    if (order.lineItemSet !== null) {
      lineSetNumerator += h.probability * order.probability * order.lineItemSet;
      lineSetDenominator += h.probability * order.probability;
    }
    if (order.lineItemRowMatch !== null) {
      lineRowNumerator += h.probability * order.probability * order.lineItemRowMatch;
      lineRowDenominator += h.probability * order.probability;
    }
    terms.push({ index: h.index, probability: term });
  }

  const hPosterior = normalizePosteriorTerms(terms);
  return {
    total: clampProbability(root * mixture),
    root,
    profileSet: clampProbability(profileMarginal),
    profileRowMatch: profileRowDenominator > 0 ? clampProbability(profileRowNumerator / profileRowDenominator) : null,
    orderSet: clampProbability(orderMarginal),
    orderRowMatch: orderRowDenominator > 0 ? clampProbability(orderRowNumerator / orderRowDenominator) : null,
    lineItemSet: lineSetDenominator > 0 ? clampProbability(lineSetNumerator / lineSetDenominator) : null,
    lineItemRowMatch: lineRowDenominator > 0 ? clampProbability(lineRowNumerator / lineRowDenominator) : null,
    hPosterior,
  };
}

function hPosteriorFromRoot(conditions) {
  const spn = preparedSpn("customer");
  if (!spn) return [{ index: "1", probability: 1 }];
  const posterior = rootPosterior(spn, customerEvidenceFor("customerRoot", conditions));
  if (!posterior.length) return [{ index: "1", probability: 1 }];
  return posterior.map((item, index) => ({
    index: String(index + 1),
    probability: clampProbability(item.probability),
  }));
}

function normalizePosteriorTerms(terms) {
  const total = terms.reduce((sum, item) => sum + item.probability, 0);
  if (total <= 0) {
    return terms.map((item) => ({ index: item.index, probability: 0 }));
  }
  return terms.map((item) => ({
    index: item.index,
    probability: clampProbability(item.probability / total),
  }));
}

function rootEvidenceProbability(conditions) {
  const spn = preparedSpn("customer");
  if (!spn) return 0;
  return Math.exp(logProb(spn, customerEvidenceFor("customerRoot", conditions)));
}

function profileSetDiagnostics(conditions) {
  if (!hasProfilePredicate(conditions)) {
    return {
      probability: 1,
      rowMatch: null,
    };
  }
  const distribution = profileCountDistribution(conditions);
  const rowMatch = profileRowMatchProbability(conditions);
  const probability = distribution.reduce(
    (sum, item) => sum + item.probability * binomialTail(Number(item.count), 1, rowMatch),
    0,
  );
  return {
    probability: clampProbability(probability),
    rowMatch,
  };
}

function profileSetDiagnosticsForH(conditions, h) {
  if (!hasProfilePredicate(conditions)) {
    return {
      probability: 1,
      rowMatch: null,
    };
  }
  const distribution = countDistributionForH("customerProfileCountByH", h, "customerProfileCount", conditions);
  const rowMatch = profileRowMatchProbabilityForH(conditions, h);
  const probability = distribution.reduce(
    (sum, item) => sum + item.probability * binomialTail(Number(item.count), 1, rowMatch),
    0,
  );
  return {
    probability: clampProbability(probability),
    rowMatch,
  };
}

function profileCountDistribution(conditions) {
  const spn = preparedSpn("customerProfileCount");
  const scope = state.demo.queryModel.scopeMaps.customerProfileCount.count;
  const given = customerEvidenceFor("customerProfileCount", conditions);
  const denom = logProb(spn, given);
  return state.demo.queryModel.domains.profileCount.map((count) => ({
    count,
    probability: probabilityRatio(logProb(spn, { ...given, [scope]: { kind: "exact", value: count } }), denom),
  }));
}

function profileRowMatchProbability(conditions) {
  const spn = preparedSpn("customerProfileContext");
  const parentEvidence = customerEvidenceFor("customerProfileContext", conditions);
  const rowEvidence = {
    ...parentEvidence,
    ...profileLocalEvidenceFor("customerProfileContext", conditions),
  };
  return probabilityRatio(logProb(spn, rowEvidence), logProb(spn, parentEvidence));
}

function profileRowMatchProbabilityForH(conditions, h) {
  return hzRowMatchProbability({
    contextGroup: "customerProfileContextByHZ",
    zGroup: "customerProfileZByH",
    zScopeMap: "customerProfileZ",
    contextScopeMap: "customerProfileContext",
    h,
    conditions,
    localEvidence: profileLocalEvidenceFor,
  });
}

function orderSetProbability(conditions) {
  return orderSetDiagnostics(conditions).probability;
}

function orderSetDiagnostics(conditions) {
  const distribution = orderCountDistribution(conditions);
  const exact = conditions.orderCountExact !== "" ? Number(conditions.orderCountExact) : null;
  const min = conditions.orderCountMin !== "" ? Number(conditions.orderCountMin) : null;
  const rowPredicateActive = hasOrderLocalPredicate(conditions) || hasLineItemPredicate(conditions);
  const matchMin = rowPredicateActive ? Number(conditions.orderMatchCountMin || 1) : null;
  const orderRow = rowPredicateActive ? orderRowMatchDiagnostics(conditions) : null;
  if (exact === null && min === null && !rowPredicateActive) {
    return {
      probability: 1,
      rowMatch: null,
      lineItemSet: null,
      lineItemRowMatch: null,
    };
  }

  let total = 0;
  for (const item of distribution) {
    const n = Number(item.count);
    if (exact !== null && n !== exact) continue;
    if (min !== null && n < min) continue;
    let eventProb = 1;
    if (rowPredicateActive) {
      eventProb *= binomialTail(n, matchMin, orderRow.probability);
    }
    total += item.probability * eventProb;
  }
  return {
    probability: clampProbability(total),
    rowMatch: orderRow?.probability ?? null,
    lineItemSet: orderRow?.lineItemSet ?? null,
    lineItemRowMatch: orderRow?.lineItemRowMatch ?? null,
  };
}

function orderSetDiagnosticsForH(conditions, h) {
  const distribution = countDistributionForH("customerOrderCountByH", h, "customerOrderCount", conditions);
  const exact = conditions.orderCountExact !== "" ? Number(conditions.orderCountExact) : null;
  const min = conditions.orderCountMin !== "" ? Number(conditions.orderCountMin) : null;
  const rowPredicateActive = hasOrderLocalPredicate(conditions) || hasLineItemPredicate(conditions);
  const matchMin = rowPredicateActive ? Number(conditions.orderMatchCountMin || 1) : null;
  const orderRow = rowPredicateActive ? orderRowMatchDiagnosticsForH(conditions, h) : null;
  if (exact === null && min === null && !rowPredicateActive) {
    return {
      probability: 1,
      rowMatch: null,
      lineItemSet: null,
      lineItemRowMatch: null,
    };
  }

  let total = 0;
  for (const item of distribution) {
    const n = Number(item.count);
    if (exact !== null && n !== exact) continue;
    if (min !== null && n < min) continue;
    let eventProb = 1;
    if (rowPredicateActive) {
      eventProb *= binomialTail(n, matchMin, orderRow.probability);
    }
    total += item.probability * eventProb;
  }
  return {
    probability: clampProbability(total),
    rowMatch: orderRow?.probability ?? null,
    lineItemSet: orderRow?.lineItemSet ?? null,
    lineItemRowMatch: orderRow?.lineItemRowMatch ?? null,
  };
}

function orderCountDistribution(conditions) {
  const spn = preparedSpn("customerOrderCount");
  const scope = state.demo.queryModel.scopeMaps.customerOrderCount.count;
  const given = customerEvidenceFor("customerOrderCount", conditions);
  const denom = logProb(spn, given);
  return state.demo.queryModel.domains.orderCount.map((count) => ({
    count,
    probability: probabilityRatio(logProb(spn, { ...given, [scope]: { kind: "exact", value: count } }), denom),
  }));
}

function countDistributionForH(groupName, h, scopeMapName, conditions) {
  const fallbackName = groupName === "customerOrderCountByH" ? "customerOrderCount" : "customerProfileCount";
  const spn = spnByPath(groupName, h) ?? preparedSpn(fallbackName);
  const scope = state.demo.queryModel.scopeMaps[scopeMapName].count;
  if (!spn || !scope) return [];
  const given = customerEvidenceFor(scopeMapName, conditions);
  const denom = logProb(spn, given);
  return state.demo.queryModel.domains[scopeMapName === "customerOrderCount" ? "orderCount" : "profileCount"].map((count) => ({
    count,
    probability: probabilityRatio(logProb(spn, { ...given, [scope]: { kind: "exact", value: count } }), denom),
  }));
}

function orderRowMatchDiagnostics(conditions) {
  const spn = preparedSpn("customerOrderContext");
  const parentEvidence = customerEvidenceFor("customerOrderContext", conditions);
  const rowEvidence = {
    ...parentEvidence,
    ...orderLocalEvidenceFor("customerOrderContext", conditions),
  };
  const orderLocal = probabilityRatio(logProb(spn, rowEvidence), logProb(spn, parentEvidence));
  const lineSet = hasLineItemPredicate(conditions) ? lineItemSetDiagnostics(conditions) : null;
  return {
    probability: clampProbability(orderLocal * (lineSet?.probability ?? 1)),
    orderLocal,
    lineItemSet: lineSet?.probability ?? null,
    lineItemRowMatch: lineSet?.rowMatch ?? null,
  };
}

function orderRowMatchDiagnosticsForH(conditions, h) {
  const orderLocal = hzRowMatchProbability({
    contextGroup: "customerOrderContextByHZ",
    zGroup: "customerOrderZByH",
    zScopeMap: "customerOrderZ",
    contextScopeMap: "customerOrderContext",
    h,
    conditions,
    localEvidence: orderLocalEvidenceFor,
  });
  const lineSet = hasLineItemPredicate(conditions) ? lineItemSetDiagnostics(conditions) : null;
  return {
    probability: clampProbability(orderLocal * (lineSet?.probability ?? 1)),
    orderLocal,
    lineItemSet: lineSet?.probability ?? null,
    lineItemRowMatch: lineSet?.rowMatch ?? null,
  };
}

function hzRowMatchProbability({ contextGroup, zGroup, zScopeMap, contextScopeMap, h, conditions, localEvidence }) {
  const zItems = zPosteriorForH(zGroup, zScopeMap, h, conditions);
  if (!zItems.length) return 1;
  let total = 0;
  for (const z of zItems) {
    const spn = spnByPath(contextGroup, h, z.index) ?? preparedSpn(contextScopeMap);
    if (!spn) continue;
    const parentEvidence = customerEvidenceFor(contextScopeMap, conditions);
    const rowEvidence = {
      ...parentEvidence,
      ...localEvidence(contextScopeMap, conditions),
    };
    total += z.probability * probabilityRatio(logProb(spn, rowEvidence), logProb(spn, parentEvidence));
  }
  return clampProbability(total);
}

function zPosteriorForH(groupName, scopeMapName, h, conditions) {
  const spn = spnByPath(groupName, h);
  if (!spn) return [{ index: "1", probability: 1 }];
  const posterior = rootPosterior(spn, customerEvidenceFor(scopeMapName, conditions));
  if (!posterior.length) return [{ index: "1", probability: 1 }];
  return posterior.map((item, index) => ({
    index: String(index + 1),
    probability: clampProbability(item.probability),
  }));
}

function lineItemSetDiagnostics(conditions) {
  const distribution = lineItemCountDistribution(conditions);
  const rowMatch = lineItemRowMatchProbability(conditions);
  const matchMin = Number(conditions.lineItemMatchCountMin || 1);
  const probability = distribution.reduce(
    (sum, item) => sum + item.probability * binomialTail(Number(item.count), matchMin, rowMatch),
    0,
  );
  return {
    probability: clampProbability(probability),
    rowMatch,
  };
}

function lineItemCountDistribution(conditions) {
  const spn = preparedSpn("orderLineItemCount");
  const scope = state.demo.queryModel.scopeMaps.orderLineItemCount.count;
  const given = orderLocalEvidenceFor("orderLineItemCount", conditions);
  const denom = logProb(spn, given);
  return state.demo.queryModel.domains.lineItemCount.map((count) => ({
    count,
    probability: probabilityRatio(logProb(spn, { ...given, [scope]: { kind: "exact", value: count } }), denom),
  }));
}

function lineItemRowMatchProbability(conditions) {
  const spn = preparedSpn("orderLineItemContext");
  if (!spn) return hasLineItemPredicate(conditions) ? 0 : 1;
  const parentEvidence = orderLocalEvidenceFor("orderLineItemContext", conditions);
  const rowEvidence = {
    ...parentEvidence,
    ...lineItemLocalEvidenceFor("orderLineItemContext", conditions),
  };
  return probabilityRatio(logProb(spn, rowEvidence), logProb(spn, parentEvidence));
}

function childMarginal(spn, evidence, scope, value) {
  if (!spn || !scope) return 0;
  const denom = logProb(spn, evidence);
  return probabilityRatio(logProb(spn, { ...evidence, [scope]: { kind: "exact", value } }), denom);
}

function customerEvidenceFor(scopeMapName, conditions) {
  const map = state.demo.queryModel.scopeMaps[scopeMapName];
  const evidence = {};
  addExactEvidence(evidence, map.region, conditions.region);
  addExactEvidence(evidence, map.signup_channel, conditions.signup);
  addNumericRangeEvidence(evidence, map.income, conditions.incomeMin, conditions.incomeMax);
  addNumericRangeEvidence(evidence, map.age, conditions.ageMin, conditions.ageMax);
  return evidence;
}

function orderLocalEvidenceFor(scopeMapName, conditions, omit = []) {
  const map = state.demo.queryModel.scopeMaps[scopeMapName];
  const evidence = {};
  if (!omit.includes("status")) addExactEvidence(evidence, map.status, conditions.orderStatus);
  if (!omit.includes("channel")) addExactEvidence(evidence, map.channel, conditions.orderChannel);
  if (!omit.includes("amount")) addNumericRangeEvidence(evidence, map.amount, conditions.orderAmountMin, conditions.orderAmountMax);
  if (!omit.includes("discount")) addNumericRangeEvidence(evidence, map.discount, conditions.orderDiscountMin, conditions.orderDiscountMax);
  return evidence;
}

function profileLocalEvidenceFor(scopeMapName, conditions, omit = []) {
  const map = state.demo.queryModel.scopeMaps[scopeMapName];
  const evidence = {};
  if (!omit.includes("loyalty_tier")) addExactEvidence(evidence, map.loyalty_tier, conditions.profileLoyalty);
  if (!omit.includes("risk_score")) addNumericRangeEvidence(evidence, map.risk_score, conditions.profileRiskMin, conditions.profileRiskMax);
  if (!omit.includes("preferred_contact")) addExactEvidence(evidence, map.preferred_contact, conditions.profileContact);
  return evidence;
}

function lineItemLocalEvidenceFor(scopeMapName, conditions, omit = []) {
  const map = state.demo.queryModel.scopeMaps[scopeMapName];
  const evidence = {};
  if (!omit.includes("product_category")) addExactEvidence(evidence, map.product_category, conditions.lineItemCategory);
  if (!omit.includes("price")) addNumericRangeEvidence(evidence, map.price, conditions.lineItemPriceMin, conditions.lineItemPriceMax);
  if (!omit.includes("quantity")) addNumericRangeEvidence(evidence, map.quantity, conditions.lineItemQuantityMin, conditions.lineItemQuantityMax);
  return evidence;
}

function hasOrderLocalPredicate(conditions) {
  return Boolean(
    conditions.orderStatus ||
    conditions.orderChannel ||
    conditions.orderAmountMin ||
    conditions.orderAmountMax ||
    conditions.orderDiscountMin ||
    conditions.orderDiscountMax
  );
}

function hasProfilePredicate(conditions) {
  return Boolean(
    conditions.profileLoyalty ||
    conditions.profileRiskMin ||
    conditions.profileRiskMax ||
    conditions.profileContact
  );
}

function hasLineItemPredicate(conditions) {
  return Boolean(
    conditions.lineItemCategory ||
    conditions.lineItemPriceMin ||
    conditions.lineItemPriceMax ||
    conditions.lineItemQuantityMin ||
    conditions.lineItemQuantityMax
  );
}

function addExactEvidence(evidence, scope, value) {
  if (!scope || value === "" || value === undefined) return;
  evidence[scope] = { kind: "exact", value: Number(value) };
}

function addNumericRangeEvidence(evidence, scope, lowerValue, upperValue) {
  if (!scope) return;
  const lower = numberOrUndefined(lowerValue);
  const upper = numberOrUndefined(upperValue);
  if (lower === undefined && upper === undefined) return;
  evidence[scope] = { kind: "interval", lower, upper };
}

function numberOrUndefined(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function probabilityRatio(jointLog, baseLog) {
  if (!Number.isFinite(jointLog) || !Number.isFinite(baseLog)) return 0;
  return clampProbability(Math.exp(jointLog - baseLog));
}

function clampProbability(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function binomialTail(n, k, p) {
  const count = Math.max(0, Math.floor(Number(n)));
  const threshold = Math.max(0, Math.floor(Number(k)));
  const probability = clampProbability(p);
  if (threshold <= 0) return 1;
  if (threshold > count) return 0;
  let total = 0;
  for (let x = threshold; x <= count; x += 1) {
    total += binomialMass(count, x, probability);
  }
  return clampProbability(total);
}

function binomialMass(n, k, p) {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return combination(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

function combination(n, k) {
  const r = Math.min(k, n - k);
  let value = 1;
  for (let i = 1; i <= r; i += 1) {
    value = (value * (n - r + i)) / i;
  }
  return value;
}

function preparedSpn(name) {
  return state.demo.queryModel.preparedSpns[name];
}

function spnByPath(...path) {
  let node = state.demo.queryModel.preparedSpns;
  for (const key of path) {
    if (!node) return null;
    node = node[String(key)];
  }
  return node ?? null;
}

function renderTableBrowser(scenario) {
  const tables = scenario.tables || [];
  if (!tables.length) {
    $("#tableTabs").innerHTML = "";
    $("#tableViewer").innerHTML = `<p class="empty-note">No table slices were exported for this scenario.</p>`;
    return;
  }

  if (!tables.some((table) => table.name === state.tableName)) {
    state.tableName = tables[0].name;
  }

  $("#tableBrowserNote").textContent =
    `Showing rows reachable from ${scenario.customerId}. These are real table slices, not model samples.`;

  $("#tableTabs").innerHTML = tables
    .map((table) => `
      <button
        type="button"
        class="table-tab${table.name === state.tableName ? " is-active" : ""}"
        data-table-name="${escapeHtml(table.name)}"
        role="tab"
        aria-selected="${table.name === state.tableName ? "true" : "false"}"
      >
        <span>${escapeHtml(table.name)}</span>
        <strong>${escapeHtml(table.rowCount)}</strong>
      </button>
    `)
    .join("");

  for (const button of document.querySelectorAll(".table-tab")) {
    button.addEventListener("click", () => {
      state.tableName = button.dataset.tableName;
      renderTableBrowser(state.scenario);
    });
  }

  const activeTable = tables.find((table) => table.name === state.tableName) || tables[0];
  const columns = activeTable.columns || [];
  const rows = activeTable.rows || [];
  const body = rows.length
    ? rows.map((row) => `
        <tr>
          ${columns.map((column) => `<td>${escapeHtml(formatNumber(row[column.name], 3))}</td>`).join("")}
        </tr>
      `).join("")
    : `<tr><td colspan="${columns.length || 1}" class="table-empty">No attached rows for this selected root.</td></tr>`;

  $("#tableViewer").innerHTML = `
    <div class="table-summary">
      <div>
        <h3>${escapeHtml(activeTable.title)}</h3>
        <p>${escapeHtml(activeTable.description)}</p>
      </div>
      <dl>
        <div>
          <dt>Relation</dt>
          <dd>${escapeHtml(activeTable.relationship)}</dd>
        </div>
        <div>
          <dt>Rows Here</dt>
          <dd>${escapeHtml(activeTable.rowCount)}</dd>
        </div>
        <div>
          <dt>Rows Total</dt>
          <dd>${escapeHtml(activeTable.totalRows)}</dd>
        </div>
      </dl>
    </div>
    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            ${columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderEvidence(scenario) {
  $("#activeEvidence").innerHTML = scenario.evidence
    .map((item) => `
      <span class="chip">
        <span>${escapeHtml(item.field)}</span>
        ${escapeHtml(item.value)}
      </span>
    `)
    .join("");
}

function renderMetrics(scenario) {
  $("#metrics").innerHTML = scenario.metrics
    .map((metric) => `
      <article class="metric">
        <span class="metric-label">${escapeHtml(metric.label)}</span>
        <span class="metric-value">${escapeHtml(formatNumber(metric.value, 3))}</span>
        <span class="metric-detail">${escapeHtml(metric.detail)}</span>
      </article>
    `)
    .join("");
}

function renderFactorBars(scenario) {
  const rows = scenario.factorBreakdown;
  const maxCe = Math.max(...rows.map((row) => numeric(row.crossEntropy)).filter((value) => value > 0), 1);
  $("#factorBars").innerHTML = rows
    .map((row) => {
      const ce = numeric(row.crossEntropy);
      const width = ce > 0 ? Math.max(2, Math.min(100, (ce / maxCe) * 100)) : 0;
      const indent = Math.min(Number(row.depth || 0) * 12, 36);
      return `
        <div class="factor-row" style="--indent:${indent}px">
          <div class="factor-label" style="padding-left:${indent}px">
            <strong>${escapeHtml(row.term)}</strong>
            <span>${escapeHtml(row.scope)} · ${escapeHtml(row.detail)}</span>
          </div>
          <div class="bar-track" aria-hidden="true">
            <div class="bar-fill" style="width:${width}%"></div>
          </div>
          <div class="factor-value">${escapeHtml(formatNumber(ce, 3))}</div>
        </div>
      `;
    })
    .join("");
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function renderCharts(scenario) {
  $("#charts").innerHTML = scenario.charts
    .map((chart) => {
      const maxValue = Math.max(...chart.items.map((item) => numeric(item.value)), 1);
      return `
        <article class="chart-card">
          <h3 class="chart-title">${escapeHtml(chart.title)}</h3>
          <div class="chart-items">
            ${chart.items.map((item) => {
              const width = numeric(item.value) > 0 ? Math.max(2, (numeric(item.value) / maxValue) * 100) : 0;
              return `
                <div class="chart-item">
                  <span class="chart-label">${escapeHtml(item.label)}</span>
                  <div class="bar-track" aria-hidden="true">
                    <div class="bar-fill" style="width:${width}%"></div>
                  </div>
                  <span class="chart-value">${escapeHtml(formatPercent(item.value))}</span>
                </div>
              `;
            }).join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRecord(record) {
  $("#recordTree").innerHTML = renderRecordNode(record, 0);
}

function renderRecordNode(record, depth) {
  const fields = record.fields
    .map((field) => `
      <div class="field">
        <span class="field-name">${escapeHtml(field.label)}</span>
        <span class="field-value">${escapeHtml(formatNumber(field.value, 3))}</span>
      </div>
    `)
    .join("");

  const childHtml = Object.entries(record.children || {})
    .flatMap(([name, children]) => {
      if (!children.length) {
        return [`<p class="empty-note">${escapeHtml(name)}: no attached rows</p>`];
      }
      return children.map((child) => renderRecordNode(child, depth + 1));
    })
    .join("");

  return `
    <article class="record-node" data-depth="${depth}">
      <div class="record-head">
        <span class="record-part">${escapeHtml(record.part)}</span>
        <span class="record-id">${escapeHtml(record.id)}</span>
        ${record.latentSegment ? `<span class="tag">${escapeHtml(record.latentSegment)}</span>` : ""}
        ${record.truncated ? `<span class="tag">truncated</span>` : ""}
      </div>
      <div class="field-grid">${fields}</div>
      ${childHtml ? `<div class="record-tree">${childHtml}</div>` : ""}
    </article>
  `;
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <main class="shell">
      <section class="panel">
        <h1>Unable to load demo data</h1>
        <p>${escapeHtml(error.message)}</p>
      </section>
    </main>
  `;
});
