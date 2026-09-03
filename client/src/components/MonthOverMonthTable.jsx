import { useMemo, useState } from "react";
import { compact } from "../lib/format";
import { calendarYearInFiscalYear, rowFiscalYear, FISCAL_MONTH_ORDER } from "../lib/period";
import WidgetInfo from "./WidgetInfo";

// Replaces the old Distributor Performance table per MOM 2026-09-02 §6.
// Layout is exactly as specified: Month | Primary Sales Value | Secondary
// Sales Value, filterable by Fiscal Year and Region. Region comes from the
// global filter bar (rows passed in are already region-scoped, but NOT
// year/month-scoped — see App.jsx); Fiscal Year is its own selector here
// since the global Year filter is a calendar year, not a fiscal one, and
// this widget needs to offer every FY actually present in the data.
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

export default function MonthOverMonthTable({ secondaryRows, primaryRows }) {
  const fyOptions = useMemo(
    () => availableFiscalYears([...secondaryRows, ...primaryRows]),
    [secondaryRows, primaryRows]
  );
  const [selectedFY, setSelectedFY] = useState(null);
  const fyYear = selectedFY != null && fyOptions.includes(selectedFY) ? selectedFY : fyOptions[0] ?? null;

  const { priByMonth, secByMonth } = useMemo(
    () => ({
      priByMonth: sumByFiscalMonth(primaryRows, fyYear),
      secByMonth: sumByFiscalMonth(secondaryRows, fyYear),
    }),
    [primaryRows, secondaryRows, fyYear]
  );

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Month-over-Month Sales</div>
          <div className="widget-sub">
            Primary &amp; Secondary · respects the Region filter
          </div>
        </div>
        <div className="widget-controls">
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
            summary="Primary and Secondary net sales for every month of the selected fiscal year (1 July – 30 June), side by side. Replaces the old Distributor Performance table per the 2026-09-02 requirements review. Filterable by Fiscal Year (selector here) and Region (global filter bar) — the fiscal year list is built from whatever years actually exist in the data, so it grows automatically as more is loaded."
            query="SUM(netSales) grouped by fiscal month, primary vs secondary, for the selected fiscal year."
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
