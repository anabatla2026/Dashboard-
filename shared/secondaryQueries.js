import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

const SEC = `${SNOWFLAKE_DATABASE}.GOLD.SALESFLO_DATADUMP_VW`;
const TARGETS = `${SNOWFLAKE_DATABASE}.GOLD.TARGETS_VW`;
const DIST_MASTER = `${SNOWFLAKE_DATABASE}.GOLD.DISTRIBUTOR_MASTER_VW`;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FISCAL_MONTH_NO = { Jul: 1, Aug: 2, Sep: 3, Oct: 4, Nov: 5, Dec: 6, Jan: 7, Feb: 8, Mar: 9, Apr: 10, May: 11, Jun: 12 };

// The business labels a fiscal year (1 July - 30 June) by the calendar year
// it ENDS in — e.g. Sep 2026 falls in "FY2027" (Jul 2026 - Jun 2027), not
// "FY2026". Confirmed against the DE's own query (2026-09-17), which
// computes calendar_year as fiscal_year - 1 for Jul-Dec months.
const FISCAL_YEAR_EXPR = "(CASE WHEN MONTH IN ('Jul','Aug','Sep','Oct','Nov','Dec') THEN YEAR + 1 ELSE YEAR END)";
// 1-12 fiscal month number (Jul=1 .. Jun=12), used for FYTD cutoff
// comparisons — mirrors the DE's current_fy_month_no formula. MONTH here is
// already the 3-letter name column, so this maps through a CASE rather than
// doing calendar-month arithmetic like Primary's Posting_Date-based version.
const FISCAL_MONTH_NO_EXPR = `(CASE MONTH
  WHEN 'Jul' THEN 1 WHEN 'Aug' THEN 2 WHEN 'Sep' THEN 3 WHEN 'Oct' THEN 4
  WHEN 'Nov' THEN 5 WHEN 'Dec' THEN 6 WHEN 'Jan' THEN 7 WHEN 'Feb' THEN 8
  WHEN 'Mar' THEN 9 WHEN 'Apr' THEN 10 WHEN 'May' THEN 11 WHEN 'Jun' THEN 12 END)`;

// Dashboard filter key -> fact-table column(s) to match (OR'd when more than
// one). Per the DE's filter rules (2026-09-17):
//   region -> REGION (REGION_CODE from GOLD.VW_REGION_MAPPING_1ST_DASH is
//             the same raw value stored in this column)
//   cat    -> CATEGORY (CATEGORY_CODE from the category mapping view equals
//             this column's raw value for Secondary-flagged rows)
//   brand  -> BRAND (single shared column, no separate code)
//   chType -> CHANNEL_TYPE (Secondary only, no separate code)
//   town   -> TOWN_NAME (Secondary only, no separate code)
//   dist   -> DISTRIBUTOR_CODE (the "D"-prefixed SalesFlo code — the same
//             value GOLD.VW_DISTRIBUTOR_FILTER_1ST_DASH.DISTRIBUTOR_CODE
//             transmits as the dropdown's value, see shared/filterOptions.js;
//             DISTRIBUTOR_CODE_RD is a messier "reconciled SAP code" column
//             — inconsistent formats incl. scientific-notation artifacts —
//             not used here)
// segment (Customer Group) and appUser (App User Tag) are pre-existing
// filters the DE's new rules don't touch — left as-is.
const COLUMN_MAP = {
  year: [FISCAL_YEAR_EXPR],
  month: ["MONTH"],
  region: ["REGION"],
  segment: ["CHANNEL_GROUP"],
  cat: ["CATEGORY"],
  brand: ["BRAND"],
  chType: ["CHANNEL_TYPE"],
  town: ["TOWN_NAME"],
  dist: ["DISTRIBUTOR_CODE"],
  appUser: ["APP_USER_TAGGED_TITLE"],
};

