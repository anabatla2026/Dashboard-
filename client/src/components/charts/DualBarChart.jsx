import { compact, moneyFull, niceMax, truncate } from "../../lib/format";
import { roundedRightPath, extrudeFaces } from "../../lib/svgPath";
import { useTooltip } from "../../context/TooltipContext";

// Two bars per row — secondary above, primary below — so both sources can
// be compared for the same category/brand/town at a glance.
const ROW_H = 32,
  BAR_H = 9,
  BAR_GAP = 3,
  MARGIN_T = 24,
  MARGIN_B = 18;
const DX = 5,
  DY = -4;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function gradId(hueVar, suffix) {
  return `dbar-grad-${hueVar.replace("--hue-", "")}-${suffix}`;
}

export default function DualBarChart({
  rows,
  hueVarA, // secondary
  hueVarB, // primary
  labelA = "Secondary",
  labelB = "Primary",
  width = 480,
  labelChars = 17,
  onDrill,
  isActive,
  hasActive,
}) {
  const { show, hide } = useTooltip();
  if (!rows || rows.length === 0) return <div className="chart-empty">No data for current filters</div>;

  const W = width;
  const LABEL_W = Math.round(W * 0.25);
  const MARGIN_R = Math.round(W * 0.1);
  const plotW = W - LABEL_W - MARGIN_R;
  const H = MARGIN_T + rows.length * ROW_H + MARGIN_B;
  const yMax = niceMax(Math.max(...rows.map((r) => Math.max(r.secondary, r.primary))));
  const idA = gradId(hueVarA, "a");
  const idB = gradId(hueVarB, "b");

  const ticks = 3;
  const axisItems = [];
  for (let i = 0; i <= ticks; i++) {
    const frac = i / ticks;
    const x = LABEL_W + plotW * frac;
    axisItems.push(
      <line key={"g" + i} y1={MARGIN_T} y2={MARGIN_T + rows.length * ROW_H} x1={x} x2={x} className={i === 0 ? "baseline" : "gridline"} />,
    );
    axisItems.push(
      <text key={"t" + i} y={MARGIN_T + rows.length * ROW_H + 15} x={x} className="tick-label" textAnchor="middle">
        {compact(yMax * frac)}
      </text>,
    );
  }

  function bar(x, y, w, h, hueVar, gradientId, isOther, key) {
    const front = isOther ? "var(--text-muted)" : `url(#${gradientId})`;
    const top = isOther
      ? "color-mix(in srgb, var(--text-muted) 75%, white 25%)"
      : `color-mix(in oklch, var(${hueVar}) 70%, white 30%)`;
    const side = isOther
      ? "color-mix(in srgb, var(--text-muted) 65%, black 25%)"
      : `color-mix(in oklch, var(${hueVar}) 60%, black 26%)`;
    const faces = extrudeFaces(x, y, w, h, DX, DY);
    return (
      <g key={key} className="bar3d bar3d-h">
        <path d={faces.side} fill={side} className="bar-face-side" />
        <path d={faces.top} fill={top} className="bar-face-top" />
        <path d={roundedRightPath(x, y, w, h, 3)} fill={front} className="bar-face-front" />
      </g>
    );
  }

  const legendAWidth = labelA.length * 5.6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={idA} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={`var(${hueVarA})`} />
          <stop offset="100%" stopColor={`color-mix(in oklch, var(${hueVarA}) 82%, white 18%)`} />
        </linearGradient>
        <linearGradient id={idB} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={`var(${hueVarB})`} />
          <stop offset="100%" stopColor={`color-mix(in oklch, var(${hueVarB}) 82%, white 18%)`} />
        </linearGradient>
      </defs>

      <circle cx={LABEL_W} cy={10} r="4" fill={`var(${hueVarA})`} />
      <text x={LABEL_W + 9} y={13.5} className="tick-label">
        {labelA}
      </text>
      <circle cx={LABEL_W + 20 + legendAWidth} cy={10} r="4" fill={`var(${hueVarB})`} />
      <text x={LABEL_W + 29 + legendAWidth} y={13.5} className="tick-label">
        {labelB}
      </text>

      {axisItems}
      {rows.map((r, i) => {
        const rowY = MARGIN_T + i * ROW_H;
        const barsH = BAR_H * 2 + BAR_GAP;
        const groupY = rowY + (ROW_H - barsH) / 2;
        const wA = r.secondary > 0 ? Math.max((r.secondary / yMax) * plotW, 1) : 0;
        const wB = r.primary > 0 ? Math.max((r.primary / yMax) * plotW, 1) : 0;
        const clickable = !!onDrill && !r.isOther;
        const active = !!isActive && isActive(r.label);
        return (
          <g
            key={r.label + i}
            className={"bandgroup" + (active ? " active" : "") + (hasActive && !active ? " dimmed" : "")}
            style={{ "--i": i, cursor: clickable ? "pointer" : "default" }}
            onClick={clickable ? () => onDrill(r.label) : undefined}
          >
            <text x={LABEL_W - 8} y={rowY + ROW_H / 2 + 3.5} className="axis-label hbar-label" textAnchor="end">
              {truncate(r.label, labelChars)}
              <title>{r.label}</title>
            </text>

            {bar(LABEL_W, groupY, wA, BAR_H, hueVarA, idA, r.isOther, "a")}
            {bar(LABEL_W, groupY + BAR_H + BAR_GAP, wB, BAR_H, hueVarB, idB, r.isOther, "b")}

            {/* Hit-test rects on top, split top/bottom half so hover always
                wins (paths only catch events on their filled pixels, and a
                thin bar is an unreliable hover target) and correctly
                attributes to secondary vs primary. */}
            <rect
              x="0"
              y={rowY}
              width={W}
              height={ROW_H / 2}
              fill="transparent"
              onPointerMove={(e) => show(e, { color: cssVar(hueVarA), label: `${r.label} · ${labelA}`, value: moneyFull(r.secondary) })}
              onPointerLeave={hide}
            />
            <rect
              x="0"
              y={rowY + ROW_H / 2}
              width={W}
              height={ROW_H / 2}
              fill="transparent"
              onPointerMove={(e) => show(e, { color: cssVar(hueVarB), label: `${r.label} · ${labelB}`, value: moneyFull(r.primary) })}
              onPointerLeave={hide}
            />
          </g>
        );
      })}
    </svg>
  );
}
