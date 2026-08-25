import { useMemo, useState } from "react";
import { cumulativeShare } from "../../lib/aggregate";
import { compact, moneyFull, pct, truncate } from "../../lib/format";
import { useTooltip } from "../../context/TooltipContext";

const W = 480,
  H = 230,
  MARGIN_L = 38,
  MARGIN_R = 14,
  MARGIN_T = 20,
  MARGIN_B = 26;
const PLOT_W = W - MARGIN_L - MARGIN_R;
const PLOT_H = H - MARGIN_T - MARGIN_B;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// mode: "line" | "area" — a Pareto / cumulative-concentration curve.
// Rank (an ordinal sequence, not a category) is the one axis that
// legitimately earns a line or area mark instead of bars.
export default function ParetoChart({ rows, dim, hueVar, mode, onDrill, isActive }) {
  const { show, hide } = useTooltip();
  const [hoverIdx, setHoverIdx] = useState(null);
  const series = useMemo(() => cumulativeShare(rows, dim), [rows, dim]);

  if (series.length === 0) return <div className="chart-empty">No data for current filters</div>;

  const n = series.length;
  const band = PLOT_W / n;
  const pts = series.map((p, i) => ({
    x: MARGIN_L + band * i + band / 2,
    y: MARGIN_T + PLOT_H - (p.cumPct / 100) * PLOT_H,
    p,
  }));
  const lineD = "M" + pts.map((pt) => `${pt.x},${pt.y}`).join(" L");
  const areaD =
    mode === "area"
      ? "M" +
        `${pts[0].x},${MARGIN_T + PLOT_H}` +
        " L" +
        pts.map((pt) => `${pt.x},${pt.y}`).join(" L") +
        ` L${pts[pts.length - 1].x},${MARGIN_T + PLOT_H} Z`
      : null;
  const hovered = hoverIdx !== null ? pts[hoverIdx] : null;

  const y80 = MARGIN_T + PLOT_H - 0.8 * PLOT_H;
  // Rank of the item where the curve first crosses 80% — the classic "vital few".
  const crossIdx = series.findIndex((p) => p.cumPct >= 80);

  const ticks = [0, 25, 50, 75, 100];
  const axisItems = ticks.map((t) => {
    const y = MARGIN_T + PLOT_H - (t / 100) * PLOT_H;
    return (
      <g key={t}>
        <line x1={MARGIN_L} x2={MARGIN_L + PLOT_W} y1={y} y2={y} className={t === 0 ? "baseline" : "gridline"} />
        <text x={MARGIN_L - 6} y={y + 3} className="tick-label" textAnchor="end">
          {t}%
        </text>
      </g>
    );
  });

  const labelStep = Math.max(1, Math.ceil(n / 7));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`pareto-grad-${dim}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`var(${hueVar})`} stopOpacity="0.32" />
          <stop offset="100%" stopColor={`var(${hueVar})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      {axisItems}
      <line x1={MARGIN_L} x2={MARGIN_L + PLOT_W} y1={y80} y2={y80} className="pareto-ref" />
      <text x={MARGIN_L + PLOT_W} y={y80 - 4} className="tick-label" textAnchor="end">
        80% threshold
      </text>
      {areaD && <path d={areaD} className="area-mark" fill={`url(#pareto-grad-${dim})`} stroke="none" />}
      <path
        d={lineD}
        pathLength="1"
        className="line-mark"
        fill="none"
        stroke={`var(${hueVar})`}
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {hovered && <line x1={hovered.x} x2={hovered.x} y1={MARGIN_T} y2={MARGIN_T + PLOT_H} className="crosshair" />}
      {crossIdx >= 0 && (
        <circle cx={pts[crossIdx].x} cy={pts[crossIdx].y} r="3.5" className="pareto-mark" fill={`var(${hueVar})`} />
      )}
      {pts.map((pt, i) => {
        const clickable = !!onDrill;
        const active = !!isActive && isActive(pt.p.label);
        return (
          <g
            key={pt.p.label + i}
            className={"bandgroup" + (active ? " active" : "")}
            style={{ "--i": i, cursor: clickable ? "pointer" : "default" }}
            onPointerMove={(e) => {
              setHoverIdx(i);
              show(e, {
                color: cssVar(hueVar),
                label: `#${pt.p.rank} ${truncate(String(pt.p.label), 22)}`,
                value: pct(pt.p.cumPct) + " cumulative",
                extra: moneyFull(pt.p.value),
              });
            }}
            onPointerLeave={() => {
              setHoverIdx(null);
              hide();
            }}
            onClick={clickable ? () => onDrill(pt.p.label) : undefined}
          >
            <circle
              cx={pt.x}
              cy={pt.y}
              r={active ? "7" : i === hoverIdx ? "5.5" : "3"}
              fill={`var(${hueVar})`}
              stroke="var(--surface)"
              strokeWidth="1.5"
              className="pt-mark"
            />
            <rect x={MARGIN_L + band * i} y={MARGIN_T} width={band} height={PLOT_H} fill="transparent" />
            {(i % labelStep === 0 || i === n - 1 || active) && (
              <text
                x={pt.x}
                y={MARGIN_T + PLOT_H + 14}
                className={"axis-label" + (i === hoverIdx || active ? " active" : "")}
                textAnchor="middle"
              >
                #{pt.p.rank}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
