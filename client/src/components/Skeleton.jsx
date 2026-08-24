export default function Skeleton() {
  return (
    <div className="container">
      <section className="section">
        <div className="widget">
          <div className="widget-head">
            <div>
              <div className="widget-title">Overview</div>
              <div className="widget-sub">Loading the latest secondary sales export…</div>
            </div>
          </div>
          <div className="skeleton-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="skeleton skeleton-kpi" key={i} />
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Performance breakdown</h2>
          </div>
        </div>
        <div className="chart-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="skeleton skeleton-chart" key={i} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="widget">
          <div className="widget-head">
            <div>
              <div className="widget-title">Transaction detail</div>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            <div className="skeleton skeleton-table" />
          </div>
        </div>
      </section>
    </div>
  );
}
