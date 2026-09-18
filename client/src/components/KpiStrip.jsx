import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import { useSecondaryKpis } from "../hooks/useSecondaryKpis";
import { usePrimaryKpis } from "../hooks/usePrimaryKpis";
import { money, num } from "../lib/format";
import { formatPeriod } from "../lib/period";
import { WalletIcon, BoxIcon } from "./Icons";
import WidgetInfo from "./WidgetInfo";

// Per MOM 2026-09-02 §1: KPI cards split into YTD/MTD × Primary/Secondary,
// each showing Sales Value (PKR) and Volume (Carton/Pcs) — Secondary also
// shows Total/Productive store & distributor counts (Primary's source query
// doesn't define an equivalent). Built as 4 compact stat-cards rather than
// ~24 separate tiles, per the same doc's own review note capping a
// dashboard at 6–9 visuals.
//
// Both sources are Snowflake-backed now (see useSecondaryKpis/usePrimaryKpis)
// — the server resolves the period and computes every MTD/YTD/GOLY figure
// directly, since neither table can be shipped whole to the browser for
// client-side aggregation the way the original single-month Excel exports
// were.

function GolyBadge({ pct }) {
  if (pct === undefined) return null;
  if (pct === null) return <span className="goly-badge goly-na">No LY data</span>;
  const up = pct >= 0;
  return (
    <span className={"goly-badge " + (up ? "goly-up" : "goly-down")}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% GOLY
    </span>
  );
}

function StatRow({ label, value, golyPct }) {
  const animated = useAnimatedNumber(typeof value === "number" ? value : 0, 400);
  return (
    <div className="stat-row">
      <span className="stat-row-label">{label}</span>
      <span className="stat-row-value">{typeof value === "number" ? num(Math.round(animated)) : value}</span>
      <GolyBadge pct={golyPct} />
    </div>
  );
}

// One YTD-or-MTD x Primary-or-Secondary card. The server has already
// resolved the period and computed every stat for `mode` (mtd/ytd) — this
// just renders it.
function PeriodCard({ title, hue, icon: Icon, sourceTag, kpis, mode, period, showStoreStats }) {
  const stats = kpis?.[mode];
  const salesVal = useAnimatedNumber(stats?.salesValue || 0);

  return (
    <div className="period-card" style={{ "--tile-hue": `var(${hue})` }}>
      <div className="period-card-head">
        <span className="kpi-icon"><Icon /></span>
        <div>
          <div className="period-card-title">{title}</div>
          <div className="period-card-sub">
            {sourceTag} · {mode === "ytd" ? "FY to " : ""}
            {formatPeriod(period)}
          </div>
        </div>
      </div>
      <div className="period-card-hero">
        {money(salesVal)} <span className="period-card-unit">PKR</span>
      </div>
      <div className="period-card-golyline">
        <GolyBadge pct={stats?.goly} />
      </div>
      <div className="stat-list">
        <StatRow label="Volume (Carton)" value={stats?.volumeCtn ?? 0} />
        <StatRow label="Volume (Pcs)" value={stats?.volumePcs ?? 0} />
        {showStoreStats && (
          <>
            <StatRow label="Total store count" value={kpis?.totalStoreCount || 0} />
            <StatRow label="Productive store count" value={stats?.productiveStores ?? 0} />
            <StatRow label="Productive distributor" value={stats?.productiveDistributors ?? 0} />
          </>
        )}
      </div>
    </div>
  );
}

export default function KpiStrip({ filters }) {
  const { kpis: secKpis } = useSecondaryKpis(filters);
  const { kpis: priKpis } = usePrimaryKpis(filters);
  const hasSecondary = !!secKpis;
  const hasPrimary = !!priKpis;

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Overview</div>
          <div className="widget-sub">YTD / MTD, Primary vs Secondary · GOLY = growth over last year</div>
        </div>
        <div className="widget-controls">
          <WidgetInfo
            title="Overview"
            summary="Four cards — Year-to-date and Month-to-date, each split by Primary (SAP) and Secondary (distributor) source. Sales Value, Volume (Carton), and Volume (Pcs) are period-wise figures (not cumulative except where YTD is explicitly cumulative from 1 July). Secondary also shows store/distributor coverage; Primary's source query doesn't define an equivalent."
            query="MTD = the resolved month (active Year+Month filter, else the latest month in the data). YTD = cumulative from 1 July (fiscal year start) through that month. GOLY = same period last year."
          />
        </div>
      </div>
      <div className="period-card-grid">
        {hasPrimary && (
          <PeriodCard title="YTD — Primary" hue="--hue-bu" icon={WalletIcon} sourceTag="Primary" kpis={priKpis} mode="ytd" period={priKpis.period} />
        )}
        {hasSecondary && (
          <PeriodCard title="YTD — Secondary" hue="--hue-ch" icon={WalletIcon} sourceTag="Secondary" kpis={secKpis} mode="ytd" period={secKpis.period} showStoreStats />
        )}
        {hasPrimary && (
          <PeriodCard title="MTD — Primary" hue="--hue-bu" icon={BoxIcon} sourceTag="Primary" kpis={priKpis} mode="mtd" period={priKpis.period} />
        )}
        {hasSecondary && (
          <PeriodCard title="MTD — Secondary" hue="--hue-ch" icon={BoxIcon} sourceTag="Secondary" kpis={secKpis} mode="mtd" period={secKpis.period} showStoreStats />
        )}
      </div>
    </div>
  );
}
