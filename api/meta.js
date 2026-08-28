import { loadData } from "../shared/excelStore.js";

export default async function handler(req, res) {
  try {
    const { primary, secondary } = await loadData();
    res.status(200).json({ primary: primary.meta, secondary: secondary.meta });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
