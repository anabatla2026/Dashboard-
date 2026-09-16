import { getMonthOverMonth } from "../../shared/secondaryQueries.js";
import { parseFilters } from "../../shared/httpParams.js";

export default async function handler(req, res) {
  try {
    const data = await getMonthOverMonth({
      fiscalYearStart: req.query.fiscalYearStart,
      filters: parseFilters(req.query),
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
