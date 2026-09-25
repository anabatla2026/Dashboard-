-- =====================================================================
-- Ana & Batla - Dashboard 1, SECONDARY queries, v5
-- Rebuilt on GOLD.VW_FACT_SECONDARY_SALES / GOLD.VW_FACT_PRIMARY_SALES
-- Pattern taken verbatim from the corrected KPI #1 (24 September 2026)
--
-- Every query uses the same shape:
--   params -> sel_filters -> sel_years -> sel_months -> resolved
--          -> fy_ranges -> mtd_ranges -> pes_codes
--   secondary CTE   filters on APP_USER_TAG + the six shared filters
--   primary top-up  filters on pes_codes + CATEGORY only
--   final           combines the two
--
-- Notes carried over from the corrected KPI #1:
--   * pes_codes reads GOLD.MT_DIRECT_DISTRIBUTORS_VW (41 SAP codes).
--   * The secondary side does NOT exclude those distributors; for Aug-2026
--     they have 0 secondary cartons, so there is nothing to double count.
--     Check this again for any month where that stops being true.
--   * The top-up filters on CATEGORY only. If the user picks a Region, Town,
--     Channel or Distributor, the full top-up is still added. Each query has
--     the other filters ready as commented lines - uncomment together.
--   * Category on the top-up falls back to MATERIAL_GROUP_NAME when the
--     material is not yet in PRODUCT_MAPPED.
--
--   * KPI #7 only: TARGETS_VW.DIST_CODE carries a leading space (' D0311'),
--     so the join is on UPPER(TRIM(...)). TARGET_MONTH is stored mixed case
--     ('Aug'), so the calendar map is UPPER()-ed - without that the targets
--     come back as zero.
--
-- FY2027 AUG reference, no filters:
--   secondary excl SD   2,018,156,796 value / 247,906.27 ctn / 77,725,001 units
--   primary top-up        208,313,570 value /  33,044.00 ctn /  9,556,282 pcs
--   combined            2,226,470,366 value / 280,950.27 ctn / 87,281,283
-- =====================================================================

USE DATABASE SALESDWH;
USE SCHEMA GOLD;

-- =====================================================================
-- ✅ SECONDARY KPI #1 — MTD / FYTD (Sales Value + CTN + PCS)
-- Secondary (GOLD.VW_FACT_SECONDARY_SALES) + primary top-up for the
-- primary = secondary distributors (GOLD.MT_DIRECT_DISTRIBUTORS_VW).
-- Filters: REGION + CATEGORY + BRAND + CHANNEL_TYPE + TOWN + DISTRIBUTOR
--          + APP_USER_TAG (secondary only).
-- FY2027 AUG, no filters: 2,226,470,366 value / 280,950.27 ctn / 87,281,283 pcs
-- =====================================================================

SET v_years        = '2027';
SET v_months       = 'AUG';
SET v_region       = NULL;
SET v_category     = NULL;
SET v_brand        = NULL;
SET v_channel_type = NULL;
SET v_town         = 'Peshawar';
SET v_distributor  = NULL;
SET v_app_user_tag = 'MDSD,OB,SD - OB';

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

-- ── SECONDARY ──
secondary_agg AS (
    SELECT
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end), v.NET_SALES,   0)),0) AS MTD_SALES_VALUE,
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end), v.SALES_CTN,   0)),0) AS MTD_VOLUME_CTN,
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end), v.SALES_UNITS, 0)),0) AS MTD_VOLUME_PCS,
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end), v.NET_SALES,   0)),0) AS FYTD_SALES_VALUE,
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end), v.SALES_CTN,   0)),0) AS FYTD_VOLUME_CTN,
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end), v.SALES_UNITS, 0)),0) AS FYTD_VOLUME_PCS
    FROM GOLD.VW_FACT_SECONDARY_SALES v
    WHERE
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT, (SELECT app_user_tag_arr FROM sel_filters))
                THEN COALESCE(v.APP_USER_TAGGED_TITLE,'') <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.APP_USER_TAGGED_TITLE,'')))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CATEGORY,'')))::VARIANT,     (SELECT category_arr     FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_BRAND,'')))::VARIANT,        (SELECT brand_arr        FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DISTRIBUTOR_CODE,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_SAP_CODE,'')))::VARIANT,    (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,        (SELECT distributor_arr FROM sel_filters)))
),

