import { useData } from "../context/DataContext";
import { useTheme } from "../context/ThemeContext";
import { RefreshIcon, SunIcon, MoonIcon } from "./Icons";

export default function Header() {
  const { status, refresh } = useData();
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
          <button className="icon-btn" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button className="icon-btn wide" onClick={refresh} disabled={refreshing} title="Re-query Snowflake">
            <RefreshIcon className={refreshing ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>
    </header>
  );
}
