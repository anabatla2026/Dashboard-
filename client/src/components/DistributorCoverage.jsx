import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import { num } from "../lib/format";
import WidgetInfo from "./WidgetInfo";

// Distributor/store reference counts — not per-transaction fact data, so not
// scoped by the global filter bar. Sourced from "Distributor Count detail"
// (the SalesFlo route roster) and the "Distributor Mapping" sheet in "Target
// Compile FTM", which reconciles SalesFlo-only distributor codes (contain
// "D") against SAP codes (numeric) — the gap flagged as blocked in
// dashboard-query-reference.md §4 "Cross-source Distributor Performance".

function CoverageTile({ label, value, hue }) {
  const animated = useAnimatedNumber(typeof value === "number" ? value : 0, 400);
  return (
    <div className="coverage-tile" style={{ "--tile-hue": hue }}>
      <div className="coverage-tile-value">{typeof value === "number" ? num(Math.round(animated)) : "—"}</div>
      <div className="coverage-tile-label">{label}</div>
    </div>
  );
}

export default function DistributorCoverage({ coverage }) {
  if (!coverage) return null;

  const {
    totalDistributors,
    totalStores,
    commonDistributors,
    onlySalesfloDistributors,
    onlySapDistributors,
    totalPrimaryDistributors,
    totalSecondaryDistributors,
  } = coverage;

  return (
    <div className="widget">
      <div className="widget-head">
        <div className="widget-head-main">
          <div className="widget-title">Distributor &amp; Store Coverage</div>
          <div className="widget-sub">Route roster + SAP/SalesFlo reconciliation · not scoped by the filter bar</div>
        </div>
        <div className="widget-controls">
          <WidgetInfo
            title="Distributor & Store Coverage"
            summary="Total Distributor and Total Stores come from the distributor route roster (distinct Distributor Code / StoreCode). Common Distributors are SalesFlo codes mapped to a valid SAP code; Only SalesFlo have no such mapping; Only SAP have no SalesFlo code at all. Total Primary Distributors = Common + Only SAP; Total Secondary Distributors = Common + Only SalesFlo."
            query={
              "SELECT COUNT(DISTINCT Distributor_Code), COUNT(DISTINCT StoreCode) FROM Distributor_Count_detail;\n\n" +
              "-- Common: DistributorCode LIKE '%D%' AND Sap code present AND not LIKE '%D%'\n" +
              "-- Only SalesFlo: DistributorCode LIKE '%D%' AND (Sap NULL OR Sap LIKE '%D%')\n" +
              "-- Only SAP: DistributorCode NOT LIKE '%D%' AND Sap present AND not LIKE '%D%'\n" +
              "-- Total Primary = Common + Only SAP · Total Secondary = Common + Only SalesFlo"
            }
          />
        </div>
      </div>
      <div className="coverage-grid">
        <CoverageTile label="Total Distributors" value={totalDistributors} hue="var(--hue-dist)" />
        <CoverageTile label="Total Stores" value={totalStores} hue="var(--hue-dist)" />
        <CoverageTile label="Common Distributors" value={commonDistributors} hue="var(--hue-src)" />
        <CoverageTile label="Only SalesFlo" value={onlySalesfloDistributors} hue="var(--hue-src)" />
        <CoverageTile label="Only SAP" value={onlySapDistributors} hue="var(--hue-src)" />
        <CoverageTile label="Total Primary Distributors" value={totalPrimaryDistributors} hue="var(--hue-bu)" />
        <CoverageTile label="Total Secondary Distributors" value={totalSecondaryDistributors} hue="var(--hue-ch)" />
      </div>
    </div>
  );
}
