import { useMemo, useState } from "react";
import { compact, num, pct } from "../lib/format";
import WidgetInfo from "./WidgetInfo";

const COLS = [
  { key: "rank",       label: "#",                type: "num" },
  { key: "brand",      label: "Brand",            type: "str" },
  { key: "secSales",   label: "Secondary (Rs)",   type: "num" },
  { key: "priSales",   label: "Primary (Rs)",     type: "num" },
  { key: "secShare",   label: "Sec share",        type: "num" },
  { key: "priCtn",     label: "Pri CTN",          type: "num" },
  { key: "priPcs",     label: "Pri Pcs",          type: "num" },
  { key: "secCtn",     label: "Sec CTN",          type: "num" },
];

function aggregateBrand(secRows, priRows) {
  const secMap = new Map();
  for (const r of secRows) {
    const b = r.brand || "—";
    let e = secMap.get(b);
    if (!e) e = { netSales: 0, salesCtn: 0 };
    e.netSales  += r.netSales  || 0;
    e.salesCtn  += r.salesCtn  || 0;
    secMap.set(b, e);
  }

  const priMap = new Map();
  for (const r of priRows) {
    const b = r.brand || "—";
    let e = priMap.get(b);
    if (!e) e = { netSales: 0, ctn: 0, pcs: 0 };
    e.netSales += r.netSales || 0;
    e.ctn      += r.ctn      || 0;
    e.pcs      += r.pcs      || 0;
    priMap.set(b, e);
  }

  const allBrands = new Set([...secMap.keys(), ...priMap.keys()]);
  const secTotal = Array.from(secMap.values()).reduce((s, e) => s + e.netSales, 0);

  return Array.from(allBrands)
    .map((brand) => {
      const sec = secMap.get(brand) || { netSales: 0, salesCtn: 0 };
      const pri = priMap.get(brand) || { netSales: 0, ctn: 0, pcs: 0 };
      return {
        brand,
        secSales: sec.netSales,
        secCtn:   Math.round(sec.salesCtn),
        priSales: pri.netSales,
        priCtn:   Math.round(pri.ctn),
        priPcs:   Math.round(pri.pcs),
        secShare: secTotal > 0 ? (sec.netSales / secTotal) * 100 : 0,
      };
    })
    .sort((a, b) => (b.secSales + b.priSales) - (a.secSales + a.priSales));
}

export default function BrandTable({ rows, primaryRows }) {
  const [sortKey, setSortKey] = useState("secSales");
  const [sortDir, setSortDir] = useState("desc");

  const data    = useMemo(() => aggregateBrand(rows, primaryRows), [rows, primaryRows]);
  const maxSec  = data.length ? Math.max(...data.map((r) => r.secSales)) : 0;

  const sorted = useMemo(() => {
    if (sortKey === "rank") return sortDir === "asc" ? data : data.slice().reverse();
    return data.slice().sort((a, b) => {
      const c = typeof a[sortKey] === "number" ? a[sortKey] - b[sortKey] : String(a[sortKey]).localeCompare(String(b[sortKey]));
      return sortDir === "asc" ? c : -c;
    });
  }, [data, sortKey, sortDir]);

  function onSort(col) {
    if (col.key === "brand") return;
    if (sortKey === col.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col.key); setSortDir("desc"); }
  }

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Brand performance</div>
          <div className="widget-sub">Primary vs secondary sales side by side, per brand</div>
        </div>
        <div className="widget-controls">
          <WidgetInfo
            title="Brand performance"
            summary="Side-by-side comparison of every brand's secondary net sales (distributor), primary net sales (factory), and volume in cartons and pieces."
            query="Brands joined across primary and secondary datasets; SUM(netSales), SUM(salesCtn), SUM(ctn), SUM(pcs) per brand."
            tip="Click any column header to sort."
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
                  style={c.key === "brand" ? { cursor: "default" } : undefined}
                >
                  {c.label}
                  <span className="arrow">{sortKey === c.key ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.brand}>
                <td className="num">{i + 1}</td>
                <td className="strong">{r.brand}</td>
                <td className="num">
                  <div className="rank-bar-wrap">
                    <div className="rank-bar" style={{ width: maxSec > 0 ? (r.secSales / maxSec) * 100 + "%" : "0%" }} />
                    <span>{compact(r.secSales)}</span>
                  </div>
                </td>
                <td className="num">{r.priSales > 0 ? compact(r.priSales) : "—"}</td>
                <td className="num">{pct(r.secShare)}</td>
                <td className="num">{r.priCtn > 0 ? num(r.priCtn) : "—"}</td>
                <td className="num">{r.priPcs > 0 ? num(r.priPcs) : "—"}</td>
                <td className="num">{r.secCtn > 0 ? num(r.secCtn) : "—"}</td>
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
