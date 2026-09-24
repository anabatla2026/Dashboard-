import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

// Migrated to GOLD.VW_FACT_PRIMARY_SALES: a curated primary fact with
// pre-computed FILTER_* canonical columns (FILTER_REGION, FILTER_CATEGORY,
// FILTER_BRAND, ...), pre-computed fiscal buckets (FY_YEAR, FY_MONTH_NO,
// FY_MONTH_NAME), MATERIAL_GROUP_NAME kept as category fallback, and a
// PRIMARY_EQ_SECONDARY boolean that already encodes MT-Direct membership.
const PRI = `${SNOWFLAKE_DATABASE}.GOLD.VW_FACT_PRIMARY_SALES`;
const DIST_FILTER = `${SNOWFLAKE_DATABASE}.GOLD.VW_FILTER_DISTRIBUTOR`;
const REGION_MAPPING = `${SNOWFLAKE_DATABASE}.GOLD.VW_FILTER_REGION`;
const CATEGORY_MAPPING = `${SNOWFLAKE_DATABASE}.GOLD.VW_FILTER_CATEGORY`;
const BRAND_MAPPING = `${SNOWFLAKE_DATABASE}.GOLD.VW_FILTER_BRAND`;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Fiscal month order (Jul-Jun) for sorting the Month dropdown; MONTH_SHORT
// stays calendar-order since it's indexed by Date.getMonth() elsewhere.
const FISCAL_MONTH_ORDER = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const FISCAL_MONTH_NO = { Jul: 1, Aug: 2, Sep: 3, Oct: 4, Nov: 5, Dec: 6, Jan: 7, Feb: 8, Mar: 9, Apr: 10, May: 11, Jun: 12 };

// Row validity filter applied everywhere below.
const VALIDITY = "POSTING_DATE IS NOT NULL";

// New fact carries fiscal year / month directly — no derivation needed.
const FISCAL_YEAR_EXPR = "FY_YEAR";
const MONTH_EXPR = "FY_MONTH_NAME";
const FISCAL_MONTH_NO_EXPR = "FY_MONTH_NO";

// Dashboard filter key -> fact-table column(s) to match (OR'd when more
// than one). `dist` is
// resolved to SAP codes via resolveDistToSapCodes before this map is used.
// Category has a COALESCE fallback so rows where FILTER_CATEGORY is NULL
// still resolve via MATERIAL_GROUP_NAME — matches the reference SQL and
// preserves the ~1.4% of rows that carry only the raw material group.
const COLUMN_EXPR = {
  year: [FISCAL_YEAR_EXPR],
  month: [MONTH_EXPR],
  region: ["UPPER(TRIM(COALESCE(FILTER_REGION,'')))"],
  cat: ["UPPER(TRIM(COALESCE(NULLIF(FILTER_CATEGORY,''), MATERIAL_GROUP_NAME, '')))"],
  brand: ["UPPER(TRIM(COALESCE(FILTER_BRAND,'')))"],
  chType: ["UPPER(TRIM(COALESCE(FILTER_CHANNEL_TYPE,'')))"],
  town: ["UPPER(TRIM(COALESCE(FILTER_TOWN,'')))"],
  dist: ["UPPER(TRIM(PARTY_CODE))", "UPPER(TRIM(DIST_NAME))"],
};

