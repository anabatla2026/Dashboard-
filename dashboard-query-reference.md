# Sales Console — SQL Query Reference for Data Engineer Review

**Purpose:** the actual aggregation logic behind every KPI card and chart, translated into SQL against the two fact tables below, for correctness review. There is no live SQL database behind the dashboard today (it runs client-side against parsed Excel rows) — this is the **equivalent SQL** a query against a proper warehouse table would need to produce the same numbers. Items marked **⚠️ Please confirm** are judgment calls made without an explicit spec.

## Assumed schema

```sql
-- SAP factory/wholesale export ("Primary")
CREATE TABLE fact_primary_sales (
  invoice     BIGINT,       -- Invoice No
  segment     VARCHAR,      -- Customer Group2 Name (NOT GT/MT/Export — see §2)
  town        VARCHAR,      -- City
  cat         VARCHAR,      -- Material Group Name
  brand       VARCHAR,
  sku         VARCHAR,      -- Product Name
  units       DECIMAL,      -- QTY in PKT
  pcs         DECIMAL,      -- Qty In Pcs
  ctn         DECIMAL,      -- Qty In Ctn
  netSales    DECIMAL,      -- Value
  gross       DECIMAL,      -- Total Value
  outletCode  BIGINT,       -- Ship to party
  outlet      VARCHAR,      -- Ship to party Name
  distCode    BIGINT,       -- Party Code
  dist        VARCHAR,      -- Party Name
  status      VARCHAR,
  year        INT,
  month       VARCHAR(3),   -- 'Jan'..'Dec'
  date        DATE          -- Posting Date
);

-- SalesFlo distributor-to-retailer export ("Secondary")
CREATE TABLE fact_secondary_sales (
  invoice     VARCHAR,
  segment     VARCHAR,      -- GT / MT / KA (channel shorthand — NOT the same meaning as primary.segment)
  region      VARCHAR,
  town        VARCHAR,
  distType    VARCHAR,
  dist        VARCHAR,      -- Distributor Name
  outletCode  VARCHAR,
  outlet      VARCHAR,
  filerType   VARCHAR,
  areaType    VARCHAR,
  orderFrom   VARCHAR,
  chType      VARCHAR,      -- Channel Type
  channel     VARCHAR,      -- Channel full name
  subChannel  VARCHAR,
  bu          VARCHAR,
  cat         VARCHAR,
  brand       VARCHAR,
  sku         VARCHAR,
  appUser     VARCHAR,      -- App User Tagged Title
  salesCtn    DECIMAL,
  units       DECIMAL,
  volume      DECIMAL,      -- Tons
  discount    DECIMAL,
  gst         DECIMAL,
  netSales    DECIMAL,
  gross       DECIMAL,
  year        INT,
  month       VARCHAR(3),
  date        DATE
);
```

**Row validity, applied at ingest (not per-query):**
- `fact_primary_sales`: source row kept only if `Invoice No` parses as numeric. ⚠️ *Recently fixed* — was previously validated on `S. NO`, which SAP prefixes with `*` on invoice continuation lines (e.g. `"*47"`), silently dropping 7,300 of 8,199 rows (89%) and undercounting every primary metric by the same margin. Verified the fix against a manual sum of the raw file. **Please confirm `Invoice No` is a safe long-term validity anchor.**
- `fact_secondary_sales`: kept only if `S.No #` parses as numeric (this one is clean — only 1 genuinely blank row excluded of 131,754).

**Standing filter applied to every `fact_secondary_sales` query below** (App User Tag default — ⚠️ please confirm):

```sql
WHERE appUser <> 'SD - OB'
```

Per client instruction (2026-08-31): rows tagged "SD" overstate real sales and should be excluded by default. The raw data has no bare `"SD"` value — `"SD - OB"` is the closest match, applied on inference. A sibling tag `"MDSD"` is **not** excluded. This filter is toggleable in the UI (checkbox list, all-but-SD checked by default) — the SQL below shows the default state.

---

## 1. Global filters → WHERE clause mapping

