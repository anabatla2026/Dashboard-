import { useMemo, useState } from "react";
import { num } from "../lib/format";

const PAGE_SIZE = 25;

const COLS = [
  { key: "invoice", label: "Invoice", type: "str", strong: true },
  { key: "dist", label: "Distributor", type: "str" },
  { key: "town", label: "Town", type: "str" },
  { key: "chType", label: "Channel", type: "str" },
  { key: "bu", label: "Business unit", type: "str" },
  { key: "cat", label: "Category", type: "str" },
  { key: "brand", label: "Brand", type: "str" },
  { key: "sku", label: "SKU", type: "str", strong: true },
  { key: "units", label: "Units", type: "num" },
  { key: "volume", label: "Volume (T)", type: "num" },
  { key: "netSales", label: "Net sales", type: "num" },
];

function cellText(col, row) {
  if (col.key === "netSales") return row.netSales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (col.key === "volume") return row.volume < 0.001 ? "<0.001" : row.volume.toFixed(3);
  if (col.key === "units") return num(row.units);
  return row[col.key];
}

export default function TableWidget({ rows }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("netSales");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.invoice + " " + r.dist + " " + r.outlet + " " + r.sku + " " + r.town).toLowerCase().includes(q));
  }, [rows, search]);

  const sorted = useMemo(() => {
    const arr = searched.slice().sort((a, b) => {
      const ka = a[sortKey],
        kb = b[sortKey];
      const c = typeof ka === "number" ? ka - kb : String(ka).localeCompare(String(kb));
      return sortDir === "asc" ? c : -c;
    });
    return arr;
  }, [searched, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function onSort(col) {
    if (sortKey === col.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(col.key);
      setSortDir(col.type === "num" ? "desc" : "asc");
    }
    setPage(1);
  }

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Transaction detail</div>
          <div className="widget-sub">Line-item rows for the current filter scope</div>
        </div>
      </div>
      <div className="table-toolbar">
        <input
          className="search-input"
          type="text"
          placeholder="Search invoice, distributor, outlet, or SKU…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={c.type === "num" ? "num" : ""} onClick={() => onSort(c)}>
                  {c.label}
                  <span className="arrow">{sortKey === c.key ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={r.invoice + "-" + r.sku + "-" + i}>
                {COLS.map((c) => (
                  <td
                    key={c.key}
                    className={[c.type === "num" ? "num" : "", c.strong ? "strong" : ""].join(" ").trim()}
                    title={c.type === "num" ? undefined : String(r[c.key])}
                  >
                    {cellText(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <div>
          <strong>{sorted.length.toLocaleString()}</strong> rows matched
        </div>
        <div className="pager">
          <button disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </button>
          <span className="pg">
            Page {safePage} of {pages}
          </span>
          <button disabled={safePage >= pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
