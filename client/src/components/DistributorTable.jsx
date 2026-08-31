import { useMemo, useState } from "react";
import { compact, num, pct } from "../lib/format";
import WidgetInfo from "./WidgetInfo";

const COLS = [
  { key: "rank",       label: "#",            type: "num",     width: "6%" },
  { key: "dist",       label: "Distributor",  type: "str",     width: "19%" },
  { key: "target",     label: "Target",       type: "pending", width: "10%" },
  { key: "volume",     label: "Volume (CTN)", type: "num",     width: "9%" },
  { key: "netSales",   label: "Value",        type: "num",     width: "10%" },
  { key: "volShare",   label: "Volume %",     type: "num",     width: "8%" },
  { key: "share",      label: "Value %",      type: "num",     width: "8%" },
  { key: "outlets",    label: "Total outlets",type: "num",     width: "10%" },
  { key: "prodOutlets",label: "Prod. outlets",type: "pending", width: "10%" },
  { key: "avgDrop",    label: "Drop size",    type: "num",     width: "10%" },
];

function aggregate(rows) {
  const map = new Map();
  for (const r of rows) {
    let e = map.get(r.dist);
    if (!e) {
      e = { dist: r.dist, netSales: 0, volume: 0, outletSet: new Set() };
      map.set(r.dist, e);
    }
    e.netSales += r.netSales || 0;
    e.volume += r.salesCtn || 0;
    e.outletSet.add(r.outletCode);
  }
  const list = Array.from(map.values());
  const totalSales = list.reduce((s, e) => s + e.netSales, 0);
  const totalVolume = list.reduce((s, e) => s + e.volume, 0);
  return list
    .map((e) => ({
      dist: e.dist,
      netSales: e.netSales,
      volume: Math.round(e.volume),
      outlets: e.outletSet.size,
      avgDrop: e.outletSet.size > 0 ? e.netSales / e.outletSet.size : 0,
      share: totalSales > 0 ? (e.netSales / totalSales) * 100 : 0,
      volShare: totalVolume > 0 ? (e.volume / totalVolume) * 100 : 0,
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
    if (col.type !== "num") return;
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
          <div className="widget-title">Distributor Performance</div>
          <div className="widget-sub">
            Ranked for the current filter scope <span className="kpi-badge kpi-badge--pending">Target &amp; productive outlets pending</span>
          </div>
        </div>
        <div className="widget-controls">
          <WidgetInfo
            title="Distributor Performance"
            summary="Every distributor with at least one matching sale, ranked by value, with volume, value/volume share, outlets served, and drop size. Target and Productive Outlets are reserved columns — Target needs a per-distributor target list, and Productive Outlets needs a master outlet roster to compute the served/total ratio against."
            query="Grouped by Distributor: SUM(netSales), SUM(salesCtn), COUNT(DISTINCT outletCode); drop size = netSales ÷ outlets; value %/volume % = share of the totals across all distributors in scope."
            tip="Click any numeric column header to sort by it."
          />
        </div>
      </div>
      <div className="table-wrap" style={{ margin: "10px 14px 14px" }}>
        <table>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={c.type === "num" ? "num" : c.type === "pending" ? "num muted" : ""}
                  onClick={() => onSort(c)}
                  style={{ width: c.width, cursor: c.type !== "num" ? "default" : undefined }}
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
                <td className="num muted">Pending</td>
                <td className="num">{num(r.volume)}</td>
                <td className="num">
                  <div className="rank-bar-wrap">
                    <div className="rank-bar" style={{ width: (r.netSales / maxNetSales) * 100 + "%" }} />
                    <span>{compact(r.netSales)}</span>
                  </div>
                </td>
                <td className="num">{pct(r.volShare)}</td>
                <td className="num">{pct(r.share)}</td>
                <td className="num">{num(r.outlets)}</td>
                <td className="num muted">Pending</td>
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
