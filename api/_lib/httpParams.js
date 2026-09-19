// Query-param parsing helpers shared by the Express routes (server/) and
// the Vercel functions (api/).

export function parseFilters(query) {
  if (!query.filters) return {};
  try {
    return JSON.parse(query.filters);
  } catch {
    return {};
  }
}

export function parseArray(param) {
  if (!param) return undefined;
  try {
    const v = JSON.parse(param);
    return Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
