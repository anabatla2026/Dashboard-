// Vercel's Hobby plan caps a deployment at 12 serverless functions — one
// file per endpoint (7 for primary, 10 for secondary) blew past that. This
// single dynamic-route file replaces all 7 primary/*.js files; the URL
// shape the client already calls (/api/primary/kpis, /api/primary/trend,
// ...) is unchanged since Vercel maps /api/primary/:action to this file's
// `action` param automatically.
import {
  getPrimaryKpis,
  getPrimaryTrend,
  getPrimaryByCategory,
  getPrimaryByBrand,
  getPrimaryMonthOverMonth,
  getPrimaryDims,
  getPrimaryMeta,
} from "../../shared/primaryQueries.js";
import { parseFilters } from "../../shared/httpParams.js";

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
        data = await getPrimaryTrend(parseFilters(req.query));
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
