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
import { parseFilters } from "../_lib/httpParams.js";

export default async function handler(req, res) {
  const { action } = req.query;
  try {
    let data;
    switch (action) {
      case "kpis": {
        const filters = parseFilters(req.query);
        data = await getSecondaryKpis({ years: filters.year, months: filters.month, filters });
        break;
      }
      case "trend":
        data = await getSecondaryTrend(parseFilters(req.query), req.query.granularity || "day");
        break;
      case "channel-type":
        data = await getByChannelType({
          filters: parseFilters(req.query),
          level: req.query.level || "chType",
          channel: req.query.channel,
        });
        break;
      case "category":
        data = await getByCategorySecondary({ filters: parseFilters(req.query), level: req.query.level || "cat" });
        break;
      case "brand":
        data = await getByBrandSecondary({ filters: parseFilters(req.query), level: req.query.level || "brand" });
        break;
      case "region":
        data = await getRegionAchievement({ filters: parseFilters(req.query), level: req.query.level || "region" });
        break;
      case "region-target": {
        const filters = parseFilters(req.query);
        data = await getRegionTargetVsAchievement({ years: filters.year, months: filters.month });
        break;
      }
      case "mom":
        data = await getMonthOverMonth({
          fiscalYearStart: req.query.fiscalYearStart,
          filters: parseFilters(req.query),
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
    // hello
    res.status(200).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
