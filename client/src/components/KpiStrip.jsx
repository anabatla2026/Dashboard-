import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import { money, num, pct } from "../lib/format";
import { WalletIcon, BoxIcon, ReceiptIcon, TagIcon, PercentIcon, TruckIcon, LayersIcon, MapPinIcon } from "./Icons";
import WidgetInfo from "./WidgetInfo";

export default function KpiStrip({ rows, options }) {
  const netSalesRaw = rows.reduce((s, r) => s + r.netSales, 0);
  const volumeRaw = rows.reduce((s, r) => s + r.volume, 0);
  const units = rows.reduce((s, r) => s + r.units, 0);
  const discountRaw = rows.reduce((s, r) => s + r.discount, 0);
  const invoicesRaw = new Set(rows.map((r) => r.invoice)).size;
  const outlets = new Set(rows.map((r) => r.outletCode)).size;
  const distributorsRaw = new Set(rows.map((r) => r.dist)).size;
  const avgInvoiceRaw = invoicesRaw > 0 ? netSalesRaw / invoicesRaw : 0;
  const buCountRaw = new Set(rows.map((r) => r.bu)).size;
  const townCountRaw = new Set(rows.map((r) => r.town)).size;

  const netSales = useAnimatedNumber(netSalesRaw);
  const volume = useAnimatedNumber(volumeRaw);
  const invoices = useAnimatedNumber(invoicesRaw, 500);
  const avgInvoice = useAnimatedNumber(avgInvoiceRaw);
  const discount = useAnimatedNumber(discountRaw);
  const distributors = useAnimatedNumber(distributorsRaw, 500);
  const buCount = useAnimatedNumber(buCountRaw, 450);
  const townCount = useAnimatedNumber(townCountRaw, 450);

  const tiles = [
    {
      label: "Net sales",
      value: money(netSales),
      sub: rows.length.toLocaleString() + " line items",
      hero: true,
      icon: WalletIcon,
      hue: "--hue-bu",
      summary: "Total net sales for the current filter scope — the headline number everything else on this page breaks down.",
      query: "SUM(netSales) across all matching line items.",
    },
    {
      label: "Volume",
      value: volume.toFixed(2) + " T",
      sub: num(units) + " units sold",
      icon: BoxIcon,
      hue: "--hue-cat",
      summary: "Total shipped volume, in metric tons, for the current filter scope.",
      query: "SUM(volume) across all matching line items; units sub-metric is SUM(units).",
    },
    {
      label: "Invoices",
      value: num(Math.round(invoices)),
      sub: num(outlets) + " outlets served",
      icon: ReceiptIcon,
      hue: "--hue-ch",
      summary: "How many distinct invoices were raised, and how many distinct outlets they were billed to.",
      query: "COUNT(DISTINCT invoice); outlets sub-metric is COUNT(DISTINCT outletCode).",
    },
    {
      label: "Avg invoice value",
      value: money(avgInvoice),
      sub: "per invoice",
      icon: TagIcon,
      hue: "--hue-town",
      summary: "Average net sales per invoice — a rough proxy for average basket size.",
      query: "SUM(netSales) ÷ COUNT(DISTINCT invoice).",
    },
    {
      label: "Total discount",
      value: money(discount),
      sub: netSalesRaw > 0 ? pct((discountRaw / (netSalesRaw + discountRaw)) * 100) + " of gross" : "—",
      icon: PercentIcon,
      hue: "--hue-brand",
      summary: "Total discount given, and what share that is of gross sales (net sales + discount).",
      query: "SUM(discount); percentage is discount ÷ (netSales + discount).",
    },
    {
      label: "Distributors active",
      value: num(Math.round(distributors)),
      sub: "of " + (options.dist?.length || 0) + " total",
      icon: TruckIcon,
      hue: "--hue-dist",
      summary: "How many distinct distributors have at least one matching sale, out of your total roster.",
      query: "COUNT(DISTINCT dist) within scope, vs. total distinct distributors in the full dataset.",
    },
    {
      label: "Business units",
      value: num(Math.round(buCount)),
      sub: "of " + (options.bu?.length || 0) + " total",
      icon: LayersIcon,
      hue: "--hue-src",
      summary: "How many of your business units have at least one matching sale.",
      query: "COUNT(DISTINCT bu) within scope, vs. total in the full dataset.",
    },
    {
      label: "Towns covered",
      value: num(Math.round(townCount)),
      sub: "of " + (options.town?.length || 0) + " total",
      icon: MapPinIcon,
      hue: "--hue-bu",
      summary: "How many towns have at least one matching sale.",
      query: "COUNT(DISTINCT town) within scope, vs. total in the full dataset.",
    },
  ];

  return (
    <div className="widget">
      <div className="widget-head">
        <div>
          <div className="widget-title">Overview</div>
          <div className="widget-sub">Key figures for the current filter scope</div>
        </div>
      </div>
      <div className="kpi-grid">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <div className={"kpi-tile" + (t.hero ? " hero" : "")} key={t.label} style={{ "--tile-hue": `var(${t.hue})` }}>
              <WidgetInfo title={t.label} summary={t.summary} query={t.query} hueVar={t.hue} />
              <div className="kpi-icon">
                <Icon />
              </div>
              <div className="kpi-label">{t.label}</div>
              <div className="kpi-value">{t.value}</div>
              <div className="kpi-sub">{t.sub}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
