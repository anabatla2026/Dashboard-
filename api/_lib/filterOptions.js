// Dropdown option lists for the global filter bar's mapped dimensions
// (Region, Category, Brand, Channel Type, Town, Distributor), sourced from
// the new GOLD.VW_FILTER_* views. Distributor transmits SAP_CODE as its
// `value` (Primary and Secondary both resolve against SAP_CODE server-side).
// Year/Month/Segment/App User Tag come from getPrimaryDims/getSecondaryDims
// instead.
//
// The endpoint is shared between the Primary and Secondary dashboards, so
// flagged views scope by (IN_PRIMARY = 1 OR IN_SECONDARY = 1) — any option
// valid for either side is offered, and the resolvers' sentinel path
// returns 0 rows on the wrong side if a user drags a cross-side selection.
import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

const DB = SNOWFLAKE_DATABASE;

// Mapping-view columns can carry stray whitespace — trim before dedup.
function clean(v) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
}

// Case-insensitive dedup so that e.g. "Affordable Range" and "affordable
// Range" both collapse into a single dropdown entry (first-seen label wins).
function toOptions(rows, valueKey, labelKey) {
  const seen = new Set();
  const options = [];
  for (const r of rows) {
    const value = clean(r[valueKey]);
    const label = clean(r[labelKey]);
    if (value == null) continue;
    const dedupKey = value.toUpperCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    options.push({ value, label: label ?? value });
  }
  options.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  return options;
}

export async function getFilterOptions() {
  const [regionRows, categoryRows, brandRows, channelRows, townRows, distRows] = await Promise.all([
    query(`SELECT DISTINCT REGION_NAME FROM ${DB}.GOLD.VW_FILTER_REGION
           WHERE REGION_NAME IS NOT NULL
             AND (IN_PRIMARY = 1 OR IN_SECONDARY = 1)`),
    query(`SELECT DISTINCT CATEGORY_NAME FROM ${DB}.GOLD.VW_FILTER_CATEGORY
           WHERE CATEGORY_NAME IS NOT NULL
             AND (IN_PRIMARY = 1 OR IN_SECONDARY = 1)`),
    query(`SELECT DISTINCT BRAND_NAME FROM ${DB}.GOLD.VW_FILTER_BRAND
           WHERE BRAND_NAME IS NOT NULL
             AND (IN_PRIMARY = 1 OR IN_SECONDARY = 1)`),
    query(`SELECT DISTINCT CHANNEL_TYPE FROM ${DB}.GOLD.VW_FILTER_CHANNEL_TYPE
           WHERE CHANNEL_TYPE IS NOT NULL
             AND (IN_PRIMARY = 1 OR IN_SECONDARY = 1)`),
    query(`SELECT DISTINCT TOWN_NAME FROM ${DB}.GOLD.VW_FILTER_TOWN
           WHERE TOWN_NAME IS NOT NULL
             AND (IN_PRIMARY = 1 OR IN_SECONDARY = 1)`),
    // query(`SELECT DISTINCT SAP_CODE, SAP_NAME FROM ${DB}.GOLD.VW_FILTER_DISTRIBUTOR
    //        WHERE SAP_CODE IS NOT NULL`),
//  query(`
//   SELECT DISTINCT DISTRIBUTOR_NAME
//   FROM ${DB}.GOLD.VW_FILTER_DISTRIBUTOR
//   WHERE DISTRIBUTOR_NAME IS NOT NULL
//   ORDER BY DISTRIBUTOR_NAME
// `),

      query(`SELECT 
    DISTRIBUTOR_NAME,
    LISTAGG(SAP_CODE, ', ') WITHIN GROUP (ORDER BY SAP_CODE) AS SAP_CODES
FROM (
    SELECT DISTINCT UPPER(TRIM(SAP_CODE)) AS SAP_CODE, DISTRIBUTOR_NAME
  FROM ${DB}.GOLD.VW_FILTER_DISTRIBUTOR
    WHERE SAP_CODE IS NOT NULL AND DISTRIBUTOR_NAME IS NOT NULL
    UNION
    SELECT DISTINCT UPPER(TRIM(SALESFLO_CODE)) AS SAP_CODE, DISTRIBUTOR_NAME
    FROM ${DB}.GOLD.VW_FILTER_DISTRIBUTOR
    WHERE SALESFLO_CODE IS NOT NULL AND DISTRIBUTOR_NAME IS NOT NULL
)
GROUP BY DISTRIBUTOR_NAME;`),

  ]);

  return {
    region: toOptions(regionRows, "REGION_NAME", "REGION_NAME"),
    cat: toOptions(categoryRows, "CATEGORY_NAME", "CATEGORY_NAME"),
    brand: toOptions(brandRows, "BRAND_NAME", "BRAND_NAME"),
    chType: toOptions(channelRows, "CHANNEL_TYPE", "CHANNEL_TYPE"),
    town: toOptions(townRows, "TOWN_NAME", "TOWN_NAME"),
  dist: toOptions(distRows, "DISTRIBUTOR_NAME", "DISTRIBUTOR_NAME"),
  };
}
