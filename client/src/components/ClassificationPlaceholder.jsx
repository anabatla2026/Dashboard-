import WidgetInfo from "./WidgetInfo";

// Section is laid out and reserved per the approved design (Dashboard 1
// Design & Acceptance Sign-off, §3.3 / §4 OP-02) — it populates once Ana &
// Batla supplies the productivity formula and the secondary data it needs.
export default function ClassificationPlaceholder() {
  return (
    <div className="widget chart-card span-4 size-sm" style={{ "--card-hue": "var(--hue-risk)" }}>
      <div className="widget-head">
        <div className="widget-head-main">
          <div className="widget-title">Classification-wise Productivity &amp; Sales</div>
          <div className="widget-sub">
            Reserved <span className="kpi-badge kpi-badge--pending">Pending formula &amp; data · OP-02</span>
          </div>
        </div>
        <div className="widget-controls">
          <WidgetInfo
            title="Classification-wise Productivity & Sales"
            summary="This section is laid out and reserved in the approved design. It populates once Ana & Batla supplies the productivity formula and the secondary sales data it depends on."
            query="Open item OP-02 — Dashboard 1 Design & Acceptance Sign-off (TNX.DWH.AnaBatla.SO.01), §4."
            hueVar="--hue-risk"
          />
        </div>
      </div>
      <div className="chart-body">
        <div className="chart-empty">Awaiting the productivity formula and secondary data from Ana &amp; Batla.</div>
      </div>
    </div>
  );
}
