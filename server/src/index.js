import express from "express";
import cors from "cors";
import compression from "compression";
import secondaryRoutes from "./secondaryRoutes.js";
import primaryRoutes from "./primaryRoutes.js";
import { getFilterOptions } from "../../api/_lib/filterOptions.js";

const app = express();
app.use(cors());
app.use(compression());
// Filter-carrying endpoints POST the filters object in the JSON body — see
// api/secondary/[action].js. A generous limit keeps room for the current
// ~40 KB "Select all" case with headroom for growth.
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/filter-options", async (req, res) => {
  try {
    res.json(await getFilterOptions());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.use("/api/secondary", secondaryRoutes);
app.use("/api/primary", primaryRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Sales dashboard API listening on http://localhost:${PORT}`);
  console.log(`Primary and Secondary sales both read live from Snowflake — see api/_lib/primaryQueries.js and api/_lib/secondaryQueries.js.`);
});
