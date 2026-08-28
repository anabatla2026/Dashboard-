import express from "express";
import cors from "cors";
import compression from "compression";
import { loadData, watchData, getDataDir } from "./excelStore.js";

const app = express();
app.use(cors());
app.use(compression());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/meta", async (req, res) => {
  try {
    const { primary, secondary } = await loadData();
    res.json({ primary: primary.meta, secondary: secondary.meta });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.get("/api/records", async (req, res) => {
  try {
    const { primary, secondary } = await loadData();
    res.json({ primary: primary.rows, secondary: secondary.rows });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.post("/api/refresh", async (req, res) => {
  try {
    const { primary, secondary } = await loadData({ force: true });
    res.json({ primary: primary.meta, secondary: secondary.meta });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`Sales dashboard API listening on http://localhost:${PORT}`);
  console.log(`Watching for Excel files in: ${getDataDir()}`);
  try {
    const { primary, secondary } = await loadData();
    if (secondary.meta) console.log(`Secondary loaded: ${secondary.meta.sourceFile} (${secondary.meta.recordCount} rows)`);
    if (primary.meta) console.log(`Primary loaded: ${primary.meta.sourceFile} (${primary.meta.recordCount} rows)`);
  } catch (err) {
    console.warn("Warning:", err.message);
  }
  watchData((meta) => {
    console.log(`Data reloaded: ${meta.sourceFile} (${meta.recordCount} rows)`);
  });
});
