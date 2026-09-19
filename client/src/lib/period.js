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

function inMonth(r, year, month) {
  return r.year === year && r.month === month;
}

// Fiscal year runs 1 July – 30 June. Rows from FY start through the given
// period's month, inclusive.
function inFiscalToDate(r, period) {
  if (!period || !r.year || !r.month || !(r.month in MONTH_IDX)) return false;
  const fyYear = period.year - (MONTH_IDX[period.month] >= 6 ? 0 : 1);
  const fyStart = new Date(fyYear, 6, 1);
  const periodEnd = new Date(period.year, MONTH_IDX[period.month] + 1, 0);
  const d = new Date(r.year, MONTH_IDX[r.month], 1);
  return d >= fyStart && d <= periodEnd;
}

function sumBy(rows, pred, key) {
  return rows.reduce((s, r) => (pred(r) ? s + (r[key] || 0) : s), 0);
}

function distinctBy(rows, pred, key) {
  const set = new Set();
  for (const r of rows) {
    if (pred(r) && r[key] != null && r[key] !== "") set.add(r[key]);
  }
  return set.size;
}

export function periodSum(rows, year, month, key = "netSales") {
  return sumBy(rows, (r) => inMonth(r, year, month), key);
}

export function periodDistinct(rows, year, month, key) {
  return distinctBy(rows, (r) => inMonth(r, year, month), key);
}

export function ytdDistinct(rows, period, key) {
  return distinctBy(rows, (r) => inFiscalToDate(r, period), key);
}

// MTD-style GOLY: the resolved period's total vs the same month last year.
export function calcGoly(rows, filters, key = "netSales") {
  const period = resolvePeriod(rows, filters);
  if (!period) return null;
  const cur = periodSum(rows, period.year, period.month, key);
  const ly = periodSum(rows, period.year - 1, period.month, key);
  return { period, cur, ly, pct: ly > 0 ? ((cur - ly) / ly) * 100 : null };
}

// YTD-style GOLY: cumulative YTD-to-period vs cumulative YTD-to-same-point last year.
export function calcYtdGoly(rows, filters, key = "netSales") {
  const period = resolvePeriod(rows, filters);
  if (!period) return null;
  const cur = sumBy(rows, (r) => inFiscalToDate(r, period), key);
  const ly = sumBy(rows, (r) => inFiscalToDate(r, { year: period.year - 1, month: period.month }), key);
  return { period, cur, ly, pct: ly > 0 ? ((cur - ly) / ly) * 100 : null };
}

// Accepts either the legacy single { year, month } shape or the multi-
// select { years, months } shape the server's KPI endpoints return —
// multiple selected months/years render as a comma list, e.g.
// "Sep, Nov 2025, 2026".
export function formatPeriod(period) {
  if (!period) return "—";
  if (period.years || period.months) {
    const months = (period.months || []).join(", ");
    const years = (period.years || []).join(", ");
    return [months, years].filter(Boolean).join(" ") || "—";
  }
  return `${period.month} ${period.year}`;
}

// The calendar year the fiscal year (1 July start) containing `period` began in.
export function fiscalYearOf(period) {
  if (!period) return null;
  return period.year - (MONTH_IDX[period.month] >= 6 ? 0 : 1);
}

export const FISCAL_MONTH_ORDER = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];

// The calendar year a given (month, fyYear) pair falls in — Jul–Dec belong
// to fyYear itself, Jan–Jun belong to fyYear + 1.
export function calendarYearInFiscalYear(month, fyYear) {
  const idx = FISCAL_MONTH_ORDER.indexOf(month);
  return idx < 6 ? fyYear : fyYear + 1;
}

// Inverse of calendarYearInFiscalYear: which fiscal year a given calendar
// (year, month) row belongs to.
export function rowFiscalYear(year, month) {
  const idx = FISCAL_MONTH_ORDER.indexOf(month);
  if (idx === -1 || year == null) return null;
  return idx < 6 ? year : year - 1;
}
