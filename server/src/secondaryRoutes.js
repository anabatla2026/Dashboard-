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
} from "../../api/_lib/secondaryQueries.js";
// Filter-carrying endpoints receive `filters` in the JSON body (see
// client/src/lib/secondaryApi.js). Small scalars stay in req.query. dims/meta
// remain GETs.
const parseFilters = (req) => (req.body && typeof req.body === "object" && req.body.filters && typeof req.body.filters === "object" ? req.body.filters : {});

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

router.post(
  "/kpis",
  wrap((req) => {
    const filters = parseFilters(req);
    return getSecondaryKpis({ years: filters.year, months: filters.month, filters });
  })
);

router.post("/trend", wrap((req) => getSecondaryTrend(parseFilters(req), req.query.granularity || "day")));

router.post(
  "/channel-type",
  wrap((req) =>
    getByChannelType({ filters: parseFilters(req), level: req.query.level || "chType", channel: req.query.channel })
  )
);

router.post(
  "/category",
  wrap((req) => getByCategorySecondary({ filters: parseFilters(req), level: req.query.level || "cat" }))
);

router.post(
  "/brand",
  wrap((req) => getByBrandSecondary({ filters: parseFilters(req), level: req.query.level || "brand" }))
);

router.post(
  "/region",
  wrap((req) => getRegionAchievement({ filters: parseFilters(req), level: req.query.level || "region" }))
);

router.post(
  "/region-target",
  wrap((req) => {
    const filters = parseFilters(req);
    return getRegionTargetVsAchievement({ years: filters.year, months: filters.month, filters });
  })
);

router.post(
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
