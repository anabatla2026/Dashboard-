import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

const PRI = `${SNOWFLAKE_DATABASE}.GOLD.ZFI_SCO_VW`;
const DIST_FILTER = `${SNOWFLAKE_DATABASE}.GOLD.VW_DISTRIBUTOR_FILTER_1ST_DASH`;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Fiscal month order (Jul-Jun) for sorting the Month dropdown; MONTH_SHORT
// stays calendar-order since it's indexed by Date.getMonth() elsewhere.
const FISCAL_MONTH_ORDER = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const FISCAL_MONTH_NO = { Jul: 1, Aug: 2, Sep: 3, Oct: 4, Nov: 5, Dec: 6, Jan: 7, Feb: 8, Mar: 9, Apr: 10, May: 11, Jun: 12 };

// Row validity filter applied everywhere below. CANCELED rows are counted
// as real sales here (intentional — do not add a CANCELED exclusion).
const VALIDITY = "Posting_Date IS NOT NULL";

// Fiscal year (1 Jul - 30 Jun) is labeled by the calendar year it ends in,
// e.g. Sep 2026 is FY2027.
const FISCAL_YEAR_EXPR =
  "(CASE WHEN TO_CHAR(Posting_Date, 'Mon') IN ('Jul','Aug','Sep','Oct','Nov','Dec') THEN YEAR(Posting_Date) + 1 ELSE YEAR(Posting_Date) END)";
const MONTH_EXPR = "TO_CHAR(Posting_Date, 'Mon')";
// 1-12 fiscal month number (Jul=1 .. Jun=12), used for FYTD cutoff comparisons.
const FISCAL_MONTH_NO_EXPR =
  "(CASE WHEN MONTH(Posting_Date) >= 7 THEN MONTH(Posting_Date) - 6 ELSE MONTH(Posting_Date) + 6 END)";

// Dashboard filter key -> fact-table column(s) to match (OR'd when more
// than one). Town is intentionally absent (Secondary only). `dist` is
// resolved to SAP codes via resolveDistToSapCodes before this map is used.
const COLUMN_EXPR = {
  year: [FISCAL_YEAR_EXPR],
  month: [MONTH_EXPR],
  region: ["REGION"],
  cat: ["MATERIAL_GROUP"],
  brand: ["BRAND"],
  dist: ["PARTY_CODE", "SHIP_TO_PARTY"],
};

