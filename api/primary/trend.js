import { getPrimaryTrend } from "../../shared/primaryQueries.js";
import { parseFilters } from "../../shared/httpParams.js";

export default async function handler(req, res) {
  try {
    res.status(200).json(await getPrimaryTrend(parseFilters(req.query)));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