-- ── PRIMARY TOP-UP ──
-- Category filter falls back to MATERIAL_GROUP_NAME when FILTER_CATEGORY is NULL,
-- recovering materials that are not yet in PRODUCT_MAPPED.
primary_topup AS (
    SELECT
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.POSTING_DATE BETWEEN m.m_start AND m.m_end), v.VALUE,      0)),0) AS MTD_SALES_VALUE,
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.POSTING_DATE BETWEEN m.m_start AND m.m_end), v.QTY_IN_CTN, 0)),0) AS MTD_VOLUME_CTN,
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.POSTING_DATE BETWEEN m.m_start AND m.m_end), v.QTY_IN_PCS, 0)),0) AS MTD_VOLUME_PCS,
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.POSTING_DATE BETWEEN f.fy_start AND f.fytd_end), v.VALUE,      0)),0) AS FYTD_SALES_VALUE,
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.POSTING_DATE BETWEEN f.fy_start AND f.fytd_end), v.QTY_IN_CTN, 0)),0) AS FYTD_VOLUME_CTN,
        COALESCE(SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.POSTING_DATE BETWEEN f.fy_start AND f.fytd_end), v.QTY_IN_PCS, 0)),0) AS FYTD_VOLUME_PCS
    FROM GOLD.VW_FACT_PRIMARY_SALES v
    WHERE UPPER(TRIM(COALESCE(v.PARTY_CODE,''))) IN (SELECT SAP_CODE FROM pes_codes)
      AND (ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), v.MATERIAL_GROUP_NAME, '')))::VARIANT,
                  (SELECT category_arr FROM sel_filters)
              ))
      -- Optional: uncomment to make the top-up obey the other filters as well.
      -- As written the top-up follows CATEGORY only, matching the validated reference query.
       AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
            OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
       AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
            OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(NULLIF(v.FILTER_BRAND,''), v.BRAND, '')))::VARIANT, (SELECT brand_arr FROM sel_filters)))
       AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
            OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
       AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
            OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
       AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
            OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.PARTY_CODE,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
            OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,  (SELECT distributor_arr FROM sel_filters)))
)
SELECT
    --t.MTD_VOLUME_CTN                        AS PRIMARY_MTD,
    ZEROIFNULL(s.MTD_SALES_VALUE)  + ZEROIFNULL(t.MTD_SALES_VALUE)  AS MTD_SALES_VALUE,
    ZEROIFNULL(s.MTD_VOLUME_CTN)   + ZEROIFNULL(t.MTD_VOLUME_CTN)   AS MTD_VOLUME_CTN,
    ZEROIFNULL(s.MTD_VOLUME_PCS)   + ZEROIFNULL(t.MTD_VOLUME_PCS)   AS MTD_VOLUME_PCS,
    ZEROIFNULL(s.FYTD_SALES_VALUE) + ZEROIFNULL(t.FYTD_SALES_VALUE) AS FYTD_SALES_VALUE,
    ZEROIFNULL(s.FYTD_VOLUME_CTN ) + ZEROIFNULL(t.FYTD_VOLUME_CTN)  AS FYTD_VOLUME_CTN,
    ZEROIFNULL(s.FYTD_VOLUME_PCS ) + ZEROIFNULL(t.FYTD_VOLUME_PCS)  AS FYTD_VOLUME_PCS
FROM secondary_agg s
CROSS JOIN primary_topup t;


-----------------------------------------------------------------------

