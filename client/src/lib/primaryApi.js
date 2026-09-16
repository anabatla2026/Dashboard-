import { apiUrl } from "./api";

async function get(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    qs.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const query = qs.toString();
  const res = await fetch(apiUrl(`/api/primary/${path}${query ? `?${query}` : ""}`));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed to load ${path}`);
  return res.json();
}

export const primaryApi = {
  kpis: ({ year, month }) => get("kpis", { year, month }),
  trend: (filters) => get("trend", { filters }),
  category: ({ filters, level }) => get("category", { filters, level }),
  brand: ({ filters, level }) => get("brand", { filters, level }),
  mom: ({ fiscalYearStart, filters }) => get("mom", { fiscalYearStart, filters }),
  dims: () => get("dims"),
  meta: () => get("meta"),
};
