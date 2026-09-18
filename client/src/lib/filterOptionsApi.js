import { apiUrl } from "./api";

// Region/Category/Brand/Channel Type/Town/Distributor dropdown options,
// sourced from the DE's GOLD.*_MAPPING_1ST_DASH reference views (see
// shared/filterOptions.js) rather than either fact table's own distinct
// values. Year/Month/Segment/App User Tag still come from
// secondaryApi.dims() (see DataContext.jsx) — the DE's rules don't cover
// those.
export async function fetchFilterOptions() {
  const res = await fetch(apiUrl("/api/filter-options"));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load filter options");
  return res.json();
}
