import { useMemo, useState } from "react";
import { compact, num, pct } from "../lib/format";
import WidgetInfo from "./WidgetInfo";

const COLS = [
  { key: "rank",     label: "#",            type: "num" },
  { key: "region",   label: "Region",       type: "str" },
  { key: "netSales", label: "Net sales",    type: "num" },
  { key: "share",    label: "Share",        type: "num" },
  { key: "salesCtn", label: "Volume (CTN)", type: "num" },
  { key: "outlets",  label: "Outlets",      type: "num" },
  { key: "dists",    label: "Distributors", type: "num" },
  { key: "avgDrop",  label: "Drop size",    type: "num" },
];

function aggregate(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.region || "—";
    let e = map.get(key);
    if (!e) {
      e = { region: key, netSales: 0, salesCtn: 0, outletSet: new Set(), distSet: new Set(), invoiceSet: new Set() };
      map.set(key, e);
    }
    e.netSales  += r.netSales  || 0;
    e.salesCtn  += r.salesCtn  || 0;
    e.outletSet.add(r.outletCode);
    e.distSet.add(r.dist);
    e.invoiceSet.add(r.invoice);
  }
  const total = Array.from(map.values()).reduce((s, e) => s + e.netSales, 0);
  return Array.from(map.values())
    .map((e) => ({
      region:   e.region,
      netSales: e.netSales,
      salesCtn: Math.round(e.salesCtn),
      outlets:  e.outletSet.size,
      dists:    e.distSet.size,
      invoices: e.invoiceSet.size,
      share:    total > 0 ? (e.netSales / total) * 100 : 0,
      avgDrop:  e.outletSet.size > 0 ? e.netSales / e.outletSet.size : 0,
    }))
    .sort((a, b) => b.netSales - a.netSales);
}

export default function RegionTable({ rows }) {
  const [sortKey, setSortKey] = useState("netSales");
  const [sortDir, setSortDir] = useState("desc");

  const data   = useMemo(() => aggregate(rows), [rows]);
  const maxVal = data.length ? data[0].netSales : 0;

  const sorted = useMemo(() => {
    if (sortKey === "rank") return sortDir === "asc" ? data : data.slice().reverse();
    return data.slice().sort((a, b) => {
      const c = typeof a[sortKey] === "number" ? a[sortKey] - b[sortKey] : String(a[sortKey]).localeCompare(String(b[sortKey]));
      return sortDir === "asc" ? c : -c;
    });
  }, [data, sortKey, sortDir]);

  function onSort(col) {
    if (col.key === "region") return;
    if (sortKey === col.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col.key); setSortDir("desc"); }
  }

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Region-wise performance</div>
          <div className="widget-sub">Secondary sales aggregated by region</div>
        </div>
        <div className="widget-controls">
          <WidgetInfo
            title="Region-wise performance"
            summary="Secondary net sales, volume (cartons), outlets served, active distributors, and average drop size grouped by region."
            query="Grouped by Region: SUM(netSales), SUM(salesCtn), COUNT(DISTINCT outletCode), COUNT(DISTINCT dist); drop size = netSales ÷ outlets."
            tip="Click any numeric column header to sort."
          />
        </div>
      </div>
      <div className="table-wrap" style={{ margin: "12px 16px 16px" }}>
        <table>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={c.type === "num" ? "num" : ""}
                  onClick={() => onSort(c)}
                  style={c.key === "region" ? { cursor: "default" } : undefined}
                >
                  {c.label}
                  <span className="arrow">{sortKey === c.key ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.region}>
                <td className="num">{i + 1}</td>
                <td className="strong">{r.region}</td>
                <td className="num">
                  <div className="rank-bar-wrap">
                    <div className="rank-bar" style={{ width: maxVal > 0 ? (r.netSales / maxVal) * 100 + "%" : "0%" }} />
                    <span>{compact(r.netSales)}</span>
                  </div>
                </td>
                <td className="num">{pct(r.share)}</td>
                <td className="num">{num(r.salesCtn)}</td>
                <td className="num">{num(r.outlets)}</td>
                <td className="num">{num(r.dists)}</td>
                <td className="num">{compact(r.avgDrop)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLS.length} style={{ textAlign: "center", padding: "24px" }}>
                  No data for current filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
