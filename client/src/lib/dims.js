// The filterable dimensions the global filter bar exposes. Order here is
// display order — date/time facets first, then business dimensions.
// Baseline is the signed-off design doc (TNX.DWH.AnaBatla.SO.01 §3.1):
// Year, Month, Region, Town, Channel Type, Category, Distributor. Segment
// and Brand were added per the 2026-09-02 MOM §2 (both requested new).
// appUser (App User Tagged Title) is a later addition: a checkbox filter
// used to exclude the "SD" tag from secondary sales by default.
export const DIMS = [
  { key: "year",    label: "Year" },
  { key: "month",   label: "Month" },
  { key: "region",  label: "Region" },
  { key: "segment", label: "Segment" },
  { key: "cat",     label: "Category" },
  { key: "brand",   label: "Brand" },
  { key: "chType",  label: "Channel type" },
  { key: "town",    label: "Town" },
  { key: "dist",    label: "Distributor" },
  { key: "appUser", label: "App User Tag" },
];

// dim key -> true for every dimension a chart can drill into by clicking a
// mark (i.e. it's also a real global filter, so clicking can scope the
// whole dashboard to that one value).
export const DRILLABLE = new Set(DIMS.map((d) => d.key));

export function emptyFilters() {
  return Object.fromEntries(DIMS.map((d) => [d.key, new Set()]));
}

export function activeFilterCount(filters) {
  return DIMS.reduce((sum, d) => sum + (filters[d.key]?.size || 0), 0);
}

export function applyFilters(rows, filters) {
  const active = DIMS.filter((d) => filters[d.key] && filters[d.key].size > 0);
  if (active.length === 0) return rows;
  return rows.filter((r) => active.every((d) => filters[d.key].has(r[d.key])));
}
