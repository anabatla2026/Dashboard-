import { compact, moneyFull, pct } from "../../lib/format";
import { useTooltip } from "../../context/TooltipContext";
import { useAnimatedNumber } from "../../hooks/useAnimatedNumber";

const SIZE = 168,
  CX = SIZE / 2,
  CY = SIZE / 2,
  R_OUTER = 75,
  R_INNER = 45,
  SQUASH = 0.64, // flattens the ring into an ellipse, as if viewed from above at an angle
  WALL_DEPTH = 15; // visible thickness of the 3D puck's edge
const VIEW_H = SIZE + WALL_DEPTH;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default function DoughnutChart({ rows, hueVar }) {
  const { show, hide } = useTooltip();
  const total = rows.reduce((s, r) => s + r.value, 0);
  const animatedTotal = useAnimatedNumber(total);

  if (rows.length === 0) return <div className="chart-empty">No data for current filters</div>;

  let angle = -Math.PI / 2;
  const gapRad = rows.length > 1 ? 0.028 : 0;

  const slices = rows.map((r, i) => {
    const frac = total > 0 ? r.value / total : 0;
    const rawSweep = frac * Math.PI * 2 - gapRad;
    const sweep = Math.max(Math.min(rawSweep, Math.PI * 2 - 0.001), 0.001);
    const a0 = angle;
    const a1 = angle + sweep;
    const shadePct = 100 - i * (55 / Math.max(rows.length - 1, 1));
    const mix = Math.max(shadePct, 35);
    const color = r.isOther
      ? "var(--text-muted)"
      : `color-mix(in oklch, var(${hueVar}) ${mix}%, var(--surface) ${100 - mix}%)`;
    const wallColor = r.isOther
      ? "color-mix(in srgb, var(--text-muted) 55%, black 35%)"
      : `color-mix(in srgb, ${color} 58%, black 34%)`;

    const x0o = CX + R_OUTER * Math.cos(a0),
      y0o = CY + R_OUTER * Math.sin(a0);
    const x1o = CX + R_OUTER * Math.cos(a1),
      y1o = CY + R_OUTER * Math.sin(a1);
    const x0i = CX + R_INNER * Math.cos(a1),
      y0i = CY + R_INNER * Math.sin(a1);
    const x1i = CX + R_INNER * Math.cos(a0),
      y1i = CY + R_INNER * Math.sin(a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d =
      `M${x0o},${y0o} A${R_OUTER},${R_OUTER} 0 ${large} 1 ${x1o},${y1o}` +
      ` L${x0i},${y0i} A${R_INNER},${R_INNER} 0 ${large} 0 ${x1i},${y1i} Z`;

    angle = a0 + frac * Math.PI * 2;
    return { ...r, d, color, wallColor, fracPct: frac * 100 };
  });

  const squashTransform = `translate(${CX} ${CY}) scale(1 ${SQUASH}) translate(${-CX} ${-CY})`;

  return (
    <>
      <div className="donut-svg-wrap">
        <svg viewBox={`0 0 ${SIZE} ${VIEW_H}`}>
          {/* the puck's edge: a darkened copy of the ring, offset down to read as thickness */}
          <g transform={`translate(0 ${WALL_DEPTH}) ${squashTransform}`} className="donut-wall">
            {slices.map((s, i) => (
              <path key={s.label + i + "w"} d={s.d} fill={s.wallColor} />
            ))}
          </g>
          {/* the lit top face */}
          <g transform={squashTransform}>
            {slices.map((s, i) => (
              <path
                key={s.label + i}
                d={s.d}
                fill={s.color}
                className="arc-slice"
                style={{ "--i": i }}
                stroke="var(--surface)"
                strokeWidth="2"
                onPointerMove={(e) =>
                  show(e, {
                    color: s.isOther ? cssVar("--text-muted") : cssVar(hueVar),
                    label: s.label,
                    value: moneyFull(s.value),
                    extra: pct(s.fracPct),
                  })
                }
                onPointerLeave={hide}
              />
            ))}
          </g>
          <text x={CX} y={CY - 3} textAnchor="middle" className="center-total" fontSize="16">
            {compact(animatedTotal)}
          </text>
          <text x={CX} y={CY + 13} textAnchor="middle" className="center-cap" fontSize="9">
            TOTAL
          </text>
        </svg>
      </div>
      <div className="legend">
        {slices.map((s, i) => (
          <div className="legend-row" key={s.label + i} style={{ "--i": i }}>
            <span className="sw" style={{ background: s.color }} />
            <span className="lbl" title={s.label}>
              {s.label}
            </span>
            <span className="val">{compact(s.value)}</span>
            <span className="pct">{pct(s.fracPct)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