-- =====================================================================
-- ✅ SECONDARY KPI #2 — MTD / FYTD PRODUCTIVE STORES & DISTRIBUTORS
-- Secondary only — counts of distinct outlets and distributors.
-- No primary top-up: SAP has no outlet grain, so it cannot add stores.
-- =====================================================================

SET v_years        = '2027';
SET v_months       = 'AUG';
SET v_region       = NULL;
SET v_category     = NULL;
SET v_brand        = NULL;
SET v_channel_type = NULL;
SET v_town         = 'Peshawar';
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

secondary_counts AS (
    SELECT
        COALESCE(COUNT(DISTINCT IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end), NULLIF(TRIM(v.OUTLET_CODE),''),       NULL)),0) AS MTD_PRODUCTIVE_STORES,
        COALESCE(COUNT(DISTINCT IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end), NULLIF(TRIM(v.DISTRIBUTOR_CODE),''), NULL)),0) AS MTD_PRODUCTIVE_DISTRIBUTOR,
        COALESCE(COUNT(DISTINCT IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end), NULLIF(TRIM(v.OUTLET_CODE),''),       NULL)),0) AS FYTD_PRODUCTIVE_STORES,
        COALESCE(COUNT(DISTINCT IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end), NULLIF(TRIM(v.DISTRIBUTOR_CODE),''), NULL)),0) AS FYTD_PRODUCTIVE_DISTRIBUTOR
    FROM GOLD.VW_FACT_SECONDARY_SALES v
    WHERE
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT, (SELECT app_user_tag_arr FROM sel_filters))
                THEN COALESCE(v.APP_USER_TAGGED_TITLE,'') <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.APP_USER_TAGGED_TITLE,'')))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CATEGORY,'')))::VARIANT,     (SELECT category_arr     FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_BRAND,'')))::VARIANT,        (SELECT brand_arr        FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DISTRIBUTOR_CODE,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_SAP_CODE,'')))::VARIANT,    (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,        (SELECT distributor_arr FROM sel_filters)))
)
SELECT * FROM secondary_counts;

-----------------------------------------------------------------------

-- =====================================================================
-- ✅ SECONDARY KPI #3 — DAILY NET SALES TREND (MTD)
-- Secondary daily + primary top-up daily, unioned and re-aggregated by date.
-- Top-up uses POSTING_DATE so it lines up with KPI #1.
-- Primary top-up obeys ALL dimension filters (same as secondary side).
-- =====================================================================

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

-- ── authoritative primary=secondary whitelist ──
pes_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS SAP_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
    WHERE NULLIF(TRIM(DISTRIBUTOR_SAP_CODE),'') IS NOT NULL
),

secondary_daily AS (
    SELECT v.DATE AS SALES_DATE, COALESCE(SUM(v.NET_SALES),0) AS NET_SALES
    FROM GOLD.VW_FACT_SECONDARY_SALES v
    WHERE
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT, (SELECT app_user_tag_arr FROM sel_filters))
                THEN COALESCE(v.APP_USER_TAGGED_TITLE,'') <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.APP_USER_TAGGED_TITLE,'')))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CATEGORY,'')))::VARIANT,     (SELECT category_arr     FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_BRAND,'')))::VARIANT,        (SELECT brand_arr        FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DISTRIBUTOR_CODE,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_SAP_CODE,'')))::VARIANT,    (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,        (SELECT distributor_arr FROM sel_filters)))
      AND EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end)
    GROUP BY v.DATE
),
primary_daily AS (
    SELECT v.POSTING_DATE AS SALES_DATE, COALESCE(SUM(v.VALUE),0) AS NET_SALES
    FROM GOLD.VW_FACT_PRIMARY_SALES v
    WHERE UPPER(TRIM(COALESCE(v.PARTY_CODE,''))) IN (SELECT SAP_CODE FROM pes_codes)
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), v.MATERIAL_GROUP_NAME, '')))::VARIANT,
                  (SELECT category_arr FROM sel_filters)
              ))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(NULLIF(v.FILTER_BRAND,''), v.BRAND, '')))::VARIANT, (SELECT brand_arr FROM sel_filters)))
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
    ZEROIFNULL(SUM(NET_SALES))  AS NET_SALES
