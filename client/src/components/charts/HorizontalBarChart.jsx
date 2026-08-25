import { compact, moneyFull, niceMax, truncate } from "../../lib/format";
import { roundedRightPath, extrudeFaces } from "../../lib/svgPath";
import { useTooltip } from "../../context/TooltipContext";

const ROW_H = 32,
  BAR_H = 15,
  MARGIN_T = 10,
  MARGIN_B = 24;
const DX = 7,
  DY = -6;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function gradId(hueVar) {
  return `hbar-grad-${hueVar.replace("--hue-", "")}`;
}

// `width` lets a caller match this chart's internal viewBox aspect ratio to
// how wide its card actually is — since the svg stretches non-uniformly to
// fill its box, a mismatched aspect ratio would visibly distort bars/text.
export default function HorizontalBarChart({ rows, hueVar, width = 480, labelChars = 17, onDrill, isActive, hasActive }) {
  const { show, hide } = useTooltip();
  if (rows.length === 0) return <div className="chart-empty">No data for current filters</div>;

  const W = width;
  const LABEL_W = Math.round(W * 0.25);
  const MARGIN_R = Math.round(W * 0.1);
  const plotW = W - LABEL_W - MARGIN_R;
  const H = MARGIN_T + rows.length * ROW_H + MARGIN_B;
  const yMax = niceMax(Math.max(...rows.map((r) => r.value)));
  const id = gradId(hueVar);

  function tooltipColor(r) {
    return r.isOther ? cssVar("--text-muted") : cssVar(hueVar);
  }

  const ticks = 3;
  const axisItems = [];
  for (let i = 0; i <= ticks; i++) {
    const frac = i / ticks;
    const x = LABEL_W + plotW * frac;
    axisItems.push(
      <line
        key={"g" + i}
        y1={MARGIN_T}
        y2={MARGIN_T + rows.length * ROW_H}
        x1={x}
        x2={x}
        className={i === 0 ? "baseline" : "gridline"}
      />,
    );
    axisItems.push(
      <text key={"t" + i} y={MARGIN_T + rows.length * ROW_H + 15} x={x} className="tick-label" textAnchor="middle">
        {compact(yMax * frac)}
      </text>,
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={`var(${hueVar})`} />
          <stop offset="100%" stopColor={`color-mix(in oklch, var(${hueVar}) 82%, white 18%)`} />
        </linearGradient>
      </defs>
      {axisItems}
      {rows.map((r, i) => {
        const rowY = MARGIN_T + i * ROW_H;
        const barY = rowY + (ROW_H - BAR_H) / 2;
        const barW = Math.max((r.value / yMax) * plotW, 1);
        const front = r.isOther ? "var(--text-muted)" : `url(#${id})`;
        const top = r.isOther
          ? "color-mix(in srgb, var(--text-muted) 75%, white 25%)"
          : `color-mix(in oklch, var(${hueVar}) 70%, white 30%)`;
        const side = r.isOther
          ? "color-mix(in srgb, var(--text-muted) 65%, black 25%)"
          : `color-mix(in oklch, var(${hueVar}) 60%, black 26%)`;
        const faces = extrudeFaces(LABEL_W, barY, barW, BAR_H, DX, DY);
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
            <text x={LABEL_W - 8} y={rowY + ROW_H / 2 + 3.5} className="axis-label hbar-label" textAnchor="end">
              {truncate(r.label, labelChars)}
              <title>{r.label}</title>
            </text>
            <g className="bar3d bar3d-h">
              <path d={faces.side} fill={side} className="bar-face-side" />
              <path d={faces.top} fill={top} className="bar-face-top" />
              <path d={roundedRightPath(LABEL_W, barY, barW, BAR_H, 4)} fill={front} className="bar-face-front" />
            </g>
            <text x={LABEL_W + barW + DX + 7} y={rowY + ROW_H / 2 + 3.5} className="value-label">
              {compact(r.value)}
            </text>
            <rect x="0" y={rowY} width={W} height={ROW_H} fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}
