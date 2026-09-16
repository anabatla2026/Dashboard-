import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

const PRI = `${SNOWFLAKE_DATABASE}.GOLD.ZFI_SCO_VW`;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Row validity applied everywhere below: 45,888 of 525,091 rows (~Rs 8B of
// ~Rs 93.6B total TOTAL_VALUE) are CANCELED = 'True' — the DE's pasted
// queries didn't filter these out, but a canceled invoice line isn't a real
// sale, so counting it would overstate every primary figure by ~8.6%. Same
// shape of bug as the earlier ~89% primary undercount (see
// dashboard-query-reference.md), just in the opposite direction. Please
// confirm with the DE that excluding CANCELED = 'True' is correct.
const VALIDITY = "CANCELED = 'False' AND Posting_Date IS NOT NULL";

// Only year/month/cat/brand/town apply to primary (see
// client/src/context/FilterContext.jsx's PRIMARY_DIMS) — Region_Name on
// this view is unusable (populated from a generic SAP country/subdivision
// table: "South Dakota", "Paraiba", "Kabul" for a Pakistan-only business)
// and Distributor isn't reconciled between SAP and SalesFlo, so neither is
// exposed as a primary filter dimension.
const COLUMN_EXPR = {
  year: "YEAR(Posting_Date)",
  month: "TO_CHAR(Posting_Date, 'Mon')",
  cat: "Material_Group_Name",
  brand: "Brand",
  town: "City",
};

function buildWhere(filters = {}, { skip = [] } = {}) {
  const clauses = [];
  const binds = [];
  for (const [key, expr] of Object.entries(COLUMN_EXPR)) {
    if (skip.includes(key)) continue;
    const values = filters[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    clauses.push(`${expr} IN (${values.map(() => "?").join(", ")})`);
    binds.push(...(key === "year" ? values.map(Number) : values));
  }
  return { clause: clauses.length ? "AND " + clauses.join(" AND ") : "", binds };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function monthBounds(year, monthIdx0) {
  const start = `${year}-${pad2(monthIdx0 + 1)}-01`;
  const lastDay = new Date(year, monthIdx0 + 1, 0).getDate();
  const end = `${year}-${pad2(monthIdx0 + 1)}-${pad2(lastDay)}`;
  return { start, end };
}

function fiscalBounds(year, monthIdx0) {
  const fyYear = monthIdx0 >= 6 ? year : year - 1;
  const { end: periodEnd } = monthBounds(year, monthIdx0);
  return { fyStart: `${fyYear}-07-01`, periodEnd };
}

async function resolvePeriod(year, month) {
  if (year != null && month != null) {
    return { year: Number(year), monthIdx0: MONTH_SHORT.indexOf(month), month };
  }
  const rows = await query(
    `SELECT TO_VARCHAR(MAX(Posting_Date), 'YYYY-MM-DD') AS MAXD FROM ${PRI} WHERE ${VALIDITY}`
  );
  const maxd = rows[0]?.MAXD;
  if (!maxd) return null;
  const d = new Date(`${maxd}T00:00:00`);
  return { year: d.getFullYear(), monthIdx0: d.getMonth(), month: MONTH_SHORT[d.getMonth()] };
}

// ── KPI cards: Sales Value, Volume Ctn/Pcs, MTD/FYTD + GOLY. The DE's
// pasted query didn't include a last-year comparison, but every other KPI
// card on this dashboard shows GOLY, so it's computed the same way as
// secondary's for consistency. ──────────────────────────────────────────────
export async function getPrimaryKpis({ year, month } = {}) {
  const period = await resolvePeriod(year, month);
  if (!period) return null;

  const mtd = monthBounds(period.year, period.monthIdx0);
  const lyMtd = monthBounds(period.year - 1, period.monthIdx0);
  const { fyStart, periodEnd } = fiscalBounds(period.year, period.monthIdx0);
  const lyFy = fiscalBounds(period.year - 1, period.monthIdx0);

  const sql = `
    SELECT
      SUM(CASE WHEN Posting_Date BETWEEN ? AND ? THEN Total_Value END) AS MTD_SALES,
      SUM(CASE WHEN Posting_Date BETWEEN ? AND ? THEN Qty_In_Ctn END)  AS MTD_CTN,
      SUM(CASE WHEN Posting_Date BETWEEN ? AND ? THEN Qty_In_Pcs END)  AS MTD_PCS,
      SUM(CASE WHEN Posting_Date BETWEEN ? AND ? THEN Total_Value END) AS FYTD_SALES,
      SUM(CASE WHEN Posting_Date BETWEEN ? AND ? THEN Qty_In_Ctn END)  AS FYTD_CTN,
      SUM(CASE WHEN Posting_Date BETWEEN ? AND ? THEN Qty_In_Pcs END)  AS FYTD_PCS,
      SUM(CASE WHEN Posting_Date BETWEEN ? AND ? THEN Total_Value END) AS LY_MTD_SALES,
      SUM(CASE WHEN Posting_Date BETWEEN ? AND ? THEN Total_Value END) AS LY_FYTD_SALES
    FROM ${PRI}
    WHERE ${VALIDITY}
  `;
  const binds = [
    mtd.start, mtd.end, mtd.start, mtd.end, mtd.start, mtd.end,
    fyStart, periodEnd, fyStart, periodEnd, fyStart, periodEnd,
    lyMtd.start, lyMtd.end,
    lyFy.fyStart, lyFy.periodEnd,
  ];

  const rows = await query(sql, binds);
  const r = rows[0];
  const goly = (cur, ly) => (ly > 0 ? ((cur - ly) / ly) * 100 : null);

  return {
    period: { year: period.year, month: period.month },
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
  const { clause, binds } = buildWhere(filters);
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
  const { clause, binds } = buildWhere(filters);
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
  const { clause, binds } = buildWhere(filters, { skip: ["year", "month"] });
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

// ── Distinct filter-option lists (Category, Brand, Town, Year, Month). ────
export async function getPrimaryDims() {
  const dims = ["cat", "brand", "town", "year", "month"];
  const result = {};
  for (const key of dims) {
    const expr = COLUMN_EXPR[key];
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
