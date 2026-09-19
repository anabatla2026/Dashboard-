import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

const SEC = `${SNOWFLAKE_DATABASE}.GOLD.SALESFLO_DATADUMP_VW`;
const TARGETS = `${SNOWFLAKE_DATABASE}.GOLD.TARGETS_VW`;
const DIST_MASTER = `${SNOWFLAKE_DATABASE}.GOLD.DISTRIBUTOR_MASTER_VW`;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Fiscal month order (Jul-Jun) for sorting the Month dropdown; MONTH_SHORT
// stays calendar-order since it's indexed by Date.getMonth() elsewhere.
const FISCAL_MONTH_ORDER = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const FISCAL_MONTH_NO = { Jul: 1, Aug: 2, Sep: 3, Oct: 4, Nov: 5, Dec: 6, Jan: 7, Feb: 8, Mar: 9, Apr: 10, May: 11, Jun: 12 };

// Fiscal year (1 Jul - 30 Jun) is labeled by the calendar year it ends in,
// e.g. Sep 2026 is FY2027.
const FISCAL_YEAR_EXPR = "(CASE WHEN MONTH IN ('Jul','Aug','Sep','Oct','Nov','Dec') THEN YEAR + 1 ELSE YEAR END)";
// 1-12 fiscal month number (Jul=1 .. Jun=12), used for FYTD cutoff comparisons.
const FISCAL_MONTH_NO_EXPR = `(CASE MONTH
  WHEN 'Jul' THEN 1 WHEN 'Aug' THEN 2 WHEN 'Sep' THEN 3 WHEN 'Oct' THEN 4
  WHEN 'Nov' THEN 5 WHEN 'Dec' THEN 6 WHEN 'Jan' THEN 7 WHEN 'Feb' THEN 8
  WHEN 'Mar' THEN 9 WHEN 'Apr' THEN 10 WHEN 'May' THEN 11 WHEN 'Jun' THEN 12 END)`;

// Standing filter applied on every Secondary query, independent of the
// user's own App User Tag selection.
const STANDING_FILTER = "APP_USER_TAGGED_TITLE <> 'SD'";

// Dashboard filter key -> fact-table column(s) to match (OR'd when more than
// one). segment/appUser are pre-existing filters. `dist` is resolved via
// withResolvedDist before this map is used.
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

// Distributor dropdown value is a DISTRIBUTOR_CODE that may be Primary-only
// (no "D" prefix, not a valid SalesFlo id) — those aren't valid Secondary
// filter values, so drop them; an empty result must still exclude
// everything rather than silently ignore the filter.
function withResolvedDist(filters = {}) {
  if (!Array.isArray(filters.dist) || filters.dist.length === 0) return filters;
  const dCodes = filters.dist.filter((c) => typeof c === "string" && c.trim().toUpperCase().startsWith("D"));
  return { ...filters, dist: dCodes.length ? dCodes : ["__NO_SECONDARY_MATCH__"] };
}

// Builds "AND col IN (?, ?) AND ..." plus the matching bind array from a
// filters object. `skip` excludes dimensions the caller handles separately.
// Apply withResolvedDist() to `filters` first if it may carry `dist`.
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
  const rows = await query(
    `SELECT TO_VARCHAR(MAX(DATE), 'YYYY-MM-DD') AS MAXD FROM ${SEC} WHERE DATE IS NOT NULL AND ${STANDING_FILTER}`
  );
  const maxd = rows[0]?.MAXD;
  if (!maxd) return null;
  const d = new Date(`${maxd}T00:00:00`);
  const monthIdx0 = d.getMonth();
  return {
    fiscalYear: monthIdx0 >= 6 ? d.getFullYear() + 1 : d.getFullYear(),
    month: MONTH_SHORT[monthIdx0],
  };
}

// Resolves selected Year/Month filters (each multi-select) into the fiscal
// years and months to sum over. MTD sums rows matching any selected year AND
// any selected month; FYTD cumulates from July through the latest selected
// month. No selection falls back to the latest (year, month) in the data.
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

// Trend/category/brand/channel-type queries default to the current MTD
// period when no Year/Month filter is active; an explicit selection still
// overrides it.
async function withDefaultPeriod(filters = {}) {
  const period = await resolvePeriod(filters.year, filters.month);
  if (!period) return filters;
  return { ...filters, year: period.years, month: period.mtdMonths };
}

