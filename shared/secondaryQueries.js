import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

// The data engineering team has since published proper GOLD views over
// these (2026-09-15) — querying them instead of the raw BRONZE/SILVER
// tables directly. GOLD.salesflo_datadump_vw's REGION column is now also
// remapped to match DISTRIBUTOR_MASTER_VW.NEW_REGION's taxonomy (the
// original South/Central/North value is preserved separately as
// DM_ORIGINAL_REGION), which is what makes getRegionTargetVsAchievement
// below actually work now — previously REGION and NEW_REGION were disjoint
// taxonomies that could never join.
const SEC = `${SNOWFLAKE_DATABASE}.GOLD.SALESFLO_DATADUMP_VW`;
const TARGETS = `${SNOWFLAKE_DATABASE}.GOLD.TARGETS_VW`;
const DIST_MASTER = `${SNOWFLAKE_DATABASE}.GOLD.DISTRIBUTOR_MASTER_VW`;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The business labels a fiscal year (1 July - 30 June) by the calendar year
// it ENDS in — e.g. Sep 2026 falls in "FY2027" (Jul 2026 - Jun 2027), not
// "FY2026". This is the opposite of what the raw YEAR column gives you for
// Jul-Dec rows, so every "year" filter/dimension value must be this derived
// label, not YEAR itself. Confirmed against the DE's own query (2026-09-17),
// which computes calendar_year as fiscal_year - 1 for Jul-Dec months.
const FISCAL_YEAR_EXPR =
  "(CASE WHEN MONTH IN ('Jul','Aug','Sep','Oct','Nov','Dec') THEN YEAR + 1 ELSE YEAR END)";

// Dashboard filter key -> real column (or derived expression) in
// SILVER.SALESFLO_DATADUMP (see dashboard-query-reference.md §1 for the
// original Excel-era mapping this mirrors).
const COLUMN_MAP = {
  year: FISCAL_YEAR_EXPR,
  month: "MONTH",
  region: "REGION",
  segment: "CHANNEL_GROUP",
  cat: "CATEGORY",
  brand: "BRAND",
  chType: "CHANNEL_TYPE",
  town: "TOWN_NAME",
  dist: "DISTRIBUTOR_NAME",
  appUser: "APP_USER_TAGGED_TITLE",
};