| Dashboard filter | `fact_secondary_sales` column | `fact_primary_sales` column |
|---|---|---|
| Year | `year` | `year` |
| Month | `month` | `month` |
| Region | `region` | *(none — not applied to primary)* |
| Segment | `segment` | *(none — see collision note)* |
| Category | `cat` | `cat` |
| Brand | `brand` | `brand` |
| Channel type | `chType` | *(none)* |
| Town | `town` | `town` |
| Distributor | `dist` | *(none — SAP/SalesFlo IDs not reconciled)* |
| App User Tag | `appUser` | *(none)* |

Each active filter with N selected values becomes `AND column IN (:val1, :val2, ...)`; combined with `AND` across different filter dimensions. No active filters on a dimension = no clause for it.

**⚠️ Segment collision:** `fact_primary_sales.segment` (Customer Group2: Q-Commerce, LMT, distributor account names…) and `fact_secondary_sales.segment` (GT/MT/KA) are unrelated taxonomies that happen to share a column name. The dashboard's Segment filter is sourced from secondary only and is **never** applied to `fact_primary_sales` — confirm this is the right call rather than a bug.

Below, `-- [+ filters]` marks where the above WHERE clauses get appended per the active filter state.

---

## 2. KPI cards — 4 cards: YTD-Primary, YTD-Secondary, MTD-Primary, MTD-Secondary

`:year` / `:month` = the resolved period (either the single Year+Month the user has selected, or if none/multiple selected, the latest (year, month) present in the data — resolved in the app layer before these queries run). `:fyStart` = `'YYYY-07-01'` of the fiscal year containing the resolved period; `:periodEnd` = last calendar day of `:month`.

### 2.1 Sales Value (PKR)

```sql
-- MTD, Secondary
SELECT SUM(netSales) AS mtd_sales_value
FROM fact_secondary_sales
WHERE year = :year AND month = :month
  AND appUser <> 'SD - OB'; -- [+ no other global filters apply to KPI cards, see §2.6]

-- MTD, Primary
SELECT SUM(netSales) AS mtd_sales_value
FROM fact_primary_sales
WHERE year = :year AND month = :month;

-- YTD, Secondary (fiscal, cumulative from 1 July)
SELECT SUM(netSales) AS ytd_sales_value
FROM fact_secondary_sales
WHERE date BETWEEN :fyStart AND :periodEnd
  AND appUser <> 'SD - OB';

-- YTD, Primary
SELECT SUM(netSales) AS ytd_sales_value
FROM fact_primary_sales
WHERE date BETWEEN :fyStart AND :periodEnd;
```

### 2.2 Volume (Carton) — same MTD/YTD date logic, column swapped

```sql
-- Secondary uses salesCtn; Primary uses ctn
SELECT SUM(salesCtn) FROM fact_secondary_sales WHERE year = :year AND month = :month AND appUser <> 'SD - OB';   -- MTD
SELECT SUM(ctn)      FROM fact_primary_sales   WHERE year = :year AND month = :month;                            -- MTD
SELECT SUM(salesCtn) FROM fact_secondary_sales WHERE date BETWEEN :fyStart AND :periodEnd AND appUser <> 'SD - OB'; -- YTD
SELECT SUM(ctn)      FROM fact_primary_sales   WHERE date BETWEEN :fyStart AND :periodEnd;                       -- YTD
```

### 2.3 Volume (Pcs) — Secondary uses `units`, Primary uses `pcs`

```sql
SELECT SUM(units) FROM fact_secondary_sales WHERE year = :year AND month = :month AND appUser <> 'SD - OB';   -- MTD
SELECT SUM(pcs)   FROM fact_primary_sales   WHERE year = :year AND month = :month;                            -- MTD
SELECT SUM(units) FROM fact_secondary_sales WHERE date BETWEEN :fyStart AND :periodEnd AND appUser <> 'SD - OB'; -- YTD
SELECT SUM(pcs)   FROM fact_primary_sales   WHERE date BETWEEN :fyStart AND :periodEnd;                       -- YTD
```

### 2.4 Total store count — **entire dataset, not period-scoped** (same value shown on both the YTD and MTD card for a source)

```sql
SELECT COUNT(DISTINCT outletCode) AS total_store_count
FROM fact_secondary_sales
WHERE appUser <> 'SD - OB';

SELECT COUNT(DISTINCT outletCode) AS total_store_count
FROM fact_primary_sales;
```

