import { useData } from "./context/DataContext";
import { FilterProvider, useFilters } from "./context/FilterContext";
import AppBar from "./components/AppBar";
import Header from "./components/Header";
import GlobalFilterBar from "./components/GlobalFilterBar";
import KpiStrip from "./components/KpiStrip";
import ChartCard from "./components/ChartCard";
import RegionTargetChart from "./components/RegionTargetChart";
import MonthOverMonthTable from "./components/MonthOverMonthTable";
import Skeleton from "./components/Skeleton";

// Chart section definitions. Every chart is `useServerAgg: true` and fetches
// its own pre-aggregated GROUP BY from the server (see ChartCard.jsx /
// hooks/useServerAggregate.js), including both sides of the dual
// (Primary vs Secondary) charts.
const CHART_SECTIONS = [
  {
    id:    "trend-section",
    title: "Sales & Channel",
    desc:  "Day-by-day net sales movement, and channel type mix",
    charts: [
      {
        id: "trend-dual",
        title: "Net sales trend — Primary vs Secondary",
        type: "dual-trend",
        dim: "date",
        hueVar: "--hue-ch",
        className: "span-2 size-sm",
        summary:
          "Daily net sales for both data sources plotted together — solid line is secondary (distributor-to-retailer), dashed line is primary (factory/SAP).",
        query: "SUM(netSales) grouped by Date, secondary vs primary, chronological.",
      },
      {
        id: "ch",
        title: "Secondary Sales Value by Channel Type",
        type: "bar-h",
        dim: "chType",
        useServerAgg: true,
        hueVar: "--hue-ch",
        topN: 8,
        className: "span-2 size-sm",
        summary: "Secondary net sales ranked by channel type — click a bar to drill into full channel name, then sub-channel.",
        query: "SUM(netSales) grouped by Channel Type (secondary).",
      },
    ],
  },

  {
    id:    "category-brand-section",
    title: "Category & Brand Performance",
    desc:  "Net sales by product category and brand — primary (factory) and secondary (distributor) side by side",
    charts: [
      {
        id: "cat-dual",
        title: "Net sales value by category — Primary vs Secondary",
        type: "dual-bar-h",
        dim: "cat",
        useServerAgg: true,
        hueVar: "--hue-cat",
        topN: 7,
        className: "span-2 size-sm",
        summary: "Category-wise net sales compared side by side across both data sources.",
        query: "SUM(netSales) grouped by Category, secondary vs primary, top 7 + Other.",
      },
      {
        id: "brand-dual",
        title: "Top brands by net sales value — Primary vs Secondary",
        type: "dual-bar-h",
        dim: "brand",
        useServerAgg: true,
        hueVar: "--hue-dist",
        topN: 8,
        className: "span-2 size-sm",
        summary: "Brand-wise net sales compared side by side across both data sources.",
        query: "SUM(netSales) grouped by Brand, secondary vs primary, top 8 + Other.",
      },
    ],
  },

  {
    id:    "region-section",
    title: "Region-wise Targets vs. Achievement",
    desc:  "Secondary net sales achievement against monthly target, by region",
    charts: [],
  },
];

function SectionBlock({ section, extra }) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>{section.title}</h2>
          <div className="desc">{section.desc}</div>
        </div>
      </div>
      <div className="chart-grid">
        {extra}
        {section.charts.map((def) => (
          <ChartCard
            key={def.id}
            title={def.title}
            type={def.type}
            dim={def.dim}
            hueVar={def.hueVar}
            topN={def.topN}
            useServerAgg={def.useServerAgg}
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
            badge={def.badge}
          />
        ))}
      </div>
    </section>
  );
}

function Dashboard() {
  const { secondaryMeta, primaryMeta } = useData();
  const { filters } = useFilters();

  return (
    <div className="container">
      <section className="section">
        <KpiStrip filters={filters} />
      </section>

      {CHART_SECTIONS.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          extra={
            section.id === "region-section" ? (
              <RegionTargetChart filters={filters} className="span-4 size-sm" />
            ) : undefined
          }
        />
      ))}

      <section className="section">
        <MonthOverMonthTable
          filters={filters}
          secondaryDateRange={secondaryMeta?.dateRange}
          primaryDateRange={primaryMeta?.dateRange}
        />
      </section>

      <footer className="credit">
        Dashboard · DWH build in progress · primary &amp; secondary: Snowflake
        {secondaryMeta?.dateRange?.min ? ` · ${secondaryMeta.dateRange.min}` : ""}
        {secondaryMeta?.dateRange?.max && secondaryMeta.dateRange.max !== secondaryMeta.dateRange.min
          ? ` to ${secondaryMeta.dateRange.max}`
          : ""}{" "}
        · all figures in PKR (Rs)
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