function buildWhere(filters = {}, { skip = [] } = {}) {
  const clauses = [];
  const binds = [];
  for (const [key, cols] of Object.entries(COLUMN_EXPR)) {
    if (skip.includes(key)) continue;
    const values = filters[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    const bindsForKey = key === "year" ? values.map(Number) : values;
    const perCol = cols.map((c) => `${c} IN (${bindsForKey.map(() => "?").join(", ")})`);
    clauses.push(cols.length > 1 ? `(${perCol.join(" OR ")})` : perCol[0]);
    for (const _c of cols) binds.push(...bindsForKey);
  }
  return { clause: clauses.length ? "AND " + clauses.join(" AND ") : "", binds };
}

// Distributor filter transmits DISTRIBUTOR_CODE; Primary's fact rows carry
// SAP-style PARTY_CODE/SHIP_TO_PARTY instead, so resolve to
// DISTRIBUTOR_SAP_CODE first (excluding rows still prefixed 'D', which have
// no real SAP mapping). No match still must exclude everything, hence the
// unmatchable sentinel below.
async function resolveDistToSapCodes(distCodes) {
  if (!distCodes || distCodes.length === 0) return [];
  const rows = await query(
    `SELECT DISTINCT DISTRIBUTOR_SAP_CODE AS V FROM ${DIST_FILTER}
     WHERE DISTRIBUTOR_CODE IN (${distCodes.map(() => "?").join(", ")})
       AND DISTRIBUTOR_SAP_CODE IS NOT NULL AND DISTRIBUTOR_SAP_CODE NOT LIKE 'D%'`,
    distCodes
  );
  return rows.map((r) => r.V);
}

async function withResolvedDist(filters = {}) {
  if (!Array.isArray(filters.dist) || filters.dist.length === 0) return filters;
  const sapCodes = await resolveDistToSapCodes(filters.dist);
  return { ...filters, dist: sapCodes.length ? sapCodes : ["__NO_PRIMARY_MATCH__"] };
}

async function currentFiscal() {
  const rows = await query(`SELECT TO_VARCHAR(MAX(Posting_Date), 'YYYY-MM-DD') AS MAXD FROM ${PRI} WHERE ${VALIDITY}`);
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

function inList(values) {
  return values.map(() => "?").join(", ");
}

// Trend/category/brand queries default to the current MTD period when no
// Year/Month filter is active; an explicit selection still overrides it.
async function withDefaultPeriod(filters = {}) {
  const period = await resolvePeriod(filters.year, filters.month);
  if (!period) return filters;
  return { ...filters, year: period.years, month: period.mtdMonths };
}

// KPI cards: Sales Value, Volume Ctn/Pcs, MTD/FYTD + GOLY.
export async function getPrimaryKpis({ years, months, filters = {} } = {}) {
  const period = await resolvePeriod(years, months);
  if (!period) return null;
  const { years: y, mtdMonths, fytdMonths } = period;
  const lyYears = y.map((n) => n - 1);
  const cutoffNo = Math.max(...fytdMonths.map((m) => FISCAL_MONTH_NO[m]));

  const resolvedFilters = await withResolvedDist(filters);
  const { clause, binds: filterBinds } = buildWhere(resolvedFilters, { skip: ["year", "month"] });

  const sql = `
    SELECT
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${MONTH_EXPR} IN (${inList(mtdMonths)}) THEN Total_Value END) AS MTD_SALES,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${MONTH_EXPR} IN (${inList(mtdMonths)}) THEN Qty_In_Ctn END)  AS MTD_CTN,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${MONTH_EXPR} IN (${inList(mtdMonths)}) THEN Qty_In_Pcs END)  AS MTD_PCS,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(lyYears)}) AND ${MONTH_EXPR} IN (${inList(mtdMonths)}) THEN Total_Value END) AS LY_MTD_SALES,

      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN Total_Value END) AS FYTD_SALES,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN Qty_In_Ctn END)  AS FYTD_CTN,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN Qty_In_Pcs END)  AS FYTD_PCS,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(lyYears)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN Total_Value END) AS LY_FYTD_SALES
    FROM ${PRI}
    WHERE ${VALIDITY} ${clause}
  `;
  const binds = [
    ...y, ...mtdMonths,
    ...y, ...mtdMonths,
    ...y, ...mtdMonths,
    ...lyYears, ...mtdMonths,
    ...y, cutoffNo,
    ...y, cutoffNo,
    ...y, cutoffNo,
    ...lyYears, cutoffNo,
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
      volumePcs: r.MTD_PCS || 0,
      goly: goly(r.MTD_SALES || 0, r.LY_MTD_SALES || 0),
    },
    ytd: {
      salesValue: r.FYTD_SALES || 0,
      volumeCtn: r.FYTD_CTN || 0,
      volumePcs: r.FYTD_PCS || 0,
      goly: goly(r.FYTD_SALES || 0, r.LY_FYTD_SALES || 0),
    },
  };
}

// Net sales trend, bucketed by day/week/month.
const TREND_DATE_EXPR = {
  day: "Posting_Date",
  week: "DATE_TRUNC('week', Posting_Date)",
  month: "DATE_TRUNC('month', Posting_Date)",
};
export async function getPrimaryTrend(filters = {}, granularity = "day") {
  const resolvedFilters = await withResolvedDist(await withDefaultPeriod(filters));
  const { clause, binds } = buildWhere(resolvedFilters);
  const dateExpr = TREND_DATE_EXPR[granularity] || TREND_DATE_EXPR.day;
  const rows = await query(
    `SELECT TO_VARCHAR(${dateExpr}, 'YYYY-MM-DD') AS DATE, SUM(Total_Value) AS NET_SALES
     FROM ${PRI}
     WHERE ${VALIDITY} ${clause}
     GROUP BY ${dateExpr}
     ORDER BY ${dateExpr}`,
    binds
  );
  return rows.map((r) => ({ date: r.DATE, netSales: r.NET_SALES || 0 }));
}

// Net sales by Category / Brand / SKU, one column at a time.
const CAT_LEVEL_COL = { cat: "Material_Group_Name", brand: "Brand", sku: "Product_Name" };
export async function getPrimaryByCategory({ filters = {}, level = "cat" } = {}) {
  return groupByOne(CAT_LEVEL_COL[level], filters);
}

const BRAND_LEVEL_COL = { brand: "Brand", sku: "Product_Name" };
export async function getPrimaryByBrand({ filters = {}, level = "brand" } = {}) {
  return groupByOne(BRAND_LEVEL_COL[level], filters);
}

async function groupByOne(col, filters) {
  const resolvedFilters = await withResolvedDist(await withDefaultPeriod(filters));
  const { clause, binds } = buildWhere(resolvedFilters);
  const rows = await query(
    `SELECT ${col} AS LABEL, SUM(Total_Value) AS NET_SALES
     FROM ${PRI}
     WHERE ${VALIDITY} ${clause}
     GROUP BY ${col}
     ORDER BY NET_SALES DESC`,
    binds
  );
  return rows.map((r) => ({ label: r.LABEL, value: r.NET_SALES || 0 }));
}

// Month-over-Month Sales by fiscal year. Region is not filterable here.
export async function getPrimaryMonthOverMonth({ fiscalYearStart, filters = {} } = {}) {
  const resolvedFilters = await withResolvedDist(filters);
  const { clause, binds } = buildWhere(resolvedFilters, { skip: ["year", "month", "region"] });
  const fyEndExclusive = `${Number(fiscalYearStart.slice(0, 4)) + 1}-${fiscalYearStart.slice(5)}`;

  const rows = await query(
    `SELECT TO_CHAR(Posting_Date, 'Mon') AS MONTH, YEAR(Posting_Date) AS YEAR, SUM(Total_Value) AS NET_SALES
     FROM ${PRI}
     WHERE ${VALIDITY} AND Posting_Date >= ? AND Posting_Date < ? ${clause}
     GROUP BY TO_CHAR(Posting_Date, 'Mon'), YEAR(Posting_Date)
     ORDER BY CASE TO_CHAR(Posting_Date, 'Mon')
       WHEN 'Jul' THEN 1 WHEN 'Aug' THEN 2 WHEN 'Sep' THEN 3 WHEN 'Oct' THEN 4
       WHEN 'Nov' THEN 5 WHEN 'Dec' THEN 6 WHEN 'Jan' THEN 7 WHEN 'Feb' THEN 8
       WHEN 'Mar' THEN 9 WHEN 'Apr' THEN 10 WHEN 'May' THEN 11 WHEN 'Jun' THEN 12
     END`,
    [fiscalYearStart, fyEndExclusive, ...binds]
  );
  return rows.map((r) => ({ month: r.MONTH, year: r.YEAR, netSales: r.NET_SALES || 0 }));
}

// Distinct Year/Month option lists (Region/Category/Brand/Distributor come
// from filterOptions.js instead).
export async function getPrimaryDims() {
  const dims = { year: [FISCAL_YEAR_EXPR], month: [MONTH_EXPR] };
  const result = {};
  for (const [key, [expr]] of Object.entries(dims)) {
    const rows = await query(
      `SELECT DISTINCT ${expr} AS V FROM ${PRI} WHERE ${VALIDITY} AND ${expr} IS NOT NULL ORDER BY ${expr}`
    );
    result[key] = rows.map((r) => r.V);
  }
  result.month.sort((a, b) => FISCAL_MONTH_ORDER.indexOf(a) - FISCAL_MONTH_ORDER.indexOf(b));
  return result;
}

export async function getPrimaryMeta() {
  const rows = await query(
    `SELECT TO_VARCHAR(MIN(Posting_Date), 'YYYY-MM-DD') AS MIND,
            TO_VARCHAR(MAX(Posting_Date), 'YYYY-MM-DD') AS MAXD,
            COUNT(*) AS N
     FROM ${PRI} WHERE ${VALIDITY}`
  );
  const r = rows[0];
  return { recordCount: r.N, dateRange: { min: r.MIND, max: r.MAXD } };
}
