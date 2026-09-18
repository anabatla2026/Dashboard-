import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

const PRI = `${SNOWFLAKE_DATABASE}.GOLD.ZFI_SCO_VW`;
const DIST_FILTER = `${SNOWFLAKE_DATABASE}.GOLD.VW_DISTRIBUTOR_FILTER_1ST_DASH`;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FISCAL_MONTH_NO = { Jul: 1, Aug: 2, Sep: 3, Oct: 4, Nov: 5, Dec: 6, Jan: 7, Feb: 8, Mar: 9, Apr: 10, May: 11, Jun: 12 };

// Row validity applied everywhere below. This used to also exclude
// CANCELED = 'True' rows (45,888 of 525,091, ~Rs 8B of ~Rs 93.6B total
// TOTAL_VALUE) on the theory that a canceled invoice line isn't a real
// sale — flagged at the time as "please confirm with the DE". Confirmed
// wrong 2026-09-18: running the DE's own reference query
// (`primary 1st Dash with all filters.sql`, KPI #1, all filters NULL)
// directly in Snowflake gives MTD/FYTD figures that only match this
// dashboard once the CANCELED exclusion is removed (e.g. FYTD_SALES_VALUE
// 5,494,853,587 with CANCELED rows included vs 5,038,534,294 without —
// the DE's query counts them). So: don't exclude CANCELED rows.
const VALIDITY = "Posting_Date IS NOT NULL";

// The business labels a fiscal year (1 July - 30 June) by the calendar year
// it ENDS in — e.g. Sep 2026 falls in "FY2027" (Jul 2026 - Jun 2027), not
// "FY2026". Confirmed against the DE's own query (2026-09-17), which
// computes calendar_year as fiscal_year - 1 for Jul-Dec months.
const FISCAL_YEAR_EXPR =
  "(CASE WHEN TO_CHAR(Posting_Date, 'Mon') IN ('Jul','Aug','Sep','Oct','Nov','Dec') THEN YEAR(Posting_Date) + 1 ELSE YEAR(Posting_Date) END)";
const MONTH_EXPR = "TO_CHAR(Posting_Date, 'Mon')";
// 1-12 fiscal month number (Jul=1 .. Jun=12), used for FYTD cutoff
// comparisons — mirrors the DE's current_fy_month_no formula.
const FISCAL_MONTH_NO_EXPR =
  "(CASE WHEN MONTH(Posting_Date) >= 7 THEN MONTH(Posting_Date) - 6 ELSE MONTH(Posting_Date) + 6 END)";

// Dashboard filter key -> fact-table column(s) to match (OR'd when more
// than one). Per the DE's filter rules (2026-09-17):
//   region -> REGION (REGION_CODE from GOLD.VW_REGION_MAPPING_1ST_DASH is
//             the same raw value stored in this column; primary's
//             REGION_NAME on this view is a coincidental SAP country-
//             subdivision match, e.g. SD -> "South Dakota" — a known data
//             quality issue in the DE's mapping view, wired up as-is)
//   cat    -> MATERIAL_GROUP (CATEGORY_CODE from the category mapping view
//             equals this column's raw value)
//   brand  -> BRAND (single shared column, no separate code)
//   dist   -> PARTY_CODE / SHIP_TO_PARTY (SAP distributor code; resolved
//             from the selected DISTRIBUTOR_CODE via resolveDistToSapCodes
//             below before this map is used — see the DE's rule: primary
//             uses DISTRIBUTOR_SAP_CODE where it's NOT LIKE 'D%')
// Town is intentionally absent — the DE's rule scopes it to Secondary only.
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

// The dashboard's Distributor filter shows DISTRIBUTOR_SAP_NAME and
// transmits DISTRIBUTOR_CODE (the stable identifier shared with Secondary —
// see shared/filterOptions.js). Primary needs the corresponding SAP code
// instead (its fact rows carry SAP-style PARTY_CODE/SHIP_TO_PARTY, not the
// SalesFlo "D"-prefixed code) — per the DE's rule: "DISTRIBUTOR_SAP_CODE
// where DISTRIBUTOR_SAP_CODE not like 'D%'" (rows whose SAP code still
// starts with 'D' have no real SAP mapping and are excluded). If none of
// the selected distributors resolve to a real SAP code, the filter must
// still exclude everything (not silently drop the filter) — hence the
// unmatchable sentinel below rather than an empty bind list.
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

