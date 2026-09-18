import express from "express";
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
import { parseFilters as parseFiltersRaw } from "../../shared/httpParams.js";

const parseFilters = (req) => parseFiltersRaw(req.query);

function wrap(handler) {
  return async (req, res) => {
    try {
      res.json(await handler(req));
    } catch (err) {
      console.error(err);
      res.status(503).json({ error: err.message });
    }
  };
}

const router = express.Router();

router.get(
  "/kpis",
  wrap((req) => {
    const filters = parseFilters(req);
    return getSecondaryKpis({ years: filters.year, months: filters.month, filters });
  })
);

router.get("/trend", wrap((req) => getSecondaryTrend(parseFilters(req), req.query.granularity || "day")));

router.get(
  "/channel-type",
  wrap((req) =>
    getByChannelType({ filters: parseFilters(req), level: req.query.level || "chType", channel: req.query.channel })
  )
);

router.get(
  "/category",
  wrap((req) => getByCategorySecondary({ filters: parseFilters(req), level: req.query.level || "cat" }))
);

router.get(
  "/brand",
  wrap((req) => getByBrandSecondary({ filters: parseFilters(req), level: req.query.level || "brand" }))
);

router.get(
  "/region",
  wrap((req) => getRegionAchievement({ filters: parseFilters(req), level: req.query.level || "region" }))
);

router.get(
  "/region-target",
  wrap((req) =>
    getRegionTargetVsAchievement({
      year: req.query.year ? Number(req.query.year) : undefined,
      month: req.query.month || undefined,
    })
  )
);

router.get(
  "/mom",
  wrap((req) =>
    getMonthOverMonth({
      fiscalYearStart: req.query.fiscalYearStart,
      filters: parseFilters(req),
    })
  )
);

router.get("/dims", wrap(() => getSecondaryDims()));
router.get("/meta", wrap(() => getSecondaryMeta()));

export default router;
