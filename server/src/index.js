import express from "express";
import cors from "cors";
import compression from "compression";
import { loadData, watchData, getDataDir } from "./excelStore.js";

const app = express();
app.use(cors());
app.use(compression());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/meta", (req, res) => {
  try {
    const { meta } = loadData();
    res.json(meta);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.get("/api/records", (req, res) => {
  try {
    const { rows } = loadData();
    res.json(rows);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.post("/api/refresh", (req, res) => {
  try {
    const { meta } = loadData({ force: true });
    res.json(meta);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Secondary sales API listening on http://localhost:${PORT}`);
  console.log(`Watching for Excel files in: ${getDataDir()}`);
  try {
    const { meta } = loadData();
    console.log(`Initial data loaded: ${meta.sourceFile} (${meta.recordCount} rows)`);
  } catch (err) {
    console.warn("Warning:", err.message);
  }
  watchData((meta) => {
    console.log(`Data reloaded: ${meta.sourceFile} (${meta.recordCount} rows)`);
  });
});
