import { truncate } from "../lib/format";
import { DIM_LABELS } from "../lib/hierarchies";

export default function Breadcrumb({ path, currentDim, goTo }) {
  return (
    <div className="breadcrumb">
      <button type="button" className="crumb crumb-root" onClick={() => goTo(-1)}>
        All
      </button>
      {path.map((step, i) => (
        <span className="crumb-item" key={i}>
          <span className="crumb-sep">›</span>
          <button type="button" className="crumb" onClick={() => goTo(i)} title={String(step.label ?? step.value)}>
            {truncate(String(step.label ?? step.value), 14)}
          </button>
        </span>
      ))}
      <span className="crumb-sep">›</span>
      <span className="crumb crumb-current">{DIM_LABELS[currentDim] || currentDim}</span>
    </div>
  );
}