FROM (
    SELECT SALES_DATE, NET_SALES FROM secondary_daily
    UNION ALL
    SELECT SALES_DATE, NET_SALES FROM primary_daily
)
GROUP BY SALES_DATE, DAY(SALES_DATE)
ORDER BY SALES_DATE;
-----------------------------------------------------------------------





-- =====================================================================
-- ✅ SECONDARY KPI #4 — SALES VALUE BY CHANNEL TYPE (MTD)
-- Secondary only.
-- CHANNEL_TYPE comes from DISTRIBUTOR_MAPPED.M_CHANNEL (FILTER_CHANNEL_TYPE),
-- not from SalesFlo's own CHANNEL_TYPE.
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

secondary_by_channel AS (
    SELECT
        COALESCE(NULLIF(TRIM(v.FILTER_CHANNEL_TYPE),''), 'Unmapped') AS CHANNEL_TYPE,
        SUM(v.NET_SALES)                                              AS SALES_VALUE,
        SUM(v.SALES_CTN)                                              AS SALES_CTN
    FROM GOLD.VW_FACT_SECONDARY_SALES v
    WHERE
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT, (SELECT app_user_tag_arr FROM sel_filters))
                THEN COALESCE(v.APP_USER_TAGGED_TITLE,'') <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.APP_USER_TAGGED_TITLE,'')))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CATEGORY,'')))::VARIANT,     (SELECT category_arr     FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_BRAND,'')))::VARIANT,        (SELECT brand_arr        FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DISTRIBUTOR_CODE,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_SAP_CODE,'')))::VARIANT,    (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,        (SELECT distributor_arr FROM sel_filters)))
      AND EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end)
    GROUP BY 1
)


-----------------------------------------------------------------------






-- =====================================================================
-- ✅ SECONDARY KPI #5 — NET SALES VALUE BY CATEGORY (MTD)
-- Secondary + primary top-up, unioned and re-aggregated by category.
-- Both sides use the same fallback + normalization: mapped category,
-- else SAP material group, uppercased and trimmed. Same bucket labels
-- on both sides so the UNION collapses cleanly.
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

pes_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS SAP_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
    WHERE NULLIF(TRIM(DISTRIBUTOR_SAP_CODE),'') IS NOT NULL
),

secondary_by_category AS (
    SELECT
        UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), 'Unmapped'))) AS CATEGORY,
        COALESCE(SUM(v.NET_SALES),0)                                                AS SALES_VALUE,
        COALESCE(SUM(v.SALES_CTN),0)                                                AS SALES_CTN
    FROM GOLD.VW_FACT_SECONDARY_SALES v
    WHERE
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT, (SELECT app_user_tag_arr FROM sel_filters))
                THEN COALESCE(v.APP_USER_TAGGED_TITLE,'') <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.APP_USER_TAGGED_TITLE,'')))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), 'Unmapped')))::VARIANT,
                  (SELECT category_arr FROM sel_filters)
              ))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_BRAND,'')))::VARIANT,        (SELECT brand_arr        FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DISTRIBUTOR_CODE,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_SAP_CODE,'')))::VARIANT,    (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,        (SELECT distributor_arr FROM sel_filters)))
      AND EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end)
    GROUP BY 1
),
primary_by_category AS (
    SELECT
        UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), v.MATERIAL_GROUP_NAME, 'Unmapped'))) AS CATEGORY,
        COALESCE(SUM(v.VALUE),0)                                                                          AS SALES_VALUE,
        COALESCE(SUM(v.QTY_IN_CTN),0)                                                                     AS SALES_CTN
    FROM GOLD.VW_FACT_PRIMARY_SALES v
    WHERE UPPER(TRIM(COALESCE(v.PARTY_CODE,''))) IN (SELECT SAP_CODE FROM pes_codes)
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), v.MATERIAL_GROUP_NAME, 'Unmapped')))::VARIANT,
                  (SELECT category_arr FROM sel_filters)
              ))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(NULLIF(v.FILTER_BRAND,''), v.BRAND, '')))::VARIANT, (SELECT brand_arr FROM sel_filters)))
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
SELECT
    CATEGORY,
    ZEROIFNULL(SUM(SALES_VALUE)) AS SALES_VALUE,
    ZEROIFNULL(SUM(SALES_CTN))   AS SALES_CTN
