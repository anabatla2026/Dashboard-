import { loadData } from "../shared/excelStore.js";

export default function handler(req, res) {
  try {
    const { meta } = loadData();
    res.status(200).json(meta);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
