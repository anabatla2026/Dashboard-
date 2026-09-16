import express from "express";
import {
  getPrimaryKpis,
  getPrimaryTrend,
  getPrimaryByCategory,
  getPrimaryByBrand,
  getPrimaryMonthOverMonth,
  getPrimaryDims,
  getPrimaryMeta,
} from "../../shared/primaryQueries.js";
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
  wrap((req) =>
    getPrimaryKpis({
      year: req.query.year ? Number(req.query.year) : undefined,
      month: req.query.month || undefined,
    })
  )
);

router.get("/trend", wrap((req) => getPrimaryTrend(parseFilters(req))));

router.get(
  "/category",
  wrap((req) => getPrimaryByCategory({ filters: parseFilters(req), level: req.query.level || "cat" }))
);

router.get(
  "/brand",
  wrap((req) => getPrimaryByBrand({ filters: parseFilters(req), level: req.query.level || "brand" }))
);

router.get(
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
