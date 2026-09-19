import {
  getSecondaryKpis,
  getSecondaryTrend,
  getByChannelType,
  getByCategorySecondary,
  getByBrandSecondary,
  getRegionAchievement,
  getRegionTargetVsAchievement,
  getMonthOverMonth,
  getSecondaryDims,
  getSecondaryMeta,
} from "../api/_lib/secondaryQueries.js";

function show(label, v) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(v, null, 2).slice(0, 2000));
}

const kpis = await getSecondaryKpis({});
show("KPIs (latest period, all app users)", kpis);

const kpisAug = await getSecondaryKpis({
  years: [2026],
  months: ["Aug"],
  filters: { appUser: ["OB", "MDSD"] },
});
show("KPIs (Aug 2026, appUser excluding SD/SD-OB)", kpisAug);

const kpisMulti = await getSecondaryKpis({ years: [2025, 2026], months: ["Sep", "Nov"] });
show("KPIs (multi-select years+months)", kpisMulti);

const trend = await getSecondaryTrend({ year: [2026], month: ["Aug"] });
show("Trend Aug 2026 (first 5 + count)", { count: trend.length, sample: trend.slice(0, 5) });

const chType = await getByChannelType({ filters: { year: [2026], month: ["Sep"] } });
show("By channel type Sep 2026", chType);

if (chType[0]) {
  const drill = await getByChannelType({ filters: { year: [2026], month: ["Sep"], chType: [chType[0].label] }, level: "channel" });
  show(`Drill into chType=${chType[0].label} -> channel`, drill.slice(0, 5));
}

const cat = await getByCategorySecondary({ filters: { year: [2026], month: ["Sep"] } });
show("By category Sep 2026 (top 5)", cat.slice(0, 5));

const brand = await getByBrandSecondary({ filters: { year: [2026], month: ["Sep"] } });
show("By brand Sep 2026 (top 5)", brand.slice(0, 5));

const region = await getRegionAchievement({ filters: { year: [2026], month: ["Aug"] } });
show("Region achievement Aug 2026", region);

const targetVsAch = await getRegionTargetVsAchievement({ year: 2026, month: "Aug" });
show("Region target vs achievement Aug 2026", targetVsAch);

const mom = await getMonthOverMonth({ fiscalYearStart: "2025-07-01", region: null, filters: {} });
show("Month over month FY2025-26", mom);

const dims = await getSecondaryDims();
show("Dims (counts per dim)", Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, v.length])));

const meta = await getSecondaryMeta();
show("Meta", meta);

process.exit(0);
