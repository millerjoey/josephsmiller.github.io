const LOG_ZERO = -Infinity;
const SQRT2 = Math.sqrt(2);
const SQRT2PI = Math.sqrt(2 * Math.PI);

export function prepareModel(model) {
  const featureIndex = {};
  for (const feature of model.features) {
    featureIndex[feature.name] = feature;
  }
  return { ...model, featureIndex };
}

export function missingEvidence() {
  return { kind: "missing" };
}

export function logProb(model, evidence = {}) {
  return logNode(model.root, evidence, model);
}

export function logNode(node, evidence, model) {
  if (node.type === "sum") {
    const terms = node.children.map((child, index) => {
      const weight = node.weights[index] ?? 0;
      return weight > 0 ? Math.log(weight) + logNode(child, evidence, model) : LOG_ZERO;
    });
    return logSumExp(terms);
  }
  if (node.type === "product") {
    let total = 0;
    for (const child of node.children) {
      total += logNode(child, evidence, model);
      if (!Number.isFinite(total)) return LOG_ZERO;
    }
    return total;
  }
  const feature = model.featureIndex[node.feature];
  return leafLogProb(node.dist, feature, evidence[node.feature] ?? missingEvidence());
}

export function rootPosterior(model, evidence = {}) {
  const root = model.root;
  if (root.type !== "sum") return [];
  const terms = root.children.map((child, index) => {
    const weight = root.weights[index] ?? 0;
    return weight > 0 ? Math.log(weight) + logNode(child, evidence, model) : LOG_ZERO;
  });
  const z = logSumExp(terms);
  return terms.map((term, index) => ({
    name: root.children[index].name ?? `component ${index + 1}`,
    probability: Number.isFinite(z) ? Math.exp(term - z) : 0
  }));
}

export function conditionalMarginal(model, evidence, feature) {
  const base = logProb(model, evidence);
  if (!Number.isFinite(base)) return [];

  if (feature.kind === "categorical") {
    return feature.values.map((value) => {
      const merged = mergeEvidence(evidence[feature.name], { kind: "exact", value });
      return {
        label: displayCategory(value),
        probability: probabilityFromLog(logProb(model, { ...evidence, [feature.name]: merged }) - base)
      };
    });
  }

  const bins = makeBins(feature);
  return bins.map((bin) => {
    const merged = mergeEvidence(evidence[feature.name], {
      kind: "interval",
      lower: bin.lower,
      upper: bin.upper
    });
    return {
      label: bin.label,
      probability: probabilityFromLog(logProb(model, { ...evidence, [feature.name]: merged }) - base)
    };
  });
}

export function sampleRows(model, evidence, count, rng = Math.random) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(sampleNode(model.root, model, evidence, rng));
  }
  return rows;
}

export function mergeEvidence(left, right) {
  const a = left ?? missingEvidence();
  const b = right ?? missingEvidence();
  if (a.kind === "impossible" || b.kind === "impossible") return { kind: "impossible" };
  if (a.kind === "missing") return b;
  if (b.kind === "missing") return a;

  if (a.kind === "exact" && b.kind === "exact") {
    return Object.is(a.value, b.value) ? a : { kind: "impossible" };
  }
  if (a.kind === "set" && b.kind === "set") {
    const values = a.values.filter((value) => b.values.includes(value));
    return values.length > 0 ? { kind: "set", values } : { kind: "impossible" };
  }
  if (a.kind === "set" && b.kind === "exact") {
    return a.values.includes(b.value) ? b : { kind: "impossible" };
  }
  if (a.kind === "exact" && b.kind === "set") {
    return b.values.includes(a.value) ? a : { kind: "impossible" };
  }

  if (a.kind === "exact" && b.kind === "interval") {
    return intervalContains(b, Number(a.value)) ? a : { kind: "impossible" };
  }
  if (a.kind === "interval" && b.kind === "exact") {
    return intervalContains(a, Number(b.value)) ? b : { kind: "impossible" };
  }
  if (a.kind === "interval" && b.kind === "interval") {
    const lower = maxBound(a.lower, b.lower);
    const upper = minBound(a.upper, b.upper);
    if (lower !== undefined && upper !== undefined && lower > upper) return { kind: "impossible" };
    return { kind: "interval", lower, upper };
  }

  return { kind: "impossible" };
}

