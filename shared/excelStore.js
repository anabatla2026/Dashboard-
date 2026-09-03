import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import ExcelJS from "exceljs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(MODULE_DIR, "..", "data");

// ── Secondary (DTS export) ──────────────────────────────────────────────────
//
// Note: the SecondarySaleDataDump sheet has TWO columns both named "Channel".
// xlsx deduplicates them: col 0 "Channel" (shorthand: GT/MT/Export) stays as
// "Channel"; col 48 "Channel" (full name: General Trade/Modern Trade/…) becomes
// "Channel_1".  We use ExcelJS streaming so we handle the column mapping by
// index position instead.
//
// Column index to internal field (0-based, matching the actual spreadsheet):
//   0  = Channel        -> segment  (GT / MT / Export shorthand)
//   1  = Region         -> region
//  10  = Town Name      -> town
//  12  = Locality       -> locality
//  13  = Distributor Type -> distType
//  16  = Distributor Name -> dist
//  21  = Invoice Number -> invoice
//  37  = Outlet Code    -> outletCode
//  38  = Outlet Name    -> outlet
//  40  = Store Filer Type -> filerType
//  41  = Area Type      -> areaType
//  46  = Order Added From -> orderFrom
//  47  = Channel Type   -> chType
//  48  = Channel (full) -> channel
//  49  = Sub Channel    -> subChannel
//  51  = Business Unit  -> bu
//  52  = Category       -> cat
//  53  = Brand          -> brand
//  59  = SKU Name       -> sku
//  65  = Year           -> year
//  66  = Month          -> month
//  67  = Date           -> date
//  72  = Sales CTN      -> salesCtn
//  74  = Sales Units    -> units
//  75  = Volume (Tons)  -> volume
//  98  = Total Discount -> discount
// 101  = GST            -> gst
// 102  = Net Sales      -> netSales
// 103  = Gross Value In GST -> gross
//  26  = App User Tagged Title -> appUser
//  28  = Order Booker Name    -> booker

// Map: column index (0-based, matching sheet header row) -> internal field name
// Col 0 = "S.No #" (used for row validation only, not mapped)
// Col 1 = "Channel" (shorthand segment: GT/MT/Export)
// Col 2 = "Region"
const SEC_COL_INDEX_MAP = {
   1: "segment",   // Channel (GT / MT / Export)
   2: "region",
  10: "town",      // Town Name
  11: "locality",  // Locality
  13: "distType",  // Distributor Type
  16: "dist",      // Distributor Name
  21: "invoice",   // Invoice Number
  26: "appUser",   // App User Tagged Title
  28: "booker",    // Order Booker Name
  37: "outletCode",// Outlet Code
  38: "outlet",    // Outlet Name
  40: "filerType", // Store Filer Type
  41: "areaType",  // Area Type
  46: "orderFrom", // Order Added From
  47: "chType",    // Channel Type
  48: "channel",   // Channel (full name: General Trade / Modern Trade …)
  49: "subChannel",// Sub Channel
  51: "bu",        // Business Unit
  52: "cat",       // Category
  53: "brand",     // Brand
  59: "sku",       // SKU Name
  65: "year",      // Year
  66: "month",     // Month
  67: "date",      // Date
  72: "salesCtn",  // Sales CTN
  74: "units",     // Sales Units
  75: "volume",    // Volume (Tons)
  98: "discount",  // Total Discount
 101: "gst",       // GST
 102: "netSales",  // Net Sales
 103: "gross",     // Gross Value In GST
};

const SEC_NUMERIC_FIELDS = new Set(["year", "salesCtn", "units", "volume", "discount", "gst", "netSales", "gross"]);

const SEC_DIMENSIONS = [
  "segment", "region", "dist", "town", "distType", "chType", "channel",
  "subChannel", "bu", "cat", "brand", "orderFrom", "areaType", "filerType",
  "appUser", "year", "month", "date",
];

// ── Primary (SAP / factory export) ─────────────────────────────────────────

const PRI_COLS_MAP = {
  "Invoice No": "invoice",
  "Customer Group2 Name": "segment",
  "City": "town",
  "Material Group Name": "cat",
  "Brand": "brand",
  "Product Name": "sku",
  "QTY in PKT": "units",
  "Qty In Pcs": "pcs",
  "Qty In Ctn": "ctn",
  "Value": "netSales",
  "Total Value": "gross",
  // Ship-to party is the delivery point (store); Party is the billing
  // account (distributor). Named to match secondary's outletCode/dist so
  // the same distinct-count logic works across both sources — these are
  // each source's own internal identity, not reconciled with each other
  // (SAP vs SalesFlo distributor/store master data reconciliation is a
  // separate, not-yet-supplied mapping — see MOM 2026-09-02 §2).
  "Ship to party": "outletCode",
  "Ship to party Name": "outlet",
  "Party Code": "distCode",
  "Party Name": "dist",
  "Status": "status",
};

