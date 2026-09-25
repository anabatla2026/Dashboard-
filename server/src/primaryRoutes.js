import express from "express";
import {
  getPrimaryKpis,
  getPrimaryTrend,
  getPrimaryByCategory,
  getPrimaryByBrand,
  getPrimaryMonthOverMonth,
  getPrimaryDims,
  getPrimaryMeta,
} from "../../api/_lib/primaryQueries.js";
// Filter-carrying endpoints receive `filters` in the JSON body (see
// client/src/lib/primaryApi.js). Small scalars stay in req.query. dims/meta
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
    return getPrimaryKpis({ years: filters.year, months: filters.month, filters });
  })
);

router.post("/trend", wrap((req) => getPrimaryTrend(parseFilters(req), req.query.granularity || "day")));

router.post(
  "/category",
  wrap((req) => getPrimaryByCategory({ filters: parseFilters(req), level: req.query.level || "cat" }))
);

router.post(
  "/brand",
  wrap((req) => getPrimaryByBrand({ filters: parseFilters(req), level: req.query.level || "brand" }))
);

router.post(
  "/mom",
  wrap((req) =>
    getPrimaryMonthOverMonth({
      fiscalYearStart: req.query.fiscalYearStart,
      filters: parseFilters(req),
    })
  )
);

router.get("/dims", wrap(() => getPrimaryDims()));
router.get("/meta", wrap(() => getPrimaryMeta()));

export default router;
