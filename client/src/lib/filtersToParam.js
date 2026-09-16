// Converts the filters state (dim key -> Set of selected values) into the
// array-shaped object the server's buildWhere() expects, dropping empty
// sets so unfiltered dimensions don't add a no-op query param. Shared by
// both primaryApi and secondaryApi — primary's server-side buildWhere
// simply ignores dims it doesn't recognize (chType, region, appUser, ...),
// so the same filters object can be sent to both without filtering it down
// on the client first.
export function filtersToParam(filters) {
  const out = {};
  for (const [key, set] of Object.entries(filters || {})) {
    if (set && set.size > 0) out[key] = [...set];
  }
  return out;
}
