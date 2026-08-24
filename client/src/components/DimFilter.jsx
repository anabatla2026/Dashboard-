import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "./Icons";

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

  const count = selected.size;
  const filteredOptions = query.trim()
    ? options.filter((o) => String(o).toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function toggle(opt) {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
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
            <button type="button" onClick={() => onChange(new Set(options))}>
              Select all
            </button>
            <button type="button" onClick={() => onChange(new Set())}>
              Clear
            </button>
          </div>
          <div className="dim-filter-list">
            {filteredOptions.length === 0 && <div className="dim-filter-empty">No matches</div>}
            {filteredOptions.map((opt) => (
              <label className="dim-filter-opt" key={String(opt)} title={String(opt)}>
                <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} />
                <span>{String(opt)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
