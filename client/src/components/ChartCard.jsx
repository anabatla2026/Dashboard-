import { useMemo } from "react";
import { aggregateTop, aggregateDualTop } from "../lib/aggregate";
import { useDrill } from "../hooks/useDrill";
import { useDrillPath } from "../hooks/useDrillPath";
import { useElementWidth } from "../hooks/useElementWidth";
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

export default function ChartCard({
  title,
  type,
  dim,
  hueVar,
  topN = 7,
  rows,
  secondaryRows,
  primaryRows,
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
}) {
  const isDual = DUAL_TYPES.has(type);
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

  const aggregated = useMemo(() => {
    if (!isAggType || effectiveType === "dual-bar-h") return null;
    return aggregateTop(scopedRows, aggDim, effectiveTopN);
  }, [scopedRows, aggDim, effectiveTopN, isAggType, effectiveType]);

  const dualAggregated = useMemo(() => {
    if (effectiveType !== "dual-bar-h") return null;
    return aggregateDualTop(scopedSecondaryRows, scopedPrimaryRows, aggDim, effectiveTopN);
  }, [effectiveType, scopedSecondaryRows, scopedPrimaryRows, aggDim, effectiveTopN]);

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
            </div>
          )}
        </div>
        <div className="widget-controls">
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
          <DualTrendChart secondaryRows={secondaryRows} primaryRows={primaryRows} hueVarA={SERIES_HUE_SECONDARY} hueVarB={SERIES_HUE_PRIMARY} />
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
