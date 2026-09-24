SET v_years        = '2027';
SET v_months       = 'AUG';
SET v_region       = NULL;
SET v_category     = 'Baby Diapers';
SET v_brand        = NULL;
SET v_channel_type = NULL;
SET v_town         = NULL;
SET v_distributor  = NULL;
SET v_app_user_tag = NULL;

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7 THEN YEAR(CURRENT_DATE()) + 1 ELSE YEAR(CURRENT_DATE()) END AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7 THEN MONTH(CURRENT_DATE()) - 6 ELSE MONTH(CURRENT_DATE()) + 6 END AS current_fy_month_no,
        NULLIF(TRIM($v_years),'') AS years_raw, NULLIF(TRIM($v_months),'') AS months_raw,
        NULLIF(TRIM($v_region),'') AS region_raw, NULLIF(TRIM($v_category),'') AS category_raw,
        NULLIF(TRIM($v_brand),'') AS brand_raw, NULLIF(TRIM($v_channel_type),'') AS channel_type_raw,
        NULLIF(TRIM($v_town),'') AS town_raw, NULLIF(TRIM($v_distributor),'') AS distributor_raw
),
sel_filters AS (
    SELECT p.*,
        IFF(p.region_raw       IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.region_raw,','),       x -> UPPER(TRIM(x)))) AS region_arr,
        IFF(p.category_raw     IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.category_raw,','),     x -> UPPER(TRIM(x)))) AS category_arr,
        IFF(p.brand_raw        IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.brand_raw,','),        x -> UPPER(TRIM(x)))) AS brand_arr,
        IFF(p.channel_type_raw IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.channel_type_raw,','), x -> UPPER(TRIM(x)))) AS channel_type_arr,
        IFF(p.town_raw         IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.town_raw,','),         x -> UPPER(TRIM(x)))) AS town_arr,
        IFF(p.distributor_raw  IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.distributor_raw,','),  x -> UPPER(TRIM(x)))) AS distributor_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*, IFF(sf.years_raw IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(sf.years_raw,','), x -> TRY_TO_NUMBER(TRIM(x)))) AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*,
        IFF(s.months_raw IS NULL, ARRAY_CONSTRUCT(),
            TRANSFORM(SPLIT(s.months_raw,','), x ->
                CASE UPPER(TRIM(x))
                    WHEN 'JUL' THEN 1 WHEN 'AUG' THEN 2 WHEN 'SEP' THEN 3 WHEN 'OCT' THEN 4
                    WHEN 'NOV' THEN 5 WHEN 'DEC' THEN 6 WHEN 'JAN' THEN 7 WHEN 'FEB' THEN 8
                    WHEN 'MAR' THEN 9 WHEN 'APR' THEN 10 WHEN 'MAY' THEN 11 WHEN 'JUN' THEN 12
                END)) AS month_no_arr
    FROM sel_years s
),
resolved AS (
    SELECT sm.*,
        IFF(ARRAY_SIZE(sm.year_arr) = 0, ARRAY_CONSTRUCT(sm.current_fy), sm.year_arr) AS eff_years,
        CASE WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
             WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) > 0 THEN ARRAY_CONSTRUCT(12)
             ELSE sm.month_no_arr END AS fytd_month_nos,
        IFF(ARRAY_SIZE(sm.month_no_arr) = 0, ARRAY_CONSTRUCT(sm.current_fy_month_no), sm.month_no_arr) AS mtd_month_nos
    FROM sel_months sm
),
fy_ranges AS (
    SELECT y.VALUE::NUMBER AS fiscal_year,
           DATE_FROM_PARTS(y.VALUE::NUMBER - 1, 7, 1) AS fy_start,
           LAST_DAY(DATE_FROM_PARTS(y.VALUE::NUMBER - IFF(MAX(m.VALUE::NUMBER) <= 6, 1, 0),
                                    MOD(MAX(m.VALUE::NUMBER) + 5, 12) + 1, 1)) AS fytd_end
    FROM resolved r, LATERAL FLATTEN(input => r.eff_years) y, LATERAL FLATTEN(input => r.fytd_month_nos) m
    GROUP BY y.VALUE::NUMBER
),
mtd_ranges AS (
    SELECT y.VALUE::NUMBER AS fiscal_year, m.VALUE::NUMBER AS fy_month_no,
           DATE_FROM_PARTS(y.VALUE::NUMBER - IFF(m.VALUE::NUMBER <= 6, 1, 0), MOD(m.VALUE::NUMBER + 5, 12) + 1, 1) AS m_start,
           LAST_DAY(DATE_FROM_PARTS(y.VALUE::NUMBER - IFF(m.VALUE::NUMBER <= 6, 1, 0), MOD(m.VALUE::NUMBER + 5, 12) + 1, 1)) AS m_end
    FROM resolved r, LATERAL FLATTEN(input => r.eff_years) y, LATERAL FLATTEN(input => r.mtd_month_nos) m
)
SELECT
    SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.POSTING_DATE BETWEEN m.m_start AND m.m_end), v.VALUE,       0)) AS MTD_SALES_VALUE,
    SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.POSTING_DATE BETWEEN m.m_start AND m.m_end), v.QTY_IN_CTN,  0)) AS MTD_VOLUME_CTN,
    SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.POSTING_DATE BETWEEN m.m_start AND m.m_end), v.QTY_IN_PCS,  0)) AS MTD_VOLUME_PCS,
    SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.POSTING_DATE BETWEEN f.fy_start AND f.fytd_end), v.VALUE,      0)) AS FYTD_SALES_VALUE,
    SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.POSTING_DATE BETWEEN f.fy_start AND f.fytd_end), v.QTY_IN_CTN, 0)) AS FYTD_VOLUME_CTN,
    SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.POSTING_DATE BETWEEN f.fy_start AND f.fytd_end), v.QTY_IN_PCS, 0)) AS FYTD_VOLUME_PCS
