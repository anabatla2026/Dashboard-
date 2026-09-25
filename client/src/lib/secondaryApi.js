import { apiUrl } from "./api";

// Re-exported for existing imports (hooks/useServerAggregate.js etc.) —
// primaryApi.js imports it directly from lib/filtersToParam instead.
export { filtersToParam } from "./filtersToParam";

// Filter-carrying endpoints POST the filters object in the JSON body so the
// payload never lands in the URL. Small scalar parameters (level, channel,
// granularity, fiscalYearStart) stay in the query string because they are
// tiny and don't blow the header size cap.
async function post(path, { filters, ...query } = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    qs.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const q = qs.toString();
  const res = await fetch(apiUrl(`/api/secondary/${path}${q ? `?${q}` : ""}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters: filters || {} }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed to load ${path}`);
  return res.json();
}

// Filter-less endpoints (dims, meta) keep GET — nothing to serialize.
async function get(path) {
  const res = await fetch(apiUrl(`/api/secondary/${path}`));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed to load ${path}`);
  return res.json();
}

export const secondaryApi = {
  kpis: (filters) => post("kpis", { filters }),
  trend: (filters, granularity) => post("trend", { filters, granularity }),
  channelType: ({ filters, level, channel }) => post("channel-type", { filters, level, channel }),
  category: ({ filters, level }) => post("category", { filters, level }),
  brand: ({ filters, level }) => post("brand", { filters, level }),
  region: ({ filters, level }) => post("region", { filters, level }),
  regionTarget: (filters) => post("region-target", { filters }),
  // Region intentionally not passed — disabled on both Primary and
  // Secondary's MoM (region data has issues pending a proper mapping).
  mom: ({ fiscalYearStart, filters }) => post("mom", { fiscalYearStart, filters }),
  dims: () => get("dims"),
  meta: () => get("meta"),
};
