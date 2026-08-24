import fs from "node:fs";
import chokidar from "chokidar";
import { loadData, getDataDir } from "../../shared/excelStore.js";

// Local-dev-only: watch the data/ folder so a newly dropped .xlsx is picked
// up without a restart. Not used in the Vercel deployment — there, the file
// is part of the deployment bundle and only changes on redeploy.
export function watchData(onChange) {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const watcher = chokidar.watch(dataDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });
  watcher.on("all", (event, filePath) => {
    if (!filePath.toLowerCase().endsWith(".xlsx")) return;
    try {
      const next = loadData({ force: true });
      onChange && onChange(next.meta);
    } catch (err) {
      console.error("Failed to reload Excel data:", err.message);
    }
  });
  return watcher;
}

export { loadData, getDataDir };
