import { getSecondaryKpis } from "../../shared/secondaryQueries.js";
import { parseArray } from "../../shared/httpParams.js";

export default async function handler(req, res) {
  try {
    const data = await getSecondaryKpis({
      year: req.query.year ? Number(req.query.year) : undefined,
      month: req.query.month || undefined,
      appUser: parseArray(req.query.appUser),
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