// KPI cards: Sales Value, Volume Ctn/Pcs, Productive Stores/Distributors, GOLY.
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
    WHERE DATE IS NOT NULL AND ${STANDING_FILTER}
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

// Net sales trend, bucketed by day/week/month. DATE_TRUNC needs an explicit
// TO_DATE() cast since this view's DATE column isn't consistently typed.
const TREND_DATE_EXPR = {
  day: "DATE",
  week: "DATE_TRUNC('week', TO_DATE(DATE))",
  month: "DATE_TRUNC('month', TO_DATE(DATE))",
};
export async function getSecondaryTrend(filters = {}, granularity = "day") {
  const { clause, binds } = buildWhere(withResolvedDist(await withDefaultPeriod(filters)));
  const dateExpr = TREND_DATE_EXPR[granularity] || TREND_DATE_EXPR.day;
  const rows = await query(
    `SELECT TO_VARCHAR(${dateExpr}, 'YYYY-MM-DD') AS DATE, SUM(NET_SALES) AS NET_SALES
     FROM ${SEC}
     WHERE DATE IS NOT NULL AND ${STANDING_FILTER} ${clause}
     GROUP BY ${dateExpr}
     ORDER BY ${dateExpr}`,
    binds
  );
  return rows.map((r) => ({ date: r.DATE, netSales: r.NET_SALES || 0 }));
}

// Generic "group by one column, scoped by the active filters" query shared
// by every drillable chart.
async function groupByOne(col, filters, extra = {}) {
  const { clause, binds } = buildWhere(withResolvedDist(await withDefaultPeriod(filters)));
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
     WHERE DATE IS NOT NULL AND ${STANDING_FILTER} ${clause} ${extraClause}
     GROUP BY ${col}
     ORDER BY NET_SALES DESC`,
    [...binds, ...extraBinds]
  );
  return rows.map((r) => ({ label: r.LABEL, value: r.NET_SALES || 0 }));
}

// Sales Value by Channel Type, with drill chType -> channel -> subChannel.
const CHANNEL_LEVEL_COL = { chType: "CHANNEL_TYPE", channel: "CHANNEL", subChannel: "SUB_CHANNEL" };
export async function getByChannelType({ filters = {}, level = "chType", channel } = {}) {
  return groupByOne(CHANNEL_LEVEL_COL[level], filters, channel ? { CHANNEL: channel } : {});
}

// Net sales by Category, with drill cat -> brand -> sku.
const CAT_LEVEL_COL = { cat: "CATEGORY", brand: "BRAND", sku: "SKU_NAME" };
export async function getByCategorySecondary({ filters = {}, level = "cat" } = {}) {
  return groupByOne(CAT_LEVEL_COL[level], filters);
}

// Top brands by net sales, with drill brand -> sku.
const BRAND_LEVEL_COL = { brand: "BRAND", sku: "SKU_NAME" };
export async function getByBrandSecondary({ filters = {}, level = "brand" } = {}) {
  return groupByOne(BRAND_LEVEL_COL[level], filters);
}

// Region-wise Achievement, with drill region -> town -> distributor.
const REGION_LEVEL_COL = { region: "REGION", town: "TOWN_NAME", dist: "DISTRIBUTOR_NAME" };
export async function getRegionAchievement({ filters = {}, level = "region" } = {}) {
  return groupByOne(REGION_LEVEL_COL[level], filters);
}

// Region-wise Target vs Achievement, MTD + FYTD. Filters are deliberately
// Year/Month only (no region/category/brand/etc).
//
// TARGETS_VW.TARGET_YEAR/TARGET_MONTH store the plain calendar year/month,
// not the fiscal-year-end label used elsewhere — each selected fiscal
// (year, month) is converted to its calendar equivalent before matching
// (toCalendarPairs).
const TARGET_CALENDAR_MONTHS = new Set(["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
function toCalendarPairs(years, months) {
  const seen = new Set();
  const pairs = [];
  for (const y of years) {
    for (const m of months) {
      const calYear = TARGET_CALENDAR_MONTHS.has(m) ? y - 1 : y;
      const calMonth = m.toUpperCase();
      const key = `${calYear}|${calMonth}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([calYear, calMonth]);
    }
  }
  return pairs;
}