export function formatEvidence(feature, evidence) {
  const item = evidence ?? missingEvidence();
  if (item.kind === "missing") return "unknown";
  if (item.kind === "impossible") return "impossible";
  if (item.kind === "exact") return formatValue(feature, item.value);
  if (item.kind === "set") return item.values.length > 0 ? item.values.map(displayCategory).join(" or ") : "none selected";
  const lower = item.lower === undefined ? "-inf" : formatValue(feature, item.lower);
  const upper = item.upper === undefined ? "+inf" : formatValue(feature, item.upper);
  if (item.lower === undefined) return `<= ${upper}`;
  if (item.upper === undefined) return `>= ${lower}`;
  return `${lower} to ${upper}`;
}

export function formatValue(feature, value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return displayCategory(value);
  if (feature.kind === "count") return String(Math.round(value));
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  if (feature.unit === "$k") return `$${rounded}k`;
  if (feature.unit) return `${rounded} ${feature.unit}`;
  return rounded;
}

export function displayCategory(value) {
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function hashString(input) {
  let hash = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function leafLogProb(dist, feature, evidence) {
  if (evidence.kind === "impossible") return LOG_ZERO;
  if (evidence.kind === "missing") return 0;

  if (dist.kind === "categorical") {
    if (evidence.kind === "exact") return logPositive(dist.probs[evidence.value] ?? 0);
    if (evidence.kind === "set") {
      return logPositive(evidence.values.reduce((sum, value) => sum + (dist.probs[value] ?? 0), 0));
    }
    return LOG_ZERO;
  }

  if (evidence.kind === "exact") {
    const x = Number(evidence.value);
    if (dist.kind === "poisson") {
      return Number.isInteger(x) && x >= 0 ? poissonLogPmf(dist.lambda, x) : LOG_ZERO;
    }
    if (dist.kind === "negativeBinomial") {
      return Number.isInteger(x) && x >= 0 ? negativeBinomialLogPmf(dist.r, dist.p, x) : LOG_ZERO;
    }
    return logPositive(numericPdf(dist, x));
  }

  if (evidence.kind === "interval") {
    if (dist.kind === "poisson") return logPositive(poissonIntervalMass(dist.lambda, evidence));
    if (dist.kind === "negativeBinomial") return logPositive(negativeBinomialIntervalMass(dist.r, dist.p, evidence));
    return logPositive(numericIntervalMass(dist, evidence));
  }

  return LOG_ZERO;
}

function sampleNode(node, model, evidence, rng) {
  if (node.type === "sum") {
    const terms = node.children.map((child, index) => {
      const weight = node.weights[index] ?? 0;
      return weight > 0 ? Math.log(weight) + logNode(child, evidence, model) : LOG_ZERO;
    });
    const selected = chooseLogWeighted(terms, rng);
    return sampleNode(node.children[selected], model, evidence, rng);
  }
  if (node.type === "product") {
    return Object.assign({}, ...node.children.map((child) => sampleNode(child, model, evidence, rng)));
  }
  const feature = model.featureIndex[node.feature];
  return {
    [node.feature]: sampleLeaf(node.dist, feature, evidence[node.feature] ?? missingEvidence(), rng)
  };
}

function sampleLeaf(dist, feature, evidence, rng) {
  if (evidence.kind === "exact") return evidence.value;
  if (dist.kind === "categorical") {
    const allowed = evidence.kind === "set" ? evidence.values : feature.values;
    const weights = allowed.map((value) => dist.probs[value] ?? 0);
    return allowed[chooseWeighted(weights, rng)] ?? allowed[0];
  }
  if (dist.kind === "poisson") {
    if (evidence.kind === "interval") return samplePoissonInterval(dist.lambda, feature, evidence, rng);
    return samplePoisson(dist.lambda, rng);
  }
  if (dist.kind === "negativeBinomial") {
    if (evidence.kind === "interval") return sampleNegativeBinomialInterval(dist.r, dist.p, feature, evidence, rng);
    return sampleNegativeBinomial(dist.r, dist.p, rng);
  }
  if (evidence.kind === "interval") return sampleNumericInterval(dist, feature, evidence, rng);
  return sampleNumeric(dist, rng);
}

function sampleNumeric(dist, rng) {
  if (dist.kind === "normal") return sampleNormal(dist.mean, dist.sd, rng);
  if (dist.kind === "lognormal") return Math.exp(sampleNormal(dist.mu, dist.sigma, rng));
  if (dist.kind === "gamma") return sampleGamma(dist.shape, dist.scale, rng);
  if (dist.kind === "zeroInflatedLognormal") {
    return rng() < dist.zeroProb ? 0 : Math.exp(sampleNormal(dist.mu, dist.sigma, rng));
  }
  return NaN;
}

function sampleNumericInterval(dist, feature, evidence, rng) {
  if (dist.kind === "zeroInflatedLognormal") {
    const zeroMass = intervalContains(evidence, 0) ? dist.zeroProb : 0;
    const positiveMass = (1 - dist.zeroProb) * lognormalIntervalMass(dist, evidence);
    const total = zeroMass + positiveMass;
    if (total <= 0) return clampToInterval(feature.domain[0], evidence);
    if (rng() < zeroMass / total) return 0;
  }

  for (let i = 0; i < 6000; i += 1) {
    const value = dist.kind === "zeroInflatedLognormal"
      ? Math.exp(sampleNormal(dist.mu, dist.sigma, rng))
      : sampleNumeric(dist, rng);
    if (intervalContains(evidence, value)) return value;
  }

  const fallback = dist.kind === "normal"
    ? dist.mean
    : dist.kind === "gamma"
      ? dist.shape * dist.scale
      : Math.exp(dist.mu ?? 0);
  return clampToInterval(fallback, evidence);
}

function samplePoissonInterval(lambda, feature, evidence, rng) {
  const lower = Math.max(0, evidence.lower === undefined ? feature.domain[0] : Math.ceil(evidence.lower));
  const upper = Math.min(
    evidence.upper === undefined ? Math.max(feature.domain[1], Math.ceil(lambda + 10 * Math.sqrt(lambda + 1))) : Math.floor(evidence.upper),
    200
  );
  const values = [];
  const weights = [];
  for (let x = lower; x <= upper; x += 1) {
    values.push(x);
    weights.push(Math.exp(poissonLogPmf(lambda, x)));
  }
  return values[chooseWeighted(weights, rng)] ?? lower;
}

function numericPdf(dist, x) {
  if (dist.kind === "normal") {
    const z = (x - dist.mean) / dist.sd;
    return Math.exp(-0.5 * z * z) / (dist.sd * SQRT2PI);
  }
  if (dist.kind === "lognormal") {
    if (x <= 0) return 0;
    const z = (Math.log(x) - dist.mu) / dist.sigma;
    return Math.exp(-0.5 * z * z) / (x * dist.sigma * SQRT2PI);
  }
  if (dist.kind === "gamma") {
    if (x <= 0) return 0;
    return Math.exp((dist.shape - 1) * Math.log(x) - x / dist.scale - logGamma(dist.shape) - dist.shape * Math.log(dist.scale));
  }
  if (dist.kind === "zeroInflatedLognormal") {
    if (x === 0) return dist.zeroProb;
    return (1 - dist.zeroProb) * numericPdf({ kind: "lognormal", mu: dist.mu, sigma: dist.sigma }, x);
  }
  return 0;
}

function numericIntervalMass(dist, interval) {
  if (dist.kind === "zeroInflatedLognormal") {
    const zeroMass = intervalContains(interval, 0) ? dist.zeroProb : 0;
    return zeroMass + (1 - dist.zeroProb) * lognormalIntervalMass(dist, interval);
  }
  const lo = interval.lower === undefined ? -Infinity : interval.lower;
  const hi = interval.upper === undefined ? Infinity : interval.upper;
  if (lo > hi) return 0;
  return Math.max(0, numericCdf(dist, hi) - numericCdf(dist, lo));
}

function lognormalIntervalMass(dist, interval) {
  const lo = interval.lower === undefined ? 0 : Math.max(0, interval.lower);
  const hi = interval.upper === undefined ? Infinity : interval.upper;
  if (hi <= 0 || lo > hi) return 0;
  return Math.max(0, lognormalCdf(dist, hi) - lognormalCdf(dist, lo));
}

function numericCdf(dist, x) {
  if (dist.kind === "normal") return normalCdf((x - dist.mean) / dist.sd);
  if (dist.kind === "lognormal") return lognormalCdf(dist, x);
  if (dist.kind === "gamma") return gammaCdf(dist.shape, dist.scale, x);
  if (dist.kind === "zeroInflatedLognormal") {
    if (x < 0) return 0;
    return dist.zeroProb + (1 - dist.zeroProb) * lognormalCdf(dist, x);
  }
  return 0;
}

function lognormalCdf(dist, x) {
  if (x <= 0) return 0;
  return normalCdf((Math.log(x) - dist.mu) / dist.sigma);
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / SQRT2));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function poissonIntervalMass(lambda, interval) {
  const lower = interval.lower === undefined ? 0 : Math.ceil(interval.lower);
  const upper = interval.upper === undefined ? Infinity : Math.floor(interval.upper);
  if (upper < lower || upper < 0) return 0;
  const lo = Math.max(0, lower);
  if (!Number.isFinite(upper)) return Math.max(0, 1 - poissonCdf(lambda, lo - 1));
  return Math.max(0, poissonCdf(lambda, upper) - poissonCdf(lambda, lo - 1));
}

function poissonCdf(lambda, k) {
  if (k < 0) return 0;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i += 1) {
    term *= lambda / i;
    sum += term;
    if (term < 1e-14) break;
  }
  return Math.min(1, sum);
}

