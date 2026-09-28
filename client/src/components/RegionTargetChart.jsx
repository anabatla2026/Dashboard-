import { useMemo, useState } from "react";
import { useServerQuery } from "../hooks/useServerQuery";
import { useElementWidth } from "../hooks/useElementWidth";
import { useData } from "../context/DataContext";
import { secondaryApi } from "../lib/secondaryApi";
import { filtersToParam } from "../lib/filtersToParam";
import DualBarChart from "./charts/DualBarChart";
import WidgetInfo from "./WidgetInfo";

// Region-wise Target vs Achievement. Kept as its own small component rather
// than folded into ChartCard's generic drill machinery: Target only exists
// at region granularity (no town/distributor breakdown), so this widget is
// intentionally not drillable. Only Year/Month apply here (each
// independently multi-select); both MTD and FYTD are computed server-side —
// this just toggles which one is displayed, same pattern as
// Month-over-Month's fiscal-year select.
export default function RegionTargetChart({ filters, className = "" }) {
  const { refreshKey } = useData();
  const [mode, setMode] = useState("mtd");
  const param = filtersToParam(filters);
  const key = `${JSON.stringify(param)}|${refreshKey}`;
  const { data, loading } = useServerQuery(() => secondaryApi.regionTarget(param), [key], []);

  const rows = useMemo(
    () =>
      (data || [])
        .map((r) => ({ label: r.region, secondary: r[mode].achievement, primary: r[mode].target }))
        // Regions with neither achievement nor target are just empty rows — drop them.
        .filter((r) => Number(r.primary) || Number(r.secondary))
        .sort((a, b) => b.primary + b.secondary - (a.primary + a.secondary)),
    [data, mode]
  );

  const [bodyRef, width] = useElementWidth(900);

  return (
    <div className={"widget chart-card " + className} style={{ "--card-hue": "var(--hue-town)" }}>
      <div className="widget-head">
        <div className="widget-head-main">
          <div className="widget-title">Region-wise Target vs Achievement (Secondary)</div>
          <div className="widget-sub">Achievement vs Target · {mode === "mtd" ? "MTD" : "FYTD"}</div>
        </div>
        <div className="widget-controls">
          <select className="fy-select" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="MTD or FYTD">
            <option value="mtd">MTD</option>
            <option value="ytd">FYTD</option>
          </select>
          <WidgetInfo
            title="Region-wise Target vs Achievement"
            summary="Secondary net sales achievement against the monthly sales target for each region — MTD and FYTD, toggled by the dropdown. Target is rolled up from each distributor's target (via the distributor-to-region mapping); Achievement is actual net sales for the same period. Only Year/Month filter this widget."
            query="SUM(TARGETS_VW.VALUE) grouped by region (joined through DISTRIBUTOR_MASTER_VW, matched on TARGETS_VW's calendar year/month), vs SUM(NET_SALES) grouped by region — same resolved MTD/FYTD period as the KPI cards."
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
