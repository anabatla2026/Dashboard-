import { useMemo, useState } from "react";
import { compact } from "../lib/format";
import { calendarYearInFiscalYear, rowFiscalYear, FISCAL_MONTH_ORDER } from "../lib/period";
import WidgetInfo from "./WidgetInfo";
import DimFilter from "./DimFilter";

// Replaces the old Distributor Performance table per MOM 2026-09-02 §6.
// Layout is exactly as specified: Month | Primary Sales Value | Secondary
// Sales Value, filterable by Fiscal Year and Region — both as local
// selectors on this widget itself, independent of the global filter bar
// (rows passed in are pre-scoped by everything else, but not by
// year/month/region — see App.jsx). Region only applies to secondary rows:
// primary has no region field at all.
function sumByFiscalMonth(rows, fyYear) {
  const map = new Map(FISCAL_MONTH_ORDER.map((m) => [m, 0]));
  for (const r of rows) {
    if (!r.year || !r.month || !map.has(r.month)) continue;
    if (calendarYearInFiscalYear(r.month, fyYear) !== r.year) continue;
    map.set(r.month, map.get(r.month) + (r.netSales || 0));
  }
  return map;
}

function availableFiscalYears(rows) {
  const years = new Set();
  for (const r of rows) {
    const fy = rowFiscalYear(r.year, r.month);
    if (fy != null) years.add(fy);
  }
  return Array.from(years).sort((a, b) => b - a);
}

export default function MonthOverMonthTable({ secondaryRows, primaryRows, regionOptions = [] }) {
  const [selectedRegions, setSelectedRegions] = useState(new Set());

  const regionScopedSecondary = useMemo(
    () => (selectedRegions.size === 0 ? secondaryRows : secondaryRows.filter((r) => selectedRegions.has(r.region))),
    [secondaryRows, selectedRegions]
  );

  const fyOptions = useMemo(
    () => availableFiscalYears([...regionScopedSecondary, ...primaryRows]),
    [regionScopedSecondary, primaryRows]
  );
  const [selectedFY, setSelectedFY] = useState(null);
  const fyYear = selectedFY != null && fyOptions.includes(selectedFY) ? selectedFY : fyOptions[0] ?? null;

  const { priByMonth, secByMonth } = useMemo(
    () => ({
      priByMonth: sumByFiscalMonth(primaryRows, fyYear),
      secByMonth: sumByFiscalMonth(regionScopedSecondary, fyYear),
    }),
    [primaryRows, regionScopedSecondary, fyYear]
  );

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Month-over-Month Sales</div>
          <div className="widget-sub">Primary &amp; Secondary — Region filter applies to Secondary only (no region field in primary)</div>
        </div>
        <div className="widget-controls">
          {regionOptions.length > 0 && (
            <DimFilter label="Region" options={regionOptions} selected={selectedRegions} onChange={setSelectedRegions} />
          )}
          {fyOptions.length > 0 && (
            <select
              className="fy-select"
              value={fyYear ?? ""}
              onChange={(e) => setSelectedFY(Number(e.target.value))}
              aria-label="Fiscal year"
            >
              {fyOptions.map((fy) => (
                <option key={fy} value={fy}>
                  FY {fy}–{fy + 1}
                </option>
              ))}
            </select>
          )}
          <WidgetInfo
            title="Month-over-Month Sales"
            summary="Primary and Secondary net sales for every month of the selected fiscal year (1 July – 30 June), side by side. Replaces the old Distributor Performance table per the 2026-09-02 requirements review. Fiscal Year and Region are both local selectors on this widget, independent of the global filter bar — the fiscal year list is built from whatever years actually exist in the data, so it grows automatically as more is loaded. Region only narrows Secondary: Primary's SAP export has no region field."
            query="SUM(netSales) grouped by fiscal month, primary vs secondary (secondary filtered by selected region), for the selected fiscal year."
          />
        </div>
      </div>
      <div className="table-wrap" style={{ margin: "10px 14px 14px" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Month</th>
              <th className="num" style={{ width: "33%" }}>Primary sales value</th>
              <th className="num" style={{ width: "33%" }}>Secondary sales value</th>
            </tr>
          </thead>
          <tbody>
            {fyYear == null ? (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", padding: "24px" }}>
                  No data for current filters
                </td>
              </tr>
            ) : (
              FISCAL_MONTH_ORDER.map((m) => {
                const pri = priByMonth.get(m) || 0;
                const sec = secByMonth.get(m) || 0;
                return (
                  <tr key={m}>
                    <td className="strong">{m}</td>
                    <td className="num">{pri > 0 ? compact(pri) : "—"}</td>
                    <td className="num">{sec > 0 ? compact(sec) : "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
