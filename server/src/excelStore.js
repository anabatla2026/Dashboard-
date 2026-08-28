import fs from "node:fs";
import chokidar from "chokidar";
import { loadData, getDataDir } from "../../shared/excelStore.js";

export function watchData(onChange) {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const watcher = chokidar.watch(dataDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });
  watcher.on("all", async (event, filePath) => {
    if (!filePath.toLowerCase().endsWith(".xlsx")) return;
    try {
      const next = await loadData({ force: true });
      onChange && onChange(next.meta || next.secondary?.meta || next.primary?.meta);
    } catch (err) {
      console.error("Failed to reload Excel data:", err.message);
    }
  });
  return watcher;
}

export { loadData, getDataDir };
