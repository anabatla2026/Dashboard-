import { useFilters } from "../context/FilterContext";
import { useData } from "../context/DataContext";
import DimFilter from "./DimFilter";
import { CalendarIcon } from "./Icons";

const TIME_KEYS = new Set(["year", "month"]);

// Region/Category/Brand/Channel Type/Town/Distributor now come from the
// DE's mapping-view-backed filterOptions (see DataContext.jsx /
// shared/filterOptions.js) as { value, label } pairs, overriding
// secondaryDims's equivalent keys below; Year/Month/Segment/App User Tag
// still come from secondaryDims as plain value lists.
export default function GlobalFilterBar() {
  const { dims, filters, setFilter, resetAll, activeCount } = useFilters();
  const { secondaryDims, filterOptions } = useData();
  const options = { ...(secondaryDims || {}), ...(filterOptions || {}) };

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
      </div>
    </div>
  );
}
