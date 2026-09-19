import { apiUrl } from "./api";

// Region/Category/Brand/Channel Type/Town/Distributor dropdown options.
// Year/Month/Segment/App User Tag still come from secondaryApi.dims()
// (see DataContext.jsx).
export async function fetchFilterOptions() {
  const res = await fetch(apiUrl("/api/filter-options"));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load filter options");
  return res.json();
}
