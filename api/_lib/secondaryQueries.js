
import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

// const SEC = `${SNOWFLAKE_DATABASE}.GOLD.SALESFLO_DATADUMP_VW`;
const SEC = `${SNOWFLAKE_DATABASE}.GOLD.VW_FACT_SECONDARY_SALES`;
// Primary-side MT-Direct top-up now reads from the curated primary fact
// (GOLD.VW_FACT_PRIMARY_SALES) which carries pre-computed FILTER_* columns
// (canonical Salesflo names), fiscal buckets (FY_YEAR / FY_MONTH_NO /
// FY_MONTH_NAME), POSTING_DATE, and a PRIMARY_EQ_SECONDARY boolean that
// already encodes MT-Direct distributor membership (verified 100% equivalent
// to MT_DIRECT_DISTRIBUTORS_VW membership on the current data).
const PRI = `${SNOWFLAKE_DATABASE}.GOLD.VW_FACT_PRIMARY_SALES`;
// Still referenced by the secondary MT-Direct EXCLUSION on SEC (the
// SEC_NON_MT_DIRECT LEFT JOIN below), because SALESFLO_DATADUMP_VW has no
// PRIMARY_EQ_SECONDARY flag. Not used by the primary top-up path any more.
const MT_DIRECT = `${SNOWFLAKE_DATABASE}.GOLD.MT_DIRECT_DISTRIBUTORS_VW`;


// MT-Direct distributors are captured on the primary side (`ZFI_SCO_VW`)
// and added via the primary top-up path. To avoid double-counting them in
// combined sales values, they are excluded from every secondary SUM query.
// NOT applied to KPI #2 productive-stores/distributors COUNTs — those still
// need MT-Direct outlets/distributors visible in the distinct counts.
// const SEC_NON_MT_DIRECT = `UPPER(TRIM(DISTRIBUTOR_CODE_RD)) NOT IN (SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) FROM ${MT_DIRECT})`;
// COALESCE to '' first: a bare `NOT IN` yields NULL (not TRUE) for rows whose
// DIST_SAP_CODE is NULL/blank, silently dropping them. Those rows are not
// MT-Direct and must be kept — this matches the `md.CODE IS NULL` LEFT JOIN
// form used by getSecondaryKpis, which is the correct reference.
const SEC_NON_MT_DIRECT = `COALESCE(UPPER(TRIM(DIST_SAP_CODE)), '') NOT IN (SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) FROM ${MT_DIRECT})`;
const TARGETS = `${SNOWFLAKE_DATABASE}.GOLD.TARGETS_VW`;
const DIST_MASTER = `${SNOWFLAKE_DATABASE}.GOLD.DISTRIBUTOR_MASTER_VW`;
const DIST_SALESFLO = `${SNOWFLAKE_DATABASE}.GOLD.VW_DIM_DISTRIBUTOR_SALESFLO`;
const REGION_MAPPING = `${SNOWFLAKE_DATABASE}.GOLD.VW_FILTER_REGION`;
const CATEGORY_MAPPING = `${SNOWFLAKE_DATABASE}.GOLD.VW_FILTER_CATEGORY`;
const BRAND_MAPPING = `${SNOWFLAKE_DATABASE}.GOLD.VW_FILTER_BRAND`;
const DIST_FILTER = `${SNOWFLAKE_DATABASE}.GOLD.VW_FILTER_DISTRIBUTOR`;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Fiscal month order (Jul-Jun) for sorting the Month dropdown; MONTH_SHORT
// stays calendar-order since it's indexed by Date.getMonth() elsewhere.
const FISCAL_MONTH_ORDER = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const FISCAL_MONTH_NO = { Jul: 1, Aug: 2, Sep: 3, Oct: 4, Nov: 5, Dec: 6, Jan: 7, Feb: 8, Mar: 9, Apr: 10, May: 11, Jun: 12 };

// Fiscal year (1 Jul - 30 Jun) is labeled by the calendar year it ends in,
// e.g. Sep 2026 is FY2027.
// const FISCAL_YEAR_EXPR = "(CASE WHEN MONTH IN ('Jul','Aug','Sep','Oct','Nov','Dec') THEN YEAR + 1 ELSE YEAR END)";
const FISCAL_YEAR_EXPR = "(YEAR(DATE) + IFF(MONTH(DATE) >= 7, 1, 0))";
// 1-12 fiscal month number (Jul=1 .. Jun=12), used for FYTD cutoff comparisons.
// const FISCAL_MONTH_NO_EXPR = `(CASE MONTH
//   WHEN 'Jul' THEN 1 WHEN 'Aug' THEN 2 WHEN 'Sep' THEN 3 WHEN 'Oct' THEN 4
//   WHEN 'Nov' THEN 5 WHEN 'Dec' THEN 6 WHEN 'Jan' THEN 7 WHEN 'Feb' THEN 8
//   WHEN 'Mar' THEN 9 WHEN 'Apr' THEN 10 WHEN 'May' THEN 11 WHEN 'Jun' THEN 12 END)`;

