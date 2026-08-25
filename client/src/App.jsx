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
    summary: "Total net sales for each date in the current filter scope, so you can see whether sales are trending up or down day to day.",
    query: "SUM(netSales) grouped by Date, ordered chronologically.",
    fallbackSummary:
      "Your best-selling individual products (SKUs) by net sales — one level more granular than the Category or Brand charts below. This chart automatically switches to a real trend line once 2+ dates of data exist.",
    fallbackQuery: "SUM(netSales) grouped by SKU, sorted descending. Top 8 shown, remainder folded into ‘Other’.",
  },
  {
    id: "bu",
    title: "Business unit mix",
    type: "doughnut",
    dim: "bu",
    hueVar: "--hue-brand",
    topN: 8,
    className: "span-1",
    summary: "How net sales split across your business units — Bona Papa, Nofea, NaNa, Momse, TEGRA, and Bona Papa Magic.",
    query: "SUM(netSales) grouped by Business Unit, shown as a share of the total.",
  },
  {
    id: "cat",
    title: "Net sales by category",
    type: "bar-h",
    dim: "cat",
    hueVar: "--hue-cat",
    topN: 7,
    className: "span-2 size-md",
    summary: "Net sales ranked by product category, so you can see which category is driving the most revenue.",
    query: "SUM(netSales) grouped by Category, sorted descending. Top 7 shown, remainder folded into ‘Other’.",
  },
  {
    id: "town",
    title: "Top towns by net sales",
    type: "bar-h",
    dim: "town",
    hueVar: "--hue-town",
    topN: 7,
    className: "span-2 size-md",
    summary: "Net sales ranked by town, showing where your revenue is geographically concentrated.",
    query: "SUM(netSales) grouped by Town, sorted descending. Top 7 shown, remainder folded into ‘Other’.",
  },
  {
    id: "ch",
    title: "Channel type mix",
    type: "bar-v",
    dim: "chType",
    hueVar: "--hue-ch",
    topN: 8,
    className: "span-1 size-sm",
    summary: "Net sales ranked by channel type — General Trade, Wholesale, Modern Trade, Institution, and so on.",
    query: "SUM(netSales) grouped by Channel Type, sorted descending.",
  },
  {
    id: "src",
    title: "Order source",
    type: "doughnut",
    dim: "orderFrom",
    hueVar: "--hue-src",
    topN: 4,
    className: "span-1 size-sm",
    summary: "The split between orders placed through the sales app versus the web.",
    query: "SUM(netSales) grouped by Order Source (APP vs WEB), shown as a share of the total.",
  },
  {
    id: "brand",
    title: "Top brands by net sales",
    type: "bar-h",
    dim: "brand",
    hueVar: "--hue-dist",
    topN: 7,
    className: "span-2 size-sm",
    summary: "Net sales ranked by brand — one level below Business Unit.",
    query: "SUM(netSales) grouped by Brand, sorted descending. Top 7 shown, remainder folded into ‘Other’.",
  },
  {
    id: "dist-concentration",
    title: "Distributor sales concentration",
    type: "pareto-area",
    dim: "dist",
    hueVar: "--hue-risk",
    className: "span-2 size-md",
    summary:
      "How concentrated your revenue is across distributors: the running cumulative % of net sales as distributors are added one by one, ranked largest first. A steep early climb means a few distributors account for most of your sales — a concentration risk worth knowing about.",
    query:
      "Distributors ranked by SUM(netSales) descending; each point is the running cumulative % of the grand total.",
    tip: "The highlighted point marks where the curve first crosses 80% — the ‘vital few’ distributors driving most of your revenue.",
  },
  {
    id: "town-concentration",
    title: "Town sales concentration",
    type: "pareto-line",
    dim: "town",
    hueVar: "--hue-town",
    className: "span-2 size-md",
    summary:
      "The same concentration analysis as the distributor chart, applied to towns — how many towns it takes to reach most of your revenue.",
    query: "Towns ranked by SUM(netSales) descending; each point is the running cumulative % of the grand total.",
    tip: "The highlighted point marks where the curve first crosses 80%.",
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
              summary={def.summary}
              query={def.query}
              tip={def.tip}
              fallbackSummary={def.fallbackSummary}
              fallbackQuery={def.fallbackQuery}
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
