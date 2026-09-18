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

// Primary (GOLD.ZFI_SCO_VW) recognizes year/month/region/cat/brand/dist (see
// shared/primaryQueries.js's COLUMN_EXPR) — its own buildWhere already
// ignores any other key, so this isn't required for correctness, but every
// primary fetch should pass through it anyway: it stops Segment, Channel
// Type, Town, and App User Tag changes (all Secondary-only concepts) from
// triggering pointless primary re-fetches, and makes it explicit/obvious
// that those never apply to Primary. Per the DE's 2026-09-17 filter rules,
// Region and Distributor now apply to Primary too (they didn't before), and
// Town no longer does (it's Secondary-only going forward).
const PRIMARY_FILTER_KEYS = ["year", "month", "region", "cat", "brand", "dist"];
export function pickPrimaryFilters(filters) {
  const out = {};
  for (const key of PRIMARY_FILTER_KEYS) {
    if (filters?.[key]) out[key] = filters[key];
  }
  return out;
}