// Resolves the selected Year/Month filters (each independently multi-
// select) into the fiscal-year labels and month names to sum over. Per the
// DE's KPI queries (2026-09-17, confirmed with the client 2026-09-18):
// selecting multiple years and/or months is a plain cross-filter — MTD sums
// every row whose fiscal year is ANY selected year AND whose month is ANY
// selected month; FYTD cumulates from 1 July through the LATEST selected
// month, for each selected fiscal year. No selection on either falls back
// to the latest (fiscalYear, month) actually present in the data — same
// "MTD defaults to latest period" behavior as before, extended to arrays.
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

// ── KPI cards: Sales Value, Volume Ctn/Pcs, MTD/FYTD + GOLY, now scoped by
// every global filter (Region/Category/Brand/Distributor) the same way the
// DE's own KPI query is — previously KPI cards deliberately ignored
// everything but Year/Month ("stable top-line pulse"); the DE's supplied
// query applies the full filter set, so this now matches it. ─────────────
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

// ── Daily net sales trend ───────────────────────────────────────────────────
export async function getPrimaryTrend(filters = {}) {
  const resolvedFilters = await withResolvedDist(filters);
  const { clause, binds } = buildWhere(resolvedFilters);
  const rows = await query(
    `SELECT TO_VARCHAR(Posting_Date, 'YYYY-MM-DD') AS DATE, SUM(Total_Value) AS NET_SALES
     FROM ${PRI}
     WHERE ${VALIDITY} ${clause}
     GROUP BY Posting_Date
     ORDER BY Posting_Date`,
    binds
  );
  return rows.map((r) => ({ date: r.DATE, netSales: r.NET_SALES || 0 }));
}

// ── Net sales by Category / Brand / SKU, one column at a time — merged
// client-side with secondary's equivalent for the dual (Primary vs
// Secondary) charts. cat/brand act as both a GROUP BY level and (once
// selected) a global filter, same pattern as secondary's groupByOne. ──────
const CAT_LEVEL_COL = { cat: "Material_Group_Name", brand: "Brand", sku: "Product_Name" };
export async function getPrimaryByCategory({ filters = {}, level = "cat" } = {}) {
  return groupByOne(CAT_LEVEL_COL[level], filters);
}

const BRAND_LEVEL_COL = { brand: "Brand", sku: "Product_Name" };
export async function getPrimaryByBrand({ filters = {}, level = "brand" } = {}) {
  return groupByOne(BRAND_LEVEL_COL[level], filters);
}

async function groupByOne(col, filters) {
  const resolvedFilters = await withResolvedDist(filters);
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

// ── Month-over-Month Sales by fiscal year. No Region param — the DE asked
// to disable Region on both Primary and Secondary's MoM for now (data
// issue on their side; a real mapping is coming later). ───────────────────
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

// ── Distinct Year/Month option lists. Region/Category/Brand/Distributor
// dropdown options now come from shared/filterOptions.js (the DE's mapping
// views) instead of this fact table's own distinct values. ────────────────
export async function getPrimaryDims() {
  const dims = { year: [FISCAL_YEAR_EXPR], month: [MONTH_EXPR] };
  const result = {};
  for (const [key, [expr]] of Object.entries(dims)) {
    const rows = await query(
      `SELECT DISTINCT ${expr} AS V FROM ${PRI} WHERE ${VALIDITY} AND ${expr} IS NOT NULL ORDER BY ${expr}`
    );
    result[key] = rows.map((r) => r.V);
  }
  result.month.sort((a, b) => MONTH_SHORT.indexOf(a) - MONTH_SHORT.indexOf(b));
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