const PRI_NUMERIC_PRECISION = {
  units: 2, pcs: 0, ctn: 3, netSales: 2, gross: 2,
};

const PRI_DIMENSIONS = [
  "segment", "town", "cat", "brand", "year", "month",
];

// ── Shared ──────────────────────────────────────────────────────────────────

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function round(n, precision) {
  const f = Math.pow(10, precision);
  return Math.round((Number(n || 0) + Number.EPSILON) * f) / f;
}

function cleanBusinessUnit(v) {
  if (typeof v !== "string") return v;
  return v.replace(/\s*\[BU\d+\]\s*$/i, "").trim();
}

function cellValue(cell) {
  if (!cell) return null;
  if (cell.type === ExcelJS.ValueType.Date) return cell.value;
  if (cell.type === ExcelJS.ValueType.Formula) return cell.result ?? null;
  return cell.value ?? null;
}

// ── Secondary parser (streaming via ExcelJS) ────────────────────────────────

async function parseSecondaryWorkbook(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let minDate = null;
    let maxDate = null;

    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
      sharedStrings: "cache",
      hyperlinks: "ignore",
      styles: "ignore",
      worksheets: "emit",
    });

    workbookReader.on("worksheet", (worksheet) => {
      const sheetNameNorm = (worksheet.name || "").replace(/\s+/g, "").toLowerCase();
      if (sheetNameNorm !== "secondarysaledatadump") return;

      let isHeaderRow = true;
      worksheet.on("row", (row) => {
        // Skip header row (row 1)
        if (isHeaderRow) { isHeaderRow = false; return; }

        // S.No # is in column 1 (1-indexed)
        const sno = row.getCell(1).value;
        if (sno === null || sno === undefined || sno === "" || isNaN(Number(sno))) return;

        const out = {};
        for (const [colIdx, destKey] of Object.entries(SEC_COL_INDEX_MAP)) {
          const cell = row.getCell(Number(colIdx) + 1); // ExcelJS 1-indexed
          let v = cell.value;
          // Unwrap formula results
          if (v && typeof v === "object" && "result" in v) v = v.result;

          if (destKey === "bu") {
            v = cleanBusinessUnit(typeof v === "string" ? v : String(v || ""));
          } else if (SEC_NUMERIC_FIELDS.has(destKey)) {
            v = round(v, destKey === "volume" ? 5 : 2);
          }
          out[destKey] = v ?? null;
        }

        rows.push(out);

        const dRaw = out.date;
        const d = dRaw instanceof Date ? dRaw : typeof dRaw === "string" ? new Date(dRaw) : null;
        if (d && !isNaN(d)) {
          if (!minDate || d < minDate) minDate = d;
          if (!maxDate || d > maxDate) maxDate = d;
        }
      });
    });

    workbookReader.on("end", () => resolve({ rows, minDate, maxDate }));
    workbookReader.on("error", reject);
    workbookReader.read();
  });
}

// ── Primary parser (small file, sync xlsx is fine) ─────────────────────────

function parsePrimaryWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true, cellNF: false, cellHTML: false, cellText: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

  const rows = [];
  let minDate = null;
  let maxDate = null;

  for (const record of raw) {
    const trimmed = {};
    for (const k in record) trimmed[k.trim()] = record[k];

    const sno = trimmed["S. NO"];
    if (sno === null || sno === undefined || sno === "" || isNaN(Number(sno))) continue;

    const out = {};
    for (const [srcCol, destKey] of Object.entries(PRI_COLS_MAP)) {
      const v = trimmed[srcCol];
      out[destKey] = destKey in PRI_NUMERIC_PRECISION
        ? round(v, PRI_NUMERIC_PRECISION[destKey])
        : v;
    }

    const dRaw = trimmed["Posting Date"];
    const d = dRaw instanceof Date ? dRaw : typeof dRaw === "string" ? new Date(dRaw) : null;
    if (d && !isNaN(d)) {
      out.year = d.getFullYear();
      out.month = MONTH_SHORT[d.getMonth()];
      out.date = d.toISOString().slice(0, 10);
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    } else {
      out.year = null;
      out.month = null;
      out.date = null;
    }

    rows.push(out);
  }

  return { rows, minDate, maxDate };
}

// ── Meta builder ────────────────────────────────────────────────────────────

