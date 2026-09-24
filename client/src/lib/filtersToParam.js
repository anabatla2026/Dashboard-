// Converts the filters state (dim key -> Set of selected values) into the
// array-shaped object the server's buildWhere() expects, dropping empty
// sets so unfiltered dimensions don't add a no-op query param.
export function filtersToParam(filters) {
  const out = {};
  for (const [key, set] of Object.entries(filters || {})) {
    if (set && set.size > 0) out[key] = [...set];
  }
  return out;
}

// Primary recognizes year/month/region/cat/brand/chType/town/dist. Not
// required for correctness (the server ignores unknown keys anyway) but stops
// Segment and App User Tag changes from triggering pointless Primary re-fetches.
const PRIMARY_FILTER_KEYS = ["year", "month", "region", "cat", "brand", "chType", "town", "dist"];
export function pickPrimaryFilters(filters) {
  const out = {};
  for (const key of PRIMARY_FILTER_KEYS) {
    if (filters?.[key]) out[key] = filters[key];
  }
  return out;
}