FROM GOLD.VW_FACT_PRIMARY_SALES v
WHERE 1 = 1
  AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
       OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
  AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
       OR ARRAY_CONTAINS(
              UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), v.MATERIAL_GROUP_NAME, '')))::VARIANT,
              (SELECT category_arr FROM sel_filters)
          ))
  AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
       OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_BRAND,'')))::VARIANT,        (SELECT brand_arr        FROM sel_filters)))
  AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
       OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
  AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
       OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
  AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
       OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.PARTY_CODE,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
       OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,  (SELECT distributor_arr FROM sel_filters)));











-- =====================================================================
-- ✅ PRIMARY KPI #2 — DAILY NET SALES TREND (MTD)
-- Grouped on POSTING_DATE, the same date the KPI #1 MTD window uses.
-- =====================================================================

SET v_years        = '2027';
SET v_months       = 'AUG';
SET v_region       = NULL;
SET v_category     = NULL;
SET v_brand        = NULL;
SET v_channel_type = NULL;
SET v_town         = NULL;
SET v_distributor  = NULL;
SET v_app_user_tag = NULL;

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7 THEN YEAR(CURRENT_DATE()) + 1 ELSE YEAR(CURRENT_DATE()) END AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7 THEN MONTH(CURRENT_DATE()) - 6 ELSE MONTH(CURRENT_DATE()) + 6 END AS current_fy_month_no,
        NULLIF(TRIM($v_years),'')        AS years_raw,
        NULLIF(TRIM($v_months),'')       AS months_raw,
        NULLIF(TRIM($v_region),'')       AS region_raw,
        NULLIF(TRIM($v_category),'')     AS category_raw,
        NULLIF(TRIM($v_brand),'')        AS brand_raw,
        NULLIF(TRIM($v_channel_type),'') AS channel_type_raw,
        NULLIF(TRIM($v_town),'')         AS town_raw,
        NULLIF(TRIM($v_distributor),'')  AS distributor_raw,
        NULLIF(TRIM($v_app_user_tag),'') AS app_user_tag_raw
),
sel_filters AS (
    SELECT p.*,
        IFF(p.region_raw       IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.region_raw,','),       x -> UPPER(TRIM(x)))) AS region_arr,
        IFF(p.category_raw     IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.category_raw,','),     x -> UPPER(TRIM(x)))) AS category_arr,
        IFF(p.brand_raw        IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.brand_raw,','),        x -> UPPER(TRIM(x)))) AS brand_arr,
        IFF(p.channel_type_raw IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.channel_type_raw,','), x -> UPPER(TRIM(x)))) AS channel_type_arr,
        IFF(p.town_raw         IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.town_raw,','),         x -> UPPER(TRIM(x)))) AS town_arr,
        IFF(p.distributor_raw  IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.distributor_raw,','),  x -> UPPER(TRIM(x)))) AS distributor_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*,
        IFF(sf.years_raw IS NULL, ARRAY_CONSTRUCT(),
            TRANSFORM(SPLIT(sf.years_raw,','), x -> TRY_TO_NUMBER(TRIM(x)))) AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*,
        IFF(s.months_raw IS NULL, ARRAY_CONSTRUCT(),
            TRANSFORM(SPLIT(s.months_raw,','), x ->
                CASE UPPER(TRIM(x))
                    WHEN 'JUL' THEN 1  WHEN 'AUG' THEN 2  WHEN 'SEP' THEN 3  WHEN 'OCT' THEN 4
                    WHEN 'NOV' THEN 5  WHEN 'DEC' THEN 6  WHEN 'JAN' THEN 7  WHEN 'FEB' THEN 8
                    WHEN 'MAR' THEN 9  WHEN 'APR' THEN 10 WHEN 'MAY' THEN 11 WHEN 'JUN' THEN 12
                END)) AS month_no_arr
    FROM sel_years s
),
resolved AS (
    SELECT sm.*,
        IFF(ARRAY_SIZE(sm.year_arr) = 0, ARRAY_CONSTRUCT(sm.current_fy), sm.year_arr) AS eff_years,
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) > 0 THEN ARRAY_CONSTRUCT(12)
            ELSE sm.month_no_arr
        END AS fytd_month_nos,
        IFF(ARRAY_SIZE(sm.month_no_arr) = 0, ARRAY_CONSTRUCT(sm.current_fy_month_no), sm.month_no_arr) AS mtd_month_nos
    FROM sel_months sm
),
fy_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        DATE_FROM_PARTS(y.VALUE::NUMBER - 1, 7, 1) AS fy_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - IFF(MAX(m.VALUE::NUMBER) <= 6, 1, 0),
            MOD(MAX(m.VALUE::NUMBER) + 5, 12) + 1,
            1)) AS fytd_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years)      y,
         LATERAL FLATTEN(input => r.fytd_month_nos) m
    GROUP BY y.VALUE::NUMBER
),
mtd_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        m.VALUE::NUMBER AS fy_month_no,
        DATE_FROM_PARTS(
            y.VALUE::NUMBER - IFF(m.VALUE::NUMBER <= 6, 1, 0),
            MOD(m.VALUE::NUMBER + 5, 12) + 1,
            1) AS m_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - IFF(m.VALUE::NUMBER <= 6, 1, 0),
            MOD(m.VALUE::NUMBER + 5, 12) + 1,
            1)) AS m_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years)     y,
         LATERAL FLATTEN(input => r.mtd_month_nos) m
),
primary_daily AS (
    SELECT
        v.POSTING_DATE    AS SALES_DATE,
        SUM(v.VALUE)      AS NET_SALES,
        SUM(v.QTY_IN_CTN) AS VOLUME_CTN
    FROM GOLD.VW_FACT_PRIMARY_SALES v
    WHERE 1 = 1
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), NULLIF(v.MATERIAL_GROUP_NAME,''), '')))::VARIANT,
                  (SELECT category_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_BRAND,'')))::VARIANT,        (SELECT brand_arr        FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.PARTY_CODE,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,  (SELECT distributor_arr FROM sel_filters)))
      AND EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.POSTING_DATE BETWEEN m.m_start AND m.m_end)
    GROUP BY v.POSTING_DATE
)
SELECT
    SALES_DATE,
    DAY(SALES_DATE) AS DAY_OF_MONTH,
    NET_SALES,
    VOLUME_CTN