### 2.5 Productive store count / Productive distributor — period-scoped distinct counts

```sql
-- Productive store count, MTD, Secondary
SELECT COUNT(DISTINCT outletCode) FROM fact_secondary_sales
WHERE year = :year AND month = :month AND appUser <> 'SD - OB';

-- Productive store count, YTD, Secondary
SELECT COUNT(DISTINCT outletCode) FROM fact_secondary_sales
WHERE date BETWEEN :fyStart AND :periodEnd AND appUser <> 'SD - OB';

-- Productive distributor, MTD, Secondary
SELECT COUNT(DISTINCT dist) FROM fact_secondary_sales
WHERE year = :year AND month = :month AND appUser <> 'SD - OB';

-- Productive distributor, YTD, Secondary
SELECT COUNT(DISTINCT dist) FROM fact_secondary_sales
WHERE date BETWEEN :fyStart AND :periodEnd AND appUser <> 'SD - OB';

-- Same 4 queries against fact_primary_sales, dropping the appUser clause
-- (outletCode = Ship to party, dist = Party Name — SAP's own IDs, not reconciled with secondary's)
```

### 2.6 GOLY (Growth Over Last Year) — every metric above, run twice and compared

```sql
-- MTD GOLY: current period vs same month last year
-- cur:
SELECT SUM(netSales) FROM fact_secondary_sales WHERE year = :year   AND month = :month AND appUser <> 'SD - OB';
-- ly:
SELECT SUM(netSales) FROM fact_secondary_sales WHERE year = :year-1 AND month = :month AND appUser <> 'SD - OB';
-- pct = (cur - ly) / ly * 100, computed in the app; shown as "No LY data" when ly = 0 (always true today — no 2025 data loaded yet)

-- YTD GOLY: fiscal-YTD-to-period vs fiscal-YTD-to-same-point last year
-- cur:
SELECT SUM(netSales) FROM fact_secondary_sales
WHERE date BETWEEN :fyStart AND :periodEnd AND appUser <> 'SD - OB';
-- ly (both bounds shifted back exactly one year):
SELECT SUM(netSales) FROM fact_secondary_sales
WHERE date BETWEEN DATE_SUB(:fyStart, INTERVAL 1 YEAR) AND DATE_SUB(:periodEnd, INTERVAL 1 YEAR)
  AND appUser <> 'SD - OB';
```

**⚠️ Please confirm:** none of the §2 queries apply Region/Category/Brand/Channel/Distributor/Segment filters even if the user has them active elsewhere on the dashboard — only Year/Month (via period resolution) apply. This is deliberate (KPI cards as a stable top-line "pulse"), not an oversight — please sign off on that being the intended behavior.

---

## 3. Charts

### 3.1 Net sales trend — Primary vs Secondary (daily line, two series)

```sql
SELECT date, SUM(netSales) AS net_sales
FROM fact_secondary_sales
WHERE appUser <> 'SD - OB' -- [+ filters]
GROUP BY date
ORDER BY date;

SELECT date, SUM(netSales) AS net_sales
FROM fact_primary_sales
-- [+ filters: only year, month, cat, brand, town apply to primary]
GROUP BY date
ORDER BY date;
```

### 3.2 Secondary Sales Value by Channel Type (+ drill-down)

```sql
-- Level 1
SELECT chType, SUM(netSales) AS net_sales
FROM fact_secondary_sales
WHERE appUser <> 'SD - OB' -- [+ filters]
GROUP BY chType
ORDER BY net_sales DESC
LIMIT 8;
-- app then buckets everything beyond the top 8 into a single "Other" row

-- Level 2 (drilled into one chType)
SELECT channel, SUM(netSales) AS net_sales
FROM fact_secondary_sales
WHERE appUser <> 'SD - OB' AND chType = :selectedChType -- [+ filters]
GROUP BY channel
ORDER BY net_sales DESC
LIMIT 8;

-- Level 3 (drilled into chType + channel)
SELECT subChannel, SUM(netSales) AS net_sales
FROM fact_secondary_sales
WHERE appUser <> 'SD - OB' AND chType = :selectedChType AND channel = :selectedChannel -- [+ filters]
GROUP BY subChannel
ORDER BY net_sales DESC
LIMIT 8;
```