const FISCAL_MONTH_NO_EXPR = "(MOD(MONTH(DATE) + 5, 12) + 1)";

// Dashboard filter key -> fact-table column(s) to match (OR'd when more than
// one). segment/appUser are pre-existing filters. `dist` is resolved via
// withResolvedDist before this map is used.
//
// Every text column here is wrapped in UPPER(TRIM(...)) because
// resolveSecondaryFilters() uppercases user input before it lands here, and
// Snowflake's default string comparison is case-sensitive — so a bare
// `CATEGORY IN ('BABY DIAPERS')` never matches fact rows stored as
// 'Baby Diapers'. This mirrors the pattern already used for PRI_FILTER_COLUMNS
// and for `dist`. year/month use pre-built expressions and are left alone.
const COLUMN_MAP = {
  year: [FISCAL_YEAR_EXPR],
  month: ["TO_CHAR(DATE, 'Mon')"],
  region: ["UPPER(TRIM(COALESCE(FILTER_REGION, '')))"],
  cat: ["UPPER(TRIM(COALESCE(NULLIF(FILTER_CATEGORY, ''), CATEGORY, '')))"],
  brand: ["UPPER(TRIM(COALESCE(NULLIF(FILTER_BRAND, ''), BRAND, '')))"],
  chType: ["UPPER(TRIM(COALESCE(FILTER_CHANNEL_TYPE, '')))"],
  town: ["UPPER(TRIM(COALESCE(FILTER_TOWN, '')))"],
  dist: ["UPPER(TRIM(DIST_SAP_CODE))", "UPPER(TRIM(DISTRIBUTOR_CODE))", "UPPER(TRIM(DIST_NAME))"],
  appUser: ["UPPER(TRIM(COALESCE(APP_USER_TAGGED_TITLE, '')))"],
};