FROM (
    SELECT CATEGORY, SALES_VALUE, SALES_CTN FROM secondary_by_category
    UNION ALL
    SELECT CATEGORY, SALES_VALUE, SALES_CTN FROM primary_by_category
)
WHERE CATEGORY IS NOT NULL
GROUP BY CATEGORY
ORDER BY SALES_VALUE DESC;

-----------------------------------------------------------------------


-- =====================================================================
-- ✅ SECONDARY KPI #6 — TOP-N BRANDS BY NET SALES VALUE (MTD)
-- Secondary + primary top-up, unioned and re-aggregated by brand.
-- Both sides normalize brand labels (UPPER + TRIM) so the UNION collapses
-- case/spacing variants into a single row.
-- Primary top-up obeys ALL filters (same as secondary).
-- =====================================================================

SET v_years        = '2027';
SET v_months       = 'AUG';
SET v_region       = NULL;
SET v_category     = 'Baby Diapers';
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

pes_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS SAP_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
    WHERE NULLIF(TRIM(DISTRIBUTOR_SAP_CODE),'') IS NOT NULL
),

secondary_by_brand AS (
    SELECT
        UPPER(TRIM(COALESCE(NULLIF(v.FILTER_BRAND,''), 'Unmapped'))) AS BRAND,
        COALESCE(SUM(v.NET_SALES),0)                                             AS SALES_VALUE
    FROM GOLD.VW_FACT_SECONDARY_SALES v
    WHERE
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT, (SELECT app_user_tag_arr FROM sel_filters))
                THEN COALESCE(v.APP_USER_TAGGED_TITLE,'') <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.APP_USER_TAGGED_TITLE,'')))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CATEGORY,'')))::VARIANT,     (SELECT category_arr     FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_BRAND,''), 'Unmapped')))::VARIANT,
                  (SELECT brand_arr FROM sel_filters)
              ))
      AND (ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_CHANNEL_TYPE,'')))::VARIANT, (SELECT channel_type_arr FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT town_arr         FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_TOWN,'')))::VARIANT,         (SELECT town_arr         FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT distributor_arr  FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DISTRIBUTOR_CODE,'')))::VARIANT, (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_SAP_CODE,'')))::VARIANT,    (SELECT distributor_arr FROM sel_filters))
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.DIST_NAME,'')))::VARIANT,        (SELECT distributor_arr FROM sel_filters)))
      AND EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end)
    GROUP BY 1
),
primary_by_brand AS (
    SELECT
        UPPER(TRIM(COALESCE(NULLIF(v.FILTER_BRAND,''), v.BRAND, 'Unmapped'))) AS BRAND,
        COALESCE(SUM(v.VALUE),0)                                                          AS SALES_VALUE
    FROM GOLD.VW_FACT_PRIMARY_SALES v
    WHERE UPPER(TRIM(COALESCE(v.PARTY_CODE,''))) IN (SELECT SAP_CODE FROM pes_codes)
      AND (ARRAY_SIZE((SELECT region_arr       FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.FILTER_REGION,'')))::VARIANT,       (SELECT region_arr       FROM sel_filters)))
      AND (ARRAY_SIZE((SELECT category_arr     FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_CATEGORY,''), v.MATERIAL_GROUP_NAME, '')))::VARIANT,
                  (SELECT category_arr FROM sel_filters)
              ))
      AND (ARRAY_SIZE((SELECT brand_arr        FROM sel_filters)) = 0
           OR ARRAY_CONTAINS(
                  UPPER(TRIM(COALESCE(NULLIF(v.FILTER_BRAND,''), v.BRAND, 'Unmapped')))::VARIANT,
                  (SELECT brand_arr FROM sel_filters)
              ))
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
SELECT
    BRAND,
    ZEROIFNULL(SUM(SALES_VALUE)) AS SALES_VALUE
