// The filterable dimensions the global filter bar exposes. Order here is
// display order — date/time facets first, then business dimensions.
export const DIMS = [
  { key: "year", label: "Year" },
  { key: "month", label: "Month" },
  { key: "date", label: "Date" },
  { key: "bu", label: "Business unit" },
  { key: "cat", label: "Category" },
  { key: "chType", label: "Channel type" },
  { key: "town", label: "Town" },
  { key: "dist", label: "Distributor" },
  { key: "orderFrom", label: "Order source" },
];

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