// New VW_FILTER_* views:
//   - regions/categories/brands are canonical (one row each)
//   - categories & brands also carry SALESFLO_ALIASES: the salesflo fact-side
//     names the canonical value expands to (slash-separated). We MUST parse
//     these on the secondary side so that filtering by e.g. canonical `Razor`
//     matches fact rows stored as `Personal Care` too.
//   - regions do not carry aliases (single fact-side name).
//
// Alias-collision guard: some canonical rows list an alias that is ALSO the
// canonical name of a different row in the same view — e.g.
//   Baby Diapers   → SALESFLO_ALIASES 'Baby Diapers / Pants'   (Pants is canonical too)
//   Onli           → SALESFLO_ALIASES 'Onli / Onli Plus'       (Onli Plus is canonical too)
// Expanding those verbatim would sweep the OTHER canonical's fact rows into
// this filter, double-counting them across separate dropdown selections.
// The guard below fetches the full canonical set for the aliased dimension
// (once per request, lazily) and skips any alias that would collide with a
// different canonical. The row's OWN canonical (a "self alias") is always
// kept, and every alias that is not itself a canonical passes through
// unchanged so genuine salesflo variants (Personal Care, Bona Pro, Oral Care,
// Toiletries, Soap, etc.) continue to work.
async function resolveSecondaryFilters(filters = {}) {
  let resolved = { ...filters };
  // key -> [table, IN_SECONDARY predicate, canonical column, expand aliases?]
  const mapped = [
    ["region", REGION_MAPPING, "IN_SECONDARY = 1", "REGION_NAME", false],
    ["cat", CATEGORY_MAPPING, "IN_SECONDARY = 1", "CATEGORY_NAME", true],
    ["brand", BRAND_MAPPING, "IN_SECONDARY = 1", "BRAND_NAME", true],
  ];
  const canonicalCache = {};
  async function getCanonicalSet(key, table, canonicalCol) {
    if (canonicalCache[key]) return canonicalCache[key];
    const rows = await query(
      `SELECT ${canonicalCol} AS V FROM ${table} WHERE ${canonicalCol} IS NOT NULL`
    );
    canonicalCache[key] = new Set(
      rows.map((r) => String(r.V).trim().toUpperCase()).filter(Boolean)
    );
    return canonicalCache[key];
  }

  for (const [key, table, predicate, canonicalCol, useAliases] of mapped) {
    const values = resolved[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    const selected = values.map((value) => String(value).trim().toUpperCase());
    const rows = await query(
      `SELECT * FROM ${table}
       WHERE ${predicate}
         AND UPPER(TRIM(${canonicalCol})) IN (${selected.map(() => "?").join(", ")})`,
      selected
    );
    if (rows.length === 0) {
      // No mapping row satisfies the user's value AND `IN_SECONDARY = 1`
      // (e.g. `Ono` brand, where `IN_SECONDARY = 0`). We must not drop the
      // filter — that would silently expose ALL secondary rows as if they
      // belonged to the user's selection. Instead pin the filter to a
      // sentinel string that no fact-table value can equal, so this side
      // legitimately contributes zero rows.
      resolved[key] = ["__NO_MATCH_ON_SECONDARY__"];
      continue;
    }
    const expanded = new Set(selected);
    // Collision guard: only needed for the aliased dimensions; fetched
    // lazily so unfiltered / region-only requests pay nothing.
    const otherCanonicals = useAliases
      ? await getCanonicalSet(key, table, canonicalCol)
      : null;
    for (const row of rows) {
      const canonical = String(row[canonicalCol] || "").trim().toUpperCase();
      if (canonical) expanded.add(canonical);
      if (useAliases) {
        const raw = row.SALESFLO_ALIASES;
        if (raw != null && String(raw).trim() !== "") {
          for (const piece of String(raw).split("/")) {
            const alias = piece.trim().toUpperCase();
            if (!alias) continue;
            // Skip aliases that are canonical names of a DIFFERENT row —
            // those have their own mapping and would otherwise double-count
            // between two canonical categories/brands. Always allow the
            // row's own canonical (self-alias).
            if (alias !== canonical && otherCanonicals.has(alias)) continue;
            expanded.add(alias);
          }
        }
      }
    }
    resolved[key] = [...expanded];
  }
  // if (Array.isArray(resolved.dist) && resolved.dist.length > 0) {
  //   const selected = resolved.dist.map((value) => String(value).trim().toUpperCase());
  //   const bindListPlaceholders = selected.map(() => "?").join(", ");
  //   const rows = await query(
  //    `SELECT DISTINCT SAP_CODE AS V FROM ${DIST_FILTER}
  //      WHERE (UPPER(TRIM(SAP_CODE))       IN (${bindListPlaceholders})
  //          OR UPPER(TRIM(SAP_NAME))       IN (${bindListPlaceholders})
  //          OR UPPER(TRIM(SALESFLO_CODE))  IN (${bindListPlaceholders})
  //          OR UPPER(TRIM(SALESFLO_NAME))  IN (${bindListPlaceholders}))
  //        AND SAP_CODE IS NOT NULL`,
  //     [...selected, ...selected, ...selected, ...selected]
  //   );
//     resolved.dist = rows.length ? rows.map((row) => row.V) : ["__NO_MATCH_ON_SECONDARY__"];
//   }
//   return resolved;
// }
  if (Array.isArray(resolved.dist) && resolved.dist.length > 0) {
    const selected = resolved.dist.map((value) => String(value).trim().toUpperCase());
    const bindListPlaceholders = selected.map(() => "?").join(", ");
    // SEC dump (SALESFLO_DATADUMP_VW.DISTRIBUTOR_CODE_RD) stores distributor
    // identifiers in TWO formats: ~321 codes as SAP-style and ~90 as
    // Salesflo-style. The dropdown ships SAP_CODE. Returning only SAP_CODE
    // here (as the pre-fix version did) missed the Salesflo-form rows for any
    // SAP_CODE whose SEC rows are stored under a Salesflo child code —
    // producing a "primary-top-up-only" total on the dashboard.
    // The UNION below returns BOTH identifiers for every matched mapping row
    // so `DISTRIBUTOR_CODE_RD IN (?)` can hit either format.
//     const rows = await query(
//       `SELECT DISTINCT UPPER(TRIM(SAP_CODE)) AS V FROM ${DIST_FILTER}
//         WHERE (UPPER(TRIM(SAP_CODE))       IN (${bindListPlaceholders})
//             OR UPPER(TRIM(SAP_NAME))       IN (${bindListPlaceholders})
//             OR UPPER(TRIM(SALESFLO_CODE))  IN (${bindListPlaceholders})
//             OR UPPER(TRIM(SALESFLO_NAME))  IN (${bindListPlaceholders}))
//           AND SAP_CODE IS NOT NULL
//        UNION
//        SELECT DISTINCT UPPER(TRIM(SALESFLO_CODE)) AS V FROM ${DIST_FILTER}
//         WHERE (UPPER(TRIM(SAP_CODE))       IN (${bindListPlaceholders})
//             OR UPPER(TRIM(SAP_NAME))       IN (${bindListPlaceholders})
//             OR UPPER(TRIM(SALESFLO_CODE))  IN (${bindListPlaceholders})
//             OR UPPER(TRIM(SALESFLO_NAME))  IN (${bindListPlaceholders}))
//           AND SALESFLO_CODE IS NOT NULL`,
//       [...selected, ...selected, ...selected, ...selected,
//        ...selected, ...selected, ...selected, ...selected]
//     );
//     resolved.dist = rows.length ? rows.map((row) => row.V) : ["__NO_MATCH_ON_SECONDARY__"];
//   }
//   return resolved;
// }


const rows = await query(
      `SELECT DISTINCT UPPER(TRIM(SAP_CODE)) AS V FROM ${DIST_FILTER}
        WHERE (UPPER(TRIM(DISTRIBUTOR_NAME))       IN (${bindListPlaceholders})
           )
          AND SAP_CODE IS NOT NULL
       UNION
       SELECT DISTINCT UPPER(TRIM(SALESFLO_CODE)) AS V FROM ${DIST_FILTER}
        WHERE (UPPER(TRIM(DISTRIBUTOR_NAME))       IN (${bindListPlaceholders})
            )
          AND SALESFLO_CODE IS NOT NULL`,
      [...selected, ...selected, ...selected, ...selected,
       ...selected, ...selected, ...selected, ...selected]
    );
    resolved.dist = rows.length ? rows.map((row) => row.V) : ["__NO_MATCH_ON_SECONDARY__"];
  }
  return resolved;
} 

// Fiscal year/month buckets are pre-computed on the new primary fact.
const PRI_FY_EXPR = "p.FY_YEAR";
const PRI_MONTH_EXPR = "p.FY_MONTH_NAME";
const PRI_FISCAL_MONTH_NO_EXPR = "p.FY_MONTH_NO";
// Match against the pre-computed canonical FILTER_* columns. Category keeps
// a COALESCE fallback so rows missing FILTER_CATEGORY still bucket via
// MATERIAL_GROUP_NAME — same shape as the reference SQL.
const PRI_FILTER_COLUMNS = {
  region: ["UPPER(TRIM(COALESCE(p.FILTER_REGION,'')))"],
  cat: ["UPPER(TRIM(COALESCE(NULLIF(p.FILTER_CATEGORY,''), p.MATERIAL_GROUP_NAME, '')))"],
  brand: ["UPPER(TRIM(COALESCE(NULLIF(p.FILTER_BRAND,''), p.BRAND, '')))"],
  chType: ["UPPER(TRIM(COALESCE(p.FILTER_CHANNEL_TYPE,'')))"],
  town: ["UPPER(TRIM(COALESCE(p.FILTER_TOWN,'')))"],
  dist: ["UPPER(TRIM(p.PARTY_CODE))", "UPPER(TRIM(p.DIST_NAME))"],
};

function primaryFilterWhere(filters = {}) {
  const clauses = [];
  const binds = [];
  for (const [key, columns] of Object.entries(PRI_FILTER_COLUMNS)) {
    const values = filters[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    // Columns are UPPER(TRIM(...)); chType/town reach here in dropdown casing
    // (e.g. 'Affordable Range'), so uppercase every bind or the top-up is 0.
    const upper = values.map((value) => String(value).trim().toUpperCase());
    clauses.push(`(${columns.map((column) => `${column} IN (${upper.map(() => "?").join(", ")})`).join(" OR ")})`);
    for (const column of columns) binds.push(...upper);
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
    if (key === "appUser") {
      const appUserValues = Array.isArray(values) && values.length > 0 ? values : ["__EXCLUDE_SD__"];
      if (appUserValues.includes("__EXCLUDE_SD__")) {
        // COALESCE keeps untagged (NULL) rows; a bare `<> 'SD'` drops them.
        clauses.push("COALESCE(APP_USER_TAGGED_TITLE, '') <> 'SD'");
        continue;
      }
      const upperAppUser = appUserValues.map((value) => String(value).trim().toUpperCase());
      const perCol = cols.map((c) => `${c} IN (${upperAppUser.map(() => "?").join(", ")})`);
      clauses.push(cols.length > 1 ? `(${perCol.join(" OR ")})` : perCol[0]);
      for (const _c of cols) binds.push(...upperAppUser);
      continue;
    }
    if (!Array.isArray(values) || values.length === 0) continue;
    // Fact-side text columns for town / chType are uppercased in COLUMN_MAP;
    // uppercase the corresponding binds so case-sensitive Snowflake IN
    // comparisons still match (e.g. bind 'Peshawar' vs stored 'Peshawar' →
    // both uppercased to 'PESHAWAR'). Region / cat / brand / dist are already
    // uppercased upstream by resolveSecondaryFilters, so pass through as-is.
    const bindsForKey = ["chType", "town"].includes(key)
      ? values.map((value) => String(value).trim().toUpperCase())
      : values;
    const perCol = cols.map((c) => `${c} IN (${bindsForKey.map(() => "?").join(", ")})`);
    clauses.push(cols.length > 1 ? `(${perCol.join(" OR ")})` : perCol[0]);
    for (const _c of cols) binds.push(...bindsForKey);
  }
  return { clause: clauses.length ? "AND " + clauses.join(" AND ") : "", binds };
}

function inList(values) {
  return values.map(() => "?").join(", ");
}

// Primary top-up mirror of resolveSecondaryFilters: same new views, but
// `IN_PRIMARY = 1` predicate and NO alias expansion (the primary fact stores
// the canonical category/brand/region name directly).
async function resolvePrimaryTopupFilters(filters = {}) {
  let resolved = { ...filters };
  const mapped = [
    ["region", REGION_MAPPING, "IN_PRIMARY = 1", "REGION_NAME"],
    ["cat", CATEGORY_MAPPING, "IN_PRIMARY = 1", "CATEGORY_NAME"],
    ["brand", BRAND_MAPPING, "IN_PRIMARY = 1", "BRAND_NAME"],
  ];
  for (const [key, table, predicate, canonicalCol] of mapped) {
    const values = resolved[key];
    if (!Array.isArray(values) || values.length === 0) continue;
    const selected = values.map((value) => String(value).trim().toUpperCase());
    const rows = await query(
      `SELECT * FROM ${table}
       WHERE ${predicate}
         AND UPPER(TRIM(${canonicalCol})) IN (${selected.map(() => "?").join(", ")})`,
      selected
    );
    if (rows.length === 0) {
      // No mapping row satisfies the user's value AND `IN_PRIMARY = 1`
      // (e.g. `Toiletries`, where `IN_PRIMARY = 0`). Dropping the filter
      // would let the full month's primary top-up leak through, so the
      // Toiletries card was showing 33,233 CTN instead of the real 189.
      // Pin to a sentinel so the primary top-up query legitimately returns
      // zero for these secondary-only categories/regions/brands.
      resolved[key] = ["__NO_MATCH_ON_PRIMARY__"];
      continue;
    }
    const expanded = new Set(selected);
    for (const row of rows) {
      const canonical = String(row[canonicalCol] || "").trim().toUpperCase();
      if (canonical) expanded.add(canonical);
    }
    resolved[key] = [...expanded];
  }
  if (Array.isArray(resolved.dist) && resolved.dist.length > 0) {
    const selected = resolved.dist.map((value) => String(value).trim().toUpperCase());
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
    resolved.dist = rows.length ? rows.map((row) => row.V) : ["__NO_MATCH_ON_PRIMARY__"];
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
       SUM(CASE WHEN ${mtd.mtd} THEN p.VALUE END) AS MTD_SALES,
       SUM(CASE WHEN ${mtd.mtd} THEN p.QTY_IN_CTN END) AS MTD_CTN,
       SUM(CASE WHEN ${mtd.mtd} THEN p.QTY_IN_PCS END) AS MTD_PCS,
       SUM(CASE WHEN ${lyMtd.mtd} THEN p.VALUE END) AS LY_MTD_SALES,
       SUM(CASE WHEN ${fytd.fytd} THEN p.VALUE END) AS FYTD_SALES,
       SUM(CASE WHEN ${fytd.fytd} THEN p.QTY_IN_CTN END) AS FYTD_CTN,
       SUM(CASE WHEN ${fytd.fytd} THEN p.QTY_IN_PCS END) AS FYTD_PCS,
       SUM(CASE WHEN ${lyFytd.fytd} THEN p.VALUE END) AS LY_FYTD_SALES
     FROM ${PRI} p
       WHERE p.POSTING_DATE IS NOT NULL
         AND p.PRIMARY_EQ_SECONDARY = TRUE ${clause}`,
    [...mtd.mtdBinds, ...mtd.mtdBinds, ...mtd.mtdBinds, ...lyMtd.mtdBinds, ...fytd.fytdBinds, ...fytd.fytdBinds, ...fytd.fytdBinds, ...lyFytd.fytdBinds, ...binds]
  );
  return rows[0] || {};
}

async function getPrimaryTopupRows(filters, years, months, groupExpr, includeVolume = false) {
  const resolved = await resolvePrimaryTopupFilters(filters);
  const { clause, binds } = primaryFilterWhere(resolved);
  const period = primaryPeriodParts(years, months);
  const volume = includeVolume ? ", SUM(p.QTY_IN_CTN) AS VOLUME_CTN, SUM(p.QTY_IN_PCS) AS VOLUME_PCS" : "";
  const rows = await query(
    `SELECT ${groupExpr} AS LABEL, SUM(p.VALUE) AS NET_SALES${volume}
     FROM ${PRI} p
     WHERE p.POSTING_DATE IS NOT NULL
       AND p.PRIMARY_EQ_SECONDARY = TRUE
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
    `SELECT p.FILTER_REGION AS REGION,
            SUM(CASE WHEN ${mtd.mtd} THEN p.VALUE END) AS ACHIEVEMENT_MTD,
            SUM(CASE WHEN ${fytd.fytd} THEN p.VALUE END) AS ACHIEVEMENT_FYTD
     FROM ${PRI} p
     WHERE p.POSTING_DATE IS NOT NULL
       AND p.PRIMARY_EQ_SECONDARY = TRUE ${clause}
     GROUP BY p.FILTER_REGION`,
    [...mtd.mtdBinds, ...fytd.fytdBinds, ...binds]
  );
}

async function getPrimaryTopupMom(filters, fiscalYearStart) {
  const resolved = await resolvePrimaryTopupFilters(filters);
  const { clause, binds } = primaryFilterWhere(resolved);
  const fyEndExclusive = `${Number(fiscalYearStart.slice(0, 4)) + 1}-${fiscalYearStart.slice(5)}`;
  return query(
    `SELECT TO_CHAR(p.POSTING_DATE, 'Mon') AS MONTH,
            YEAR(p.POSTING_DATE) AS YEAR,
            SUM(p.VALUE) AS NET_SALES
     FROM ${PRI} p
     WHERE p.POSTING_DATE >= ? AND p.POSTING_DATE < ?
       AND p.PRIMARY_EQ_SECONDARY = TRUE ${clause}
     GROUP BY TO_CHAR(p.POSTING_DATE, 'Mon'), YEAR(p.POSTING_DATE)
     ORDER BY CASE TO_CHAR(p.POSTING_DATE, 'Mon')
       WHEN 'Jul' THEN 1 WHEN 'Aug' THEN 2 WHEN 'Sep' THEN 3 WHEN 'Oct' THEN 4
       WHEN 'Nov' THEN 5 WHEN 'Dec' THEN 6 WHEN 'Jan' THEN 7 WHEN 'Feb' THEN 8
       WHEN 'Mar' THEN 9 WHEN 'Apr' THEN 10 WHEN 'May' THEN 11 WHEN 'Jun' THEN 12
     END`,
    [fiscalYearStart, fyEndExclusive, ...binds]
  );
}

async function currentFiscal() {
  const rows = await query(
    `SELECT TO_VARCHAR(MAX(DATE), 'YYYY-MM-DD') AS MAXD FROM ${SEC} WHERE DATE IS NOT NULL`
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

  // MT-Direct exclusion is applied only to SUM aggregates (sales / volume) to
  // avoid double-counting with the primary top-up. COUNT DISTINCT stays
  // unfiltered so KPI #2 productive-stores/distributors keep counting every
  // secondary outlet/distributor, including MT-Direct.
  //
  // Implementation: LEFT JOIN the MT-Direct code list once, then use
  // `md.CODE IS NULL` inside the SUM CASE predicates. Snowflake does not
  // allow an uncorrelated `NOT IN (SELECT ... FROM ...)` subquery inside an
  // aggregate CASE expression — the join is a functionally equivalent form
  // that compiles correctly and is evaluated once per row.
  const sql = `
    SELECT
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND TO_CHAR(DATE, 'Mon') IN (${inList(mtdMonths)}) AND md.CODE IS NULL THEN NET_SALES END)  AS MTD_SALES,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND TO_CHAR(DATE, 'Mon') IN (${inList(mtdMonths)}) AND md.CODE IS NULL THEN SALES_CTN END)  AS MTD_CTN,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND TO_CHAR(DATE, 'Mon') IN (${inList(mtdMonths)}) AND md.CODE IS NULL THEN SALES_UNITS END) AS MTD_UNITS,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(lyYears)}) AND TO_CHAR(DATE, 'Mon') IN (${inList(mtdMonths)}) AND md.CODE IS NULL THEN NET_SALES END) AS LY_MTD_SALES,
      COUNT(DISTINCT CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND TO_CHAR(DATE, 'Mon') IN (${inList(mtdMonths)}) THEN TRIM(OUTLET_CODE) END)      AS MTD_STORES,
      COUNT(DISTINCT CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND TO_CHAR(DATE, 'Mon') IN (${inList(mtdMonths)}) THEN TRIM(DISTRIBUTOR_CODE) END) AS MTD_DIST,

      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? AND md.CODE IS NULL THEN NET_SALES END)  AS FYTD_SALES,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? AND md.CODE IS NULL THEN SALES_CTN END)  AS FYTD_CTN,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? AND md.CODE IS NULL THEN SALES_UNITS END) AS FYTD_UNITS,
      SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(lyYears)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? AND md.CODE IS NULL THEN NET_SALES END) AS LY_FYTD_SALES,
      COUNT(DISTINCT CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN TRIM(OUTLET_CODE) END)      AS FYTD_STORES,
      COUNT(DISTINCT CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN TRIM(DISTRIBUTOR_CODE) END) AS FYTD_DIST,

      COUNT(DISTINCT TRIM(OUTLET_CODE)) AS TOTAL_STORES
    FROM ${SEC} v
    LEFT JOIN (SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS CODE FROM ${MT_DIRECT}) md
      ON UPPER(TRIM(v.DIST_SAP_CODE)) = md.CODE
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
    WHERE DATE IS NOT NULL AND ${SEC_NON_MT_DIRECT} ${clause}
     GROUP BY ${dateExpr}
     ORDER BY ${dateExpr}`,
    binds
  );
  const years = periodFilters.year || [];
  const months = periodFilters.month || [];
  const topupRows = years.length && months.length
    ? await getPrimaryTopupRows(filters, years.map(Number), months, `TO_VARCHAR(${effectiveGranularity === "day" ? "p.POSTING_DATE" : `DATE_TRUNC('${effectiveGranularity}', p.POSTING_DATE)`}, 'YYYY-MM-DD')`)
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
    WHERE DATE IS NOT NULL AND ${SEC_NON_MT_DIRECT} ${clause} ${extraClause}
     GROUP BY ${col}
     ORDER BY NET_SALES DESC`,
    [...binds, ...extraBinds]
  );
  const periodFilters = await withDefaultPeriod(filters);
  const years = periodFilters.year || [];
  const months = periodFilters.month || [];
  const topupGroup =
    col === "COALESCE(NULLIF(FILTER_CATEGORY, ''), CATEGORY)" ? "COALESCE(NULLIF(p.FILTER_CATEGORY, ''), p.MATERIAL_GROUP_NAME)" :
    col === "COALESCE(NULLIF(FILTER_BRAND, ''), BRAND)" ? "COALESCE(NULLIF(p.FILTER_BRAND, ''), p.BRAND)" :
    col === "FILTER_REGION" ? "p.FILTER_REGION" :
    col === "FILTER_CHANNEL_TYPE" ? "COALESCE(NULLIF(p.FILTER_CHANNEL_TYPE,''), 'Unmapped')" :
    null;
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
const CHANNEL_LEVEL_COL = { chType: "FILTER_CHANNEL_TYPE", channel: "CHANNEL", subChannel: "SUB_CHANNEL" };
export async function getByChannelType({ filters = {}, level = "chType", channel } = {}) {
  return groupByOne(CHANNEL_LEVEL_COL[level], filters, channel ? { CHANNEL: channel } : {});
}

// Net sales by Category, with drill cat -> brand -> sku.
const CAT_LEVEL_COL = { cat: "COALESCE(NULLIF(FILTER_CATEGORY, ''), CATEGORY)", brand: "COALESCE(NULLIF(FILTER_BRAND, ''), BRAND)", sku: "MAPPED_PRODUCT_NAME" };
export async function getByCategorySecondary({ filters = {}, level = "cat" } = {}) {
  return groupByOne(CAT_LEVEL_COL[level], filters);
}

// Top brands by net sales, with drill brand -> sku.
const BRAND_LEVEL_COL = { brand: "COALESCE(NULLIF(FILTER_BRAND, ''), BRAND)", sku: "MAPPED_PRODUCT_NAME" };
export async function getByBrandSecondary({ filters = {}, level = "brand" } = {}) {
  return groupByOne(BRAND_LEVEL_COL[level], filters);
}

// Region-wise Achievement, with drill region -> town -> distributor.
const REGION_LEVEL_COL = { region: "FILTER_REGION", town: "FILTER_TOWN", dist: "DIST_NAME" };
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
//
// Targets are keyed on the SalesFlo distributor code, so they roll up on
// VW_DIM_DISTRIBUTOR_SALESFLO.REGION rather than DISTRIBUTOR_MASTER_VW's
// NEW_REGION — the latter spells some regions differently from the
// FILTER_REGION used by the achievement side (e.g. "South Nana Momse" vs
// "South Nana & Momse"), which split those regions into two rows.
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
      SELECT TRIM(t.DIST_CODE) AS DISTRIBUTOR_CODE, SUM(t.VALUE) AS TOTAL_TARGET
      FROM ${TARGETS} t
      WHERE ${clause}
      GROUP BY TRIM(t.DIST_CODE)
    )
    SELECT d.REGION AS REGION, SUM(ta.TOTAL_TARGET) AS TARGET
    FROM targets_agg ta
    JOIN ${DIST_SALESFLO} d ON d.SALESFLO_CODE = UPPER(TRIM(ta.DISTRIBUTOR_CODE))
    GROUP BY d.REGION
    `,
    binds
  );
  return rows;
}

export async function getRegionTargetVsAchievement({ years, months, filters = {} } = {}) {
  const period = await resolvePeriod(years, months);
  if (!period) return [];
  const { years: y, mtdMonths, fytdMonths } = period;
  const cutoffNo = Math.max(...fytdMonths.map((m) => FISCAL_MONTH_NO[m]));
  const targetFilters = { ...filters };
  for (const key of ["region", "cat", "brand", "chType", "town", "dist", "segment"]) {
    delete targetFilters[key];
  }
  const resolvedFilters = await resolveSecondaryFilters(targetFilters);
  const { clause, binds: filterBinds } = buildWhere(resolvedFilters, { skip: ["year", "month", "region", "cat", "brand", "chType", "town", "dist", "segment"] });

  const [mtdTargets, fytdTargets, achievementRows, topupRows] = await Promise.all([
    targetsByRegion(toCalendarPairs(y, mtdMonths)),
    targetsByRegion(toCalendarPairs(y, fytdMonths)),
    query(
      `SELECT FILTER_REGION AS REGION,
              SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND TO_CHAR(DATE, 'Mon') IN (${inList(mtdMonths)}) THEN NET_SALES END) AS ACHIEVEMENT_MTD,
              SUM(CASE WHEN ${FISCAL_YEAR_EXPR} IN (${inList(y)}) AND ${FISCAL_MONTH_NO_EXPR} <= ? THEN NET_SALES END) AS ACHIEVEMENT_FYTD
      FROM ${SEC}
      WHERE ${SEC_NON_MT_DIRECT} ${clause}
       GROUP BY FILTER_REGION`,
          [...y, ...mtdMonths, ...y, cutoffNo, ...filterBinds]
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

  // "Affordable Range" (any casing) is a product-range bucket that leaks into
  // the region columns, not a real region — keep it off this chart.
  return [...regions]
    .filter((region) => String(region ?? "").trim().toUpperCase() !== "AFFORDABLE RANGE")
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
    `SELECT TO_CHAR(DATE, 'Mon') AS MONTH, YEAR(DATE) AS YEAR, SUM(NET_SALES) AS NET_SALES
     FROM ${SEC}
    WHERE DATE >= ? AND DATE < ? AND ${SEC_NON_MT_DIRECT} ${clause}
     GROUP BY TO_CHAR(DATE, 'Mon'), YEAR(DATE)
     ORDER BY CASE TO_CHAR(DATE, 'Mon')
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
  const dims = { year: FISCAL_YEAR_EXPR, month: "TO_CHAR(DATE, 'Mon')", appUser: "APP_USER_TAGGED_TITLE" };
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


