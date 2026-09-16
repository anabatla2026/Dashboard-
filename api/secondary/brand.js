import { getByBrandSecondary } from "../../shared/secondaryQueries.js";
import { parseFilters } from "../../shared/httpParams.js";

export default async function handler(req, res) {
  try {
    const data = await getByBrandSecondary({
      filters: parseFilters(req.query),
      level: req.query.level || "brand",
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
