import { apiUrl } from "./api";

// Re-exported for existing imports (hooks/useServerAggregate.js etc.) —
// primaryApi.js imports it directly from lib/filtersToParam instead.
export { filtersToParam } from "./filtersToParam";

async function get(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    qs.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const query = qs.toString();
  const res = await fetch(apiUrl(`/api/secondary/${path}${query ? `?${query}` : ""}`));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed to load ${path}`);
  return res.json();
}

export const secondaryApi = {
  kpis: (filters) => get("kpis", { filters }),
  trend: (filters) => get("trend", { filters }),
  channelType: ({ filters, level, channel }) => get("channel-type", { filters, level, channel }),
  category: ({ filters, level }) => get("category", { filters, level }),
  brand: ({ filters, level }) => get("brand", { filters, level }),
  region: ({ filters, level }) => get("region", { filters, level }),
  regionTarget: ({ year, month }) => get("region-target", { year, month }),
  // Region intentionally not passed — disabled on both Primary and
  // Secondary's MoM per the DE (2026-09-16): region data has issues pending
  // a proper mapping. See shared/secondaryQueries.js's getMonthOverMonth.
  mom: ({ fiscalYearStart, filters }) => get("mom", { fiscalYearStart, filters }),
  dims: () => get("dims"),
  meta: () => get("meta"),
};
