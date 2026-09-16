import { getPrimaryKpis } from "../../shared/primaryQueries.js";

export default async function handler(req, res) {
  try {
    const data = await getPrimaryKpis({
      year: req.query.year ? Number(req.query.year) : undefined,
      month: req.query.month || undefined,
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
