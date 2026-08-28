// Pre-parses the Excel workbooks in data/ into data/prebuilt.json so the
// deployed serverless functions never have to run the (40s+) xlsx parse on a
// cold start. Runs as part of `vercel build`; see shared/excelStore.js.
import fs from "node:fs";
import path from "node:path";
import { loadData, getDataDir } from "../shared/excelStore.js";

const { primary, secondary } = await loadData({ force: true });
const outPath = path.join(getDataDir(), "prebuilt.json");
fs.writeFileSync(outPath, JSON.stringify({ primary, secondary }));

const sizeMb = (fs.statSync(outPath).size / 1e6).toFixed(1);
console.log(`Wrote prebuilt data cache: ${outPath} (${sizeMb} MB)`);
console.log(`  primary: ${primary.rows.length} rows, secondary: ${secondary.rows.length} rows`);