function buildWhere(filters = {}, { skip = [] } = {}) {
  const clauses = [];
  const binds = [];
  for (const [key, cols] of Object.entries(COLUMN_EXPR)) {
    if (skip.includes(key)) continue;
    const values = filters[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    const bindsForKey = key === "year"
      ? values.map(Number)
      : ["chType", "town"].includes(key)
        ? values.map((value) => String(value).trim().toUpperCase())
        : values;
    const perCol = cols.map((c) => `${c} IN (${bindsForKey.map(() => "?").join(", ")})`);
    clauses.push(cols.length > 1 ? `(${perCol.join(" OR ")})` : perCol[0]);
    for (const _c of cols) binds.push(...bindsForKey);
  }
  return { clause: clauses.length ? "AND " + clauses.join(" AND ") : "", binds };
}

// Distributor filter transmits SAP_CODE (per VW_FILTER_DISTRIBUTOR contract).
// The new primary fact stores SAP-style PARTY_CODE / DIST_NAME. We keep the
// resolver as a robustness layer that matches the user's value against any
// of the four distributor identifiers (SAP code/name + Salesflo code/name)
// and returns distinct SAP_CODE. The legacy `NOT LIKE 'D%'` guard is dropped
// because the new fact contains zero D-prefixed party codes.
async function resolveDistToSapCodes(distCodes) {
  if (!distCodes || distCodes.length === 0) return [];
  const selected = distCodes.map((value) => String(value).trim().toUpperCase());
  const bindListPlaceholders = selected.map(() => "?").join(", ");
  const rows = await query(
    `SELECT DISTINCT SAP_CODE AS V FROM ${DIST_FILTER}
     WHERE (UPPER(TRIM(SAP_CODE))       IN (${bindListPlaceholders})
         OR UPPER(TRIM(SAP_NAME))       IN (${bindListPlaceholders})
         OR UPPER(TRIM(SALESFLO_CODE))  IN (${bindListPlaceholders})
         OR UPPER(TRIM(SALESFLO_NAME))  IN (${bindListPlaceholders}))
       AND SAP_CODE IS NOT NULL`,
    [...selected, ...selected, ...selected, ...selected]
  );
  return rows.map((r) => r.V);
}

async function withResolvedDist(filters = {}) {
  if (!Array.isArray(filters.dist) || filters.dist.length === 0) return filters;
  const sapCodes = await resolveDistToSapCodes(filters.dist);
  // No SAP-mapped distributor for the user's selection — do NOT drop the
  // filter (that would let every row through). Pin to the primary sentinel
  // so this side legitimately contributes zero rows.
  return sapCodes.length ? { ...filters, dist: sapCodes } : { ...filters, dist: ["__NO_MATCH_ON_PRIMARY__"] };
}

// The new VW_FILTER_* views carry the canonical name only (no CODE column).
// Region has no aliases; category/brand have SALESFLO_ALIASES for the
// secondary side only — the primary fact stores the canonical value already,
// so we never expand aliases here.
async function resolveMappedValues(filters = {}, key, table, flag) {
  const values = filters[key];
  if (!Array.isArray(values) || values.length === 0) return filters;
  const canonicalCol = key === "region"
    ? "REGION_NAME"
    : key === "cat"
      ? "CATEGORY_NAME"
      : "BRAND_NAME";
  const selected = values.map((value) => String(value).trim().toUpperCase());
  const rows = await query(
    `SELECT * FROM ${table}
     WHERE ${flag}
       AND UPPER(TRIM(${canonicalCol})) IN (${selected.map(() => "?").join(", ")})`,
    selected
  );
  if (rows.length === 0) {
    // Same latent leak fixed on the secondary side — pin to sentinel so
    // the primary query legitimately returns zero, rather than dropping
    // the filter and returning every row.
    return { ...filters, [key]: ["__NO_MATCH_ON_PRIMARY__"] };
  }
  const mapped = new Set(selected);
  for (const row of rows) {
    const canonical = String(row[canonicalCol] || "").trim().toUpperCase();
    if (canonical) mapped.add(canonical);
  }
  return { ...filters, [key]: [...mapped].filter(Boolean) };
}

async function resolvePrimaryFilters(filters = {}) {
  let resolved = await resolveMappedValues(filters, "region", REGION_MAPPING, "IN_PRIMARY = 1");
  resolved = await resolveMappedValues(resolved, "cat", CATEGORY_MAPPING, "IN_PRIMARY = 1");
  resolved = await resolveMappedValues(resolved, "brand", BRAND_MAPPING, "IN_PRIMARY = 1");
  return withResolvedDist(resolved);
}

async function currentFiscal() {
  const rows = await query(`SELECT TO_VARCHAR(MAX(POSTING_DATE), 'YYYY-MM-DD') AS MAXD FROM ${PRI} WHERE ${VALIDITY}`);
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

  const resolvedFilters = await resolvePrimaryFilters(filters);
  const { clause, binds: filterBinds } = buildWhere(resolvedFilters, { skip: ["year", "month"] });

  const sql = `
    SELECT
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${MONTH_EXPR} IN (${inList(mtdMonths)}) THEN VALUE END) AS MTD_SALES,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${MONTH_EXPR} IN (${inList(mtdMonths)}) THEN QTY_IN_CTN END)  AS MTD_CTN,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${MONTH_EXPR} IN (${inList(mtdMonths)}) THEN QTY_IN_PCS END)  AS MTD_PCS,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(lyYears)}) AND ${MONTH_EXPR} IN (${inList(mtdMonths)}) THEN VALUE END) AS LY_MTD_SALES,

      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN VALUE END) AS FYTD_SALES,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN QTY_IN_CTN END)  AS FYTD_CTN,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN QTY_IN_PCS END)  AS FYTD_PCS,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(lyYears)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN VALUE END) AS LY_FYTD_SALES
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
  day: "POSTING_DATE",
  week: "DATE_TRUNC('week', POSTING_DATE)",
  month: "DATE_TRUNC('month', POSTING_DATE)",
};
export async function getPrimaryTrend(filters = {}, granularity = "day") {
  const resolvedFilters = await resolvePrimaryFilters(await withDefaultPeriod(filters));
  const { clause, binds } = buildWhere(resolvedFilters);
  const dateExpr = TREND_DATE_EXPR[granularity] || TREND_DATE_EXPR.day;
  const rows = await query(
    `SELECT TO_VARCHAR(${dateExpr}, 'YYYY-MM-DD') AS DATE, SUM(VALUE) AS NET_SALES
     FROM ${PRI}
     WHERE ${VALIDITY} ${clause}
     GROUP BY ${dateExpr}
     ORDER BY ${dateExpr}`,
    binds
  );
  return rows.map((r) => ({ date: r.DATE, netSales: r.NET_SALES || 0 }));
}

// Net sales by Category / Brand / SKU, one column at a time.
// Category uses the same COALESCE fallback as the filter to keep labels
// consistent with the WHERE-clause bucketing.
const CAT_LEVEL_COL = {
  cat: "COALESCE(NULLIF(FILTER_CATEGORY,''), MATERIAL_GROUP_NAME)",
  brand: "FILTER_BRAND",
  sku: "MAPPED_PRODUCT_NAME",
};
export async function getPrimaryByCategory({ filters = {}, level = "cat" } = {}) {
  return groupByOne(CAT_LEVEL_COL[level], filters);
}

const BRAND_LEVEL_COL = { brand: "FILTER_BRAND", sku: "MAPPED_PRODUCT_NAME" };
export async function getPrimaryByBrand({ filters = {}, level = "brand" } = {}) {
  return groupByOne(BRAND_LEVEL_COL[level], filters);
}

async function groupByOne(col, filters) {
  const resolvedFilters = await resolvePrimaryFilters(await withDefaultPeriod(filters));
  const { clause, binds } = buildWhere(resolvedFilters);
  const rows = await query(
    `SELECT ${col} AS LABEL, SUM(VALUE) AS NET_SALES
     FROM ${PRI}
     WHERE ${VALIDITY} ${clause}
     GROUP BY ${col}
     ORDER BY NET_SALES DESC`,
    binds
  );
  return rows.map((r) => ({ label: r.LABEL, value: r.NET_SALES || 0 }));
}

// Month-over-Month Sales by fiscal year. Region is not filterable here.
// MoM uses TO_CHAR(POSTING_DATE,'Mon') + YEAR(POSTING_DATE) so the returned
// (MONTH, YEAR) pair merges 1:1 with the secondary side's MONTH/YEAR (which
// are calendar month name + calendar year).
export async function getPrimaryMonthOverMonth({ fiscalYearStart, filters = {} } = {}) {
  const resolvedFilters = await resolvePrimaryFilters(filters);
  const { clause, binds } = buildWhere(resolvedFilters, { skip: ["year", "month", "region"] });
  const fyEndExclusive = `${Number(fiscalYearStart.slice(0, 4)) + 1}-${fiscalYearStart.slice(5)}`;

  const rows = await query(
    `SELECT TO_CHAR(POSTING_DATE, 'Mon') AS MONTH, YEAR(POSTING_DATE) AS YEAR, SUM(VALUE) AS NET_SALES
     FROM ${PRI}
     WHERE ${VALIDITY} AND POSTING_DATE >= ? AND POSTING_DATE < ? ${clause}
     GROUP BY TO_CHAR(POSTING_DATE, 'Mon'), YEAR(POSTING_DATE)
     ORDER BY CASE TO_CHAR(POSTING_DATE, 'Mon')
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
    `SELECT TO_VARCHAR(MIN(POSTING_DATE), 'YYYY-MM-DD') AS MIND,
            TO_VARCHAR(MAX(POSTING_DATE), 'YYYY-MM-DD') AS MAXD,
            COUNT(*) AS N
     FROM ${PRI} WHERE ${VALIDITY}`
  );
  const r = rows[0];
  return { recordCount: r.N, dateRange: { min: r.MIND, max: r.MAXD } };
}
