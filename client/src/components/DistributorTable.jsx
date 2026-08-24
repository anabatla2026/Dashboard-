import { useMemo, useState } from "react";
import { compact, num, pct } from "../lib/format";

const COLS = [
  { key: "rank", label: "#", type: "num" },
  { key: "dist", label: "Distributor", type: "str" },
  { key: "netSales", label: "Net sales", type: "num" },
  { key: "share", label: "Share", type: "num" },
  { key: "volume", label: "Volume (T)", type: "num" },
  { key: "units", label: "Units", type: "num" },
  { key: "invoices", label: "Invoices", type: "num" },
  { key: "outlets", label: "Outlets", type: "num" },
  { key: "avgInvoice", label: "Avg invoice", type: "num" },
];

function aggregate(rows) {
  const map = new Map();
  for (const r of rows) {
    let e = map.get(r.dist);
    if (!e) {
      e = { dist: r.dist, netSales: 0, volume: 0, units: 0, invoiceSet: new Set(), outletSet: new Set() };
      map.set(r.dist, e);
    }
    e.netSales += r.netSales;
    e.volume += r.volume;
    e.units += r.units;
    e.invoiceSet.add(r.invoice);
    e.outletSet.add(r.outletCode);
  }
  const total = Array.from(map.values()).reduce((s, e) => s + e.netSales, 0);
  return Array.from(map.values())
    .map((e) => ({
      dist: e.dist,
      netSales: e.netSales,
      volume: e.volume,
      units: e.units,
      invoices: e.invoiceSet.size,
      outlets: e.outletSet.size,
      avgInvoice: e.invoiceSet.size > 0 ? e.netSales / e.invoiceSet.size : 0,
      share: total > 0 ? (e.netSales / total) * 100 : 0,
    }))
    .sort((a, b) => b.netSales - a.netSales);
}

export default function DistributorTable({ rows }) {
  const [sortKey, setSortKey] = useState("netSales");
  const [sortDir, setSortDir] = useState("desc");

  const data = useMemo(() => aggregate(rows), [rows]);
  const maxNetSales = data.length ? data[0].netSales : 0;

  const sorted = useMemo(() => {
    if (sortKey === "rank") return sortDir === "asc" ? data : data.slice().reverse();
    return data.slice().sort((a, b) => {
      const c = a[sortKey] - b[sortKey];
      return sortDir === "asc" ? c : -c;
    });
  }, [data, sortKey, sortDir]);

  function onSort(col) {
    if (col.key === "dist") return;
    if (sortKey === col.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(col.key);
      setSortDir("desc");
    }
  }

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Distributor performance</div>
          <div className="widget-sub">Ranked leaderboard for the current filter scope</div>
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
                  style={c.key === "dist" ? { cursor: "default" } : undefined}
                >
                  {c.label}
                  <span className="arrow">{sortKey === c.key ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.dist}>
                <td className="num">{i + 1}</td>
                <td className="strong">{r.dist}</td>
                <td className="num">
                  <div className="rank-bar-wrap">
                    <div className="rank-bar" style={{ width: (r.netSales / maxNetSales) * 100 + "%" }} />
                    <span>{compact(r.netSales)}</span>
                  </div>
                </td>
                <td className="num">{pct(r.share)}</td>
                <td className="num">{r.volume.toFixed(2)}</td>
                <td className="num">{num(r.units)}</td>
                <td className="num">{num(r.invoices)}</td>
                <td className="num">{num(r.outlets)}</td>
                <td className="num">{compact(r.avgInvoice)}</td>
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