FROM (
    SELECT BRAND, SALES_VALUE FROM secondary_by_brand
    UNION ALL
    SELECT BRAND, SALES_VALUE FROM primary_by_brand
)
WHERE BRAND IS NOT NULL
GROUP BY BRAND
ORDER BY SALES_VALUE DESC
LIMIT $top_n;

-----------------------------------------------------------------------


-- =====================================================================
-- ✅ SECONDARY KPI #6b — FULL FISCAL YEAR MONTHLY TREND (Jul → Jun)
-- Secondary + primary top-up by month. Only v_year and v_region apply.
-- Region now reads FILTER_REGION on both sides (the old primary side used
-- ZFI_SCO.REGION, which returns SAP's foreign region texts).
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
pes_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS SAP_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
    WHERE NULLIF(TRIM(DISTRIBUTOR_SAP_CODE),'') IS NOT NULL
),
secondary AS (
    SELECT DATE_TRUNC('month', v.DATE) AS FY_MONTH_START,
           COALESCE(SUM(v.NET_SALES),0)   AS SALES_VALUE,
           COALESCE(SUM(v.SALES_CTN),0)   AS VOLUME_CTN,
           COALESCE(SUM(v.SALES_UNITS),0) AS VOLUME_PCS
    FROM GOLD.VW_FACT_SECONDARY_SALES v
    WHERE v.DATE >= (SELECT fy_start FROM params)
      AND v.DATE <  DATEADD('year', 1, (SELECT fy_start FROM params))
      AND ($v_region IS NULL OR UPPER(TRIM(COALESCE(v.FILTER_REGION,''))) = UPPER(TRIM($v_region)))
      AND COALESCE(v.APP_USER_TAGGED_TITLE,'') <> 'SD'
    GROUP BY 1
),
primary_topup AS (
    SELECT DATE_TRUNC('month', v.POSTING_DATE) AS FY_MONTH_START,
           COALESCE(SUM(v.VALUE),0)      AS SALES_VALUE,
           COALESCE(SUM(v.QTY_IN_CTN),0) AS VOLUME_CTN,
           COALESCE(SUM(v.QTY_IN_PCS),0) AS VOLUME_PCS
    FROM GOLD.VW_FACT_PRIMARY_SALES v
    WHERE v.POSTING_DATE >= (SELECT fy_start FROM params)
      AND v.POSTING_DATE <  DATEADD('year', 1, (SELECT fy_start FROM params))
      AND ($v_region IS NULL OR UPPER(TRIM(COALESCE(v.FILTER_REGION,''))) = UPPER(TRIM($v_region)))
      AND UPPER(TRIM(COALESCE(v.PARTY_CODE,''))) IN (SELECT SAP_CODE FROM pes_codes)
    GROUP BY 1
),
combined AS (
    SELECT FY_MONTH_START, SUM(SALES_VALUE) AS SALES_VALUE, SUM(VOLUME_CTN) AS VOLUME_CTN, SUM(VOLUME_PCS) AS VOLUME_PCS
    FROM (SELECT * FROM secondary UNION ALL SELECT * FROM primary_topup)
    GROUP BY FY_MONTH_START
)
SELECT
    TO_CHAR(m.FY_MONTH_START,'Mon') AS MONTH,
    m.FY_MONTH_START                AS MONTH_START,
    COALESCE(c.SALES_VALUE, 0)      AS SALES_VALUE,
    COALESCE(c.VOLUME_CTN, 0)       AS VOLUME_CTN,
    COALESCE(c.VOLUME_PCS, 0)       AS VOLUME_PCS
