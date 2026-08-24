import { loadData } from "../shared/excelStore.js";

// On Vercel the data file only changes when you redeploy (it's bundled into
// the deployment, not watched on disk) — this just re-parses the bundled
// file, which is cheap and keeps the client's "Refresh" button working the
// same way it does against the local server.
export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { meta } = loadData({ force: true });
    res.status(200).json(meta);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
