import { useData } from "./context/DataContext";
import { FilterProvider, useFilters } from "./context/FilterContext";
import AppBar from "./components/AppBar";
import Header from "./components/Header";
import GlobalFilterBar from "./components/GlobalFilterBar";
import KpiStrip from "./components/KpiStrip";
import ChartCard from "./components/ChartCard";
import DistributorTable from "./components/DistributorTable";
import TableWidget from "./components/TableWidget";
import RegionTable from "./components/RegionTable";
import BrandTable from "./components/BrandTable";
import Skeleton from "./components/Skeleton";

// ── Chart section definitions ─────────────────────────────────────────────────
// source: "secondary" → filteredRows  |  "primary" → filteredPrimaryRows
// Each section groups related charts under a heading.

const CHART_SECTIONS = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id:    "trend-section",
    title: "Sales Trends",
    desc:  "Day-by-day net sales movement for both data sources",
    charts: [
      {
        id: "trend",
        title: "Net sales trend (Secondary)",
        type: "trend",
        dim: "date",
        source: "secondary",
        hueVar: "--hue-bu",
        className: "span-2 size-lg",
        fallbackDim: "brand",
        fallbackTitle: "Top brands — Secondary",
        fallbackTopN: 8,
        summary: "Secondary net sales for each date in scope — shows momentum day to day.",
        query: "SUM(netSales) grouped by Date (secondary), chronological.",
        fallbackSummary: "Best-selling brands by secondary net sales. Switches to a trend line once 2+ dates of data exist.",
        fallbackQuery: "SUM(netSales) grouped by Brand (secondary), top 8.",
      },
      {
        id: "trend-primary",
        title: "Net sales trend (Primary)",
        type: "trend",
        dim: "date",
        source: "primary",
        hueVar: "--hue-ch",
        className: "span-2 size-lg",
        fallbackDim: "brand",
        fallbackTitle: "Top brands — Primary",
        fallbackTopN: 8,
        summary: "Primary (SAP/factory) net sales for each date in scope.",
        query: "SUM(netSales) grouped by Date (primary), chronological.",
        fallbackSummary: "Best-selling brands by primary net sales.",
        fallbackQuery: "SUM(netSales) grouped by Brand (primary), top 8.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id:    "channel-section",
    title: "Channel & Segment Analysis",
    desc:  "How sales split across channel types, segments, sub-channels, and order sources",
    charts: [
      {
        id: "segment-donut",
        title: "Channel segment mix",
        type: "doughnut",
        dim: "segment",
        source: "secondary",
        hueVar: "--hue-ch",
        topN: 6,
        className: "span-1",
        summary: "Share of secondary net sales by top-level channel segment (GT / MT / Export / KA …).",
        query: "SUM(netSales) grouped by Segment (Channel col 0), shown as % of total.",
      },
      {
        id: "ch",
        title: "Channel type mix",
        type: "bar-h",
        dim: "chType",
        source: "secondary",
        hueVar: "--hue-ch",
        topN: 8,
        className: "span-1 size-sm",
        summary: "Secondary net sales ranked by channel type — drills into full channel name and sub-channel.",
        query: "SUM(netSales) grouped by Channel Type (secondary).",
      },
      {
        id: "channel-full",
        title: "Channel name breakdown",
        type: "bar-h",
        dim: "channel",
        source: "secondary",
        hueVar: "--hue-ch",
        topN: 8,
        className: "span-1 size-sm",
        summary: "Secondary net sales by full channel name (General Trade, Modern Trade, Wholesale …).",
        query: "SUM(netSales) grouped by Channel (full name), sorted descending.",
      },
      {
        id: "subch",
        title: "Sub-channel breakdown",
        type: "bar-h",
        dim: "subChannel",
        source: "secondary",
        hueVar: "--hue-ch",
        topN: 8,
        className: "span-1 size-sm",
        summary: "Secondary net sales broken down by sub-channel (Small GT, Large GT, Hypermarket …).",
        query: "SUM(netSales) grouped by Sub Channel (secondary), sorted descending.",
      },
      {
        id: "dist-type",
        title: "Distributor type mix",
        type: "doughnut",
        dim: "distType",
        source: "secondary",
        hueVar: "--hue-dist",
        topN: 6,
        className: "span-1",
        summary: "How secondary net sales split across distributor types (DD, SD, Wholesaler …).",
        query: "SUM(netSales) grouped by Distributor Type, as % of total.",
      },
      {
        id: "order-from",
        title: "Order source (APP vs WEB)",
        type: "doughnut",
        dim: "orderFrom",
        source: "secondary",
        hueVar: "--hue-src",
        topN: 4,
        className: "span-1",
        summary: "Split between orders placed via the sales app versus the web portal.",
        query: "SUM(netSales) grouped by Order Added From (APP / WEB).",
      },
      {
        id: "area-type",
        title: "Urban vs Rural split",
        type: "doughnut",
        dim: "areaType",
        source: "secondary",
        hueVar: "--hue-town",
        topN: 4,
        className: "span-1",
        summary: "Share of secondary net sales from urban versus rural outlets.",
        query: "SUM(netSales) grouped by Area Type (Urban / Rural).",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id:    "category-brand-section",
    title: "Category & Brand Breakdown",
    desc:  "Net sales by product category and brand — primary (factory) and secondary (distributor) side by side",
    charts: [
      {
        id: "cat-secondary",
        title: "Net sales by category (Secondary)",
        type: "bar-h",
        dim: "cat",
        source: "secondary",
        hueVar: "--hue-cat",
        topN: 7,
        className: "span-2 size-md",
        summary: "Secondary net sales ranked by product category.",
        query: "SUM(netSales) grouped by Category (secondary), top 7 + Other.",
      },
      {
        id: "cat-primary",
        title: "Net sales by category (Primary)",
        type: "bar-h",
        dim: "cat",
        source: "primary",
        hueVar: "--hue-cat",
        topN: 7,
        className: "span-2 size-md",
        summary: "Primary (SAP) net sales ranked by product category (Material Group).",
        query: "SUM(Value) grouped by Material Group Name (primary), top 7 + Other.",
      },
      {
        id: "cat-share-donut",
        title: "Category share (Secondary)",
        type: "doughnut",
        dim: "cat",
        source: "secondary",
        hueVar: "--hue-cat",
        topN: 6,
        className: "span-1",
        summary: "Proportional share of secondary net sales by product category.",
        query: "SUM(netSales) grouped by Category, as % of total (top 6 + Other).",
      },
      {
        id: "brand-secondary",
        title: "Top brands by net sales (Secondary)",
        type: "bar-h",
        dim: "brand",
        source: "secondary",
        hueVar: "--hue-dist",
        topN: 8,
        className: "span-2 size-md",
        summary: "Secondary net sales ranked by brand.",
        query: "SUM(netSales) grouped by Brand (secondary), top 8 + Other.",
      },
      {
        id: "brand-primary",
        title: "Top brands by net sales (Primary)",
        type: "bar-h",
        dim: "brand",
        source: "primary",
        hueVar: "--hue-dist",
        topN: 8,
        className: "span-2 size-md",
        summary: "Primary (SAP) net sales ranked by brand.",
        query: "SUM(Value) grouped by Brand (primary), top 8 + Other.",
      },
      {
        id: "brand-share-donut",
        title: "Brand share (Secondary)",
        type: "doughnut",
        dim: "brand",
        source: "secondary",
        hueVar: "--hue-dist",
        topN: 6,
        className: "span-1",
        summary: "Proportional share of secondary net sales across top brands.",
        query: "SUM(netSales) grouped by Brand, as % of total (top 6 + Other).",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id:    "geo-section",
    title: "Geographic Performance",
    desc:  "Region-wise and town-level sales distribution from secondary data",
    charts: [
      {
        id: "region-bar",
        title: "Region-wise net sales",
        type: "bar-h",
        dim: "region",
        source: "secondary",
        hueVar: "--hue-town",
        topN: 10,
        className: "span-2 size-md",
        summary: "Secondary net sales ranked by region — shows which territory drives the most revenue.",
        query: "SUM(netSales) grouped by Region (secondary), sorted descending.",
      },
      {
        id: "region-donut",
        title: "Region share",
        type: "doughnut",
        dim: "region",
        source: "secondary",
        hueVar: "--hue-town",
        topN: 6,
        className: "span-1",
        summary: "Proportional share of secondary net sales by region.",
        query: "SUM(netSales) grouped by Region, as % of total.",
      },
      {
        id: "town",
        title: "Top towns by net sales (Secondary)",
        type: "bar-h",
        dim: "town",
        source: "secondary",
        hueVar: "--hue-town",
        topN: 10,
        className: "span-2 size-md",
        summary: "Secondary net sales ranked by town — geographic revenue concentration.",
        query: "SUM(netSales) grouped by Town (secondary), top 10 + Other.",
      },
      {
        id: "town-primary",
        title: "Top towns by net sales (Primary)",
        type: "bar-h",
        dim: "town",
        source: "primary",
        hueVar: "--hue-town",
        topN: 10,
        className: "span-2 size-md",
        summary: "Primary (SAP) net sales ranked by town/city.",
        query: "SUM(Value) grouped by City (primary), top 10 + Other.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id:    "primary-section",
    title: "Primary Sales Breakdown",
    desc:  "SAP / factory-level analysis by customer group and segment",
    charts: [
      {
        id: "pri-segment-bar",
        title: "Customer group (Primary)",
        type: "bar-h",
        dim: "segment",
        source: "primary",
        hueVar: "--hue-bu",
        topN: 8,
        className: "span-2 size-sm",
        summary: "Primary net sales by Customer Group 2 (Q-Commerce, LMT, E-Commerce, Direct Sales …). GT/Export/MT mapping pending Irqam confirmation.",
        query: "SUM(Value) grouped by Customer Group2 Name (primary), sorted descending.",
      },
      {
        id: "pri-segment-donut",
        title: "Customer group share (Primary)",
        type: "doughnut",
        dim: "segment",
        source: "primary",
        hueVar: "--hue-bu",
        topN: 6,
        className: "span-1",
        summary: "Share of primary net sales across customer group types.",
        query: "SUM(Value) grouped by Customer Group2 Name, as % of total.",
      },
    ],
  },
];

// Flatten all chart defs for easy lookup
const ALL_CHARTS = CHART_SECTIONS.flatMap((s) => s.charts);

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
  const { meta, secondaryRows } = useData();
  const { filteredRows, filteredPrimaryRows } = useFilters();
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
        <div style={{ marginTop: 14 }}>
          <BrandTable rows={filteredRows} primaryRows={filteredPrimaryRows} />
        </div>
        <div style={{ marginTop: 14 }}>
          <DistributorTable rows={filteredRows} />
        </div>
      </section>

      {/* ── Transaction Detail ── */}
      <section className="section">
        <TableWidget rows={filteredRows} />
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
