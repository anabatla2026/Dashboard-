// See api/primary/[action].js for why this is one dynamic-route file
// instead of one file per endpoint — Vercel's Hobby plan caps a deployment
// at 12 serverless functions. Replaces all 10 secondary/*.js files; URL
// shape the client calls (/api/secondary/kpis, /api/secondary/channel-type,
// ...) is unchanged.
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
} from "../../shared/secondaryQueries.js";
import { parseFilters } from "../../shared/httpParams.js";

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
        data = await getSecondaryTrend(parseFilters(req.query));
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
      case "region-target":
        data = await getRegionTargetVsAchievement({
          year: req.query.year ? Number(req.query.year) : undefined,
          month: req.query.month || undefined,
        });
        break;
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
    res.status(200).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}
