import { loadData } from "../shared/excelStore.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { primary, secondary } = await loadData({ force: true });
    res.status(200).json({ primary: primary.meta, secondary: secondary.meta });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
