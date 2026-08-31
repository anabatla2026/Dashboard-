import { useData } from "./context/DataContext";
import { FilterProvider, useFilters } from "./context/FilterContext";
import AppBar from "./components/AppBar";
import Header from "./components/Header";
import GlobalFilterBar from "./components/GlobalFilterBar";
import KpiStrip from "./components/KpiStrip";
import ChartCard from "./components/ChartCard";
import DistributorTable from "./components/DistributorTable";
import RegionTable from "./components/RegionTable";
import ClassificationPlaceholder from "./components/ClassificationPlaceholder";
import Skeleton from "./components/Skeleton";

// ── Chart section definitions ─────────────────────────────────────────────────
// Kept to the approved design (Dashboard 1 Design & Acceptance Sign-off,
// TNX.DWH.AnaBatla.SO.01 §3.3) and capped at a handful of widgets total —
// see the doc for what was deliberately dropped (SKU breakdown, distributor/
// town concentration, Business Unit mix, and the extra channel/segment/
// order-source/area-type/region charts this build previously carried beyond
// what was actually signed off).
// source: "secondary" → filteredRows  |  "primary" → filteredPrimaryRows

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
        title: "Channel type mix",
        type: "bar-h",
        dim: "chType",
        source: "secondary",
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
        title: "Net sales by category — Primary vs Secondary",
        type: "dual-bar-h",
        dim: "cat",
        hueVar: "--hue-cat",
        topN: 7,
        className: "span-2 size-sm",
        summary: "Category-wise net sales compared side by side across both data sources.",
        query: "SUM(netSales) grouped by Category, secondary vs primary, top 7 + Other.",
      },
      {
        id: "brand-dual",
        title: "Top brands by net sales — Primary vs Secondary",
        type: "dual-bar-h",
        dim: "brand",
        hueVar: "--hue-dist",
        topN: 8,
        className: "span-2 size-sm",
        summary: "Brand-wise net sales compared side by side across both data sources.",
        query: "SUM(netSales) grouped by Brand, secondary vs primary, top 8 + Other.",
      },
    ],
  },
];

function SectionBlock({ section, filteredRows, filteredPrimaryRows }) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>{section.title}</h2>
          <div className="desc">{section.desc}</div>
        </div>
      </div>
      <div className="chart-grid">
        {section.charts.map((def) => {
          const isDual = def.type === "dual-bar-h" || def.type === "dual-trend";
          const rows = def.source === "primary" ? filteredPrimaryRows : filteredRows;
          return (
            <ChartCard
              key={def.id}
              title={def.title}
              type={def.type}
              dim={def.dim}
              hueVar={def.hueVar}
              topN={def.topN}
              rows={rows}
              secondaryRows={isDual ? filteredRows : undefined}
              primaryRows={isDual ? filteredPrimaryRows : undefined}
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
          );
        })}
      </div>
    </section>
  );
}

function Dashboard() {
  const { meta, secondaryRows, primaryRows } = useData();
  const { filteredRows, filteredPrimaryRows, filters } = useFilters();
  const options = meta?.dimensions || {};

  return (
    <div className="container">
      {/* ── KPI Overview ── */}
      <section className="section">
        <KpiStrip
          rows={filteredRows}
          primaryRows={filteredPrimaryRows}
          options={options}
          allSecondaryRows={secondaryRows}
          allPrimaryRows={primaryRows}
          filters={filters}
        />
      </section>

      {/* ── Chart Sections ── */}
      {CHART_SECTIONS.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          filteredRows={filteredRows}
          filteredPrimaryRows={filteredPrimaryRows}
        />
      ))}

      {/* ── Summary Tables ── */}
      <section className="section">
        <div className="section-head">
          <div>
            <h2>Summary Tables</h2>
            <div className="desc">Aggregated performance data — sortable, drillable</div>
          </div>
        </div>
        <RegionTable rows={filteredRows} />
      </section>

      <section className="section">
        <DistributorTable rows={filteredRows} />
      </section>

      {/* ── Classification-wise Productivity & Sales (reserved, OP-02) ── */}
      <section className="section">
        <ClassificationPlaceholder />
      </section>

      <footer className="credit">
        Dashboard · MTD data only · DWH build in progress ·{" "}
        {meta?.sourceFile ? `secondary: ${meta.sourceFile}` : ""}
        {meta?.dateRange?.min ? ` · ${meta.dateRange.min}` : ""}
        {meta?.dateRange?.max && meta.dateRange.max !== meta.dateRange.min
          ? ` to ${meta.dateRange.max}`
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
            <p>
              Drop a <code>primary data.xlsx</code> and/or secondary sales <code>.xlsx</code> export into the
              server&rsquo;s <code>data/</code> folder, then retry.
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