function poissonLogPmf(lambda, k) {
  let logFactorial = 0;
  for (let i = 2; i <= k; i += 1) logFactorial += Math.log(i);
  return k * Math.log(lambda) - lambda - logFactorial;
}

function negativeBinomialIntervalMass(r, p, interval) {
  const lower = interval.lower === undefined ? 0 : Math.ceil(interval.lower);
  const upper = interval.upper === undefined ? Infinity : Math.floor(interval.upper);
  if (upper < lower || upper < 0) return 0;
  const lo = Math.max(0, lower);
  if (!Number.isFinite(upper)) return Math.max(0, 1 - negativeBinomialCdf(r, p, lo - 1));
  return Math.max(0, negativeBinomialCdf(r, p, upper) - negativeBinomialCdf(r, p, lo - 1));
}

function negativeBinomialCdf(r, p, k) {
  if (k < 0) return 0;
  if (k > 10000) return negativeBinomialCdfApprox(r, p, k);
  const logs = [];
  for (let i = 0; i <= k; i += 1) logs.push(negativeBinomialLogPmf(r, p, i));
  return Math.min(1, Math.exp(logSumExp(logs)));
}

function negativeBinomialCdfApprox(r, p, k) {
  const mean = r * (1 - p) / p;
  const variance = r * (1 - p) / (p * p);
  return normalCdf((k + 0.5 - mean) / Math.sqrt(variance));
}