FROM primary_daily
ORDER BY SALES_DATE;













-- =====================================================================
-- ✅ PRIMARY KPI #3 — CATEGORY-WISE NET SALES (MTD)
-- Grouped on the mapped category, falling back to MATERIAL_GROUP_NAME when the
-- material is not yet in PRODUCT_MAPPED - so the breakdown agrees with the
-- category filter and nothing silently disappears.
-- FY2027 AUG, no filters: 277,307.00 ctn across 11 categories.
-- =====================================================================

SET v_years        = '2027';
SET v_months       = 'AUG';
SET v_region       = NULL;
SET v_category     = NULL;
SET v_brand        = NULL;
SET v_channel_type = NULL;
SET v_town         = NULL;
SET v_distributor  = NULL;
SET v_app_user_tag = NULL;

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7 THEN YEAR(CURRENT_DATE()) + 1 ELSE YEAR(CURRENT_DATE()) END AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7 THEN MONTH(CURRENT_DATE()) - 6 ELSE MONTH(CURRENT_DATE()) + 6 END AS current_fy_month_no,
        NULLIF(TRIM($v_years),'')        AS years_raw,
        NULLIF(TRIM($v_months),'')       AS months_raw,
        NULLIF(TRIM($v_region),'')       AS region_raw,
        NULLIF(TRIM($v_category),'')     AS category_raw,
        NULLIF(TRIM($v_brand),'')        AS brand_raw,
        NULLIF(TRIM($v_channel_type),'') AS channel_type_raw,
        NULLIF(TRIM($v_town),'')         AS town_raw,
        NULLIF(TRIM($v_distributor),'')  AS distributor_raw,
        NULLIF(TRIM($v_app_user_tag),'') AS app_user_tag_raw
),
sel_filters AS (
    SELECT p.*,
        IFF(p.region_raw       IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.region_raw,','),       x -> UPPER(TRIM(x)))) AS region_arr,
        IFF(p.category_raw     IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.category_raw,','),     x -> UPPER(TRIM(x)))) AS category_arr,
        IFF(p.brand_raw        IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.brand_raw,','),        x -> UPPER(TRIM(x)))) AS brand_arr,
        IFF(p.channel_type_raw IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.channel_type_raw,','), x -> UPPER(TRIM(x)))) AS channel_type_arr,
        IFF(p.town_raw         IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.town_raw,','),         x -> UPPER(TRIM(x)))) AS town_arr,
        IFF(p.distributor_raw  IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.distributor_raw,','),  x -> UPPER(TRIM(x)))) AS distributor_arr,
        IFF(p.app_user_tag_raw IS NULL,
            ARRAY_CONSTRUCT('__EXCLUDE_SD__'),
            TRANSFORM(SPLIT(p.app_user_tag_raw,','), x -> UPPER(TRIM(x)))) AS app_user_tag_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*,
        IFF(sf.years_raw IS NULL, ARRAY_CONSTRUCT(),
            TRANSFORM(SPLIT(sf.years_raw,','), x -> TRY_TO_NUMBER(TRIM(x)))) AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*,
        IFF(s.months_raw IS NULL, ARRAY_CONSTRUCT(),
            TRANSFORM(SPLIT(s.months_raw,','), x ->
                CASE UPPER(TRIM(x))
                    WHEN 'JUL' THEN 1  WHEN 'AUG' THEN 2  WHEN 'SEP' THEN 3  WHEN 'OCT' THEN 4
                    WHEN 'NOV' THEN 5  WHEN 'DEC' THEN 6  WHEN 'JAN' THEN 7  WHEN 'FEB' THEN 8
                    WHEN 'MAR' THEN 9  WHEN 'APR' THEN 10 WHEN 'MAY' THEN 11 WHEN 'JUN' THEN 12
                END)) AS month_no_arr
    FROM sel_years s
),
resolved AS (
    SELECT sm.*,
        IFF(ARRAY_SIZE(sm.year_arr) = 0, ARRAY_CONSTRUCT(sm.current_fy), sm.year_arr) AS eff_years,
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) > 0 THEN ARRAY_CONSTRUCT(12)
            ELSE sm.month_no_arr
        END AS fytd_month_nos,
        IFF(ARRAY_SIZE(sm.month_no_arr) = 0, ARRAY_CONSTRUCT(sm.current_fy_month_no), sm.month_no_arr) AS mtd_month_nos
    FROM sel_months sm
),
fy_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        DATE_FROM_PARTS(y.VALUE::NUMBER - 1, 7, 1) AS fy_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - IFF(MAX(m.VALUE::NUMBER) <= 6, 1, 0),
            MOD(MAX(m.VALUE::NUMBER) + 5, 12) + 1,
            1)) AS fytd_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years)      y,
         LATERAL FLATTEN(input => r.fytd_month_nos) m
    GROUP BY y.VALUE::NUMBER
),
mtd_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        m.VALUE::NUMBER AS fy_month_no,
        DATE_FROM_PARTS(
            y.VALUE::NUMBER - IFF(m.VALUE::NUMBER <= 6, 1, 0),
            MOD(m.VALUE::NUMBER + 5, 12) + 1,
            1) AS m_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - IFF(m.VALUE::NUMBER <= 6, 1, 0),
            MOD(m.VALUE::NUMBER + 5, 12) + 1,
            1)) AS m_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years)     y,
         LATERAL FLATTEN(input => r.mtd_month_nos) m
),

