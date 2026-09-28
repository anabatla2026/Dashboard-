// Ranks every distinct value of `key` by net sales (desc) and returns the
// running cumulative share of the total — the data a Pareto / concentration
// curve needs. Unlike aggregateTop this deliberately keeps every entity
// (no "Other" bucket) since the whole point is watching how the curve climbs.
export function cumulativeShare(rows, key) {
  const map = new Map();
  for (const r of rows) {
    map.set(r[key], (map.get(r[key]) || 0) + r.netSales);
  }
  const total = rows.reduce((s, r) => s + r.netSales, 0);
  const sorted = Array.from(map, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  let running = 0;
  return sorted.map((r, i) => {
    running += r.value;
    return { rank: i + 1, label: r.label, value: r.value, cumPct: total > 0 ? (running / total) * 100 : 0 };
  });
}

// Shared top-N split. Keeps the top `topN` entries plus any label in
// `pinned` (items the user pulled out of "Other"), and folds the rest into a
// single "Other" row. The Other row carries its members in `items` so the
// widget can list what's inside and let the user add any of them back.
function withOther(sorted, topN, pinned, total, makeOther) {
  if (sorted.length <= topN) return sorted;
  const pin = pinned || new Set();
  const head = [];
  const rest = [];
  sorted.forEach((r, i) => (i < topN || pin.has(r.label) ? head : rest).push(r));
  if (rest.length && rest.reduce((s, r) => s + total(r), 0) > 0) {
    head.push({ label: "Other", ...makeOther(rest), isOther: true, items: rest });
  }
  return head;
}

const sumDual = (rest) =>
  rest.reduce((acc, r) => ({ secondary: acc.secondary + r.secondary, primary: acc.primary + r.primary }), { secondary: 0, primary: 0 });
const dualTotal = (r) => r.secondary + r.primary;
const sumValue = (rest) => ({ value: rest.reduce((s, r) => s + r.value, 0) });
const valueTotal = (r) => r.value;

function mergeDual(secMap, priMap, topN, pinned) {
  const labels = new Set([...secMap.keys(), ...priMap.keys()]);
  const arr = Array.from(labels, (label) => ({
    label,
    secondary: secMap.get(label) || 0,
    primary: priMap.get(label) || 0,
  }));
  arr.sort((a, b) => dualTotal(b) - dualTotal(a));
  return withOther(arr, topN, pinned, dualTotal, sumDual);
}

// Same idea as aggregateTop but merges two row sets (e.g. secondary +
// primary) sharing a dimension key into one label list, so a chart can show
// both series side by side for direct comparison.
export function aggregateDualTop(secRows, priRows, key, topN, pinned) {
  const secMap = new Map();
  for (const r of secRows) {
    if (r[key] == null || r[key] === "") continue;
    secMap.set(r[key], (secMap.get(r[key]) || 0) + (r.netSales || 0));
  }
  const priMap = new Map();
  for (const r of priRows) {
    if (r[key] == null || r[key] === "") continue;
    priMap.set(r[key], (priMap.get(r[key]) || 0) + (r.netSales || 0));
  }
  return mergeDual(secMap, priMap, topN, pinned);
}

// Applies the same top-N + "Other" bucketing as aggregateTop, but to an
// already-grouped {label, value} list (e.g. from a server-side GROUP BY)
// instead of raw transaction rows.
export function topNWithOther(arr, topN, pinned) {
  return withOther(arr, topN, pinned, valueTotal, sumValue);
}

// Same shape as aggregateDualTop, but both sides arrive already grouped by
// the server (see useServerAggregate) — both Primary and Secondary are
// Snowflake-backed now, so neither needs summing raw rows client-side here.
export function mergeDualTop(secondaryAgg, primaryAgg, topN, pinned) {
  const secMap = new Map(secondaryAgg.map((r) => [r.label, r.value]));
  const priMap = new Map(primaryAgg.map((r) => [r.label, r.value]));
  return mergeDual(secMap, priMap, topN, pinned);
}

export function aggregateTop(rows, key, topN, pinned) {
  const map = new Map();
  for (const r of rows) {
    map.set(r[key], (map.get(r[key]) || 0) + r.netSales);
  }
  const arr = Array.from(map, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  return withOther(arr, topN, pinned, valueTotal, sumValue);
}