function negativeBinomialLogPmf(r, p, k) {
  return logGamma(k + r) - logGamma(r) - logGamma(k + 1) + r * Math.log(p) + k * Math.log1p(-p);
}

function sampleNegativeBinomialInterval(r, p, feature, evidence, rng) {
  const lower = Math.max(0, evidence.lower === undefined ? feature.domain[0] : Math.ceil(evidence.lower));
  const upper = Math.min(
    evidence.upper === undefined ? Math.max(feature.domain[1], Math.ceil(r * (1 - p) / p + 10 * Math.sqrt(r * (1 - p) / (p * p)))) : Math.floor(evidence.upper),
    10000
  );
  const values = [];
  const logWeights = [];
  for (let x = lower; x <= upper; x += 1) {
    values.push(x);
    logWeights.push(negativeBinomialLogPmf(r, p, x));
  }
  const selected = chooseLogWeighted(logWeights, rng);
  return values[selected] ?? lower;
}

function samplePoisson(lambda, rng) {
  const limit = Math.exp(-lambda);
  let k = 0;
  let product = 1;
  do {
    k += 1;
    product *= rng();
  } while (product > limit);
  return k - 1;
}

function sampleNegativeBinomial(r, p, rng) {
  const lambda = sampleGamma(r, (1 - p) / p, rng);
  return samplePoisson(lambda, rng);
}

