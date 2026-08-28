import { useFilters } from "../context/FilterContext";
import { useData } from "../context/DataContext";
import DimFilter from "./DimFilter";
import { CalendarIcon } from "./Icons";

const TIME_KEYS = new Set(["year", "month"]);

export default function GlobalFilterBar() {
  const { dims, filters, setFilter, resetAll, filteredRows, filteredPrimaryRows, activeCount, totalRows, totalPrimaryRows } =
    useFilters();
  const { meta } = useData();
  const options = meta?.dimensions || {};

  const timeDims = dims.filter((d) => TIME_KEYS.has(d.key));
  const bizDims  = dims.filter((d) => !TIME_KEYS.has(d.key));

  return (
    <div className="filterbar">
      <div className="filterbar-row">
        <div className="filterbar-group">
          <span className="filterbar-icon">
            <CalendarIcon />
          </span>
          {timeDims.map((d) => (
            <DimFilter
              key={d.key}
              label={d.label}
              options={options[d.key] || []}
              selected={filters[d.key]}
              onChange={(set) => setFilter(d.key, set)}
            />
          ))}
        </div>
        <div className="filterbar-divider" />
        <div className="filterbar-group">
          {bizDims.map((d) => (
            <DimFilter
              key={d.key}
              label={d.label}
              options={options[d.key] || []}
              selected={filters[d.key]}
              onChange={(set) => setFilter(d.key, set)}
            />
          ))}
        </div>
        {activeCount > 0 && (
          <button type="button" className="filterbar-reset" onClick={resetAll}>
            Clear all ({activeCount})
          </button>
        )}
        <div className="filterbar-count">
          <span className="filterbar-count-row">
            <strong>{filteredRows.length.toLocaleString()}</strong>
            <span> / {totalRows.toLocaleString()} sec</span>
          </span>
          {totalPrimaryRows > 0 && (
            <span className="filterbar-count-row">
              <strong>{filteredPrimaryRows.length.toLocaleString()}</strong>
              <span> / {totalPrimaryRows.toLocaleString()} pri</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
