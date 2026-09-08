import { useData } from "../context/DataContext";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import { money, num } from "../lib/format";
import { resolvePeriod, calcGoly, calcYtdGoly, periodDistinct, ytdDistinct, formatPeriod } from "../lib/period";
import { WalletIcon, BoxIcon } from "./Icons";
import WidgetInfo from "./WidgetInfo";

// Per MOM 2026-09-02 §1: KPI cards split into YTD/MTD × Primary/Secondary,
// each showing Sales Value (PKR), Volume in Carton, Volume in Pcs, Total
// Store Count, Productive Store Count, and Productive Distributor — with
// volumes captured period-wise, not just cumulative. Built as 4 compact
// stat-cards rather than ~24 separate tiles, per the same doc's own review
// note capping a dashboard at 6–9 visuals.

function GolyBadge({ goly }) {
  if (!goly) return null;
  if (goly.pct === null) return <span className="goly-badge goly-na">No LY data</span>;
  const up = goly.pct >= 0;
  return (
    <span className={"goly-badge " + (up ? "goly-up" : "goly-down")}>
      {up ? "▲" : "▼"} {Math.abs(goly.pct).toFixed(1)}% GOLY
    </span>
  );
}

function StatRow({ label, value, goly }) {
  const animated = useAnimatedNumber(typeof value === "number" ? value : 0, 400);
  return (
    <div className="stat-row">
      <span className="stat-row-label">{label}</span>
      <span className="stat-row-value">{typeof value === "number" ? num(Math.round(animated)) : value}</span>
      <GolyBadge goly={goly} />
    </div>
  );
}

// One YTD-or-MTD × Primary-or-Secondary card, listing the 6 required stats.
function PeriodCard({ title, hue, icon: Icon, rows, filters, mode, ctnKey, pcsKey, totalStoreCount, sourceTag, showStoreStats = true }) {
  const golyFn = mode === "ytd" ? calcYtdGoly : calcGoly;
  const period = resolvePeriod(rows, filters);

  const valueGoly = golyFn(rows, filters, "netSales");
  const ctnGoly = golyFn(rows, filters, ctnKey);
  const pcsGoly = golyFn(rows, filters, pcsKey);

  const productiveStores =
    mode === "ytd" ? ytdDistinct(rows, period, "outletCode") : periodDistinct(rows, period?.year, period?.month, "outletCode");
  const productiveDist =
    mode === "ytd" ? ytdDistinct(rows, period, "dist") : periodDistinct(rows, period?.year, period?.month, "dist");

  const salesVal = useAnimatedNumber(valueGoly?.cur || 0);

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
        <GolyBadge goly={valueGoly} />
      </div>
      <div className="stat-list">
        <StatRow label="Volume (Carton)" value={ctnGoly?.cur ?? 0} goly={ctnGoly} />
        <StatRow label="Volume (Pcs)" value={pcsGoly?.cur ?? 0} goly={pcsGoly} />
        {showStoreStats && (
          <>
            <StatRow label="Total store count" value={totalStoreCount || 0} />
            <StatRow label="Productive store count" value={productiveStores} />
            <StatRow label="Productive distributor" value={productiveDist} />
          </>
        )}
      </div>
    </div>
  );
}

export default function KpiStrip({ allSecondaryRows, allPrimaryRows, filters }) {
  const { secondaryMeta, primaryMeta } = useData();
  const secAll = allSecondaryRows || [];
  const priAll = allPrimaryRows || [];
  const hasSecondary = secAll.length > 0;
  const hasPrimary = priAll.length > 0;

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
            summary="Four cards — Year-to-date and Month-to-date, each split by Primary (SAP) and Secondary (distributor) source. Sales Value, Volume (Carton), and Volume (Pcs) are period-wise figures (not cumulative except where YTD is explicitly cumulative from 1 July). Total store count is the full outlet roster for that source; Productive store count / Productive distributor are counts with at least one sale in the period shown."
            query="MTD = the resolved month (active Year+Month filter, else the latest month in the data). YTD = cumulative from 1 July (fiscal year start) through that month. GOLY = same period last year."
          />
        </div>
      </div>
      <div className="period-card-grid">
        {hasPrimary && (
          <PeriodCard
            title="YTD — Primary"
            hue="--hue-bu"
            icon={WalletIcon}
            rows={priAll}
            filters={filters}
            mode="ytd"
            ctnKey="ctn"
            pcsKey="pcs"
            totalStoreCount={primaryMeta?.outletCount}
            sourceTag="Primary"
            showStoreStats={false}
          />
        )}
        {hasSecondary && (
          <PeriodCard
            title="YTD — Secondary"
            hue="--hue-ch"
            icon={WalletIcon}
            rows={secAll}
            filters={filters}
            mode="ytd"
            ctnKey="salesCtn"
            pcsKey="units"
            totalStoreCount={secondaryMeta?.outletCount}
            sourceTag="Secondary"
            showStoreStats={false}
          />
        )}
        {hasPrimary && (
          <PeriodCard
            title="MTD — Primary"
            hue="--hue-bu"
            icon={BoxIcon}
            rows={priAll}
            filters={filters}
            mode="mtd"
            ctnKey="ctn"
            pcsKey="pcs"
            totalStoreCount={primaryMeta?.outletCount}
            sourceTag="Primary"
          />
        )}
        {hasSecondary && (
          <PeriodCard
            title="MTD — Secondary"
            hue="--hue-ch"
            icon={BoxIcon}
            rows={secAll}
            filters={filters}
            mode="mtd"
            ctnKey="salesCtn"
            pcsKey="units"
            totalStoreCount={secondaryMeta?.outletCount}
            sourceTag="Secondary"
          />
        )}
      </div>
    </div>
  );
}