### 3.3 Net sales value by category — Primary vs Secondary (+ drill: cat → brand → sku)

```sql
WITH sec AS (
  SELECT cat, SUM(netSales) AS secondary_net_sales
  FROM fact_secondary_sales
  WHERE appUser <> 'SD - OB' -- [+ filters]
  GROUP BY cat
),
pri AS (
  SELECT cat, SUM(netSales) AS primary_net_sales
  FROM fact_primary_sales
  -- [+ filters: year, month, brand, town]
  GROUP BY cat
)
SELECT
  COALESCE(sec.cat, pri.cat)              AS category,
  COALESCE(secondary_net_sales, 0)        AS secondary_net_sales,
  COALESCE(primary_net_sales, 0)          AS primary_net_sales
FROM sec
FULL OUTER JOIN pri ON sec.cat = pri.cat
ORDER BY (COALESCE(secondary_net_sales,0) + COALESCE(primary_net_sales,0)) DESC;
-- app keeps top 7 rows by that combined total, sums everything else into one "Other" row
-- drill level 2 (brand) and level 3 (sku) re-run the same shape, scoped with AND cat = :selectedCat [AND brand = :selectedBrand]
```

### 3.4 Top brands by net sales value — Primary vs Secondary (+ drill: brand → sku)

Identical shape to §3.3 with `brand` in place of `cat`, top 8 instead of top 7.

```sql
WITH sec AS (
  SELECT brand, SUM(netSales) AS secondary_net_sales
  FROM fact_secondary_sales
  WHERE appUser <> 'SD - OB' -- [+ filters]
  GROUP BY brand
),
pri AS (
  SELECT brand, SUM(netSales) AS primary_net_sales
  FROM fact_primary_sales
  -- [+ filters: year, month, cat, town]
  GROUP BY brand
)
SELECT
  COALESCE(sec.brand, pri.brand)     AS brand,
  COALESCE(secondary_net_sales, 0)   AS secondary_net_sales,
  COALESCE(primary_net_sales, 0)     AS primary_net_sales
FROM sec
FULL OUTER JOIN pri ON sec.brand = pri.brand
ORDER BY (COALESCE(secondary_net_sales,0) + COALESCE(primary_net_sales,0)) DESC;
-- top 8 kept, remainder bucketed into "Other"
```

### 3.5 Region-wise Achievement (Secondary only) (+ drill: region → town → dist)

```sql
SELECT region, SUM(netSales) AS net_sales
FROM fact_secondary_sales
WHERE appUser <> 'SD - OB' -- [+ filters]
GROUP BY region
ORDER BY net_sales DESC
LIMIT 10;
-- top 10 + "Other"; Target column not implemented — no target/region-mapping data supplied yet
```

### 3.6 Month-over-Month Sales

Local widget filters — **Fiscal Year** and **Region** — are independent of the global filter bar (global Year/Month/Region are deliberately *not* applied here; other global filters like Category/Brand still are).

```sql
-- Secondary, region-filtered locally
SELECT
  month,
  CASE WHEN month IN ('Jul','Aug','Sep','Oct','Nov','Dec') THEN year ELSE year - 1 END AS fiscal_year,
  SUM(netSales) AS secondary_net_sales
FROM fact_secondary_sales
WHERE appUser <> 'SD - OB'
  AND (:region IS NULL OR region = :region)
  -- [+ other active global filters except year/month/region]
GROUP BY fiscal_year, month
HAVING fiscal_year = :selectedFiscalYear
ORDER BY FIELD(month, 'Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun');

-- Primary — no region clause (primary has no region field)
SELECT
  month,
  CASE WHEN month IN ('Jul','Aug','Sep','Oct','Nov','Dec') THEN year ELSE year - 1 END AS fiscal_year,
  SUM(netSales) AS primary_net_sales
FROM fact_primary_sales
-- [+ active global filters except year/month/region: cat, brand, town]
GROUP BY fiscal_year, month
HAVING fiscal_year = :selectedFiscalYear
ORDER BY FIELD(month, 'Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun');
```

