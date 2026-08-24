import { useMemo } from "react";
import { aggregateTop } from "../lib/aggregate";
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
}) {
  const distinctDates = useMemo(() => (type === "trend" ? new Set(rows.map((r) => r.date)).size : 0), [rows, type]);
  const useFallback = type === "trend" && distinctDates <= 1 && fallbackDim;
  const effectiveType = useFallback ? "bar-h" : type;
  const effectiveDim = useFallback ? fallbackDim : dim;
  const effectiveTopN = useFallback ? fallbackTopN : topN;

  const aggregated = useMemo(() => {
    if (!AGGREGATED_TYPES.has(effectiveType)) return null;
    return aggregateTop(rows, effectiveDim, effectiveTopN);
  }, [rows, effectiveDim, effectiveTopN, effectiveType]);

  const hasOther = aggregated?.some((r) => r.isOther);
  const displayTitle = useFallback ? fallbackTitle || title : title;

  return (
    <div className={"widget chart-card " + className} style={{ "--card-hue": `var(${hueVar})` }}>
      <div className="widget-head">
        <div>
          <div className="widget-title">{displayTitle}</div>
          <div className="widget-sub">
            {useFallback
              ? `Ranked · single day of data so far${hasOther ? ` · top ${aggregated.length - 1} shown` : ""}`
              : `${CHART_LABEL[effectiveType]}${hasOther ? ` · top ${aggregated.length - 1} shown` : ""}`}
          </div>
        </div>
      </div>
      <div
        className={"chart-body" + (effectiveType === "doughnut" ? " donut" : "") + (effectiveType === "trend" ? " trend" : "")}
      >
        {effectiveType === "bar-v" && <VerticalBarChart rows={aggregated} hueVar={hueVar} />}
        {effectiveType === "bar-h" && (
          <HorizontalBarChart rows={aggregated} hueVar={hueVar} width={chartWidth} labelChars={labelChars} />
        )}
        {effectiveType === "doughnut" && <DoughnutChart rows={aggregated} hueVar={hueVar} />}
        {effectiveType === "trend" && <TrendChart rows={rows} hueVar={hueVar} />}
        {effectiveType === "pareto-line" && <ParetoChart rows={rows} dim={effectiveDim} hueVar={hueVar} mode="line" />}
        {effectiveType === "pareto-area" && <ParetoChart rows={rows} dim={effectiveDim} hueVar={hueVar} mode="area" />}
      </div>
    </div>
  );
}
