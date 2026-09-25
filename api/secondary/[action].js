// Single dynamic-route handler for all Secondary endpoints — see
// api/primary/[action].js for why.
import {
  getSecondaryKpis,
  getSecondaryTrend,
  getByChannelType,
  getByCategorySecondary,
  getByBrandSecondary,
  getRegionAchievement,
  getRegionTargetVsAchievement,
  getMonthOverMonth,
  getSecondaryDims,
  getSecondaryMeta,
} from "../_lib/secondaryQueries.js";
// Filter-carrying endpoints (kpis, trend, channel-type, category, brand,
// region, region-target, mom) now receive `filters` in the JSON body — see
// client/src/lib/secondaryApi.js. Small scalars (level, channel, granularity,
// fiscalYearStart) still travel in the query string. dims/meta remain plain
// GETs with no filters. Vercel parses application/json bodies automatically.
function getFilters(req) {
  const raw = req.body && typeof req.body === "object" ? req.body.filters : null;
  return raw && typeof raw === "object" ? raw : {};
}

export default async function handler(req, res) {
  const { action } = req.query;
  try {
    let data;
    switch (action) {
      case "kpis": {
        const filters = getFilters(req);
        data = await getSecondaryKpis({ years: filters.year, months: filters.month, filters });
        break;
      }
      case "trend":
        data = await getSecondaryTrend(getFilters(req), req.query.granularity || "day");
        break;
      case "channel-type":
        data = await getByChannelType({
          filters: getFilters(req),
          level: req.query.level || "chType",
          channel: req.query.channel,
        });
        break;
      case "category":
        data = await getByCategorySecondary({ filters: getFilters(req), level: req.query.level || "cat" });
        break;
      case "brand":
        data = await getByBrandSecondary({ filters: getFilters(req), level: req.query.level || "brand" });
        break;
      case "region":
        data = await getRegionAchievement({ filters: getFilters(req), level: req.query.level || "region" });
        break;
      case "region-target": {
        const filters = getFilters(req);
        data = await getRegionTargetVsAchievement({ years: filters.year, months: filters.month, filters });
        break;
      }
      case "mom":
        data = await getMonthOverMonth({
          fiscalYearStart: req.query.fiscalYearStart,
          filters: getFilters(req),
        });
        break;
      case "dims":
        data = await getSecondaryDims();
        break;
      case "meta":
        data = await getSecondaryMeta();
        break;
      default:
        res.status(404).json({ error: `Unknown secondary action: ${action}` });
        return;
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
