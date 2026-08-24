import { loadData } from "../shared/excelStore.js";

export default function handler(req, res) {
  try {
    const { rows } = loadData();
    res.status(200).json(rows);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
