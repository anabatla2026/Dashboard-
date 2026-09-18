// Dropdown option lists for the global filter bar's mapped dimensions
// (Region, Category, Brand, Channel Type, Town, Distributor), sourced from
// the DE's GOLD.*_MAPPING_1ST_DASH / GOLD.VW_DISTRIBUTOR_FILTER_1ST_DASH
// reference views (supplied 2026-09-17) instead of each fact table's own
// distinct raw values. Per the DE's rule:
//   Region       -> dropdown shows REGION_NAME,         backend gets REGION_CODE
//   Category     -> dropdown shows CATEGORY_NAME,       backend gets CATEGORY_CODE
//   Brand        -> dropdown and backend both use BRAND (single column, no split)
//   Channel Type -> dropdown and backend both use CHANNEL_TYPE (Secondary only)
//   Town         -> dropdown and backend both use TOWN_NAME (Secondary only)
//   Distributor  -> dropdown shows DISTRIBUTOR_SAP_NAME, backend gets a code that
//                    differs per source (see shared/primaryQueries.js and
//                    shared/secondaryQueries.js) — this module hands back
//                    DISTRIBUTOR_CODE as the transmitted `value` since it's the
//                    one stable, always-populated identifier per distributor;
//                    primary resolves it to a SAP code server-side before
//                    querying (see resolveDistToSapCodes in primaryQueries.js).
//
// Year/Month/Segment/App User Tag are NOT covered by the DE's new mapping
// views and keep coming from getPrimaryDims/getSecondaryDims as before.
import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

const DB = SNOWFLAKE_DATABASE;

// Several mapping-view columns carry stray whitespace (e.g. a tab-prefixed
// DISTRIBUTOR_CODE seen in the live data) — trim before dedup so those
// don't slip in as distinct near-duplicate options.
function clean(v) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
}

function toOptions(rows, valueKey, labelKey) {
  const seen = new Set();
  const options = [];
  for (const r of rows) {
    const value = clean(r[valueKey]);
    const label = clean(r[labelKey]);
    if (value == null || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: label ?? value });
  }
  options.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  return options;
}

export async function getFilterOptions() {
  const [regionRows, categoryRows, brandRows, channelRows, townRows, distRows] = await Promise.all([
    query(`SELECT DISTINCT REGION_CODE, REGION_NAME FROM ${DB}.GOLD.VW_REGION_MAPPING_1ST_DASH
           WHERE REGION_CODE IS NOT NULL`),
    query(`SELECT DISTINCT CATEGORY_CODE, CATEGORY_NAME FROM ${DB}.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
           WHERE CATEGORY_CODE IS NOT NULL`),
    query(`SELECT DISTINCT BRAND FROM ${DB}.GOLD.VW_BRAND_MAPPING_1st_DASH WHERE BRAND IS NOT NULL`),
    query(`SELECT DISTINCT CHANNEL_TYPE FROM ${DB}.GOLD.VW_CHANNEL_TYPE_MAPPING_1st_DASH
           WHERE CHANNEL_TYPE IS NOT NULL`),
    query(`SELECT DISTINCT TOWN_NAME FROM ${DB}.GOLD.VW_TOWN_MAPPING_1st_DASH WHERE TOWN_NAME IS NOT NULL`),
    query(`SELECT DISTINCT DISTRIBUTOR_CODE, DISTRIBUTOR_SAP_NAME FROM ${DB}.GOLD.VW_DISTRIBUTOR_FILTER_1ST_DASH
           WHERE DISTRIBUTOR_CODE IS NOT NULL`),
  ]);

  return {
    region: toOptions(regionRows, "REGION_CODE", "REGION_NAME"),
    cat: toOptions(categoryRows, "CATEGORY_CODE", "CATEGORY_NAME"),
    brand: toOptions(brandRows, "BRAND", "BRAND"),
    chType: toOptions(channelRows, "CHANNEL_TYPE", "CHANNEL_TYPE"),
    town: toOptions(townRows, "TOWN_NAME", "TOWN_NAME"),
    dist: toOptions(distRows, "DISTRIBUTOR_CODE", "DISTRIBUTOR_SAP_NAME"),
  };
}