-- ── authoritative primary=secondary whitelist (same source as validated reference query) ──
pes_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS SAP_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
    WHERE NULLIF(TRIM(DISTRIBUTOR_SAP_CODE),'') IS NOT NULL
),
primary_by_category AS (
    SELECT
        COALESCE(NULLIF(v.FILTER_CATEGORY,''), v.MATERIAL_GROUP_NAME, 'Unmapped') AS CATEGORY,
        SUM(v.VALUE)      AS NET_SALES,
        SUM(v.QTY_IN_CTN) AS VOLUME_CTN,
        SUM(v.QTY_IN_PCS) AS VOLUME_PCS
    FROM GOLD.VW_FACT_PRIMARY_SALES v
    WHERE 1 = 1
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), v.MATERIAL_GROUP_NAME, '')))::VARIANT,
                  (SELECT category_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_BRAND,''), v.BRAND, '')))::VARIANT,
                  (SELECT brand_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.PARTY_CODE,'')))::VARIANT,    (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.SHIP_TO_PARTY,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,     (SELECT distributor_arr FROM sel_filters)))
      AND EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.POSTING_DATE BETWEEN m.m_start AND m.m_end)
    GROUP BY 1
)
SELECT CATEGORY, NET_SALES, VOLUME_CTN, VOLUME_PCS
FROM primary_by_category
WHERE CATEGORY IS NOT NULL
ORDER BY NET_SALES DESC;









