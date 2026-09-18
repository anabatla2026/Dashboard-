import { useMemo, useState } from "react";
import { aggregateTop, aggregateDualTop, topNWithOther, mergeDualTop } from "../lib/aggregate";
import { useDrill } from "../hooks/useDrill";
import { useDrillPath } from "../hooks/useDrillPath";
import { useElementWidth } from "../hooks/useElementWidth";
import { useServerAggregate } from "../hooks/useServerAggregate";
import { useSecondaryTrend } from "../hooks/useSecondaryTrend";
import { usePrimaryTrend } from "../hooks/usePrimaryTrend";
import { useFilters } from "../context/FilterContext";
import { secondaryApi } from "../lib/secondaryApi";
import { primaryApi } from "../lib/primaryApi";
import { pickPrimaryFilters } from "../lib/filtersToParam";
import { truncate } from "../lib/format";
import { DIM_LABELS } from "../lib/hierarchies";
import WidgetInfo from "./WidgetInfo";
import Breadcrumb from "./Breadcrumb";
import VerticalBarChart from "./charts/VerticalBarChart";
import HorizontalBarChart from "./charts/HorizontalBarChart";
import DoughnutChart from "./charts/DoughnutChart";
import TrendChart from "./charts/TrendChart";
import ParetoChart from "./charts/ParetoChart";
import DualBarChart from "./charts/DualBarChart";
import DualTrendChart from "./charts/DualTrendChart";

const CHART_LABEL = {
  "bar-v": "Ranked",
  "bar-h": "Ranked",
  doughnut: "Share of total",
  trend: "Trend",
  "pareto-line": "Cumulative concentration",
  "pareto-area": "Cumulative concentration",
  "dual-bar-h": "Primary vs Secondary",
  "dual-trend": "Primary vs Secondary trend",
};

const AGGREGATED_TYPES = new Set(["bar-v", "bar-h", "doughnut", "dual-bar-h"]);
const DUAL_TYPES = new Set(["dual-bar-h", "dual-trend"]);
const SERIES_HUE_SECONDARY = "--hue-ch";
const SERIES_HUE_PRIMARY = "--hue-bu";

// Secondary sales is Snowflake-backed (see dashboard-query-reference.md and
// the shared/secondaryQueries.js layer it maps to) — these charts fetch
// their own pre-aggregated GROUP BY from the server instead of computing
// from a client-held row array. Keyed by the chart's root `dim`.
const SERVER_ENDPOINTS = {
  chType: secondaryApi.channelType,
  cat: secondaryApi.category,
  brand: secondaryApi.brand,
  region: secondaryApi.region,
};
// Primary is Snowflake-backed now too (GOLD.ZFI_SCO_VW) — only category and
// brand have a primary equivalent; chType and region are secondary-only
// concepts.
const PRIMARY_SERVER_ENDPOINTS = {
  cat: primaryApi.category,
  brand: primaryApi.brand,
};
const NOOP_FETCH = () => Promise.resolve([]);

