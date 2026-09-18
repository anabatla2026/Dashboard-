function trimZero(s) {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

export function compact(n, decimals = 1) {
  const sign = n < 0 ? "-" : "";
  n = Math.abs(n);
  if (n >= 1e9) return sign + trimZero((n / 1e9).toFixed(decimals)) + "B";
  if (n >= 1e6) return sign + trimZero((n / 1e6).toFixed(decimals)) + "M";
  if (n >= 1e3) return sign + trimZero((n / 1e3).toFixed(decimals)) + "K";
  return sign + Math.round(n).toLocaleString("en-US");
}

export function money(n) {
  return "Rs " + compact(n, 3);
}

export function moneyFull(n) {
  return "Rs " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function num(n) {
  return n.toLocaleString("en-US");
}

export function pct(n) {
  return n.toFixed(1) + "%";
}

export function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  let n;
  if (norm <= 1) n = 1;
  else if (norm <= 2) n = 2;
  else if (norm <= 2.5) n = 2.5;
  else if (norm <= 5) n = 5;
  else n = 10;
  return n * mag;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `granularity` matches a trend query's bucket size ("day" | "week" |
// "month" — see shared/primaryQueries.js / shared/secondaryQueries.js's
// getPrimaryTrend/getSecondaryTrend). A "day" or "week" point is still one
// specific date (week buckets are labeled by their start date, e.g. "Sep
// 1" meaning the week beginning then) so the day-of-month stays in the
// label; a "month" point has no day component worth showing.
export function formatDateLabel(iso, granularity = "day") {
  if (typeof iso !== "string") return String(iso);
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  const mi = parseInt(m, 10) - 1;
  const month = MONTH_SHORT[mi] || m;
  return granularity === "month" ? `${month} ${y}` : `${month} ${parseInt(d, 10)}`;
}

export function truncate(s, len) {
  if (typeof s !== "string") return s;
  return s.length > len ? s.slice(0, len - 1) + "…" : s;
}
