import { compact, moneyFull, niceMax, truncate } from "../../lib/format";
import { roundedTopPath, extrudeFaces } from "../../lib/svgPath";
import { useTooltip } from "../../context/TooltipContext";

const W = 480,
  H = 230,
  MARGIN_L = 38,
  MARGIN_R = 18,
  MARGIN_T = 28,
  MARGIN_B = 44;
const PLOT_W = W - MARGIN_L - MARGIN_R;
const PLOT_H = H - MARGIN_T - MARGIN_B;
const DX = 9,
  DY = -7; // extrusion depth: recedes up-and-right, as if lit from the upper-left

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function gradId(hueVar) {
  return `bar-grad-${hueVar.replace("--hue-", "")}`;
}

export default function VerticalBarChart({ rows, hueVar, onDrill, isActive, hasActive }) {
  const { show, hide } = useTooltip();
  if (rows.length === 0) return <div className="chart-empty">No data for current filters</div>;

  const band = PLOT_W / rows.length;
  const yMax = niceMax(Math.max(...rows.map((r) => r.value)));
  const maxIdx = rows.reduce((mi, r, i, a) => (r.value > a[mi].value ? i : mi), 0);
  const id = gradId(hueVar);

  function tooltipColor(r) {
    return r.isOther ? cssVar("--text-muted") : cssVar(hueVar);
  }

  const ticks = 4;
  const axisItems = [];
  for (let i = 0; i <= ticks; i++) {
    const frac = i / ticks;
    const y = MARGIN_T + PLOT_H * (1 - frac);
    axisItems.push(
      <line
        key={"g" + i}
        x1={MARGIN_L}
        x2={MARGIN_L + PLOT_W}
        y1={y}
        y2={y}
        className={i === 0 ? "baseline" : "gridline"}
      />,
    );
    axisItems.push(
      <text key={"t" + i} x={MARGIN_L - 6} y={y + 3} className="tick-label" textAnchor="end">
        {compact(yMax * frac)}
      </text>,
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`color-mix(in oklch, var(${hueVar}) 82%, white 18%)`} />
          <stop offset="100%" stopColor={`var(${hueVar})`} />
        </linearGradient>
      </defs>
      {axisItems}
      {rows.map((r, i) => {
        const x = MARGIN_L + band * i;
        const barW = Math.min(26, band * 0.5);
        const barH = (r.value / yMax) * PLOT_H;
        const bx = x + band / 2 - barW / 2;
        const by = MARGIN_T + PLOT_H - barH;
        const front = r.isOther ? "var(--text-muted)" : `url(#${id})`;
        const top = r.isOther
          ? "color-mix(in srgb, var(--text-muted) 75%, white 25%)"
          : `color-mix(in oklch, var(${hueVar}) 68%, white 32%)`;
        const side = r.isOther
          ? "color-mix(in srgb, var(--text-muted) 65%, black 25%)"
          : `color-mix(in oklch, var(${hueVar}) 62%, black 28%)`;
        const faces = extrudeFaces(bx, by, barW, barH, DX, DY);
        const clickable = !!onDrill && !r.isOther;
        const active = !!isActive && isActive(r.label);
        return (
          <g
            key={r.label + i}
            className={"bandgroup" + (active ? " active" : "") + (hasActive && !active ? " dimmed" : "")}
            style={{ "--i": i, cursor: clickable ? "pointer" : "default" }}
            onPointerMove={(e) => show(e, { color: tooltipColor(r), label: r.label, value: moneyFull(r.value) })}
            onPointerLeave={hide}
            onClick={clickable ? () => onDrill(r.label) : undefined}
          >
            <g className="bar3d bar3d-v">
              <path d={faces.side} fill={side} className="bar-face-side" />
              <path d={faces.top} fill={top} className="bar-face-top" />
              <path d={roundedTopPath(bx, by, barW, barH, 4)} fill={front} className="bar-face-front" />
            </g>
            <rect x={x} y={MARGIN_T} width={band} height={PLOT_H} fill="transparent" />
            {i === maxIdx && by - 6 + DY > MARGIN_T && (
              <text x={bx + barW / 2 + DX / 2} y={by - 8 + DY} className="value-label" textAnchor="middle">
                {compact(r.value)}
              </text>
            )}
          </g>
        );
      })}
      {rows.map((r, i) => {
        const cx = MARGIN_L + band * i + band / 2;
        const y = MARGIN_T + PLOT_H + 14;
        return (
          <text key={"lbl" + r.label + i} x={cx} y={y} className="axis-label" textAnchor="end" transform={`rotate(-32 ${cx} ${y})`}>
            {truncate(r.label, 14)}
            <title>{r.label}</title>
          </text>
        );
      })}
    </svg>
  );
}