export default function ChartCard({
  title,
  type,
  dim,
  hueVar,
  topN = 7,
  rows = [],
  secondaryRows = [],
  primaryRows = [],
  useServerAgg = false,
  className = "",
  chartWidth,
  labelChars,
  fallbackDim,
  fallbackTitle,
  fallbackTopN = 8,
  summary,
  query,
  tip,
  fallbackSummary,
  fallbackQuery,
  badge,
}) {
  const { filters } = useFilters();
  const isDual = DUAL_TYPES.has(type);
  const isTrendDual = type === "dual-trend";
  // Daily is fine for one month; once several months are selected a daily
  // series is a lot of points, so the trend chart offers week/month
  // bucketing instead — see shared/primaryQueries.js's TREND_DATE_EXPR.
  const isMultiMonth = (filters.month?.size || 0) > 1;
  const [granularity, setGranularity] = useState("day");
  const effectiveGranularity = isMultiMonth ? granularity : "day";
  const { trend: secondaryTrend } = useSecondaryTrend(filters, isTrendDual, effectiveGranularity);
  const { trend: primaryTrend } = usePrimaryTrend(filters, isTrendDual, effectiveGranularity);
  const distinctDates = useMemo(() => (type === "trend" ? new Set(rows.map((r) => r.date)).size : 0), [rows, type]);
  const useFallback = type === "trend" && distinctDates <= 1 && fallbackDim;
  const effectiveType = useFallback ? "bar-h" : type;
  const effectiveDim = useFallback ? fallbackDim : dim;
  const effectiveTopN = useFallback ? fallbackTopN : topN;
  const isAggType = AGGREGATED_TYPES.has(effectiveType);

  // Both hooks are always called (rules of hooks) — only one's output is
  // actually used, based on whether this chart type supports in-place
  // hierarchy navigation (bar/doughnut) or just simple cross-filtering
  // (Pareto, trend).
  const simpleDrill = useDrill(effectiveDim);
  const pathDrill = useDrillPath(effectiveDim);
  const useHierarchy = isAggType && pathDrill.hasHierarchy;

  const scopedRows = useMemo(() => {
    if (isDual || !useHierarchy || pathDrill.path.length === 0) return rows;
    return rows.filter((r) => pathDrill.path.every((step) => r[step.dim] === step.value));
  }, [rows, isDual, useHierarchy, pathDrill.path]);

  const scopedSecondaryRows = useMemo(() => {
    if (!isDual) return null;
    if (!useHierarchy || pathDrill.path.length === 0) return secondaryRows;
    return secondaryRows.filter((r) => pathDrill.path.every((step) => r[step.dim] === step.value));
  }, [isDual, secondaryRows, useHierarchy, pathDrill.path]);

  const scopedPrimaryRows = useMemo(() => {
    if (!isDual) return null;
    if (!useHierarchy || pathDrill.path.length === 0) return primaryRows;
    return primaryRows.filter((r) => pathDrill.path.every((step) => r[step.dim] === step.value));
  }, [isDual, primaryRows, useHierarchy, pathDrill.path]);

  const aggDim = useHierarchy ? pathDrill.currentDim : effectiveDim;

  // Only chType has a drill level (`channel`) that isn't itself a real
  // global filter dimension — every other hierarchy level is kept in sync
  // with the global filters by useDrillPath already, so the server query
  // just needs `filters` + `aggDim`. See shared/secondaryQueries.js's
  // groupByOne for the other half of this.
  const channelParent = useServerAgg && dim === "chType" ? pathDrill.path.find((s) => s.dim === "channel")?.value : undefined;
  const { data: serverAgg } = useServerAggregate(
    useServerAgg ? SERVER_ENDPOINTS[dim] : NOOP_FETCH,
    filters,
    aggDim,
    channelParent ? { channel: channelParent } : {}
  );
  // Primary's side of a dual chart — only relevant for cat/brand (chType and
  // region have no primary equivalent), so PRIMARY_SERVER_ENDPOINTS[dim] is
  // undefined for those and falls back to the no-op fetcher.
  const { data: primaryServerAgg } = useServerAggregate(
    useServerAgg && effectiveType === "dual-bar-h" ? PRIMARY_SERVER_ENDPOINTS[dim] || NOOP_FETCH : NOOP_FETCH,
    pickPrimaryFilters(filters),
    aggDim
  );

  const aggregated = useMemo(() => {
    if (!isAggType || effectiveType === "dual-bar-h") return null;
    if (useServerAgg) return topNWithOther(serverAgg, effectiveTopN);
    return aggregateTop(scopedRows, aggDim, effectiveTopN);
  }, [scopedRows, aggDim, effectiveTopN, isAggType, effectiveType, useServerAgg, serverAgg]);

  const dualAggregated = useMemo(() => {
    if (effectiveType !== "dual-bar-h") return null;
    if (useServerAgg) return mergeDualTop(serverAgg, primaryServerAgg, effectiveTopN);
    return aggregateDualTop(scopedSecondaryRows, scopedPrimaryRows, aggDim, effectiveTopN);
  }, [effectiveType, scopedSecondaryRows, scopedPrimaryRows, aggDim, effectiveTopN, useServerAgg, serverAgg, primaryServerAgg]);

  const activeAggregated = dualAggregated || aggregated;
  const hasOther = activeAggregated?.some((r) => r.isOther);
  const drilledIn = useHierarchy && pathDrill.path.length > 0;

  const rootTitle = useFallback ? fallbackTitle || title : title;
  const displayTitle = drilledIn ? `Net sales by ${DIM_LABELS[pathDrill.currentDim] || pathDrill.currentDim}` : rootTitle;
  const displaySummary = useFallback ? fallbackSummary || summary : summary;
  const displayQuery = useFallback ? fallbackQuery || query : query;

  const activeOnDrill = isAggType ? (useHierarchy ? pathDrill.onDrill : simpleDrill.onDrill) : simpleDrill.onDrill;
  const activeIsActive = isAggType && useHierarchy ? pathDrill.isActive : simpleDrill.isActive;
  const activeHasActive = isAggType && useHierarchy ? pathDrill.hasActive : simpleDrill.hasActive;

  const chipDrill = isAggType && useHierarchy ? null : simpleDrill; // the plain single-chip only applies when there's no breadcrumb

  const canDrillAny = isAggType ? !!(useHierarchy ? pathDrill.onDrill || pathDrill.levels.length > 1 : simpleDrill.drillable) : simpleDrill.drillable;

  // bar-h / dual-bar-h stretch their svg non-uniformly (preserveAspectRatio
  // "none") to fill the card — if the viewBox width doesn't match the card's
  // real rendered width, the browser can't resolve the svg's percentage
  // height and falls back to the viewBox's intrinsic ratio, which balloons
  // the whole card. Measuring the real width and feeding it back in as the
  // viewBox width keeps the two in sync at any card size.
  const isRowChart = effectiveType === "bar-h" || effectiveType === "dual-bar-h";
  const [bodyRef, measuredWidth] = useElementWidth(chartWidth || 480);
  const effectiveChartWidth = isRowChart ? measuredWidth : chartWidth;

  const displayTip =
    tip ||
    (canDrillAny
      ? useHierarchy
        ? "Click a bar or slice to drill into it — click a breadcrumb to go back up."
        : "Click a bar or slice to filter the whole dashboard to just that value — click it again to clear."
      : undefined);

  return (
    <div className={"widget chart-card " + className} style={{ "--card-hue": `var(${hueVar})` }}>
      <div className="widget-head">
        <div className="widget-head-main">
          <div className="widget-title">{displayTitle}</div>
          {drilledIn ? (
            <Breadcrumb path={pathDrill.path} currentDim={pathDrill.currentDim} goTo={pathDrill.goTo} />
          ) : (
            <div className="widget-sub">
              {useFallback
                ? `Ranked · single day of data so far${hasOther ? ` · top ${activeAggregated.length - 1} shown` : ""}`
                : `${CHART_LABEL[effectiveType]}${hasOther ? ` · top ${activeAggregated.length - 1} shown` : ""}`}
              {badge && <span className="kpi-badge kpi-badge--pending">{badge}</span>}
            </div>
          )}
        </div>
        <div className="widget-controls">
          {isTrendDual && isMultiMonth && (
            <select
              className="fy-select"
              value={granularity}
              onChange={(e) => setGranularity(e.target.value)}
              aria-label="Trend data points"
              title="Group the trend by day, week, or month"
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          )}
          {chipDrill?.hasActive && (
            <button type="button" className="drill-chip" onClick={chipDrill.clear} title="Clear this drill-down">
              {chipDrill.activeValue ? truncate(String(chipDrill.activeValue), 16) : "Filtered"}
              <span className="drill-chip-x">×</span>
            </button>
          )}
          {displaySummary && (
            <WidgetInfo title={rootTitle} summary={displaySummary} query={displayQuery} tip={displayTip} hueVar={hueVar} />
          )}
        </div>
      </div>
      <div
        ref={isRowChart ? bodyRef : undefined}
        className={
          "chart-body" +
          (effectiveType === "doughnut" ? " donut" : "") +
          (effectiveType === "trend" || effectiveType === "dual-trend" ? " trend" : "")
        }
      >
        {effectiveType === "bar-v" && (
          <VerticalBarChart
            rows={aggregated}
            hueVar={hueVar}
            onDrill={activeOnDrill}
            isActive={activeIsActive}
            hasActive={activeHasActive}
          />
        )}
        {effectiveType === "bar-h" && (
          <HorizontalBarChart
            rows={aggregated}
            hueVar={hueVar}
            width={effectiveChartWidth}
            labelChars={labelChars}
            onDrill={activeOnDrill}
            isActive={activeIsActive}
            hasActive={activeHasActive}
          />
        )}
        {effectiveType === "doughnut" && (
          <DoughnutChart
            rows={aggregated}
            hueVar={hueVar}
            onDrill={activeOnDrill}
            isActive={activeIsActive}
            hasActive={activeHasActive}
          />
        )}
        {effectiveType === "trend" && <TrendChart rows={rows} hueVar={hueVar} />}
        {effectiveType === "dual-bar-h" && (
          <DualBarChart
            rows={dualAggregated}
            hueVarA={SERIES_HUE_SECONDARY}
            hueVarB={SERIES_HUE_PRIMARY}
            width={effectiveChartWidth}
            labelChars={labelChars}
            onDrill={activeOnDrill}
            isActive={activeIsActive}
            hasActive={activeHasActive}
          />
        )}
        {effectiveType === "dual-trend" && (
          <DualTrendChart
            secondaryTrend={secondaryTrend}
            primaryTrend={primaryTrend}
            hueVarA={SERIES_HUE_SECONDARY}
            hueVarB={SERIES_HUE_PRIMARY}
            granularity={effectiveGranularity}
          />
        )}
        {effectiveType === "pareto-line" && (
          <ParetoChart rows={rows} dim={effectiveDim} hueVar={hueVar} mode="line" onDrill={simpleDrill.onDrill} isActive={simpleDrill.isActive} />
        )}
        {effectiveType === "pareto-area" && (
          <ParetoChart rows={rows} dim={effectiveDim} hueVar={hueVar} mode="area" onDrill={simpleDrill.onDrill} isActive={simpleDrill.isActive} />
        )}
      </div>
    </div>
  );
}
