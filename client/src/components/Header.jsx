import { useData } from "../context/DataContext";
import { useTheme } from "../context/ThemeContext";
import { RefreshIcon, SunIcon, MoonIcon } from "./Icons";

function timeAgo(iso) {
  if (!iso) return "unknown";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

export default function Header() {
  const { meta, status, refresh } = useData();
  const { theme, toggle } = useTheme();
  const refreshing = status === "refreshing";

  return (
    <header className="header">
      <div className="header-inner">
        <div className="brand">
          <div className="brand-mark">SS</div>
          <div className="brand-text">
            <h1>Sales Console</h1>
            <div className="sub">Bona Papa · Nofea · NaNa · Momse · TEGRA</div>
          </div>
        </div>
        <div className="header-right">
          {meta && (
            <div className="status-pill" title={meta.sourceFile}>
              <span className={"status-dot" + (refreshing ? " stale" : "")} />
              {meta.recordCount.toLocaleString()} rows · updated {timeAgo(meta.lastModified)}
            </div>
          )}
          <button className="icon-btn" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button className="icon-btn wide" onClick={refresh} disabled={refreshing} title="Reload from the Excel file">
            <RefreshIcon className={refreshing ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>
    </header>
  );
}