FROM months m
LEFT JOIN combined c ON c.FY_MONTH_START = m.FY_MONTH_START
ORDER BY m.FY_MONTH_START;


-----------------------------------------------------------------------


-- =====================================================================
-- ✅ SECONDARY KPI #7 — REGION-WISE TARGET vs ACHIEVEMENT
-- MTD + FYTD. Filters: v_years + v_months + APP_USER_TAG.
-- Targets come from GOLD.TARGETS_VW keyed on the SalesFlo distributor code,
-- and are rolled up on GOLD.VW_DIM_DISTRIBUTOR_SALESFLO.REGION (M_NEW_REGION)
-- instead of DISTRIBUTOR_MASTER_VW.new_region.
-- Achievement = secondary + primary top-up, both grouped on FILTER_REGION.
-- Aug-2026 check: 215 target distributors, 2,499,491,382 total target;
-- 2,323,052,767 (93%) rolls up to 9 regions. The rest are target rows whose
-- distributor code is not in DISTRIBUTOR_MAPPED.
-- Achievement MTD ties exactly to KPI #1: 2,226,470,366.
-- =====================================================================

SET v_years        = '2027';
SET v_months       = 'AUG';
SET v_app_user_tag = NULL;

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7 THEN YEAR(CURRENT_DATE()) + 1 ELSE YEAR(CURRENT_DATE()) END AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7 THEN MONTH(CURRENT_DATE()) - 6 ELSE MONTH(CURRENT_DATE()) + 6 END AS current_fy_month_no,
        NULLIF(TRIM($v_years),'')        AS years_raw,
        NULLIF(TRIM($v_months),'')       AS months_raw,
        NULLIF(TRIM($v_app_user_tag),'') AS app_user_tag_raw
),
sel_filters AS (
    SELECT p.*,
        IFF(p.app_user_tag_raw IS NULL,
            ARRAY_CONSTRUCT('__EXCLUDE_SD__'),
            TRANSFORM(SPLIT(p.app_user_tag_raw,','), x -> UPPER(TRIM(x)))) AS app_user_tag_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*, IFF(sf.years_raw IS NULL, ARRAY_CONSTRUCT(),
        TRANSFORM(SPLIT(sf.years_raw,','), x -> TRY_TO_NUMBER(TRIM(x)))) AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*, IFF(s.months_raw IS NULL, ARRAY_CONSTRUCT(),
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
),
pes_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS SAP_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
    WHERE NULLIF(TRIM(DISTRIBUTOR_SAP_CODE),'') IS NOT NULL
),

