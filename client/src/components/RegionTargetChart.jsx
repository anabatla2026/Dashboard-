import { useMemo } from "react";
import { useServerQuery } from "../hooks/useServerQuery";
import { useElementWidth } from "../hooks/useElementWidth";
import { useData } from "../context/DataContext";
import { secondaryApi } from "../lib/secondaryApi";
import DualBarChart from "./charts/DualBarChart";
import WidgetInfo from "./WidgetInfo";

// Region-wise Target vs Achievement — previously blocked (see
// dashboard-query-reference.md §4): Target data's region names and Sales
// data's region names were two disjoint taxonomies with no overlap. Fixed
// 2026-09-15 when the data team remapped GOLD.salesflo_datadump_vw's REGION
// column onto DISTRIBUTOR_MASTER_VW's NEW_REGION taxonomy. Kept as its own
// small component rather than folded into ChartCard's generic drill
// machinery: Target only exists at region granularity (no town/distributor
// breakdown), so this widget is intentionally not drillable.
export default function RegionTargetChart({ year, month, className = "" }) {
  const { refreshKey } = useData();
  const key = `${year}|${month}|${refreshKey}`;
  const { data, loading } = useServerQuery(() => secondaryApi.regionTarget({ year, month }), [key], []);

  const rows = useMemo(
    () =>
      (data || [])
        .map((r) => ({ label: r.region, secondary: r.achievement, primary: r.target }))
        .sort((a, b) => b.primary + b.secondary - (a.primary + a.secondary)),
    [data]
  );

  const [bodyRef, width] = useElementWidth(900);

  return (
    <div className={"widget chart-card " + className} style={{ "--card-hue": "var(--hue-town)" }}>
      <div className="widget-head">
        <div className="widget-head-main">
          <div className="widget-title">Region-wise Target vs Achievement (Secondary)</div>
          <div className="widget-sub">Achievement vs Target</div>
        </div>
        <div className="widget-controls">
          <WidgetInfo
            title="Region-wise Target vs Achievement"
            summary="Secondary net sales achievement against the monthly sales target for each region, for the resolved MTD period. Target is rolled up from each distributor's target (via the distributor-to-region mapping); Achievement is actual net sales for the same month."
            query="SUM(TARGETS.VALUE) grouped by region (joined through DISTRIBUTOR_MASTER), vs SUM(NET_SALES) grouped by region — same resolved month as the KPI cards."
          />
        </div>
      </div>
      <div ref={bodyRef} className="chart-body">
        {!loading && rows.length === 0 ? (
          <div className="chart-empty">No data for current filters</div>
        ) : (
          <DualBarChart rows={rows} hueVarA="--hue-ch" hueVarB="--hue-town" labelA="Achievement" labelB="Target" width={width} />
        )}
      </div>
    </div>
  );
}
