import { useMemo, useState } from "react";
import { compact, num, pct } from "../lib/format";
import WidgetInfo from "./WidgetInfo";

const COLS = [
  { key: "rank",     label: "#",            type: "num",     width: "6%" },
  { key: "region",   label: "Region",       type: "str",     width: "15%" },
  { key: "target",   label: "Target",       type: "pending", width: "11%" },
  { key: "netSales", label: "Sec. sales",   type: "num",     width: "15%" },
  { key: "ach",      label: "Ach. %",       type: "pending", width: "9%" },
  { key: "share",    label: "Share",        type: "num",     width: "9%" },
  { key: "salesCtn", label: "Volume (CTN)", type: "num",     width: "12%" },
  { key: "outlets",  label: "Outlets",      type: "num",     width: "10%" },
  { key: "avgDrop",  label: "Drop size",    type: "num",     width: "13%" },
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
    if (col.type !== "num") return;
    if (sortKey === col.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col.key); setSortDir("desc"); }
  }

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Region-wise Targets &amp; Achievement</div>
          <div className="widget-sub">
            Secondary sales by region <span className="kpi-badge kpi-badge--pending">Target pending</span>
          </div>
        </div>
        <div className="widget-controls">
          <WidgetInfo
            title="Region-wise Targets & Achievement"
            summary="Secondary net sales, volume, outlets served, and drop size grouped by region. Target and Achievement % are reserved columns — populated once region-wise targets are supplied. Primary sales aren't broken out here: the primary export has no region field, only City."
            query="Grouped by Region: SUM(netSales), SUM(salesCtn), COUNT(DISTINCT outletCode); drop size = netSales ÷ outlets. Achievement % = netSales ÷ Target, once Target is available."
            tip="Click any numeric column header to sort."
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
              <tr key={r.region}>
                <td className="num">{i + 1}</td>
                <td className="strong">{r.region}</td>
                <td className="num muted">Pending</td>
                <td className="num">
                  <div className="rank-bar-wrap">
                    <div className="rank-bar" style={{ width: maxVal > 0 ? (r.netSales / maxVal) * 100 + "%" : "0%" }} />
                    <span>{compact(r.netSales)}</span>
                  </div>
                </td>
                <td className="num muted">—</td>
                <td className="num">{pct(r.share)}</td>
                <td className="num">{num(r.salesCtn)}</td>
                <td className="num">{num(r.outlets)}</td>
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
