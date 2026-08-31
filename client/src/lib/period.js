const MONTH_IDX = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// Picks the "current" reporting period for MTD/YTD KPI tiles: the active
// filter's single year+month selection when set, otherwise the most recent
// year/month actually present in the rows. The fallback matters — without
// it, a tile goes silently blank whenever the M-1 default filter can't fire
// (e.g. no data yet for last calendar month), instead of showing the most
// recent real period.
export function resolvePeriod(rows, filters) {
  if (filters?.year?.size === 1 && filters?.month?.size === 1) {
    return { year: [...filters.year][0], month: [...filters.month][0] };
  }
  let latest = null;
  for (const r of rows) {
    if (!r.year || !r.month || !(r.month in MONTH_IDX)) continue;
    const key = r.year * 12 + MONTH_IDX[r.month];
    if (!latest || key > latest.key) latest = { key, year: r.year, month: r.month };
  }
  return latest ? { year: latest.year, month: latest.month } : null;
}

export function periodSum(rows, year, month, key = "netSales") {
  return rows.filter((r) => r.year === year && r.month === month).reduce((s, r) => s + (r[key] || 0), 0);
}

// MTD-style GOLY: the resolved period's total vs the same month last year.
export function calcGoly(rows, filters, key = "netSales") {
  const period = resolvePeriod(rows, filters);
  if (!period) return null;
  const cur = periodSum(rows, period.year, period.month, key);
  const ly = periodSum(rows, period.year - 1, period.month, key);
  return { period, cur, ly, pct: ly > 0 ? ((cur - ly) / ly) * 100 : null };
}

// Cumulative fiscal-YTD (from July 1) through the given period, inclusive.
function ytdSum(rows, period, key) {
  if (!period) return 0;
  const fyYear = period.year - (MONTH_IDX[period.month] >= 6 ? 0 : 1);
  const fyStart = new Date(fyYear, 6, 1);
  const periodEnd = new Date(period.year, MONTH_IDX[period.month] + 1, 0);
  return rows
    .filter((r) => {
      if (!r.year || !r.month || !(r.month in MONTH_IDX)) return false;
      const d = new Date(r.year, MONTH_IDX[r.month], 1);
      return d >= fyStart && d <= periodEnd;
    })
    .reduce((s, r) => s + (r[key] || 0), 0);
}

// YTD-style GOLY: cumulative YTD-to-period vs cumulative YTD-to-same-point last year.
export function calcYtdGoly(rows, filters, key = "netSales") {
  const period = resolvePeriod(rows, filters);
  if (!period) return null;
  const cur = ytdSum(rows, period, key);
  const ly = ytdSum(rows, { year: period.year - 1, month: period.month }, key);
  return { period, cur, ly, pct: ly > 0 ? ((cur - ly) / ly) * 100 : null };
}

export function formatPeriod(period) {
  return period ? `${period.month} ${period.year}` : "—";
}
