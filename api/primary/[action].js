// Single dynamic-route handler for all Primary endpoints (Vercel's Hobby
// plan caps deployments at 12 functions, so one file per action isn't an
// option). Vercel maps /api/primary/:action to the `action` param below.
import {
  getPrimaryKpis,
  getPrimaryTrend,
  getPrimaryByCategory,
  getPrimaryByBrand,
  getPrimaryMonthOverMonth,
  getPrimaryDims,
  getPrimaryMeta,
} from "../_lib/primaryQueries.js";
import { parseFilters } from "../_lib/httpParams.js";

export default async function handler(req, res) {
  const { action } = req.query;
  try {
    let data;
    switch (action) {
      case "kpis": {
        const filters = parseFilters(req.query);
        data = await getPrimaryKpis({ years: filters.year, months: filters.month, filters });
        break;
      }
      case "trend":
        data = await getPrimaryTrend(parseFilters(req.query), req.query.granularity || "day");
        break;
      case "category":
        data = await getPrimaryByCategory({ filters: parseFilters(req.query), level: req.query.level || "cat" });
        break;
      case "brand":
        data = await getPrimaryByBrand({ filters: parseFilters(req.query), level: req.query.level || "brand" });
        break;
      case "mom":
        data = await getPrimaryMonthOverMonth({
          fiscalYearStart: req.query.fiscalYearStart,
          filters: parseFilters(req.query),
        });
        break;
      case "dims":
        data = await getPrimaryDims();
        break;
      case "meta":
        data = await getPrimaryMeta();
        break;
      default:
        res.status(404).json({ error: `Unknown primary action: ${action}` });
        return;
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
