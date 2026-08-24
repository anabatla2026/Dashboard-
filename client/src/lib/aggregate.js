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