function sampleGamma(shape, scale, rng) {
  if (shape <= 0 || scale <= 0) return NaN;
  if (shape < 1) {
    const u = Math.max(rng(), Number.EPSILON);
    return sampleGamma(shape + 1, scale, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 10000; i += 1) {
    const x = sampleNormal(0, 1, rng);
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return scale * d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return scale * d * v;
  }
  return scale * shape;
}

function sampleNormal(mean, sd, rng) {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function gammaCdf(shape, scale, x) {
  if (x <= 0) return 0;
  const z = x / scale;
  if (z < shape + 1) return gammaPSeries(shape, z);
  return Math.max(0, Math.min(1, 1 - gammaQContinuedFraction(shape, z)));
}

function gammaPSeries(a, x) {
  let sum = 1 / a;
  let del = sum;
  let ap = a;
  for (let n = 1; n <= 200; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
  }
  return Math.max(0, Math.min(1, sum * Math.exp(-x + a * Math.log(x) - logGamma(a))));
}

function gammaQContinuedFraction(a, x) {
  const fpmin = 1e-300;
  let b = x + 1 - a;
  let c = 1 / fpmin;
  let d = 1 / Math.max(b, fpmin);
  let h = d;
  for (let i = 1; i <= 200; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = b + an / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - logGamma(a)) * h));
}

function logGamma(z) {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = 0.9999999999998099;
  const y = z - 1;
  for (let i = 0; i < coefficients.length; i += 1) {
    x += coefficients[i] / (y + i + 1);
  }
  const t = y + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(x);
}

function chooseLogWeighted(logWeights, rng) {
  const z = logSumExp(logWeights);
  if (!Number.isFinite(z)) return 0;
  return chooseWeighted(logWeights.map((value) => Math.exp(value - z)), rng);
}

function chooseWeighted(weights, rng) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return 0;
  let draw = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    draw -= weights[i];
    if (draw <= 0) return i;
  }
  return weights.length - 1;
}

function logSumExp(values) {
  const max = Math.max(...values);
  if (!Number.isFinite(max)) return LOG_ZERO;
  let total = 0;
  for (const value of values) total += Math.exp(value - max);
  return max + Math.log(total);
}

function logPositive(value) {
  return value > 0 ? Math.log(value) : LOG_ZERO;
}

function probabilityFromLog(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.exp(value)));
}

function intervalContains(interval, x) {
  if (!Number.isFinite(x)) return false;
  if (interval.lower !== undefined && x < interval.lower) return false;
  if (interval.upper !== undefined && x > interval.upper) return false;
  return true;
}

function clampToInterval(value, interval) {
  let out = value;
  if (interval.lower !== undefined) out = Math.max(out, interval.lower);
  if (interval.upper !== undefined) out = Math.min(out, interval.upper);
  return out;
}

function maxBound(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function minBound(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function makeBins(feature) {
  const [min, max] = feature.domain;
  const requested = feature.bins ?? 10;
  if (feature.kind === "count") {
    const width = Math.max(1, Math.ceil((max - min + 1) / requested));
    const bins = [];
    for (let lo = Math.round(min); lo <= max; lo += width) {
      const hi = Math.min(max, lo + width - 1);
      bins.push({
        lower: lo,
        upper: hi,
        label: lo === hi ? String(lo) : `${lo}-${hi}`
      });
    }
    return bins;
  }
  const width = (max - min) / requested;
  return Array.from({ length: requested }, (_, index) => {
    const lo = min + index * width;
    const hi = index === requested - 1 ? max : lo + width;
    return {
      lower: lo,
      upper: hi,
      label: `${formatValue(feature, lo)}-${formatValue(feature, hi)}`
    };
  });
}