function buildMeta(rows, dimensions, sourceFile, mtimeMs, minDate, maxDate) {
  const dims = {};
  for (const key of dimensions) {
    let values = Array.from(new Set(rows.map((r) => r[key]))).filter(
      (v) => v !== null && v !== undefined && v !== ""
    );
    if (key === "month") {
      values.sort((a, b) => MONTH_SHORT.indexOf(a) - MONTH_SHORT.indexOf(b));
    } else if (key === "year" || key === "date") {
      values.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
    } else {
      values.sort((a, b) => String(a).localeCompare(String(b)));
    }
    dims[key] = values;
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.netSales += r.netSales || 0;
      acc.volume += r.volume || 0;
      acc.units += r.units || 0;
      acc.discount += r.discount || 0;
      acc.gst += r.gst || 0;
      return acc;
    },
    { netSales: 0, volume: 0, units: 0, discount: 0, gst: 0 }
  );

  return {
    sourceFile,
    lastModified: new Date(mtimeMs).toISOString(),
    recordCount: rows.length,
    invoiceCount: new Set(rows.map((r) => r.invoice)).size,
    outletCount: new Set(rows.map((r) => r.outletCode)).size,
    distributorCount: new Set(rows.map((r) => r.dist)).size,
    dateRange: {
      min: minDate ? minDate.toISOString().slice(0, 10) : null,
      max: maxDate ? maxDate.toISOString().slice(0, 10) : null,
    },
    dimensions: dims,
    totals,
  };
}

// ── File discovery ──────────────────────────────────────────────────────────

export function getDataDir() {
  return DATA_DIR;
}

function findExcelFiles() {
  if (!fs.existsSync(DATA_DIR)) return { primary: null, secondary: null };
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"))
    .map((f) => {
      const full = path.join(DATA_DIR, f);
      return { name: f, full, mtimeMs: fs.statSync(full).mtimeMs };
    });

  const primary   = files.find((f) => f.name.toLowerCase().includes("primary")) || null;
  const secondary =
    files.find((f) => f.name.toLowerCase().includes("secondary")) ||
    files.find((f) => f !== primary) ||
    null;

  return { primary, secondary };
}

// ── Cache & public loader (async) ───────────────────────────────────────────

let cache = null;
let loading = null; // in-flight Promise

// Serverless cold starts can't afford to re-parse a 50MB+ workbook on every
// invocation (no persistent disk, and parsing alone takes 40s+ — well past
// any Vercel function timeout). `scripts/build-data-cache.js` pre-parses the
// workbooks into this JSON file during `vercel build`; at runtime we just
// read+JSON.parse it, which is a fraction of a second. Local dev never has
// this file, so it always falls through to the live xlsx watch/parse flow.
function tryLoadPrebuilt() {
  const prebuiltPath = path.join(DATA_DIR, "prebuilt.json");
  if (!fs.existsSync(prebuiltPath)) return null;
  try {
    const { primary, secondary } = JSON.parse(fs.readFileSync(prebuiltPath, "utf8"));
    const mainSource = secondary.rows.length > 0 ? secondary : primary;
    return { cacheKey: "prebuilt", rows: mainSource.rows, meta: mainSource.meta, primary, secondary };
  } catch (err) {
    console.error("Failed to read prebuilt data cache:", err.message);
    return null;
  }
}

export async function loadData({ force = false } = {}) {
  if (!force) {
    if (cache) return cache;
    const prebuilt = tryLoadPrebuilt();
    if (prebuilt) {
      cache = prebuilt;
      return cache;
    }
  }

  const found = findExcelFiles();

  if (!found.secondary && !found.primary) {
    throw new Error(`No .xlsx file found in ${DATA_DIR}. Drop a primary or secondary sales export there.`);
  }

  const secKey = found.secondary ? `${found.secondary.full}:${found.secondary.mtimeMs}` : "";
  const priKey = found.primary ? `${found.primary.full}:${found.primary.mtimeMs}` : "";
  const cacheKey = `${secKey}|${priKey}`;

  if (!force && cache && cache.cacheKey === cacheKey) {
    return cache;
  }

  // Deduplicate concurrent loads — if one is already running, wait for it
  if (loading) return loading;

  loading = (async () => {
    let secondary = { rows: [], meta: null };
    if (found.secondary) {
      console.log(`Parsing secondary file: ${found.secondary.name} …`);
      const t0 = Date.now();
      const { rows, minDate, maxDate } = await parseSecondaryWorkbook(found.secondary.full);
      const meta = buildMeta(rows, SEC_DIMENSIONS, found.secondary.name, found.secondary.mtimeMs, minDate, maxDate);
      secondary = { rows, meta };
      console.log(`Secondary parsed: ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

    let primary = { rows: [], meta: null };
    if (found.primary) {
      console.log(`Parsing primary file: ${found.primary.name} …`);
      const t0 = Date.now();
      const { rows, minDate, maxDate } = parsePrimaryWorkbook(found.primary.full);
      const meta = buildMeta(rows, PRI_DIMENSIONS, found.primary.name, found.primary.mtimeMs, minDate, maxDate);
      primary = { rows, meta };
      console.log(`Primary parsed: ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

    const mainSource = secondary.rows.length > 0 ? secondary : primary;

    cache = { cacheKey, rows: mainSource.rows, meta: mainSource.meta, primary, secondary };
    loading = null;
    return cache;
  })();

  return loading;
}
