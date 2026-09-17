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

// Primary (GOLD.ZFI_SCO_VW) only recognizes year/month/cat/brand/town (see
// shared/primaryQueries.js's COLUMN_EXPR) — its own buildWhere already
// ignores any other key, so this isn't required for correctness, but every
// primary fetch should pass through it anyway: it stops App User Tag,
// Region, Segment, Channel Type, and Distributor changes (all
// Secondary-only concepts) from triggering pointless primary re-fetches,
// and makes it explicit/obvious that those never apply to Primary.
const PRIMARY_FILTER_KEYS = ["year", "month", "cat", "brand", "town"];
export function pickPrimaryFilters(filters) {
  const out = {};
  for (const key of PRIMARY_FILTER_KEYS) {
    if (filters?.[key]) out[key] = filters[key];
  }
  return out;
}
