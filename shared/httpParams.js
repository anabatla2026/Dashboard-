// Small query-param parsing helpers shared by the Express routes
// (server/src/secondaryRoutes.js) and the Vercel functions (api/secondary/*.js)
// so the two deployment targets stay in lockstep.

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
