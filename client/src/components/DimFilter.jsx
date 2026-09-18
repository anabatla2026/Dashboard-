import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "./Icons";

// `options` accepts either plain strings (year/month/segment/appUser — value
// and display label are the same) or { value, label } pairs (Region,
// Category, Distributor — where the dropdown shows a friendly name but the
// filter tracks/transmits the DE's mapping-table code, per the 2026-09-17
// filter rules). Normalized to { value, label } here so the rest of the
// component doesn't need to care which shape it got.
function normalize(opt) {
  return opt && typeof opt === "object" ? opt : { value: opt, label: opt };
}

export default function DimFilter({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!options || options.length === 0) return null;

  const normalized = options.map(normalize);
  const count = selected.size;
  const filteredOptions = query.trim()
    ? normalized.filter((o) => String(o.label).toLowerCase().includes(query.trim().toLowerCase()))
    : normalized;

  function toggle(value) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  return (
    <div className="dim-filter" ref={ref}>
      <button
        type="button"
        className={"dim-filter-btn" + (count > 0 ? " active" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="lbl">{label}</span>
        {count > 0 ? <span className="dim-filter-count">{count}</span> : <ChevronIcon />}
      </button>
      {open && (
        <div className="dim-filter-panel" onClick={(e) => e.stopPropagation()}>
          {options.length > 8 && (
            <input
              className="dim-filter-search"
              type="text"
              placeholder={`Search ${label.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          )}
          <div className="dim-filter-actions">
            <button type="button" onClick={() => onChange(new Set(normalized.map((o) => o.value)))}>
              Select all
            </button>
            <button type="button" onClick={() => onChange(new Set())}>
              Clear
            </button>
          </div>
          <div className="dim-filter-list">
            {filteredOptions.length === 0 && <div className="dim-filter-empty">No matches</div>}
            {filteredOptions.map((opt) => (
              <label className="dim-filter-opt" key={String(opt.value)} title={String(opt.label)}>
                <input type="checkbox" checked={selected.has(opt.value)} onChange={() => toggle(opt.value)} />
                <span>{String(opt.label)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