async function targetsByRegion(calendarPairs) {
  if (calendarPairs.length === 0) return [];
  const clause = calendarPairs.map(() => "(TRY_TO_NUMBER(t.TARGET_YEAR) = ? AND UPPER(TRIM(t.TARGET_MONTH)) = ?)").join(" OR ");
  const binds = calendarPairs.flat();
  const rows = await query(
    `
    WITH targets_agg AS (
      SELECT TRIM(t.DIST_CODE) AS DISTRIBUTOR_CODE, SUM(TRY_TO_NUMBER(t.VALUE)) AS TOTAL_TARGET
      FROM ${TARGETS} t
      WHERE ${clause}
      GROUP BY TRIM(t.DIST_CODE)
    )
    SELECT d.NEW_REGION AS REGION, SUM(ta.TOTAL_TARGET) AS TARGET
    FROM targets_agg ta
    JOIN ${DIST_MASTER} d ON ta.DISTRIBUTOR_CODE = TRIM(d.DISTRIBUTOR_CODE)
    GROUP BY d.NEW_REGION
    `,
    binds
  );
  return rows;
}

export async function getRegionTargetVsAchievement({ years, months } = {}) {
  const period = await resolvePeriod(years, months);
  if (!period) return [];
  const { years: y, mtdMonths, fytdMonths } = period;
  const cutoffNo = Math.max(...fytdMonths.map((m) => FISCAL_MONTH_NO[m]));

  const [mtdTargets, fytdTargets, achievementRows] = await Promise.all([
    targetsByRegion(toCalendarPairs(y, mtdMonths)),
    targetsByRegion(toCalendarPairs(y, fytdMonths)),
    query(
      `SELECT REGION,
              SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND MONTH IN (${inList(mtdMonths)}) THEN NET_SALES END) AS ACHIEVEMENT_MTD,
              SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN NET_SALES END) AS ACHIEVEMENT_FYTD
       FROM ${SEC}
       WHERE ${STANDING_FILTER}
       GROUP BY REGION`,
      [...y, ...mtdMonths, ...y, cutoffNo]
    ),
  ]);

  const mtdMap = new Map(mtdTargets.map((r) => [r.REGION, r.TARGET || 0]));
  const fytdMap = new Map(fytdTargets.map((r) => [r.REGION, r.TARGET || 0]));
  const regions = new Set([...mtdMap.keys(), ...fytdMap.keys(), ...achievementRows.map((r) => r.REGION)]);

  const achMap = new Map(achievementRows.map((r) => [r.REGION, r]));
  return [...regions]
    .map((region) => {
      const a = achMap.get(region);
      return {
        region,
        mtd: { target: mtdMap.get(region) || 0, achievement: a?.ACHIEVEMENT_MTD || 0 },
        ytd: { target: fytdMap.get(region) || 0, achievement: a?.ACHIEVEMENT_FYTD || 0 },
      };
    })
    .sort((a, b) => b.mtd.achievement - a.mtd.achievement);
}

// Month-over-Month Sales by fiscal year. Region is not filterable here.
export async function getMonthOverMonth({ fiscalYearStart, filters = {} } = {}) {
  const { clause, binds } = buildWhere(withResolvedDist(filters), { skip: ["year", "month", "region"] });
  const fyEndExclusive = `${Number(fiscalYearStart.slice(0, 4)) + 1}-${fiscalYearStart.slice(5)}`;

  const rows = await query(
    `SELECT MONTH, YEAR, SUM(NET_SALES) AS NET_SALES
     FROM ${SEC}
     WHERE DATE >= ? AND DATE < ? AND ${STANDING_FILTER} ${clause}
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

// Distinct Year/Month/Segment/App-User-Tag option lists (Region/Category/
// Brand/ChannelType/Town/Distributor come from filterOptions.js instead).
export async function getSecondaryDims() {
  const dims = { year: FISCAL_YEAR_EXPR, month: "MONTH", segment: "CHANNEL_GROUP", appUser: "APP_USER_TAGGED_TITLE" };
  const result = {};
  for (const [key, col] of Object.entries(dims)) {
    const rows = await query(`SELECT DISTINCT ${col} AS V FROM ${SEC} WHERE ${col} IS NOT NULL ORDER BY ${col}`);
    result[key] = rows.map((r) => r.V);
  }
  result.month.sort((a, b) => FISCAL_MONTH_ORDER.indexOf(a) - FISCAL_MONTH_ORDER.indexOf(b));
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
