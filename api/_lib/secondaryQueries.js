import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

const SEC = `${SNOWFLAKE_DATABASE}.GOLD.SALESFLO_DATADUMP_VW`;
const PRI = `${SNOWFLAKE_DATABASE}.GOLD.ZFI_SCO_VW`;
const MT_DIRECT = `${SNOWFLAKE_DATABASE}.GOLD.MT_DIRECT_DISTRIBUTORS_VW`;
const TARGETS = `${SNOWFLAKE_DATABASE}.GOLD.TARGETS_VW`;
const DIST_MASTER = `${SNOWFLAKE_DATABASE}.GOLD.DISTRIBUTOR_MASTER_VW`;
const REGION_MAPPING = `${SNOWFLAKE_DATABASE}.GOLD.VW_REGION_MAPPING_1ST_DASH`;
const CATEGORY_MAPPING = `${SNOWFLAKE_DATABASE}.GOLD.VW_CATEGORY_MAPPING_1ST_DASH`;
const BRAND_MAPPING = `${SNOWFLAKE_DATABASE}.GOLD.VW_BRAND_MAPPING_1ST_DASH`;
const DIST_FILTER = `${SNOWFLAKE_DATABASE}.GOLD.VW_DISTRIBUTOR_FILTER_1ST_DASH`;

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
  dist: ["UPPER(TRIM(DISTRIBUTOR_CODE_RD))"],
  appUser: ["APP_USER_TAGGED_TITLE"],
};