-- =====================================================================
-- ✅ PRIMARY KPI #4 — TOP N BRANDS (MTD)
-- Brand fallback: mapped brand, else SAP brand on the invoice line.
-- Recovered brands (e.g. Ono, Dr. John) are preserved in the top-N.
-- =====================================================================

SET v_years        = '2027';
SET v_months       = 'AUG';
SET v_region       = NULL;
SET v_category     = NULL;
SET v_brand        = NULL;
SET v_channel_type = NULL;
SET v_town         = NULL;
SET v_distributor  = NULL;
SET v_app_user_tag = NULL;
SET top_n          = 10;

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7 THEN YEAR(CURRENT_DATE()) + 1 ELSE YEAR(CURRENT_DATE()) END AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7 THEN MONTH(CURRENT_DATE()) - 6 ELSE MONTH(CURRENT_DATE()) + 6 END AS current_fy_month_no,
        NULLIF(TRIM($v_years),'')        AS years_raw,
        NULLIF(TRIM($v_months),'')       AS months_raw,
        NULLIF(TRIM($v_region),'')       AS region_raw,
        NULLIF(TRIM($v_category),'')     AS category_raw,
        NULLIF(TRIM($v_brand),'')        AS brand_raw,
        NULLIF(TRIM($v_channel_type),'') AS channel_type_raw,
        NULLIF(TRIM($v_town),'')         AS town_raw,
        NULLIF(TRIM($v_distributor),'')  AS distributor_raw
),
sel_filters AS (
    SELECT p.*,
        IFF(p.region_raw       IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.region_raw,','),       x -> UPPER(TRIM(x)))) AS region_arr,
        IFF(p.category_raw     IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.category_raw,','),     x -> UPPER(TRIM(x)))) AS category_arr,
        IFF(p.brand_raw        IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.brand_raw,','),        x -> UPPER(TRIM(x)))) AS brand_arr,
        IFF(p.channel_type_raw IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.channel_type_raw,','), x -> UPPER(TRIM(x)))) AS channel_type_arr,
        IFF(p.town_raw         IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.town_raw,','),         x -> UPPER(TRIM(x)))) AS town_arr,
        IFF(p.distributor_raw  IS NULL, ARRAY_CONSTRUCT(), TRANSFORM(SPLIT(p.distributor_raw,','),  x -> UPPER(TRIM(x)))) AS distributor_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*,
        IFF(sf.years_raw IS NULL, ARRAY_CONSTRUCT(),
            TRANSFORM(SPLIT(sf.years_raw,','), x -> TRY_TO_NUMBER(TRIM(x)))) AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*,
        IFF(s.months_raw IS NULL, ARRAY_CONSTRUCT(),
            TRANSFORM(SPLIT(s.months_raw,','), x ->
                CASE UPPER(TRIM(x))
                    WHEN 'JUL' THEN 1  WHEN 'AUG' THEN 2  WHEN 'SEP' THEN 3  WHEN 'OCT' THEN 4
                    WHEN 'NOV' THEN 5  WHEN 'DEC' THEN 6  WHEN 'JAN' THEN 7  WHEN 'FEB' THEN 8
                    WHEN 'MAR' THEN 9  WHEN 'APR' THEN 10 WHEN 'MAY' THEN 11 WHEN 'JUN' THEN 12
                END)) AS month_no_arr
    FROM sel_years s
),
resolved AS (
    SELECT sm.*,
        IFF(ARRAY_SIZE(sm.year_arr) = 0, ARRAY_CONSTRUCT(sm.current_fy), sm.year_arr) AS eff_years,
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) > 0 THEN ARRAY_CONSTRUCT(12)
            ELSE sm.month_no_arr
        END AS fytd_month_nos,
        IFF(ARRAY_SIZE(sm.month_no_arr) = 0, ARRAY_CONSTRUCT(sm.current_fy_month_no), sm.month_no_arr) AS mtd_month_nos
    FROM sel_months sm
),
fy_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        DATE_FROM_PARTS(y.VALUE::NUMBER - 1, 7, 1) AS fy_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - IFF(MAX(m.VALUE::NUMBER) <= 6, 1, 0),
            MOD(MAX(m.VALUE::NUMBER) + 5, 12) + 1,
            1)) AS fytd_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years)      y,
         LATERAL FLATTEN(input => r.fytd_month_nos) m
    GROUP BY y.VALUE::NUMBER
),
mtd_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        m.VALUE::NUMBER AS fy_month_no,
        DATE_FROM_PARTS(
            y.VALUE::NUMBER - IFF(m.VALUE::NUMBER <= 6, 1, 0),
            MOD(m.VALUE::NUMBER + 5, 12) + 1,
            1) AS m_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - IFF(m.VALUE::NUMBER <= 6, 1, 0),
            MOD(m.VALUE::NUMBER + 5, 12) + 1,
            1)) AS m_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years)     y,
         LATERAL FLATTEN(input => r.mtd_month_nos) m
),
primary_by_brand AS (
    SELECT
        UPPER(TRIM(COALESCE(NULLIF(v.FILTER_BRAND,''), NULLIF(v.BRAND,''), 'UNMAPPED'))) AS BRAND,
        SUM(v.VALUE)                                                                     AS NET_SALES,
        SUM(v.QTY_IN_CTN)                                                                AS VOLUME_CTN
    FROM GOLD.VW_FACT_PRIMARY_SALES v
    WHERE 1 = 1
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), NULLIF(v.MATERIAL_GROUP_NAME,''), '')))::VARIANT,
                  (SELECT category_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_BRAND,''), NULLIF(v.BRAND,''), 'UNMAPPED')))::VARIANT,
                  (SELECT brand_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.PARTY_CODE,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,  (SELECT distributor_arr FROM sel_filters)))
      AND EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.POSTING_DATE BETWEEN m.m_start AND m.m_end)
    GROUP BY 1
)
SELECT BRAND, NET_SALES, VOLUME_CTN
FROM primary_by_brand
WHERE BRAND IS NOT NULL
ORDER BY NET_SALES DESC
LIMIT $top_n;















