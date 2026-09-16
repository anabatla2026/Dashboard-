import { useMemo, useState } from "react";
import { compact } from "../lib/format";
import { FISCAL_MONTH_ORDER } from "../lib/period";
import { useSecondaryMonthOverMonth, usePrimaryMonthOverMonth } from "../hooks/useMonthOverMonthServer";
import WidgetInfo from "./WidgetInfo";

// Replaces the old Distributor Performance table per MOM 2026-09-02 §6.
// Layout: Month | Primary Sales Value | Secondary Sales Value, filterable by
// Fiscal Year (a local selector, independent of the global filter bar). Both
// sides are Snowflake-backed (see hooks/useMonthOverMonthServer.js). The
// Region selector this widget used to have has been removed — the DE asked
// (2026-09-16) to disable Region on both Primary and Secondary's MoM for
// now, pending a proper region mapping.
function toMonthMap(rows) {
  const map = new Map(FISCAL_MONTH_ORDER.map((m) => [m, 0]));
  for (const r of rows) map.set(r.month, (map.get(r.month) || 0) + (r.netSales || 0));
  return map;
}

// The fiscal year (1 July start) a given 'YYYY-MM-DD' date string falls in.
function fyOfDateStr(s) {
  const d = new Date(`${s}T00:00:00`);
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
}

function fiscalYearRange(dateRange) {
  if (!dateRange?.min || !dateRange?.max) return [];
  const from = fyOfDateStr(dateRange.min);
  const to = fyOfDateStr(dateRange.max);
  const years = [];
  for (let y = to; y >= from; y--) years.push(y);
  return years;
}

export default function MonthOverMonthTable({ filters, secondaryDateRange, primaryDateRange }) {
  const fyOptions = useMemo(() => {
    const years = new Set([...fiscalYearRange(secondaryDateRange), ...fiscalYearRange(primaryDateRange)]);
    return Array.from(years).sort((a, b) => b - a);
  }, [secondaryDateRange, primaryDateRange]);

  const [selectedFY, setSelectedFY] = useState(null);
  const fyYear = selectedFY != null && fyOptions.includes(selectedFY) ? selectedFY : fyOptions[0] ?? null;
  const fiscalYearStart = fyYear != null ? `${fyYear}-07-01` : null;

  const { mom: secMom } = useSecondaryMonthOverMonth({ fiscalYearStart, filters });
  const { mom: priMom } = usePrimaryMonthOverMonth({ fiscalYearStart, filters });

  const secByMonth = useMemo(() => toMonthMap(secMom), [secMom]);
  const priByMonth = useMemo(() => toMonthMap(priMom), [priMom]);

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Month-over-Month Sales</div>
          <div className="widget-sub">Primary &amp; Secondary</div>
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
            summary="Primary and Secondary net sales for every month of the selected fiscal year (1 July – 30 June), side by side. Replaces the old Distributor Performance table per the 2026-09-02 requirements review. Fiscal Year is a local selector on this widget, independent of the global filter bar — the fiscal year list is built from each source's known date range, so it grows automatically as more is loaded. Region filtering is temporarily disabled on this widget pending a data mapping fix."
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
