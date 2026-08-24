# Secondary Sales Console

A live dashboard over your secondary sales Excel dumps: a Node/Express API
reads and watches the `.xlsx` file, and a React (Vite) front end renders it —
one global filter bar (including Year / Month / Date) scopes every KPI,
chart, and table at once.

## Structure

```
data/     Drop your .xlsx export(s) here
server/   Express API — reads the Excel file, watches it for changes
client/   React (Vite) dashboard
```

## Run it

First time only:

```bash
npm run install:all
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

Every time you get a new export, just drop the new `.xlsx` file into `data/`
(you can keep the old ones there too, or delete them — it doesn't matter).
The server watches that folder and always serves whichever `.xlsx` file was
modified most recently, so:

- **Replace the file in place** (save over `SecondarySaleDataDump_....xlsx`) — picked up automatically within about half a second.
- **Add a new dated file** (e.g. `SecondarySaleDataDump_2026-08-22.xlsx`) — also picked up automatically, no restart needed.

The header's **Refresh** button re-fetches from the API on demand (also
forces a re-read of the file in case you want to be sure).

Once exports for more than one date exist, the **Year / Month / Date**
filters and the **Net sales trend** chart start doing real work — right now,
with a single day of data, the trend chart shows a friendly single-day
callout instead of an awkward one-point line.

## How filtering works

One filter bar sits under the header (Year, Month, Date, then the business
dimensions — Business unit, Category, Channel type, Town, Distributor, Order
source). Anything selected there scopes the KPI strip, every chart, the
distributor leaderboard, and the transaction table **together** — there's no
per-widget filtering. The transaction table also has its own text search box,
which narrows within whatever the global filters already selected.

## Chart types

Each chart uses a fixed, data-appropriate type rather than a switchable one:

- **Net sales trend** — area/line (the one genuinely time-based chart)
- **Business unit mix / Order source** — doughnut (composition of a whole)
- **Channel type mix** — vertical bar (few, short-labeled categories)
- **Category / Top towns / Top brands** — horizontal bar (ranked, longer labels)
- **Distributor performance** — a sortable leaderboard table instead of a
  chart, since 27 distributors with 8 metrics each reads better as a table

## Notes

- Column mapping and cleaning logic (dropping the trailing "Total:" row,
  stripping the `[BU0000x]` suffix from Business Unit, adding year/month/date,
  etc.) lives in `server/src/excelStore.js`. If a future export renames or
  adds columns, that's the one file to touch.
- The API serves the full parsed dataset as JSON (`GET /api/records`) plus
  dimension option lists and summary totals (`GET /api/meta`); the frontend
  does its own filtering/aggregation client-side from one shared filtered
  dataset, which is plenty fast at this row count.