-- TARGETS_VW stores CALENDAR year + month, so map the fiscal selection to calendar
targets_cal_map_mtd AS (
    SELECT DISTINCT
        YEAR(m.m_start)  AS cal_year,
        UPPER(TO_CHAR(m.m_start,'MON')) AS cal_month_name
    FROM mtd_ranges m
),
seq12 AS (
    SELECT SEQ4() AS n FROM TABLE(GENERATOR(ROWCOUNT => 12))
),
targets_cal_map_fytd AS (
    SELECT DISTINCT
        YEAR(DATEADD('month', s.n, f.fy_start))           AS cal_year,
        UPPER(TO_CHAR(DATEADD('month', s.n, f.fy_start),'MON'))  AS cal_month_name
    FROM fy_ranges f
    CROSS JOIN seq12 s
    WHERE DATEADD('month', s.n, f.fy_start) <= f.fytd_end
),
targets_agg_mtd AS (
    SELECT TRIM(t.DIST_CODE) AS distributor_code, SUM(t.VALUE) AS total_target_mtd
    FROM GOLD.TARGETS_VW t
    JOIN targets_cal_map_mtd cm
      ON t.TARGET_YEAR::NUMBER = cm.cal_year
     AND UPPER(TRIM(t.TARGET_MONTH)) = cm.cal_month_name
    GROUP BY 1
),
targets_agg_fytd AS (
    SELECT TRIM(t.DIST_CODE) AS distributor_code, SUM(t.VALUE) AS total_target_fytd
    FROM GOLD.TARGETS_VW t
    JOIN targets_cal_map_fytd cm
      ON t.TARGET_YEAR::NUMBER = cm.cal_year
     AND UPPER(TRIM(t.TARGET_MONTH)) = cm.cal_month_name
    GROUP BY 1
),
targets_by_region_mtd AS (
    SELECT d.REGION AS region, SUM(ta.total_target_mtd) AS targets_by_region_mtd
    FROM targets_agg_mtd ta
    JOIN GOLD.VW_DIM_DISTRIBUTOR_SALESFLO d ON d.SALESFLO_CODE = UPPER(TRIM(ta.distributor_code))
    GROUP BY d.REGION
),
targets_by_region_fytd AS (
    SELECT d.REGION AS region, SUM(ta.total_target_fytd) AS targets_by_region_fytd
    FROM targets_agg_fytd ta
    JOIN GOLD.VW_DIM_DISTRIBUTOR_SALESFLO d ON d.SALESFLO_CODE = UPPER(TRIM(ta.distributor_code))
    GROUP BY d.REGION
),
secondary_by_region AS (
    SELECT
        v.FILTER_REGION AS region,
        SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end), v.NET_SALES, 0)) AS ach_mtd,
        SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end), v.NET_SALES, 0)) AS ach_fytd
    FROM GOLD.VW_FACT_SECONDARY_SALES v
    WHERE
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT, (SELECT app_user_tag_arr FROM sel_filters))
                THEN COALESCE(v.APP_USER_TAGGED_TITLE,'') <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(COALESCE(v.APP_USER_TAGGED_TITLE,'')))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
    GROUP BY v.FILTER_REGION
),
primary_by_region AS (
    SELECT
        v.FILTER_REGION AS region,
        SUM(IFF(EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.POSTING_DATE BETWEEN m.m_start AND m.m_end), v.VALUE, 0)) AS ach_mtd,
        SUM(IFF(EXISTS (SELECT 1 FROM fy_ranges  f WHERE v.POSTING_DATE BETWEEN f.fy_start AND f.fytd_end), v.VALUE, 0)) AS ach_fytd
    FROM GOLD.VW_FACT_PRIMARY_SALES v
    WHERE UPPER(TRIM(COALESCE(v.PARTY_CODE,''))) IN (SELECT SAP_CODE FROM pes_codes)
    GROUP BY v.FILTER_REGION
),
achievements_by_region AS (
    SELECT region, SUM(ach_mtd) AS total_achievement_mtd, SUM(ach_fytd) AS total_achievement_fytd
    FROM (SELECT region, ach_mtd, ach_fytd FROM secondary_by_region
          UNION ALL
          SELECT region, ach_mtd, ach_fytd FROM primary_by_region)
    WHERE region IS NOT NULL
    GROUP BY region
)
SELECT
    COALESCE(t.region, tf.region, a.region) AS region,
    t.targets_by_region_mtd,
    a.total_achievement_mtd,
    tf.targets_by_region_fytd,
    a.total_achievement_fytd
FROM targets_by_region_mtd t
FULL OUTER JOIN targets_by_region_fytd tf ON t.region = tf.region
FULL OUTER JOIN achievements_by_region a  ON COALESCE(t.region, tf.region) = a.region
ORDER BY total_achievement_mtd DESC NULLS LAST;