-- =====================================================================
-- ✅ PRIMARY KPI #8 — FULL FISCAL YEAR MONTHLY TREND (Jul → Jun)
-- Only v_year and v_region apply, as in v3.
-- Region reads FILTER_REGION, not ZFI_SCO.REGION_NAME.
-- =====================================================================

SET v_year   = 2027;
SET v_region = NULL;

WITH params AS (
    SELECT $v_year AS fiscal_year,
           DATE_FROM_PARTS($v_year - 1, 7, 1) AS fy_start,
           DATE_FROM_PARTS($v_year, 6, 30)    AS fy_end
),
months AS (
    SELECT DATEADD('month', seq, p.fy_start) AS FY_MONTH_START
    FROM params p,
    (SELECT 0 AS seq UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
     UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7
     UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11)
),
primary_sales AS (
    SELECT DATE_TRUNC('month', v.POSTING_DATE) AS FY_MONTH_START,
           SUM(v.VALUE)      AS PRIMARY_SALES_VALUE,
           SUM(v.QTY_IN_CTN) AS PRIMARY_VOLUME_CTN,
           SUM(v.QTY_IN_PCS) AS PRIMARY_VOLUME_PCS
    FROM GOLD.VW_FACT_PRIMARY_SALES v
    WHERE v.POSTING_DATE >= (SELECT fy_start FROM params)
      AND v.POSTING_DATE <  DATEADD('year', 1, (SELECT fy_start FROM params))
      AND ($v_region IS NULL OR UPPER(TRIM(COALESCE(v.FILTER_REGION,''))) = UPPER(TRIM($v_region)))
    GROUP BY 1
)
SELECT
    TO_CHAR(m.FY_MONTH_START,'Mon')        AS MONTH,
    m.FY_MONTH_START                       AS MONTH_START,
    COALESCE(s.PRIMARY_SALES_VALUE, 0)     AS PRIMARY_SALES_VALUE,
    COALESCE(s.PRIMARY_VOLUME_CTN, 0)      AS PRIMARY_VOLUME_CTN,
    COALESCE(s.PRIMARY_VOLUME_PCS, 0)      AS PRIMARY_VOLUME_PCS
FROM months m
LEFT JOIN primary_sales s ON s.FY_MONTH_START = m.FY_MONTH_START
ORDER BY m.FY_MONTH_START;