// The Distributor dropdown's value is GOLD.VW_DISTRIBUTOR_FILTER_1ST_DASH's
// DISTRIBUTOR_CODE (see shared/filterOptions.js) — the "D"-prefixed SalesFlo
// identifier for a real SalesFlo-registered distributor. 97 of 607 rows in
// that view are Primary-only (no SalesFlo presence): DISTRIBUTOR_CODE falls
// back to a plain numeric value there instead. Per the DE's rule, those
// aren't valid Secondary filter values — pass them as null (here: an
// unmatchable sentinel, so the filter still excludes everything rather than
// silently being dropped) rather than let a coincidental numeric match
// through against the fact table's own 337 non-"D" DISTRIBUTOR_CODE rows.
function withResolvedDist(filters = {}) {
  if (!Array.isArray(filters.dist) || filters.dist.length === 0) return filters;
  const dCodes = filters.dist.filter((c) => typeof c === "string" && c.trim().toUpperCase().startsWith("D"));
  return { ...filters, dist: dCodes.length ? dCodes : ["__NO_SECONDARY_MATCH__"] };
}

// Builds "AND col IN (?, ?) AND ..." plus the matching bind array, from a
// filters object like { region: ["South"], cat: ["Baby Diapers", "Snacks"] }.
// `skip` excludes dimensions the caller handles separately. Always apply
// withResolvedDist() to `filters` first if it may carry a `dist` selection.
export function buildWhere(filters = {}, { skip = [] } = {}) {
  const clauses = [];
  const binds = [];
  for (const [key, cols] of Object.entries(COLUMN_MAP)) {
    if (skip.includes(key)) continue;
    const values = filters[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    const perCol = cols.map((c) => `${c} IN (${values.map(() => "?").join(", ")})`);
    clauses.push(cols.length > 1 ? `(${perCol.join(" OR ")})` : perCol[0]);
    for (const _c of cols) binds.push(...values);
  }
  return { clause: clauses.length ? "AND " + clauses.join(" AND ") : "", binds };
}

function inList(values) {
  return values.map(() => "?").join(", ");
}

async function currentFiscal() {
  const rows = await query(`SELECT TO_VARCHAR(MAX(DATE), 'YYYY-MM-DD') AS MAXD FROM ${SEC} WHERE DATE IS NOT NULL`);
  const maxd = rows[0]?.MAXD;
  if (!maxd) return null;
  const d = new Date(`${maxd}T00:00:00`);
  const monthIdx0 = d.getMonth();
  return {
    fiscalYear: monthIdx0 >= 6 ? d.getFullYear() + 1 : d.getFullYear(),
    month: MONTH_SHORT[monthIdx0],
  };
}

// Resolves the selected Year/Month filters (each independently multi-
// select) into the fiscal-year labels and month names to sum over — same
// cross-filter semantics as shared/primaryQueries.js's resolvePeriod (see
// that file's comment for the full rationale).
async function resolvePeriod(years, months) {
  const hasYears = Array.isArray(years) && years.length > 0;
  const hasMonths = Array.isArray(months) && months.length > 0;
  if (!hasYears && !hasMonths) {
    const cur = await currentFiscal();
    if (!cur) return null;
    return { years: [cur.fiscalYear], mtdMonths: [cur.month], fytdMonths: [cur.month] };
  }
  const cur = hasMonths ? null : await currentFiscal();
  const effYears = hasYears ? years.map(Number) : cur ? [cur.fiscalYear] : [];
  const mtdMonths = hasMonths ? months : cur ? [cur.month] : [];
  const fytdMonths = hasMonths ? months : hasYears ? ["Jun"] : cur ? [cur.month] : [];
  if (effYears.length === 0 || mtdMonths.length === 0) return null;
  return { years: effYears, mtdMonths, fytdMonths };
}

// ── KPI cards (Sales Value, Volume Ctn/Pcs, Productive Stores/Distributors,
// GOLY), now scoped by every global filter the same way the DE's own KPI
// query is (previously only Year/Month/App-User-Tag applied — see
// dashboard-query-reference.md §2.6 — the DE's supplied query applies the
// full filter set, so this now matches it). ────────────────────────────────
export async function getSecondaryKpis({ years, months, filters = {} } = {}) {
  const period = await resolvePeriod(years, months);
  if (!period) return null;
  const { years: y, mtdMonths, fytdMonths } = period;
  const lyYears = y.map((n) => n - 1);
  const cutoffNo = Math.max(...fytdMonths.map((m) => FISCAL_MONTH_NO[m]));

  const { clause, binds: filterBinds } = buildWhere(withResolvedDist(filters), { skip: ["year", "month"] });

  const sql = `
    SELECT
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND MONTH IN (${inList(mtdMonths)}) THEN NET_SALES END)  AS MTD_SALES,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND MONTH IN (${inList(mtdMonths)}) THEN SALES_CTN END)  AS MTD_CTN,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND MONTH IN (${inList(mtdMonths)}) THEN SALES_UNITS END) AS MTD_UNITS,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(lyYears)}) AND MONTH IN (${inList(mtdMonths)}) THEN NET_SALES END) AS LY_MTD_SALES,
      COUNT(DISTINCT CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND MONTH IN (${inList(mtdMonths)}) THEN TRIM(OUTLET_CODE) END)      AS MTD_STORES,
      COUNT(DISTINCT CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND MONTH IN (${inList(mtdMonths)}) THEN TRIM(DISTRIBUTOR_CODE) END) AS MTD_DIST,

      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN NET_SALES END)  AS FYTD_SALES,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN SALES_CTN END)  AS FYTD_CTN,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN SALES_UNITS END) AS FYTD_UNITS,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(lyYears)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN NET_SALES END) AS LY_FYTD_SALES,
      COUNT(DISTINCT CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN TRIM(OUTLET_CODE) END)      AS FYTD_STORES,
      COUNT(DISTINCT CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN TRIM(DISTRIBUTOR_CODE) END) AS FYTD_DIST,

      COUNT(DISTINCT TRIM(OUTLET_CODE)) AS TOTAL_STORES
    FROM ${SEC}
    WHERE DATE IS NOT NULL
    ${clause}
  `;
  const binds = [
    ...y, ...mtdMonths,
    ...y, ...mtdMonths,
    ...y, ...mtdMonths,
    ...lyYears, ...mtdMonths,
    ...y, ...mtdMonths,
    ...y, ...mtdMonths,

    ...y, cutoffNo,
    ...y, cutoffNo,
    ...y, cutoffNo,
    ...lyYears, cutoffNo,
    ...y, cutoffNo,
    ...y, cutoffNo,

    ...filterBinds,
  ];

  const rows = await query(sql, binds);
  const r = rows[0];
  const goly = (cur, ly) => (ly > 0 ? ((cur - ly) / ly) * 100 : null);

  return {
    period: { years: y, months: mtdMonths },
    mtd: {
      salesValue: r.MTD_SALES || 0,
      volumeCtn: r.MTD_CTN || 0,
      volumePcs: r.MTD_UNITS || 0,
      productiveStores: r.MTD_STORES || 0,
      productiveDistributors: r.MTD_DIST || 0,
      goly: goly(r.MTD_SALES || 0, r.LY_MTD_SALES || 0),
    },
    ytd: {
      salesValue: r.FYTD_SALES || 0,
      volumeCtn: r.FYTD_CTN || 0,
      volumePcs: r.FYTD_UNITS || 0,
      productiveStores: r.FYTD_STORES || 0,
      productiveDistributors: r.FYTD_DIST || 0,
      goly: goly(r.FYTD_SALES || 0, r.LY_FYTD_SALES || 0),
    },
    totalStoreCount: r.TOTAL_STORES || 0,
  };
}

// ── Daily net sales trend (§3.1) ────────────────────────────────────────────
export async function getSecondaryTrend(filters = {}) {
  const { clause, binds } = buildWhere(withResolvedDist(filters));
  const rows = await query(
    `SELECT TO_VARCHAR(DATE, 'YYYY-MM-DD') AS DATE, SUM(NET_SALES) AS NET_SALES
     FROM ${SEC}
     WHERE DATE IS NOT NULL ${clause}
     GROUP BY DATE
     ORDER BY DATE`,
    binds
  );
  return rows.map((r) => ({ date: r.DATE, netSales: r.NET_SALES || 0 }));
}

// ── Generic "group by one column, scoped by the active global filters"
// query shared by every drillable chart. ────────────────────────────────────
async function groupByOne(col, filters, extra = {}) {
  const { clause, binds } = buildWhere(withResolvedDist(filters));
  const extraClauses = [];
  const extraBinds = [];
  for (const [c, v] of Object.entries(extra)) {
    extraClauses.push(`${c} = ?`);
    extraBinds.push(v);
  }
  const extraClause = extraClauses.length ? "AND " + extraClauses.join(" AND ") : "";

  const rows = await query(
    `SELECT ${col} AS LABEL, SUM(NET_SALES) AS NET_SALES
     FROM ${SEC}
     WHERE DATE IS NOT NULL ${clause} ${extraClause}
     GROUP BY ${col}
     ORDER BY NET_SALES DESC`,
    [...binds, ...extraBinds]
  );
  return rows.map((r) => ({ label: r.LABEL, value: r.NET_SALES || 0 }));
}

// ── Secondary Sales Value by Channel Type, with drill chType -> channel ->
// subChannel (§3.2). ────────────────────────────────────────────────────────
const CHANNEL_LEVEL_COL = { chType: "CHANNEL_TYPE", channel: "CHANNEL", subChannel: "SUB_CHANNEL" };
export async function getByChannelType({ filters = {}, level = "chType", channel } = {}) {
  return groupByOne(CHANNEL_LEVEL_COL[level], filters, channel ? { CHANNEL: channel } : {});
}

// ── Net sales by Category (Secondary side only), with drill cat -> brand ->
// sku (§3.3). ────────────────────────────────────────────────────────────────
const CAT_LEVEL_COL = { cat: "CATEGORY", brand: "BRAND", sku: "SKU_NAME" };
export async function getByCategorySecondary({ filters = {}, level = "cat" } = {}) {
  return groupByOne(CAT_LEVEL_COL[level], filters);
}

// ── Top brands by net sales (Secondary side), drill brand -> sku (§3.4). ──
const BRAND_LEVEL_COL = { brand: "BRAND", sku: "SKU_NAME" };
export async function getByBrandSecondary({ filters = {}, level = "brand" } = {}) {
  return groupByOne(BRAND_LEVEL_COL[level], filters);
}

// ── Region-wise Achievement, with drill region -> town -> distributor
// (§3.5). ────────────────────────────────────────────────────────────────────
const REGION_LEVEL_COL = { region: "REGION", town: "TOWN_NAME", dist: "DISTRIBUTOR_NAME" };
export async function getRegionAchievement({ filters = {}, level = "region" } = {}) {
  return groupByOne(REGION_LEVEL_COL[level], filters);
}

// Region-wise Target vs Achievement for one resolved (year, month) — TARGETS
// has no region of its own; it's reached by joining its DIST_CODE to
// DISTRIBUTOR_MASTER's NEW_REGION.
export async function getRegionTargetVsAchievement({ year, month } = {}) {
  const period = await resolvePeriod(year != null ? [year] : [], month ? [month] : []);
  if (!period) return [];
  const y = period.years[0];
  const m = period.mtdMonths[0];

  const rows = await query(
    `
    WITH targets_agg AS (
      SELECT TRIM(t.DIST_CODE) AS DISTRIBUTOR_CODE, SUM(t.VALUE) AS TOTAL_TARGET
      FROM ${TARGETS} t
      WHERE t.TARGET_YEAR = ? AND t.TARGET_MONTH = ?
      GROUP BY TRIM(t.DIST_CODE)
    ),
    targets_by_region AS (
      SELECT d.NEW_REGION AS REGION, SUM(ta.TOTAL_TARGET) AS TARGET
      FROM targets_agg ta
      JOIN ${DIST_MASTER} d ON ta.DISTRIBUTOR_CODE = TRIM(d.DISTRIBUTOR_CODE)
      GROUP BY d.NEW_REGION
    ),
    achievement_by_region AS (
      SELECT REGION, SUM(NET_SALES) AS ACHIEVEMENT
      FROM ${SEC}
      WHERE ${FISCAL_YEAR_EXPR} = ? AND MONTH = ?
      GROUP BY REGION
    )
    SELECT COALESCE(t.REGION, a.REGION) AS REGION,
           COALESCE(t.TARGET, 0) AS TARGET,
           COALESCE(a.ACHIEVEMENT, 0) AS ACHIEVEMENT
    FROM targets_by_region t
    FULL OUTER JOIN achievement_by_region a ON t.REGION = a.REGION
    ORDER BY ACHIEVEMENT DESC
    `,
    [String(y), m, y, m]
  );
  return rows.map((r) => ({ region: r.REGION, target: r.TARGET || 0, achievement: r.ACHIEVEMENT || 0 }));
}

// ── Month-over-Month Sales by fiscal year, local widget filters independent
// of the global bar (§3.6). Region is deliberately NOT applied here — the DE
// asked (2026-09-16) to disable Region on both Primary and Secondary's MoM
// for now, pending a proper region mapping; any `region` passed in is
// ignored. ──────────────────────────────────────────────────────────────────
export async function getMonthOverMonth({ fiscalYearStart, filters = {} } = {}) {
  const { clause, binds } = buildWhere(withResolvedDist(filters), { skip: ["year", "month", "region"] });
  const fyEndExclusive = `${Number(fiscalYearStart.slice(0, 4)) + 1}-${fiscalYearStart.slice(5)}`;

  const rows = await query(
    `SELECT MONTH, YEAR, SUM(NET_SALES) AS NET_SALES
     FROM ${SEC}
     WHERE DATE >= ? AND DATE < ? ${clause}
     GROUP BY MONTH, YEAR
     ORDER BY CASE MONTH
       WHEN 'Jul' THEN 1 WHEN 'Aug' THEN 2 WHEN 'Sep' THEN 3 WHEN 'Oct' THEN 4
       WHEN 'Nov' THEN 5 WHEN 'Dec' THEN 6 WHEN 'Jan' THEN 7 WHEN 'Feb' THEN 8
       WHEN 'Mar' THEN 9 WHEN 'Apr' THEN 10 WHEN 'May' THEN 11 WHEN 'Jun' THEN 12
     END`,
    [fiscalYearStart, fyEndExclusive, ...binds]
  );
  return rows.map((r) => ({ month: r.MONTH, year: r.YEAR, netSales: r.NET_SALES || 0 }));
}

// ── Distinct Year/Month/Segment/App-User-Tag option lists. Region/Category/
// Brand/ChannelType/Town/Distributor dropdown options now come from
// shared/filterOptions.js (the DE's mapping views) instead of this fact
// table's own distinct values. ──────────────────────────────────────────────
export async function getSecondaryDims() {
  const dims = { year: FISCAL_YEAR_EXPR, month: "MONTH", segment: "CHANNEL_GROUP", appUser: "APP_USER_TAGGED_TITLE" };
  const result = {};
  for (const [key, col] of Object.entries(dims)) {
    const rows = await query(`SELECT DISTINCT ${col} AS V FROM ${SEC} WHERE ${col} IS NOT NULL ORDER BY ${col}`);
    result[key] = rows.map((r) => r.V);
  }
  result.month.sort((a, b) => MONTH_SHORT.indexOf(a) - MONTH_SHORT.indexOf(b));
  return result;
}

export async function getSecondaryMeta() {
  const rows = await query(
    `SELECT TO_VARCHAR(MIN(DATE), 'YYYY-MM-DD') AS MIND, TO_VARCHAR(MAX(DATE), 'YYYY-MM-DD') AS MAXD, COUNT(*) AS N,
            COUNT(DISTINCT TRIM(OUTLET_CODE)) AS OUTLETS,
            COUNT(DISTINCT TRIM(DISTRIBUTOR_CODE)) AS DISTS
     FROM ${SEC} WHERE DATE IS NOT NULL`
  );
  const r = rows[0];
  return {
    recordCount: r.N,
    outletCount: r.OUTLETS,
    distributorCount: r.DISTS,
    dateRange: { min: r.MIND, max: r.MAXD },
  };
}
