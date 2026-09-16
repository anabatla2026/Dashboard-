import { useMemo, useState } from "react";
import { compact, formatDateLabel, moneyFull, niceMax } from "../../lib/format";
import { useTooltip } from "../../context/TooltipContext";

const W = 920,
  H = 200,
  MARGIN_L = 50,
  MARGIN_R = 16,
  MARGIN_T = 24,
  MARGIN_B = 28;
const PLOT_W = W - MARGIN_L - MARGIN_R;
const PLOT_H = H - MARGIN_T - MARGIN_B;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function toDateMap(trend) {
  return new Map((trend || []).map((r) => [r.date, r.netSales || 0]));
}

export default function DualTrendChart({ secondaryTrend, primaryTrend, hueVarA, hueVarB, labelA = "Secondary", labelB = "Primary" }) {
  const { show, hide } = useTooltip();
  const [hoverIdx, setHoverIdx] = useState(null);

  const { dates, secSeries, priSeries } = useMemo(() => {
    // Both sides arrive already grouped by date from the server now — both
    // Primary and Secondary are Snowflake-backed (see hooks/useSecondaryTrend
    // and hooks/usePrimaryTrend), too much history to ship raw rows for
    // client-side summing the way the single-month Excel export allowed.
    const secMap = toDateMap(secondaryTrend);
    const priMap = toDateMap(primaryTrend);
    const dates = Array.from(new Set([...secMap.keys(), ...priMap.keys()])).sort();
    return {
      dates,
      secSeries: dates.map((d) => secMap.get(d) || 0),
      priSeries: dates.map((d) => priMap.get(d) || 0),
    };
  }, [secondaryTrend, primaryTrend]);

  if (dates.length === 0) {
    return <div className="chart-empty">No data for current filters</div>;
  }

  if (dates.length === 1) {
    return (
      <div className="trend-single">
        <div className="trend-single-value">{compact(secSeries[0] || priSeries[0])}</div>
        <div className="trend-single-label">Net sales on {formatDateLabel(dates[0])}</div>
        <div className="trend-single-note">This widens into a full trend once more dated exports are added.</div>
      </div>
    );
  }

  const yMax = niceMax(Math.max(...secSeries, ...priSeries));
  const band = PLOT_W / dates.length;
  const xAt = (i) => MARGIN_L + band * i + band / 2;
  const yAt = (v) => MARGIN_T + PLOT_H - (v / yMax) * PLOT_H;

  const secPts = dates.map((d, i) => ({ x: xAt(i), y: yAt(secSeries[i]), d }));
  const priPts = dates.map((d, i) => ({ x: xAt(i), y: yAt(priSeries[i]), d }));
  const secLine = "M" + secPts.map((p) => `${p.x},${p.y}`).join(" L");
  const priLine = "M" + priPts.map((p) => `${p.x},${p.y}`).join(" L");
  const secArea =
    "M" +
    `${secPts[0].x},${MARGIN_T + PLOT_H}` +
    " L" +
    secPts.map((p) => `${p.x},${p.y}`).join(" L") +
    ` L${secPts[secPts.length - 1].x},${MARGIN_T + PLOT_H} Z`;

  const ticks = 4;
  const axisItems = [];
  for (let i = 0; i <= ticks; i++) {
    const frac = i / ticks;
    const y = MARGIN_T + PLOT_H * (1 - frac);
    axisItems.push(
      <line key={"g" + i} x1={MARGIN_L} x2={MARGIN_L + PLOT_W} y1={y} y2={y} className={i === 0 ? "baseline" : "gridline"} />,
    );
    axisItems.push(
      <text key={"t" + i} x={MARGIN_L - 8} y={y + 3} className="tick-label" textAnchor="end">
        {compact(yMax * frac)}
      </text>,
    );
  }

  const labelStep = Math.max(1, Math.ceil(dates.length / 10));
  const legendAWidth = labelA.length * 5.8;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="trend-svg">
      <defs>
        <linearGradient id="dual-trend-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`var(${hueVarA})`} stopOpacity="0.22" />
          <stop offset="100%" stopColor={`var(${hueVarA})`} stopOpacity="0" />
        </linearGradient>
      </defs>

      <circle cx={MARGIN_L} cy={12} r="4" fill={`var(${hueVarA})`} />
      <text x={MARGIN_L + 9} y={15.5} className="tick-label">
        {labelA}
      </text>
      <circle cx={MARGIN_L + 20 + legendAWidth} cy={12} r="4" fill={`var(${hueVarB})`} />
      <text x={MARGIN_L + 29 + legendAWidth} y={15.5} className="tick-label">
        {labelB}
      </text>

      {axisItems}
      <path d={secArea} fill="url(#dual-trend-area)" stroke="none" />
      <path d={secLine} pathLength="1" className="line-mark" fill="none" stroke={`var(${hueVarA})`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d={priLine}
        pathLength="1"
        className="line-mark"
        fill="none"
        stroke={`var(${hueVarB})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="5 4"
      />
      {hoverIdx !== null && <line x1={secPts[hoverIdx].x} x2={secPts[hoverIdx].x} y1={MARGIN_T} y2={MARGIN_T + PLOT_H} className="crosshair" />}

      {dates.map((d, i) => (
        <g
          key={d}
          className="bandgroup"
          style={{ "--i": i, cursor: "default" }}
          onPointerMove={(e) => {
            setHoverIdx(i);
            show(e, {
              color: cssVar(hueVarA),
              label: formatDateLabel(d),
              value: `${labelA}: ${moneyFull(secSeries[i])}`,
              extra: `${labelB}: ${moneyFull(priSeries[i])}`,
            });
          }}
          onPointerLeave={() => {
            setHoverIdx(null);
            hide();
          }}
        >
          <circle
            cx={secPts[i].x}
            cy={secPts[i].y}
            r={i === hoverIdx ? "6" : "4.5"}
            fill={`var(${hueVarA})`}
            stroke="var(--surface)"
            strokeWidth="2"
            className="pt-mark"
          />
          {priSeries[i] > 0 && (
            <circle
              cx={priPts[i].x}
              cy={priPts[i].y}
              r={i === hoverIdx ? "6" : "4.5"}
              fill={`var(${hueVarB})`}
              stroke="var(--surface)"
              strokeWidth="2"
              className="pt-mark"
            />
          )}
          <rect x={MARGIN_L + band * i} y={MARGIN_T} width={band} height={PLOT_H} fill="transparent" />
          {i % labelStep === 0 && (
            <text x={secPts[i].x} y={MARGIN_T + PLOT_H + 20} className={"axis-label" + (i === hoverIdx ? " active" : "")} textAnchor="middle">
              {formatDateLabel(d)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
