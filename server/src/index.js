import express from "express";
import cors from "cors";
import compression from "compression";
import secondaryRoutes from "./secondaryRoutes.js";
import primaryRoutes from "./primaryRoutes.js";

const app = express();
app.use(cors());
app.use(compression());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/secondary", secondaryRoutes);
app.use("/api/primary", primaryRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Sales dashboard API listening on http://localhost:${PORT}`);
  console.log(`Primary and Secondary sales both read live from Snowflake — see shared/primaryQueries.js and shared/secondaryQueries.js.`);
});
