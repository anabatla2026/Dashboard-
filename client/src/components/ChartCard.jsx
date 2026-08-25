import { useMemo } from "react";
import { aggregateTop } from "../lib/aggregate";
import { useDrill } from "../hooks/useDrill";
import { useDrillPath } from "../hooks/useDrillPath";
import { truncate } from "../lib/format";
import { DIM_LABELS } from "../lib/hierarchies";
import WidgetInfo from "./WidgetInfo";
import Breadcrumb from "./Breadcrumb";
import VerticalBarChart from "./charts/VerticalBarChart";
import HorizontalBarChart from "./charts/HorizontalBarChart";
import DoughnutChart from "./charts/DoughnutChart";
import TrendChart from "./charts/TrendChart";
import ParetoChart from "./charts/ParetoChart";

const CHART_LABEL = {
  "bar-v": "Ranked",
  "bar-h": "Ranked",
  doughnut: "Share of total",
  trend: "Trend",
  "pareto-line": "Cumulative concentration",
  "pareto-area": "Cumulative concentration",
};

const AGGREGATED_TYPES = new Set(["bar-v", "bar-h", "doughnut"]);

export default function ChartCard({
  title,
  type,
  dim,
  hueVar,
  topN = 7,
  rows,
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
    if (!useHierarchy || pathDrill.path.length === 0) return rows;
    return rows.filter((r) => pathDrill.path.every((step) => r[step.dim] === step.value));
  }, [rows, useHierarchy, pathDrill.path]);

  const aggDim = useHierarchy ? pathDrill.currentDim : effectiveDim;

  const aggregated = useMemo(() => {
    if (!isAggType) return null;
    return aggregateTop(scopedRows, aggDim, effectiveTopN);
  }, [scopedRows, aggDim, effectiveTopN, isAggType]);

  const hasOther = aggregated?.some((r) => r.isOther);
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
                ? `Ranked · single day of data so far${hasOther ? ` · top ${aggregated.length - 1} shown` : ""}`
                : `${CHART_LABEL[effectiveType]}${hasOther ? ` · top ${aggregated.length - 1} shown` : ""}`}
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
        className={"chart-body" + (effectiveType === "doughnut" ? " donut" : "") + (effectiveType === "trend" ? " trend" : "")}
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
            width={chartWidth}
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
