import { useData } from "./context/DataContext";
import { FilterProvider, useFilters } from "./context/FilterContext";
import AppBar from "./components/AppBar";
import Header from "./components/Header";
import GlobalFilterBar from "./components/GlobalFilterBar";
import KpiStrip from "./components/KpiStrip";
import ChartCard from "./components/ChartCard";
import DistributorTable from "./components/DistributorTable";
import TableWidget from "./components/TableWidget";
import Skeleton from "./components/Skeleton";

const CHART_DEFS = [
  {
    id: "trend",
    title: "Net sales trend",
    type: "trend",
    dim: "date",
    hueVar: "--hue-bu",
    className: "span-3 size-lg",
    fallbackDim: "sku",
    fallbackTitle: "Top SKUs by net sales",
    fallbackTopN: 8,
    chartWidth: 900,
    labelChars: 38,
  },
  { id: "bu", title: "Business unit mix", type: "doughnut", dim: "bu", hueVar: "--hue-brand", topN: 8, className: "span-1" },
  { id: "cat", title: "Net sales by category", type: "bar-h", dim: "cat", hueVar: "--hue-cat", topN: 7, className: "span-2 size-md" },
  { id: "town", title: "Top towns by net sales", type: "bar-h", dim: "town", hueVar: "--hue-town", topN: 7, className: "span-2 size-md" },
  { id: "ch", title: "Channel type mix", type: "bar-v", dim: "chType", hueVar: "--hue-ch", topN: 8, className: "span-1 size-sm" },
  { id: "src", title: "Order source", type: "doughnut", dim: "orderFrom", hueVar: "--hue-src", topN: 4, className: "span-1 size-sm" },
  { id: "brand", title: "Top brands by net sales", type: "bar-h", dim: "brand", hueVar: "--hue-dist", topN: 7, className: "span-2 size-sm" },
  {
    id: "dist-concentration",
    title: "Distributor sales concentration",
    type: "pareto-area",
    dim: "dist",
    hueVar: "--hue-risk",
    className: "span-2 size-md",
  },
  {
    id: "town-concentration",
    title: "Town sales concentration",
    type: "pareto-line",
    dim: "town",
    hueVar: "--hue-town",
    className: "span-2 size-md",
  },
];

function Dashboard() {
  const { meta } = useData();
  const { filteredRows } = useFilters();
  const options = meta?.dimensions || {};

  return (
    <div className="container">
      <section className="section">
        <KpiStrip rows={filteredRows} options={options} />
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Performance breakdown</h2>
            <div className="desc">Each chart uses the type that best fits its data — filters above scope everything</div>
          </div>
        </div>
        <div className="chart-grid">
          {CHART_DEFS.map((def) => (
            <ChartCard
              key={def.id}
              title={def.title}
              type={def.type}
              dim={def.dim}
              hueVar={def.hueVar}
              topN={def.topN}
              rows={filteredRows}
              className={def.className}
              chartWidth={def.chartWidth}
              labelChars={def.labelChars}
              fallbackDim={def.fallbackDim}
              fallbackTitle={def.fallbackTitle}
              fallbackTopN={def.fallbackTopN}
            />
          ))}
        </div>
      </section>

      <section className="section">
        <DistributorTable rows={filteredRows} />
      </section>

      <section className="section">
        <TableWidget rows={filteredRows} />
      </section>

      <footer className="credit">
        Secondary sales data · source file {meta?.sourceFile} · dated {meta?.dateRange?.min || "—"}
        {meta?.dateRange?.max && meta.dateRange.max !== meta.dateRange.min ? ` to ${meta.dateRange.max}` : ""} · all
        figures in PKR (Rs)
      </footer>
    </div>
  );
}

export default function App() {
  const { status, error, refresh } = useData();
  const ready = status === "ready" || status === "refreshing";

  return (
    <FilterProvider>
      <div className="app">
        <AppBar>
          <Header />
          {ready && <GlobalFilterBar />}
        </AppBar>

        {status === "loading" && <Skeleton />}

        {status === "error" && (
          <div className="center-state">
            <h2>Couldn&rsquo;t load the data</h2>
            <p>{error}</p>
            <p>
              Drop a secondary sales <code>.xlsx</code> export into the server&rsquo;s <code>data/</code> folder,
              then retry.
            </p>
            <button className="icon-btn wide" onClick={refresh}>
              Try again
            </button>
          </div>
        )}

        {ready && <Dashboard />}
      </div>
    </FilterProvider>
  );
}