// Builds "AND col IN (?, ?) AND ..." plus the matching bind array, from a
// filters object like { region: ["South"], cat: ["Baby Diapers", "Snacks"] }.
// `skip` excludes dimensions the caller handles separately (e.g. a chart
// already scoped by its own drill path, or year/month resolved into an
// explicit date range instead of an IN clause).
export function buildWhere(filters = {}, { skip = [] } = {}) {
  const clauses = [];
  const binds = [];
  for (const [key, col] of Object.entries(COLUMN_MAP)) {
    if (skip.includes(key)) continue;
    const values = filters[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    clauses.push(`${col} IN (${values.map(() => "?").join(", ")})`);
    binds.push(...values);
  }
  return { clause: clauses.length ? "AND " + clauses.join(" AND ") : "", binds };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Last calendar day of (year, monthIdx0) as 'YYYY-MM-DD'.
function monthBounds(year, monthIdx0) {
  const start = `${year}-${pad2(monthIdx0 + 1)}-01`;
  const lastDay = new Date(year, monthIdx0 + 1, 0).getDate();
  const end = `${year}-${pad2(monthIdx0 + 1)}-${pad2(lastDay)}`;
  return { start, end };
}

// Fiscal year runs 1 July - 30 June, same rule as client/src/lib/period.js.
function fiscalBounds(year, monthIdx0) {
  const fyYear = monthIdx0 >= 6 ? year : year - 1;
  const { end: periodEnd } = monthBounds(year, monthIdx0);
  return { fyStart: `${fyYear}-07-01`, periodEnd };
}

// Resolves the "current" period: the single Year+Month filter when set,
// otherwise the latest (year, month) actually present in the table.
// `fiscalYear` is the incoming Year filter value — a fiscal-year-END label
// (see FISCAL_YEAR_EXPR above) — converted here to the actual calendar year
// of the given month before any date-range math happens.
async function resolvePeriod(fiscalYear, month) {
  if (fiscalYear != null && month != null) {
    const monthIdx0 = MONTH_SHORT.indexOf(month);
    const year = monthIdx0 >= 6 ? Number(fiscalYear) - 1 : Number(fiscalYear);
    return { year, monthIdx0, month };
  }
  const rows = await query(
    `SELECT TO_VARCHAR(MAX(DATE), 'YYYY-MM-DD') AS MAXD FROM ${SEC} WHERE DATE IS NOT NULL`
  );
  const maxd = rows[0]?.MAXD;
  if (!maxd) return null;
  const d = new Date(`${maxd}T00:00:00`);
  return { year: d.getFullYear(), monthIdx0: d.getMonth(), month: MONTH_SHORT[d.getMonth()] };
}

// ── KPI cards (Sales Value, Volume Ctn/Pcs, Productive Stores/Distributors,
// GOLY) — only Year/Month (via period resolution) and the App User Tag
// filter apply here; see dashboard-query-reference.md §2.6. ────────────────
export async function getSecondaryKpis({ year, month, appUser } = {}) {
  const period = await resolvePeriod(year, month);
  if (!period) return null;

  const mtd = monthBounds(period.year, period.monthIdx0);
  const lyMtd = monthBounds(period.year - 1, period.monthIdx0);
  const { fyStart, periodEnd } = fiscalBounds(period.year, period.monthIdx0);
  const lyFy = fiscalBounds(period.year - 1, period.monthIdx0);

  const { clause: appUserClause, binds: appUserBinds } = buildWhere(
    { appUser },
    {}
  );

  const sql = `
    SELECT
      SUM(CASE WHEN DATE BETWEEN ? AND ? THEN NET_SALES END)  AS MTD_SALES,
      SUM(CASE WHEN DATE BETWEEN ? AND ? THEN SALES_CTN END)  AS MTD_CTN,
      SUM(CASE WHEN DATE BETWEEN ? AND ? THEN SALES_UNITS END) AS MTD_UNITS,
      SUM(CASE WHEN DATE BETWEEN ? AND ? THEN NET_SALES END)  AS FYTD_SALES,
      SUM(CASE WHEN DATE BETWEEN ? AND ? THEN SALES_CTN END)  AS FYTD_CTN,
      SUM(CASE WHEN DATE BETWEEN ? AND ? THEN SALES_UNITS END) AS FYTD_UNITS,
      SUM(CASE WHEN DATE BETWEEN ? AND ? THEN NET_SALES END)  AS LY_MTD_SALES,
      SUM(CASE WHEN DATE BETWEEN ? AND ? THEN NET_SALES END)  AS LY_FYTD_SALES,
      COUNT(DISTINCT CASE WHEN DATE BETWEEN ? AND ? THEN TRIM(OUTLET_CODE) END)      AS MTD_STORES,
      COUNT(DISTINCT CASE WHEN DATE BETWEEN ? AND ? THEN TRIM(DISTRIBUTOR_CODE) END) AS MTD_DIST,
      COUNT(DISTINCT CASE WHEN DATE BETWEEN ? AND ? THEN TRIM(OUTLET_CODE) END)      AS FYTD_STORES,
      COUNT(DISTINCT CASE WHEN DATE BETWEEN ? AND ? THEN TRIM(DISTRIBUTOR_CODE) END) AS FYTD_DIST,
      COUNT(DISTINCT TRIM(OUTLET_CODE)) AS TOTAL_STORES
    FROM ${SEC}
    WHERE DATE IS NOT NULL
    ${appUserClause}
  `;

  const binds = [
    mtd.start, mtd.end, mtd.start, mtd.end, mtd.start, mtd.end,
    fyStart, periodEnd, fyStart, periodEnd, fyStart, periodEnd,
    lyMtd.start, lyMtd.end,
    lyFy.fyStart, lyFy.periodEnd,
    mtd.start, mtd.end, mtd.start, mtd.end,
    fyStart, periodEnd, fyStart, periodEnd,
    ...appUserBinds,
  ];

  const rows = await query(sql, binds);
  const r = rows[0];

  const goly = (cur, ly) => (ly > 0 ? ((cur - ly) / ly) * 100 : null);

  return {
    period: { year: period.year, month: period.month },
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
  const { clause, binds } = buildWhere(filters);
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
// query shared by every drillable chart. For hierarchy levels that are also
// real global-filter dimensions (chType/cat/brand/region/town/dist), the
// client keeps the global filter and the drill path in sync (see
// useDrillPath's self-heal effect), so `filters` alone already scopes to
// the selected parent value — no separate path plumbing needed. Only
// `channel` (chType's child) isn't a real filter dimension, so it's the one
// level that needs an explicit parent value passed through `extra`. ───────
async function groupByOne(col, filters, extra = {}) {
  const { clause, binds } = buildWhere(filters);
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
// subChannel (§3.2). `channel` narrows to the parent Channel value once
// drilled past chType (chType itself is already applied via filters.chType). ─
const CHANNEL_LEVEL_COL = { chType: "CHANNEL_TYPE", channel: "CHANNEL", subChannel: "SUB_CHANNEL" };
export async function getByChannelType({ filters = {}, level = "chType", channel } = {}) {
  return groupByOne(CHANNEL_LEVEL_COL[level], filters, channel ? { CHANNEL: channel } : {});
}

// ── Net sales by Category (Secondary side only — Primary stays Excel-
// sourced and is merged client-side), with drill cat -> brand -> sku (§3.3).
// cat/brand are both global filter dims, so `filters` alone scopes each
// level once drilled. ──────────────────────────────────────────────────────
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
// (§3.5). Target is fetched separately by getRegionTargetVsAchievement below
// and merged client-side (see ChartCard's regionTarget wiring) now that the
// region taxonomy on both sides actually matches. ──────────────────────────
const REGION_LEVEL_COL = { region: "REGION", town: "TOWN_NAME", dist: "DISTRIBUTOR_NAME" };
export async function getRegionAchievement({ filters = {}, level = "region" } = {}) {
  return groupByOne(REGION_LEVEL_COL[level], filters);
}

// Region-wise Target vs Achievement for one resolved (year, month) — the
// "region wise target Vs Achievements FINAL" query, generalized. TARGETS has
// no region of its own; it's reached by joining its DIST_CODE to
// DISTRIBUTOR_MASTER's NEW_REGION. Verified working 2026-09-15 once GOLD
// remapped salesflo_datadump_vw.REGION onto the same taxonomy as
// DISTRIBUTOR_MASTER_VW.NEW_REGION — every region now gets a real TARGET
// and a real ACHIEVEMENT instead of one side always landing on 0.
export async function getRegionTargetVsAchievement({ year, month } = {}) {
  const period = await resolvePeriod(year, month);
  if (!period) return [];
  const { start, end } = monthBounds(period.year, period.monthIdx0);

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
      WHERE DATE BETWEEN ? AND ?
      GROUP BY REGION
    )
    SELECT COALESCE(t.REGION, a.REGION) AS REGION,
           COALESCE(t.TARGET, 0) AS TARGET,
           COALESCE(a.ACHIEVEMENT, 0) AS ACHIEVEMENT
    FROM targets_by_region t
    FULL OUTER JOIN achievement_by_region a ON t.REGION = a.REGION
    ORDER BY ACHIEVEMENT DESC
    `,
    [String(period.year), period.month, start, end]
  );
  return rows.map((r) => ({ region: r.REGION, target: r.TARGET || 0, achievement: r.ACHIEVEMENT || 0 }));
}

// ── Month-over-Month Sales by fiscal year, local widget filters independent
// of the global bar (§3.6). Region is deliberately NOT applied here — the DE
// asked (2026-09-16) to disable Region on both Primary and Secondary's MoM
// for now, pending a proper region mapping; any `region` passed in is
// ignored. ──────────────────────────────────────────────────────────────────
export async function getMonthOverMonth({ fiscalYearStart, filters = {} } = {}) {
  const { clause, binds } = buildWhere(filters, { skip: ["year", "month", "region"] });
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

// ── Distinct filter-option lists, for populating the global filter bar
// without shipping raw rows. ────────────────────────────────────────────────
export async function getSecondaryDims() {
  const dims = ["region", "segment", "cat", "brand", "chType", "town", "dist", "appUser", "year", "month"];
  const result = {};
  for (const key of dims) {
    const col = COLUMN_MAP[key];
    const rows = await query(
      `SELECT DISTINCT ${col} AS V FROM ${SEC} WHERE ${col} IS NOT NULL ORDER BY ${col}`
    );
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
