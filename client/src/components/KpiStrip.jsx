import { useData } from "../context/DataContext";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import { money, num, pct } from "../lib/format";
import { calcGoly, calcYtdGoly, formatPeriod } from "../lib/period";
import { WalletIcon, BoxIcon, TagIcon, TruckIcon, MapPinIcon } from "./Icons";
import WidgetInfo from "./WidgetInfo";

// ── helpers ──────────────────────────────────────────────────────────────────

function sumField(rows, key) {
  return rows.reduce((s, r) => s + (r[key] || 0), 0);
}

function distinctCount(rows, key) {
  return new Set(rows.map((r) => r[key])).size;
}

// ── Animated number wrappers ─────────────────────────────────────────────────

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

function KpiTile({ label, value, sub, icon: Icon, hue, hero, summary, query, badge, goly }) {
  return (
    <div className={"kpi-tile" + (hero ? " hero" : "")} style={{ "--tile-hue": `var(${hue})` }}>
      <WidgetInfo title={label} summary={summary} query={query} hueVar={hue} />
      <div className="kpi-top">
        <span className="kpi-icon"><Icon /></span>
        <span className="kpi-label">{label}</span>
        {badge && <span className="kpi-badge">{badge}</span>}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">
        <span className="kpi-sub">{sub}</span>
        <GolyBadge goly={goly} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function KpiStrip({ rows, primaryRows, options, allSecondaryRows, allPrimaryRows, filters }) {
  const { secondaryMeta } = useData();
  const totalOutlets = secondaryMeta?.outletCount || 0;
  const secAll = allSecondaryRows || rows;
  const priAll = allPrimaryRows || primaryRows;

  // ── Secondary KPIs (current filter scope — respects every filter) ──
  const secCtnRaw     = sumField(rows, "salesCtn");
  const secUnitsRaw   = sumField(rows, "units");
  const secOutletsRaw = distinctCount(rows, "outletCode");
  const productivePct = totalOutlets > 0 ? (secOutletsRaw / totalOutlets) * 100 : 0;
  const secDistRaw    = distinctCount(rows, "dist");

  // ── Primary KPIs (current filter scope) ──
  const priCtnRaw = sumField(primaryRows, "ctn");
  const priPcsRaw = sumField(primaryRows, "pcs");

  // ── MTD / YTD — resolved period (active Year+Month filter, else the
  // dataset's latest month) so these tiles never go blank, and are
  // comparable to the same month last year regardless of what else is filtered. ──
  const secMtd = calcGoly(secAll, filters);
  const priMtd = calcGoly(priAll, filters);
  const secYtd = calcYtdGoly(secAll, filters);
  const priYtd = calcYtdGoly(priAll, filters);
  const periodLabel = formatPeriod(secMtd?.period || priMtd?.period);

  // Note: Segment-wise Sales (GT/Export/MT, primary source only per the
  // approved design §3.2) is NOT shown — primary's only categorical field
  // is Customer Group2 (Q-Commerce, LMT, distributor names, …), which
  // doesn't map to GT/Export/MT, and no such mapping has been supplied yet.
  // Showing the raw customer groups instead would misrepresent this KPI, so
  // it's omitted rather than approximated.

  // Animated values
  const secMtdVal = useAnimatedNumber(secMtd?.cur || 0);
  const priMtdVal = useAnimatedNumber(priMtd?.cur || 0);
  const secYtdVal = useAnimatedNumber(secYtd?.cur || 0);
  const priYtdVal = useAnimatedNumber(priYtd?.cur || 0);
  const secCtn    = useAnimatedNumber(secCtnRaw);
  const priCtn    = useAnimatedNumber(priCtnRaw);
  const priPcs    = useAnimatedNumber(priPcsRaw);
  const secDist   = useAnimatedNumber(secDistRaw, 500);
  const outlets   = useAnimatedNumber(secOutletsRaw, 500);
  const prodPct   = useAnimatedNumber(productivePct, 500);

  const hasPrimary   = primaryRows.length > 0;
  const hasSecondary = rows.length > 0;

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Overview</div>
          <div className="widget-sub">MTD/YTD figures resolved to {periodLabel} · GOLY = growth over last year</div>
        </div>
      </div>

      <div className="kpi-grid">
        {hasPrimary && (
          <KpiTile
            hero
            label="YTD Pri-Sales"
            value={money(priYtdVal)}
            sub={"FY to " + periodLabel}
            icon={TagIcon}
            hue="--hue-bu"
            goly={priYtd}
            summary="Cumulative primary net sales from 1 July (fiscal year start) through the resolved period."
            query="SUM(Value) for primary rows from FY start through period; GOLY vs the same cumulative point last year."
          />
        )}
        {hasSecondary && (
          <KpiTile
            hero
            label="YTD Sec-Sales"
            value={money(secYtdVal)}
            sub={"FY to " + periodLabel}
            icon={TagIcon}
            hue="--hue-ch"
            goly={secYtd}
            summary="Cumulative secondary net sales from 1 July (fiscal year start) through the resolved period."
            query="SUM(netSales) for secondary rows from FY start through period; GOLY vs the same cumulative point last year."
          />
        )}
        {hasPrimary && (
          <KpiTile
            hero
            label="MTD Pri-Sales"
            value={money(priMtdVal)}
            sub={num(Math.round(priCtn)) + " CTN this scope"}
            icon={WalletIcon}
            hue="--hue-bu"
            goly={priMtd}
            summary="Primary net sales for the resolved month (active Year+Month filter, else the latest month in the data)."
            query="SUM(Value) for primary rows in the resolved month; GOLY vs the same month last year."
          />
        )}
        {hasSecondary && (
          <KpiTile
            hero
            label="MTD Sec-Sales"
            value={money(secMtdVal)}
            sub={num(Math.round(secCtn)) + " CTN this scope"}
            icon={WalletIcon}
            hue="--hue-ch"
            goly={secMtd}
            summary="Secondary net sales for the resolved month (active Year+Month filter, else the latest month in the data)."
            query="SUM(netSales) for secondary rows in the resolved month; GOLY vs the same month last year."
          />
        )}
        {hasPrimary && (
          <KpiTile
            label="Primary volume"
            value={num(Math.round(priCtn)) + " CTN"}
            sub={num(Math.round(priPcs)) + " Pcs · current scope"}
            icon={BoxIcon}
            hue="--hue-cat"
            summary="Total shipped volume in cartons and pieces from primary sales, for the current filter scope."
            query="SUM(Qty In Ctn) and SUM(Qty In Pcs) across primary line items in scope."
          />
        )}
        {hasSecondary && (
          <KpiTile
            label="Secondary volume"
            value={num(Math.round(secCtn)) + " CTN"}
            sub={num(Math.round(secUnitsRaw)) + " Pcs · current scope"}
            icon={BoxIcon}
            hue="--hue-town"
            summary="Total shipped volume in cartons and pieces from secondary sales, for the current filter scope."
            query="SUM(Sales CTN) and SUM(Sales Units) across secondary line items in scope."
          />
        )}
        {hasSecondary && (
          <KpiTile
            label="Total store count"
            value={num(outlets)}
            sub={"of " + num(totalOutlets) + " total"}
            icon={MapPinIcon}
            hue="--hue-dist"
            summary="Distinct outlets served in this filter scope, against the total outlet roster."
            query="COUNT(DISTINCT outletCode) in scope vs. total dataset outlets."
          />
        )}
        {hasSecondary && (
          <KpiTile
            label="Productive outlets"
            value={pct(prodPct)}
            sub={num(secOutletsRaw) + " productive"}
            icon={MapPinIcon}
            hue="--hue-dist"
            summary="Outlets with at least one sale in scope, as a share of the total outlet roster."
            query="COUNT(DISTINCT outletCode in scope) ÷ COUNT(DISTINCT outletCode) in full dataset."
          />
        )}
        {hasSecondary && (
          <KpiTile
            label="Distributors active"
            value={num(Math.round(secDist))}
            sub={"of " + (options?.dist?.length || 0) + " total"}
            icon={TruckIcon}
            hue="--hue-src"
            summary="Distinct distributors with at least one sale in the current filter scope."
            query="COUNT(DISTINCT dist) within scope vs. total roster."
          />
        )}
      </div>
    </div>
  );
}
