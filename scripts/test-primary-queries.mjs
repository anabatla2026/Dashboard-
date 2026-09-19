import {
  getPrimaryKpis,
  getPrimaryTrend,
  getPrimaryByCategory,
  getPrimaryByBrand,
  getPrimaryMonthOverMonth,
  getPrimaryDims,
  getPrimaryMeta,
} from "../api/_lib/primaryQueries.js";

function show(label, v) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(v, null, 2).slice(0, 2000));
}

show("KPIs (latest period)", await getPrimaryKpis({}));
show("KPIs (Aug 2026)", await getPrimaryKpis({ years: [2026], months: ["Aug"] }));
show("KPIs (multi-select years+months)", await getPrimaryKpis({ years: [2025, 2026], months: ["Aug", "Sep"] }));

const trend = await getPrimaryTrend({ year: [2026], month: ["Aug"] });
show("Trend Aug 2026", { count: trend.length, sample: trend.slice(0, 3) });

const cat = await getPrimaryByCategory({ filters: { year: [2026], month: ["Aug"] } });
show("By category Aug 2026 (top 5)", cat.slice(0, 5));

const brand = await getPrimaryByBrand({ filters: { year: [2026], month: ["Aug"] } });
show("By brand Aug 2026 (top 5)", brand.slice(0, 5));

const mom = await getPrimaryMonthOverMonth({ fiscalYearStart: "2025-07-01", filters: {} });
show("MoM FY2025-26", mom);

const dims = await getPrimaryDims();
show("Dims (counts per dim)", Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, v.length])));

show("Meta", await getPrimaryMeta());

process.exit(0);
