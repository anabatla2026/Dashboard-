# Sales Console

A live dashboard over Primary (SAP) and Secondary (SalesFlo distributor)
sales data — both now read directly from Snowflake. A Node/Express API runs
the aggregation queries per request, and a React (Vite) front end renders
the results; one global filter bar (Year, Month, Region, Category, Brand,
Channel type, Town, Distributor, App User Tag) scopes every KPI and chart at
once by triggering fresh queries, not by re-filtering an in-memory dataset.

## Structure

```
server/   Express API for local dev — mounts the Primary/Secondary routes
client/   React (Vite) dashboard
shared/   Snowflake connection + all query logic, used by both server/
          (local) and api/ (Vercel)
api/      Vercel serverless functions mirroring server/'s routes — same
          query logic, no persistent process
```

`shared/snowflakeClient.js` holds the connection; `shared/primaryQueries.js`
and `shared/secondaryQueries.js` hold every aggregation query (KPIs, trend,
category/brand breakdowns, month-over-month, region achievement/target).
Both are queried straight from `GOLD.ZFI_SCO_VW` (Primary) and
`GOLD.SALESFLO_DATADUMP_VW` (Secondary) — no data is cached or shipped as
raw rows to the browser; each widget fetches its own pre-aggregated result
and re-fetches whenever the filters, drill-down level, or fiscal year
selection change.

## Run it

First time only:

```bash
npm run install:all
```

Set up Snowflake credentials in a `.env` file at the project root (gitignored):

```
SNOWFLAKE_ACCOUNT=...
SNOWFLAKE_USERNAME=...
SNOWFLAKE_PASSWORD=...
SNOWFLAKE_WAREHOUSE=...
SNOWFLAKE_DATABASE=DWH
SNOWFLAKE_SCHEMA=GOLD
```

Then, from the project root:

```bash
npm run dev
```

This starts the API on `http://localhost:4000` and the dashboard on
`http://localhost:5173` together. Open the dashboard URL in a browser.

(You can also run `npm run dev:server` / `npm run dev:client` in separate
terminals if you prefer.)

## Updating the data

There's nothing to drop in or replace locally — both Primary and Secondary
are live Snowflake views, updated by the data team's own pipelines. The
header's **Refresh** button forces every widget to re-query Snowflake (there
is no local cache to invalidate the way an Excel file-watcher would).

## How filtering works

One filter bar sits under the header (Year, Month, Region, Segment,
Category, Brand, Channel type, Town, Distributor, App User Tag). Anything
selected there is sent as query parameters to every widget's Snowflake
query — Region/Segment/Channel type/Distributor/App User Tag only apply to
Secondary (Primary has no equivalent columns; see
`client/src/context/FilterContext.jsx`'s handling and
`shared/primaryQueries.js`'s `COLUMN_EXPR`). Clicking a bar to drill down
(e.g. Category → Brand → SKU) re-queries scoped to that value instead of
re-filtering already-fetched rows.

## Known data caveats

- **Primary excludes `CANCELED = 'True'` rows** (~8.6% of `GOLD.ZFI_SCO_VW`,
  ~Rs 8B) — a canceled invoice line isn't a real sale. Confirm this is
  correct with the data team if primary figures look lower than expected
  against a query that doesn't filter on it.
- **Primary's `Region_Name` column is unusable** — it's populated from a
  generic SAP country/subdivision reference table ("South Dakota", "Kabul",
  "Paraiba" for a Pakistan-only business), so Primary has no Region filter
  or dimension.
- **Region filtering is disabled on the Month-over-Month table** for both
  Primary and Secondary (per the data team, 2026-09-16) pending a proper
  region mapping fix.
- Secondary's App User Tag exclusion (`"SD"` / `"SD - OB"`) is a default
  applied client-side, not a hard server-side filter — see
  `client/src/context/FilterContext.jsx`.

## Deploying (Vercel, all-in-one)

The whole app — static client + API — deploys to a single Vercel project.
`vercel.json` handles the build. Set the `SNOWFLAKE_*` environment variables
above in the Vercel project settings — there's no bundled data file to
configure, since every request queries Snowflake live. Same origin, so the
client just calls relative `/api/...` paths in production — no
`VITE_API_URL` needed for a single all-in-one deployment (only relevant if
you split the client and API into separate deployments).