`:selectedFiscalYear` options are populated from `SELECT DISTINCT fiscal_year FROM (...)` over both tables combined — grows automatically as more years of data land.

---

## 3.7 Distributor & Store Coverage widget

New reference tables, supplied 2026-09-08 — a distributor route roster (`Distributor Count detail.xlsx`) and a SAP↔SalesFlo distributor-identity mapping (`Distributor Mapping` sheet in `Target Compile FTM August 26 (6).xlsx`). Unlike everything above, these are small reference/master-data tables, not per-transaction fact rows — the widget is **not** scoped by the global filter bar, and is recomputed only when either source file changes.

```sql
-- Route roster (assumed table: distributor_count_detail)
SELECT COUNT(DISTINCT Distributor_Code) AS total_distributors FROM distributor_count_detail;
SELECT COUNT(DISTINCT StoreCode)        AS total_stores       FROM distributor_count_detail;

-- Distributor identity reconciliation (assumed table: distributor_mapping)
-- SalesFlo-only codes contain "D" (e.g. "D0001"); SAP codes are numeric.

-- 1. Common: SalesFlo mapped to a valid SAP code
SELECT COUNT(DISTINCT DistributorCode) AS common_distributors
FROM distributor_mapping
WHERE DistributorCode LIKE '%D%'
  AND Distributor_Sap_Code IS NOT NULL
  AND Distributor_Sap_Code NOT LIKE '%D%';

-- 2. Only SalesFlo: no SAP mapping (NULL, or mapped to another SalesFlo code)
SELECT COUNT(DISTINCT DistributorCode) AS only_salesflo_distributors
FROM distributor_mapping
WHERE DistributorCode LIKE '%D%'
  AND (Distributor_Sap_Code IS NULL OR Distributor_Sap_Code LIKE '%D%');

-- 3. Only SAP: no SalesFlo mapping
SELECT COUNT(DISTINCT Distributor_Sap_Code) AS only_sap_distributors
FROM distributor_mapping
WHERE DistributorCode NOT LIKE '%D%'
  AND Distributor_Sap_Code IS NOT NULL
  AND Distributor_Sap_Code NOT LIKE '%D%';

-- Total Primary Distributors   = (1) + (3)
-- Total Secondary Distributors = (1) + (2)
```

**⚠️ Please confirm:** this reconciles distributor *identities* (counts) between the two sources — it does not yet join SAP `distCode`/SalesFlo `dist` on `fact_primary_sales`/`fact_secondary_sales` rows, so per-distributor Primary-vs-Secondary performance (§4 below) is still not available; that would need the mapping applied at the fact-row level, not just counted.

---

## 4. Explicitly NOT implemented (flagged in-app, not silently omitted)

| Item | Why it's blocked |
|---|---|
| Segment-wise Sales (GT / Export / MT split) | Spec requires this from Primary only; primary has no GT/Export/MT field, only Customer Group2, and no mapping has been supplied. |
| Modern Trade value also added into Secondary totals | No store-type / Modern-Trade field exists anywhere in Primary's 28 raw columns — checked directly. |
| Classification-wise Productivity & Sales | Formula and underlying data not yet supplied. |
| "SD" tag exact meaning/scope | Best-effort match to `"SD - OB"` (see standing filter above) — needs explicit confirmation. |
| Region-wise Target / Achievement % | No target data or region-mapping table supplied yet. |
| Cross-source Distributor Performance | Distributor *identity counts* are now reconciled (§3.7), but SAP/SalesFlo codes still aren't joined at the fact-row level, so per-distributor Primary-vs-Secondary metrics aren't available yet. |
| SAP/SalesFlo Channel classification reconciliation | Not yet supplied. |

---

*Generated 2026-09-04, translated directly from the current implementation (`shared/excelStore.js`, `client/src/lib/period.js`, `client/src/lib/dims.js`, `client/src/context/FilterContext.jsx`, `client/src/lib/aggregate.js`, `client/src/App.jsx`, `client/src/components/KpiStrip.jsx`, `client/src/components/MonthOverMonthTable.jsx`). The dashboard itself runs this logic client-side against parsed Excel rows, not against a SQL engine — the SQL above is the equivalent query a warehouse table would need, for review purposes.*
