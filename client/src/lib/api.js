// In local dev, Vite's proxy forwards relative /api/* calls to the Express
// server (see vite.config.js), so the default empty base works. In a
// production build (e.g. the client deployed standalone on Vercel), there is
// no proxy — set VITE_API_URL to the server's real URL at build time.
const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "";

export function apiUrl(path) {
  return API_BASE + path;
}
