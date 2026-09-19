// Dropdown option lists for the global filter bar's mapped dimensions
// (Region, Category, Brand, Channel Type, Town, Distributor), sourced from
// GOLD.*_MAPPING_1ST_DASH / GOLD.VW_DISTRIBUTOR_FILTER_1ST_DASH reference
// views. Distributor transmits DISTRIBUTOR_CODE as its `value` — Primary
// resolves that to a SAP code server-side (see resolveDistToSapCodes in
// primaryQueries.js). Year/Month/Segment/App User Tag come from
// getPrimaryDims/getSecondaryDims instead.
import { query, SNOWFLAKE_DATABASE } from "./snowflakeClient.js";

const DB = SNOWFLAKE_DATABASE;

// Mapping-view columns can carry stray whitespace — trim before dedup.
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
