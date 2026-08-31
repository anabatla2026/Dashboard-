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

// Same idea as aggregateTop but merges two row sets (e.g. secondary +
// primary) sharing a dimension key into one label list, so a chart can show
// both series side by side for direct comparison.
export function aggregateDualTop(secRows, priRows, key, topN) {
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

  const labels = new Set([...secMap.keys(), ...priMap.keys()]);
  let arr = Array.from(labels, (label) => ({
    label,
    secondary: secMap.get(label) || 0,
    primary: priMap.get(label) || 0,
  }));
  arr.sort((a, b) => b.secondary + b.primary - (a.secondary + a.primary));

  if (arr.length > topN) {
    const head = arr.slice(0, topN);
    const rest = arr.slice(topN).reduce(
      (acc, r) => ({ secondary: acc.secondary + r.secondary, primary: acc.primary + r.primary }),
      { secondary: 0, primary: 0 }
    );
    if (rest.secondary + rest.primary > 0) head.push({ label: "Other", ...rest, isOther: true });
    arr = head;
  }
  return arr;
}

export function aggregateTop(rows, key, topN) {
  const map = new Map();
  for (const r of rows) {
    map.set(r[key], (map.get(r[key]) || 0) + r.netSales);
  }
  let arr = Array.from(map, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (arr.length > topN) {
    const head = arr.slice(0, topN);
    const rest = arr.slice(topN).reduce((s, r) => s + r.value, 0);
    if (rest > 0) head.push({ label: "Other", value: rest, isOther: true });
    arr = head;
  }
  return arr;
}