async function resolveSecondaryFilters(filters = {}) {
  let resolved = { ...filters };
  const mapped = [
    ["region", REGION_MAPPING, "SOURCE = 'SECONDARY'", ["REGION_CODE", "REGION_NAME"]],
    ["cat", CATEGORY_MAPPING, "IN_SECONDARY = 1", ["CATEGORY_CODE", "CATEGORY_NAME"]],
    ["brand", BRAND_MAPPING, "IN_SECONDARY = 1", ["BRAND"]],
  ];
  for (const [key, table, predicate, columns] of mapped) {
    const values = resolved[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    const selected = values.map((value) => String(value).trim().toUpperCase());
    const rows = await query(
      `SELECT * FROM ${table}
       WHERE ${predicate}
         AND (${columns.map((column) => `UPPER(TRIM(${column})) IN (${values.map(() => "?").join(", ")})`).join(" OR ")})`,
      columns.flatMap(() => selected)
    );
    if (rows.length === 0) {
      resolved[key] = undefined;
      continue;
    }
    const expanded = new Set(selected);
    for (const row of rows) for (const column of columns) {
      const value = String(row[column] || "").trim().toUpperCase();
      if (value) expanded.add(value);
    }
    resolved[key] = [...expanded];
  }
  if (Array.isArray(resolved.dist) && resolved.dist.length > 0) {
    const selected = resolved.dist.map((value) => String(value).trim().toUpperCase());
    const rows = await query(
      `SELECT DISTINCT DISTRIBUTOR_SAP_CODE AS V FROM ${DIST_FILTER}
       WHERE (UPPER(TRIM(DISTRIBUTOR_CODE)) IN (${selected.map(() => "?").join(", ")})
           OR UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) IN (${selected.map(() => "?").join(", ")})
           OR UPPER(TRIM(DISTRIBUTOR_SAP_NAME)) IN (${selected.map(() => "?").join(", ")}))
         AND DISTRIBUTOR_SAP_CODE IS NOT NULL`,
      [...selected, ...selected, ...selected]
    );
    resolved.dist = rows.length ? rows.map((row) => row.V) : undefined;
  }
  return resolved;
}

const PRI_FY_EXPR = "(CASE WHEN MONTH(invoice_Date) >= 7 THEN YEAR(invoice_Date) + 1 ELSE YEAR(invoice_Date) END)";
const PRI_MONTH_EXPR = "TO_CHAR(invoice_Date, 'Mon')";
const PRI_FISCAL_MONTH_NO_EXPR = "(CASE WHEN MONTH(invoice_Date) >= 7 THEN MONTH(invoice_Date) - 6 ELSE MONTH(invoice_Date) + 6 END)";
const PRI_FILTER_COLUMNS = {
  region: ["UPPER(TRIM(p.REGION))", "UPPER(TRIM(p.REGION_NAME))"],
  cat: ["UPPER(TRIM(p.MATERIAL_GROUP))", "UPPER(TRIM(p.MATERIAL_GROUP_NAME))"],
  brand: ["UPPER(TRIM(p.BRAND))"],
  dist: ["UPPER(TRIM(p.PARTY_CODE))"],
};

function primaryFilterWhere(filters = {}) {
  const clauses = [];
  const binds = [];
  for (const [key, columns] of Object.entries(PRI_FILTER_COLUMNS)) {
    const values = filters[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    clauses.push(`(${columns.map((column) => `${column} IN (${values.map(() => "?").join(", ")})`).join(" OR ")})`);
    for (const column of columns) binds.push(...values);
  }
  return { clause: clauses.length ? `AND ${clauses.join(" AND ")}` : "", binds };
}

// Builds "AND col IN (?, ?) AND ..." plus the matching bind array from a
// filters object. `skip` excludes dimensions the caller handles separately.
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

async function resolvePrimaryTopupFilters(filters = {}) {
  let resolved = { ...filters };
  const mapped = [
    ["region", REGION_MAPPING, "SOURCE = 'PRIMARY'", ["REGION_CODE", "REGION_NAME"]],
    ["cat", CATEGORY_MAPPING, "IN_PRIMARY = 1", ["CATEGORY_CODE", "CATEGORY_NAME"]],
    ["brand", BRAND_MAPPING, "IN_PRIMARY = 1", ["BRAND"]],
  ];
  for (const [key, table, predicate, columns] of mapped) {
    const values = resolved[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    const selected = values.map((value) => String(value).trim().toUpperCase());
    const rows = await query(
      `SELECT * FROM ${table}
       WHERE ${predicate}
         AND (${columns.map((column) => `UPPER(TRIM(${column})) IN (${values.map(() => "?").join(", ")})`).join(" OR ")})`,
      columns.flatMap(() => selected)
    );
    if (rows.length === 0) {
      resolved[key] = undefined;
      continue;
    }
    const expanded = new Set(selected);
    for (const row of rows) for (const column of columns) {
      const value = String(row[column] || "").trim().toUpperCase();
      if (value) expanded.add(value);
    }
    resolved[key] = [...expanded];
  }
  if (Array.isArray(resolved.dist) && resolved.dist.length > 0) {
    const selected = resolved.dist.map((value) => String(value).trim().toUpperCase());
    const rows = await query(
      `SELECT DISTINCT DISTRIBUTOR_SAP_CODE AS V FROM ${DIST_FILTER}
       WHERE (UPPER(TRIM(DISTRIBUTOR_CODE)) IN (${selected.map(() => "?").join(", ")})
           OR UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) IN (${selected.map(() => "?").join(", ")})
           OR UPPER(TRIM(DISTRIBUTOR_SAP_NAME)) IN (${selected.map(() => "?").join(", ")}))
         AND DISTRIBUTOR_SAP_CODE IS NOT NULL`,
      [...selected, ...selected, ...selected]
    );
    resolved.dist = rows.length ? rows.map((row) => row.V) : undefined;
  }
  return resolved;
}

function primaryPeriodParts(years, months) {
  const cutoff = Math.max(...months.map((month) => FISCAL_MONTH_NO[month]));
  return {
    mtd: `(${PRI_FY_EXPR} IN (${inList(years)}) AND ${PRI_MONTH_EXPR} IN (${inList(months)}))`,
    fytd: `(${PRI_FY_EXPR} IN (${inList(years)}) AND ${PRI_FISCAL_MONTH_NO_EXPR} <= ?)`,
    mtdBinds: [...years, ...months],
    fytdBinds: [...years, cutoff],
  };
}

async function getPrimaryTopupKpis(filters, years, mtdMonths, fytdMonths) {
  const resolved = await resolvePrimaryTopupFilters(filters);
  const { clause, binds } = primaryFilterWhere(resolved);
  const lyYears = years.map((year) => year - 1);
  const mtd = primaryPeriodParts(years, mtdMonths);
  const fytd = primaryPeriodParts(years, fytdMonths);
  const lyMtd = primaryPeriodParts(lyYears, mtdMonths);
  const lyFytd = primaryPeriodParts(lyYears, fytdMonths);
  const rows = await query(
    `SELECT
       SUM(CASE WHEN ${mtd.mtd} THEN p.Value END) AS MTD_SALES,
       SUM(CASE WHEN ${mtd.mtd} THEN p.Qty_In_Ctn END) AS MTD_CTN,
       SUM(CASE WHEN ${mtd.mtd} THEN p.Qty_In_Pcs END) AS MTD_PCS,
       SUM(CASE WHEN ${lyMtd.mtd} THEN p.Value END) AS LY_MTD_SALES,
       SUM(CASE WHEN ${fytd.fytd} THEN p.Value END) AS FYTD_SALES,
       SUM(CASE WHEN ${fytd.fytd} THEN p.Qty_In_Ctn END) AS FYTD_CTN,
       SUM(CASE WHEN ${fytd.fytd} THEN p.Qty_In_Pcs END) AS FYTD_PCS,
       SUM(CASE WHEN ${lyFytd.fytd} THEN p.Value END) AS LY_FYTD_SALES
     FROM ${PRI} p
       WHERE p.invoice_Date IS NOT NULL
         AND UPPER(TRIM(p.PARTY_CODE)) IN (
           SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) FROM ${MT_DIRECT}
         ) ${clause}`,
    [...mtd.mtdBinds, ...mtd.mtdBinds, ...mtd.mtdBinds, ...lyMtd.mtdBinds, ...fytd.fytdBinds, ...fytd.fytdBinds, ...fytd.fytdBinds, ...lyFytd.fytdBinds, ...binds]
  );
  return rows[0] || {};
}

async function getPrimaryTopupRows(filters, years, months, groupExpr, includeVolume = false) {
  const resolved = await resolvePrimaryTopupFilters(filters);
  const { clause, binds } = primaryFilterWhere(resolved);
  const period = primaryPeriodParts(years, months);
  const volume = includeVolume ? ", SUM(p.Qty_In_Ctn) AS VOLUME_CTN, SUM(p.Qty_In_Pcs) AS VOLUME_PCS" : "";
  const rows = await query(
    `SELECT ${groupExpr} AS LABEL, SUM(p.Value) AS NET_SALES${volume}
     FROM ${PRI} p
     WHERE p.invoice_Date IS NOT NULL
       AND UPPER(TRIM(p.PARTY_CODE)) IN (
         SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) FROM ${MT_DIRECT}
       )
       AND ${period.mtd}${clause}
     GROUP BY ${groupExpr}
     ORDER BY NET_SALES DESC`,
    [...period.mtdBinds, ...binds]
  );
  return rows;
}

async function getPrimaryTopupRegionAchievement(filters, years, mtdMonths, fytdMonths) {
  const resolved = await resolvePrimaryTopupFilters(filters);
  const { clause, binds } = primaryFilterWhere(resolved);
  const mtd = primaryPeriodParts(years, mtdMonths);
  const fytd = primaryPeriodParts(years, fytdMonths);
  return query(
    `SELECT p.REGION AS REGION,
            SUM(CASE WHEN ${mtd.mtd} THEN p.Value END) AS ACHIEVEMENT_MTD,
            SUM(CASE WHEN ${fytd.fytd} THEN p.Value END) AS ACHIEVEMENT_FYTD
     FROM ${PRI} p
     WHERE p.invoice_Date IS NOT NULL
       AND UPPER(TRIM(p.PARTY_CODE)) IN (
         SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) FROM ${MT_DIRECT}
       ) ${clause}
     GROUP BY p.REGION`,
    [...mtd.mtdBinds, ...fytd.fytdBinds, ...binds]
  );
}

async function getPrimaryTopupMom(filters, fiscalYearStart) {
  const resolved = await resolvePrimaryTopupFilters(filters);
  const { clause, binds } = primaryFilterWhere(resolved);
  const fyEndExclusive = `${Number(fiscalYearStart.slice(0, 4)) + 1}-${fiscalYearStart.slice(5)}`;
  return query(
    `SELECT TO_CHAR(p.invoice_Date, 'Mon') AS MONTH,
            YEAR(p.invoice_Date) AS YEAR,
            SUM(p.Value) AS NET_SALES
     FROM ${PRI} p
     WHERE p.invoice_Date >= ? AND p.invoice_Date < ?
       AND UPPER(TRIM(p.PARTY_CODE)) IN (
         SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) FROM ${MT_DIRECT}
       )${clause}
     GROUP BY TO_CHAR(p.invoice_Date, 'Mon'), YEAR(p.invoice_Date)
     ORDER BY CASE TO_CHAR(p.invoice_Date, 'Mon')
       WHEN 'Jul' THEN 1 WHEN 'Aug' THEN 2 WHEN 'Sep' THEN 3 WHEN 'Oct' THEN 4
       WHEN 'Nov' THEN 5 WHEN 'Dec' THEN 6 WHEN 'Jan' THEN 7 WHEN 'Feb' THEN 8
       WHEN 'Mar' THEN 9 WHEN 'Apr' THEN 10 WHEN 'May' THEN 11 WHEN 'Jun' THEN 12
     END`,
    [fiscalYearStart, fyEndExclusive, ...binds]
  );
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

  const resolvedFilters = await resolveSecondaryFilters(filters);
  const { clause, binds: filterBinds } = buildWhere(resolvedFilters, { skip: ["year", "month"] });

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

  const [rows, topup] = await Promise.all([query(sql, binds), getPrimaryTopupKpis(filters, y, mtdMonths, fytdMonths)]);
  const r = rows[0];
  const goly = (cur, ly) => (ly > 0 ? ((cur - ly) / ly) * 100 : null);
  const mtdSales = (r.MTD_SALES || 0) + (topup.MTD_SALES || 0);
  const fytdSales = (r.FYTD_SALES || 0) + (topup.FYTD_SALES || 0);

  return {
    period: { years: y, months: mtdMonths },
    mtd: {
      salesValue: mtdSales,
      volumeCtn: (r.MTD_CTN || 0) + (topup.MTD_CTN || 0),
      volumePcs: (r.MTD_UNITS || 0) + (topup.MTD_PCS || 0),
      productiveStores: r.MTD_STORES || 0,
      productiveDistributors: r.MTD_DIST || 0,
      goly: goly(mtdSales, (r.LY_MTD_SALES || 0) + (topup.LY_MTD_SALES || 0)),
    },
    ytd: {
      salesValue: fytdSales,
      volumeCtn: (r.FYTD_CTN || 0) + (topup.FYTD_CTN || 0),
      volumePcs: (r.FYTD_UNITS || 0) + (topup.FYTD_PCS || 0),
      productiveStores: r.FYTD_STORES || 0,
      productiveDistributors: r.FYTD_DIST || 0,
      goly: goly(fytdSales, (r.LY_FYTD_SALES || 0) + (topup.LY_FYTD_SALES || 0)),
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
  const periodFilters = await withDefaultPeriod(filters);
  const resolvedFilters = await resolveSecondaryFilters(periodFilters);
  const { clause, binds } = buildWhere(resolvedFilters);
  const effectiveGranularity = TREND_DATE_EXPR[granularity] ? granularity : "day";
  const dateExpr = TREND_DATE_EXPR[effectiveGranularity];
  const rows = await query(
    `SELECT TO_VARCHAR(${dateExpr}, 'YYYY-MM-DD') AS DATE, SUM(NET_SALES) AS NET_SALES
     FROM ${SEC}
     WHERE DATE IS NOT NULL AND ${STANDING_FILTER} ${clause}
     GROUP BY ${dateExpr}
     ORDER BY ${dateExpr}`,
    binds
  );
  const years = periodFilters.year || [];
  const months = periodFilters.month || [];
  const topupRows = years.length && months.length
    ? await getPrimaryTopupRows(filters, years.map(Number), months, `TO_VARCHAR(${effectiveGranularity === "day" ? "p.invoice_Date" : `DATE_TRUNC('${effectiveGranularity}', p.invoice_Date)`}, 'YYYY-MM-DD')`)
    : [];
  const values = new Map(rows.map((row) => [row.DATE, row.NET_SALES || 0]));
  for (const row of topupRows) values.set(row.LABEL, (values.get(row.LABEL) || 0) + (row.NET_SALES || 0));
  return [...values].sort(([a], [b]) => (a > b ? 1 : -1)).map(([date, netSales]) => ({ date, netSales }));
}

// Generic "group by one column, scoped by the active filters" query shared
// by every drillable chart.
async function groupByOne(col, filters, extra = {}) {
  const resolvedFilters = await resolveSecondaryFilters(await withDefaultPeriod(filters));
  const { clause, binds } = buildWhere(resolvedFilters);
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
  const periodFilters = await withDefaultPeriod(filters);
  const years = periodFilters.year || [];
  const months = periodFilters.month || [];
  const topupGroup = col === "CATEGORY" ? "p.MATERIAL_GROUP_NAME" : col === "BRAND" ? "p.BRAND" : col === "REGION" ? "p.REGION" : null;
  if (topupGroup && years.length && months.length) {
    const topupRows = await getPrimaryTopupRows(filters, years.map(Number), months, topupGroup);
    const values = new Map(rows.map((row) => [row.LABEL, row.NET_SALES || 0]));
    for (const row of topupRows) values.set(row.LABEL, (values.get(row.LABEL) || 0) + (row.NET_SALES || 0));
    return [...values]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }
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

  const [mtdTargets, fytdTargets, achievementRows, topupRows] = await Promise.all([
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
    getPrimaryTopupRegionAchievement({}, y, mtdMonths, fytdMonths),
  ]);

  const achievementMap = new Map();
  for (const row of [...achievementRows, ...topupRows]) {
    const current = achievementMap.get(row.REGION) || { ACHIEVEMENT_MTD: 0, ACHIEVEMENT_FYTD: 0 };
    current.ACHIEVEMENT_MTD += row.ACHIEVEMENT_MTD || 0;
    current.ACHIEVEMENT_FYTD += row.ACHIEVEMENT_FYTD || 0;
    achievementMap.set(row.REGION, current);
  }

  const mtdMap = new Map(mtdTargets.map((r) => [r.REGION, r.TARGET || 0]));
  const fytdMap = new Map(fytdTargets.map((r) => [r.REGION, r.TARGET || 0]));
  const regions = new Set([...mtdMap.keys(), ...fytdMap.keys(), ...achievementMap.keys()]);

  return [...regions]
    .map((region) => {
      const a = achievementMap.get(region);
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
  const resolvedFilters = await resolveSecondaryFilters(filters);
  const { clause, binds } = buildWhere(resolvedFilters, { skip: ["year", "month", "region"] });
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
  const topupRows = await getPrimaryTopupMom(filters, fiscalYearStart);
  const values = new Map();
  for (const row of [...rows, ...topupRows]) {
    const key = `${row.MONTH}|${row.YEAR}`;
    const current = values.get(key) || { month: row.MONTH, year: row.YEAR, netSales: 0 };
    current.netSales += row.NET_SALES || 0;
    values.set(key, current);
  }
  return [...values.values()].sort((a, b) => FISCAL_MONTH_ORDER.indexOf(a.month) - FISCAL_MONTH_ORDER.indexOf(b.month));
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
