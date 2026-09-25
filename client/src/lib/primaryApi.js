import { apiUrl } from "./api";

// Filter-carrying endpoints POST the filters object in the JSON body so the
// payload never lands in the URL. Small scalar parameters (level, granularity,
// fiscalYearStart) stay in the query string.
async function post(path, { filters, ...query } = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    qs.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const q = qs.toString();
  const res = await fetch(apiUrl(`/api/primary/${path}${q ? `?${q}` : ""}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters: filters || {} }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed to load ${path}`);
  return res.json();
}

// Filter-less endpoints (dims, meta) keep GET.
async function get(path) {
  const res = await fetch(apiUrl(`/api/primary/${path}`));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed to load ${path}`);
  return res.json();
}

export const primaryApi = {
  kpis: (filters) => post("kpis", { filters }),
  trend: (filters, granularity) => post("trend", { filters, granularity }),
  category: ({ filters, level }) => post("category", { filters, level }),
  brand: ({ filters, level }) => post("brand", { filters, level }),
  mom: ({ fiscalYearStart, filters }) => post("mom", { fiscalYearStart, filters }),
  dims: () => get("dims"),
  meta: () => get("meta"),
};
