import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import { money, num, pct } from "../lib/format";
import { WalletIcon, BoxIcon, ReceiptIcon, TagIcon, PercentIcon, TruckIcon, LayersIcon, MapPinIcon } from "./Icons";

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
    },
    { label: "Volume", value: volume.toFixed(2) + " T", sub: num(units) + " units sold", icon: BoxIcon, hue: "--hue-cat" },
    {
      label: "Invoices",
      value: num(Math.round(invoices)),
      sub: num(outlets) + " outlets served",
      icon: ReceiptIcon,
      hue: "--hue-ch",
    },
    { label: "Avg invoice value", value: money(avgInvoice), sub: "per invoice", icon: TagIcon, hue: "--hue-town" },
    {
      label: "Total discount",
      value: money(discount),
      sub: netSalesRaw > 0 ? pct((discountRaw / (netSalesRaw + discountRaw)) * 100) + " of gross" : "—",
      icon: PercentIcon,
      hue: "--hue-brand",
    },
    {
      label: "Distributors active",
      value: num(Math.round(distributors)),
      sub: "of " + (options.dist?.length || 0) + " total",
      icon: TruckIcon,
      hue: "--hue-dist",
    },
    {
      label: "Business units",
      value: num(Math.round(buCount)),
      sub: "of " + (options.bu?.length || 0) + " total",
      icon: LayersIcon,
      hue: "--hue-src",
    },
    {
      label: "Towns covered",
      value: num(Math.round(townCount)),
      sub: "of " + (options.town?.length || 0) + " total",
      icon: MapPinIcon,
      hue: "--hue-bu",
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
