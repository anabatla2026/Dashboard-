import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

// Resolved relative to this file's own location (not process.cwd()) so it
// works the same whether it's imported by the local Express server or by a
// Vercel serverless function, regardless of what directory each runs from.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(MODULE_DIR, "..", "data");

// Source column (as it appears in the export, after trimming) -> internal field name.
const COLS_MAP = {
  "Distributor Name": "dist",
  "Town Name": "town",
  "Locality": "locality",
  "Distributor Type": "distType",
  "Channel Type": "chType",
  "Channel": "channel",
  "Sub Channel": "subChannel",
  "Business Unit": "bu",
  "Category": "cat",
  "Brand": "brand",
  "SKU Name": "sku",
  "Order Added From": "orderFrom",
  "Area Type": "areaType",
  "Store Filer Type": "filerType",
  "App User Tagged Title": "appUser",
  "Order Booker Name": "booker",
  "Outlet Name": "outlet",
  "Outlet Code": "outletCode",
  "Invoice Number": "invoice",
  "Sales Units": "units",
  "Volume (Tons)": "volume",
  "Net Sales": "netSales",
  "Total Discount": "discount",
  "GST": "gst",
  "Gross Value In GST": "gross",
  "Year": "year",
  "Month": "month",
  "Date": "date",
};

const MONTH_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Precision per numeric field — volume needs more decimals since single-unit
// transactions can be a few thousandths of a ton.
const NUMERIC_PRECISION = { units: 2, volume: 5, netSales: 2, discount: 2, gst: 2, gross: 2 };

const DIMENSIONS = [
  "dist",
  "town",
  "distType",
  "chType",
  "channel",
  "subChannel",
  "bu",
  "cat",
  "brand",
  "orderFrom",
  "areaType",
  "filerType",
  "year",
  "month",
  "date",
];

let cache = null; // { rows, meta, filePath, mtimeMs }

function findLatestExcelFile() {
  if (!fs.existsSync(DATA_DIR)) return null;
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"))
    .map((f) => {
      const full = path.join(DATA_DIR, f);
      return { name: f, full, mtimeMs: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] || null;
}

function cleanBusinessUnit(v) {
  if (typeof v !== "string") return v;
  return v.replace(/\s*\[BU\d+\]\s*$/i, "").trim();
}

function round(n, precision) {
  const f = Math.pow(10, precision);
  return Math.round((Number(n || 0) + Number.EPSILON) * f) / f;
}

function parseWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName =
    wb.SheetNames.find((n) => n.replace(/\s+/g, "").toLowerCase() === "secondarysaledatadump") ||
    wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

  const rows = [];
  let minDate = null;
  let maxDate = null;

  for (const record of raw) {
    const trimmed = {};
    for (const k in record) trimmed[k.trim()] = record[k];

    const sno = trimmed["S.No #"];
    if (sno === null || sno === undefined || sno === "" || isNaN(Number(sno))) continue; // drops the trailing "Total:" row

    const out = {};
    for (const [srcCol, destKey] of Object.entries(COLS_MAP)) {
      const v = trimmed[srcCol];
      out[destKey] = destKey in NUMERIC_PRECISION ? round(v, NUMERIC_PRECISION[destKey]) : v;
    }
    out.bu = cleanBusinessUnit(out.bu);
    rows.push(out);

    const dRaw = trimmed["Date"];
    const d = dRaw instanceof Date ? dRaw : typeof dRaw === "string" ? new Date(dRaw) : null;
    if (d && !isNaN(d)) {
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }
  }

  return { rows, minDate, maxDate };
}

function buildMeta(rows, sourceFile, mtimeMs, minDate, maxDate) {
  const dims = {};
  for (const key of DIMENSIONS) {
    let values = Array.from(new Set(rows.map((r) => r[key]))).filter(
      (v) => v !== null && v !== undefined && v !== "",
    );
    if (key === "month") {
      values.sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b));
    } else if (key === "year" || key === "date") {
      values.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
    } else {
      values.sort((a, b) => String(a).localeCompare(String(b)));
    }
    dims[key] = values;
  }
  const totals = rows.reduce(
    (acc, r) => {
      acc.netSales += r.netSales;
      acc.volume += r.volume;
      acc.units += r.units;
      acc.discount += r.discount;
      acc.gst += r.gst;
      return acc;
    },
    { netSales: 0, volume: 0, units: 0, discount: 0, gst: 0 },
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

export function loadData({ force = false } = {}) {
  const found = findLatestExcelFile();
  if (!found) {
    throw new Error(`No .xlsx file found in ${DATA_DIR}. Drop a secondary sales export there.`);
  }
  if (!force && cache && cache.filePath === found.full && cache.mtimeMs === found.mtimeMs) {
    return cache;
  }
  const { rows, minDate, maxDate } = parseWorkbook(found.full);
  const meta = buildMeta(rows, found.name, found.mtimeMs, minDate, maxDate);
  cache = { rows, meta, filePath: found.full, mtimeMs: found.mtimeMs };
  return cache;
}

export function getDataDir() {
  return DATA_DIR;
}
