import { useData } from "../context/DataContext";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import { money, compact, num, pct } from "../lib/format";
import { WalletIcon, BoxIcon, TagIcon, TruckIcon, MapPinIcon, LayersIcon } from "./Icons";
import WidgetInfo from "./WidgetInfo";

// ── helpers ──────────────────────────────────────────────────────────────────

function sumField(rows, key) {
  return rows.reduce((s, r) => s + (r[key] || 0), 0);
}

function distinctCount(rows, key) {
  return new Set(rows.map((r) => r[key])).size;
}

// Segment-wise breakdown from secondary rows using the top-level "segment"
// field (GT / MT / Export).  Returns an array of { label, value } pairs
// sorted descending by value.
function segmentBreakdown(rows) {
  const map = new Map();
  for (const r of rows) {
    const seg = r.segment || "Other";
    map.set(seg, (map.get(seg) || 0) + (r.netSales || 0));
  }
  return Array.from(map, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// YTD from fiscal year start (July 1).  Uses ALL secondary rows (unfiltered)
// so the YTD figure isn't scoped down by the month filter.
function calcYtd(allRows) {
  const now = new Date();
  // Fiscal year: July 1 of current calendar year (or previous if before July)
  const fyStart = now.getMonth() >= 6
    ? new Date(now.getFullYear(), 6, 1)           // July 1 this year
    : new Date(now.getFullYear() - 1, 6, 1);      // July 1 last year

  const fyYear = fyStart.getFullYear();
  const FY_MONTHS = new Set(["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"]);
  const MONTH_IDX = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  function inFiscalYtd(row) {
    const rYear = row.year;
    const rMon = row.month;
    if (!rYear || !rMon) return false;
    const rDate = new Date(rYear, MONTH_IDX[rMon] ?? 0, 1);
    return rDate >= fyStart && rDate <= now;
  }

  const ytdValue = allRows.filter(inFiscalYtd).reduce((s, r) => s + (r.netSales || 0), 0);

  // Same-month last year comparison
  const curMonthName = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][now.getMonth()];
  const prevYearValue = allRows
    .filter((r) => r.month === curMonthName && r.year === now.getFullYear() - 1)
    .reduce((s, r) => s + (r.netSales || 0), 0);

  const curMonthValue = allRows
    .filter((r) => r.month === curMonthName && r.year === now.getFullYear())
    .reduce((s, r) => s + (r.netSales || 0), 0);

  return { ytdValue, prevYearValue, curMonthValue, curMonthName };
}

// ── Animated number wrappers ─────────────────────────────────────────────────

function KpiTile({ label, value, sub, icon: Icon, hue, hero, summary, query, badge }) {
  return (
    <div className={"kpi-tile" + (hero ? " hero" : "")} style={{ "--tile-hue": `var(${hue})` }}>
      <WidgetInfo title={label} summary={summary} query={query} hueVar={hue} />
      <div className="kpi-icon"><Icon /></div>
      <div className="kpi-label">{label}{badge && <span className="kpi-badge">{badge}</span>}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function KpiStrip({ rows, primaryRows, options, allSecondaryRows }) {
  const { secondaryMeta } = useData();
  const totalOutlets = secondaryMeta?.outletCount || 0;

  // ── Secondary KPIs ──
  const secSalesRaw   = sumField(rows, "netSales");
  const secCtnRaw     = sumField(rows, "salesCtn");
  const secUnitsRaw   = sumField(rows, "units");
  const secOutletsRaw = distinctCount(rows, "outletCode");
  const productivePct = totalOutlets > 0 ? (secOutletsRaw / totalOutlets) * 100 : 0;
  const secDistRaw    = distinctCount(rows, "dist");

  // ── Primary KPIs ──
  const priSalesRaw = sumField(primaryRows, "netSales");
  const priCtnRaw   = sumField(primaryRows, "ctn");
  const priPcsRaw   = sumField(primaryRows, "pcs");
  const priInvRaw   = distinctCount(primaryRows, "invoice");

  // ── Segment mix (secondary — top 3 by value) ──
  const segments = segmentBreakdown(rows).slice(0, 3);

  // ── YTD (all secondary rows, unscoped by filter) ──
  const { ytdValue, prevYearValue, curMonthValue, curMonthName } = calcYtd(allSecondaryRows || rows);
  const ytdVsLy = prevYearValue > 0 ? ((curMonthValue - prevYearValue) / prevYearValue) * 100 : null;

  // Animated values
  const secSales  = useAnimatedNumber(secSalesRaw);
  const priSales  = useAnimatedNumber(priSalesRaw);
  const secCtn    = useAnimatedNumber(secCtnRaw);
  const priCtn    = useAnimatedNumber(priCtnRaw);
  const priPcs    = useAnimatedNumber(priPcsRaw);
  const secDist   = useAnimatedNumber(secDistRaw, 500);
  const outlets   = useAnimatedNumber(secOutletsRaw, 500);
  const prodPct   = useAnimatedNumber(productivePct, 500);
  const ytd       = useAnimatedNumber(ytdValue);
  const seg0Val   = useAnimatedNumber(segments[0]?.value || 0);
  const seg1Val   = useAnimatedNumber(segments[1]?.value || 0);
  const seg2Val   = useAnimatedNumber(segments[2]?.value || 0);

  const hasPrimary   = primaryRows.length > 0;
  const hasSecondary = rows.length > 0;

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Overview</div>
          <div className="widget-sub">Key figures for the current filter scope</div>
        </div>
      </div>

      {/* ── Primary Sales ── */}
      {hasPrimary && (
        <>
          <div className="kpi-section-label">Primary Sales</div>
          <div className="kpi-grid">
            <KpiTile
              hero
              label="Primary sales value"
              value={money(priSales)}
              sub={num(priInvRaw) + " invoices"}
              icon={WalletIcon}
              hue="--hue-bu"
              summary="Total net sales value from the SAP primary (factory) export for the current filter scope."
              query="SUM(Value) across all primary line items."
            />
            <KpiTile
              label="Primary volume"
              value={num(Math.round(priCtn)) + " CTN"}
              sub={num(Math.round(priPcs)) + " Pcs"}
              icon={BoxIcon}
              hue="--hue-cat"
              summary="Total shipped volume in cartons and pieces from primary sales."
              query="SUM(Qty In Ctn) and SUM(Qty In Pcs) across primary line items."
            />
            <KpiTile
              label="YTD sales"
              value={money(ytd)}
              sub={
                ytdVsLy !== null
                  ? `${curMonthName} vs LY: ${ytdVsLy >= 0 ? "+" : ""}${pct(ytdVsLy)}`
                  : `${curMonthName} vs LY: no prior-year data yet`
              }
              icon={TagIcon}
              hue="--hue-brand"
              summary="Year-to-date secondary net sales from July 1 (fiscal year start). Comparison shows current month vs same month last year."
              query="SUM(netSales) for secondary rows with date ≥ July 1 of current FY. LY comparison uses same calendar month in prior year."
            />
          </div>
        </>
      )}

      {/* ── Secondary Sales ── */}
      {hasSecondary && (
        <>
          <div className="kpi-section-label">Secondary Sales</div>
          <div className="kpi-grid">
            <KpiTile
              hero
              label="Secondary sales value"
              value={money(secSales)}
              sub={rows.length.toLocaleString() + " line items"}
              icon={WalletIcon}
              hue="--hue-ch"
              summary="Total net sales value from the secondary (distributor-to-retailer) export for the current filter scope."
              query="SUM(Net Sales) across all secondary line items."
            />
            <KpiTile
              label="Secondary volume"
              value={num(Math.round(secCtn)) + " CTN"}
              sub={num(Math.round(secUnitsRaw)) + " units"}
              icon={BoxIcon}
              hue="--hue-town"
              summary="Total shipped volume in cartons and units from secondary sales."
              query="SUM(Sales CTN) and SUM(Sales Units) across secondary line items."
            />
            <KpiTile
              label="Total store count"
              value={num(outlets)}
              sub={pct(prodPct) + " productive"}
              icon={MapPinIcon}
              hue="--hue-dist"
              summary="Distinct outlets served in this filter scope. Productive % = outlets with ≥1 sale ÷ total outlets in the full dataset."
              query="COUNT(DISTINCT outletCode) in scope; productive % = in-scope ÷ total dataset outlets."
            />
            <KpiTile
              label="Distributors active"
              value={num(Math.round(secDist))}
              sub={"of " + (options?.dist?.length || 0) + " total"}
              icon={TruckIcon}
              hue="--hue-src"
              summary="Distinct distributors with at least one sale in the current filter scope."
              query="COUNT(DISTINCT dist) within scope vs. total roster."
            />
          </div>
        </>
      )}

      {/* ── Segment-wise (Secondary source — top 3 channels) ── */}
      {hasSecondary && segments.length > 0 && (
        <>
          <div className="kpi-section-label">
            Segment-wise Sales
            <span className="kpi-badge kpi-badge--pending">Secondary source · Primary mapping pending</span>
          </div>
          <div className="kpi-grid">
            {[
              { seg: segments[0], val: seg0Val, hue: "--hue-bu"    },
              { seg: segments[1], val: seg1Val, hue: "--hue-brand"  },
              { seg: segments[2], val: seg2Val, hue: "--hue-risk"   },
            ].filter((s) => s.seg).map(({ seg, val, hue }) => (
              <KpiTile
                key={seg.label}
                label={seg.label}
                value={money(val)}
                sub={secSalesRaw > 0 ? pct((seg.value / secSalesRaw) * 100) + " of secondary" : "—"}
                icon={LayersIcon}
                hue={hue}
                summary={`Net sales for segment "${seg.label}" (secondary data source).`}
                query={`SUM(netSales) WHERE segment = '${seg.label}'.`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
