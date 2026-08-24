import { useMemo, useState } from "react";
import { compact, formatDateLabel, moneyFull, niceMax } from "../../lib/format";
import { useTooltip } from "../../context/TooltipContext";

const W = 920,
  H = 260,
  MARGIN_L = 54,
  MARGIN_R = 20,
  MARGIN_T = 24,
  MARGIN_B = 34;
const PLOT_W = W - MARGIN_L - MARGIN_R;
const PLOT_H = H - MARGIN_T - MARGIN_B;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function aggregateByDate(rows) {
  const map = new Map();
  for (const r of rows) {
    map.set(r.date, (map.get(r.date) || 0) + r.netSales);
  }
  return Array.from(map, ([date, value]) => ({ date, value })).sort((a, b) => (a.date > b.date ? 1 : -1));
}

export default function TrendChart({ rows, hueVar }) {
  const { show, hide } = useTooltip();
  const [hoverIdx, setHoverIdx] = useState(null);
  const series = useMemo(() => aggregateByDate(rows), [rows]);

  if (series.length === 0) {
    return <div className="chart-empty">No data for current filters</div>;
  }

  if (series.length === 1) {
    return (
      <div className="trend-single">
        <div className="trend-single-value">{compact(series[0].value)}</div>
        <div className="trend-single-label">Net sales on {formatDateLabel(series[0].date)}</div>
        <div className="trend-single-note">
          This is a single-day snapshot — once more dated exports are dropped into <code>data/</code>, this widens
          into a full trend line automatically.
        </div>
      </div>
    );
  }

  const yMax = niceMax(Math.max(...series.map((p) => p.value)));
  const band = PLOT_W / series.length;
  const pts = series.map((p, i) => ({
    x: MARGIN_L + band * i + band / 2,
    y: MARGIN_T + PLOT_H - (p.value / yMax) * PLOT_H,
    p,
  }));
  const lineD = "M" + pts.map((pt) => `${pt.x},${pt.y}`).join(" L");
  const areaD =
    "M" +
    `${pts[0].x},${MARGIN_T + PLOT_H}` +
    " L" +
    pts.map((pt) => `${pt.x},${pt.y}`).join(" L") +
    ` L${pts[pts.length - 1].x},${MARGIN_T + PLOT_H} Z`;
  const hovered = hoverIdx !== null ? pts[hoverIdx] : null;

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

  const labelStep = Math.max(1, Math.ceil(series.length / 10));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="trend-svg">
      <defs>
        <linearGradient id="trend-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`var(${hueVar})`} stopOpacity="0.3" />
          <stop offset="100%" stopColor={`var(${hueVar})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      {axisItems}
      <path d={areaD} className="area-mark" fill="url(#trend-area-grad)" stroke="none" />
      <path d={lineD} pathLength="1" className="line-mark" fill="none" stroke={`var(${hueVar})`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {hovered && <line x1={hovered.x} x2={hovered.x} y1={MARGIN_T} y2={MARGIN_T + PLOT_H} className="crosshair" />}
      {pts.map((pt, i) => (
        <g
          key={pt.p.date}
          className="bandgroup"
          style={{ "--i": i }}
          onPointerMove={(e) => {
            setHoverIdx(i);
            show(e, { color: cssVar(hueVar), label: formatDateLabel(pt.p.date), value: moneyFull(pt.p.value) });
          }}
          onPointerLeave={() => {
            setHoverIdx(null);
            hide();
          }}
        >
          <circle cx={pt.x} cy={pt.y} r={i === hoverIdx ? "6" : "4.5"} fill={`var(${hueVar})`} stroke="var(--surface)" strokeWidth="2" className="pt-mark" />
          <rect x={MARGIN_L + band * i} y={MARGIN_T} width={band} height={PLOT_H} fill="transparent" />
          {i % labelStep === 0 && (
            <text x={pt.x} y={MARGIN_T + PLOT_H + 20} className={"axis-label" + (i === hoverIdx ? " active" : "")} textAnchor="middle">
              {formatDateLabel(pt.p.date)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
