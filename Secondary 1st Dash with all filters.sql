
select * from GOLD.VW_REGION_MAPPING_1ST_DASH
select * from GOLD.VW_CATEGORY_MAPPING_1ST_DASH
select * from GOLD.VW_BRAND_MAPPING_1st_DASH
select * from GOLD.VW_CHANNEL_TYPE_MAPPING_1st_DASH
select * from  GOLD.VW_DISTRIBUTOR_FILTER_1st_DASH

select * from GOLD.VW_TOWN_MAPPING_1st_DASH


-- =====================================================================
-- ✅ SECONDARY KPI #1 — MTD / FYTD (Sales Value + CTN + PCS)
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
-- =====================================================================


SET v_years        = '2022,2023,2024,2025';             -- '2025,2026'
SET v_months       = 'JAN,FEB,MAR,APR,MAY,JUN,JUL,AUG,SEP,OCT,NOV,DEC';          -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = 'Karachi Total,PB,Peshawar Region';               -- 'SD,KP'
SET v_category     = NULL;--'AP006,Pants,Oral Care';               -- 'Baby Diapers,Pants'
SET v_brand        = 'Bona Plus,Bona Papa';               -- 'Bona Plus,Momse'
SET v_channel_type = NULL;--'Wholesale,GT,MT';               -- 'MT,GT'
SET v_town         = NULL;--'Bhawalpur,Lahore';               -- 'Karachi,Lahore'
SET v_distributor  = NULL;               -- 'D0458,D0459'

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN YEAR(CURRENT_DATE()) + 1
             ELSE YEAR(CURRENT_DATE())
        END                                                         AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN MONTH(CURRENT_DATE()) - 6
             ELSE MONTH(CURRENT_DATE()) + 6
        END                                                         AS current_fy_month_no,
        NULLIF(TRIM($v_years),        '')                           AS years_raw,
        NULLIF(TRIM($v_months),       '')                           AS months_raw,
        NULLIF(TRIM($v_region),       '')                           AS region_raw,
        NULLIF(TRIM($v_category),     '')                           AS category_raw,
        NULLIF(TRIM($v_brand),        '')                           AS brand_raw,
        NULLIF(TRIM($v_channel_type), '')                           AS channel_type_raw,
        NULLIF(TRIM($v_town),         '')                           AS town_raw,
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw
),
-- ✅ Build arrays for ALL filters (multi-select support)
sel_filters AS (
    SELECT p.*,
        CASE WHEN p.region_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.region_raw, ','), x -> UPPER(TRIM(x)))
        END AS region_arr,
        CASE WHEN p.category_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.category_raw, ','), x -> UPPER(TRIM(x)))
        END AS category_arr,
        CASE WHEN p.brand_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.brand_raw, ','), x -> UPPER(TRIM(x)))
        END AS brand_arr,
        CASE WHEN p.channel_type_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.channel_type_raw, ','), x -> UPPER(TRIM(x)))
        END AS channel_type_arr,
        CASE WHEN p.town_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.town_raw, ','), x -> UPPER(TRIM(x)))
        END AS town_arr,
        CASE WHEN p.distributor_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.distributor_raw, ','), x -> UPPER(TRIM(x)))
        END AS distributor_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*,
        CASE WHEN sf.years_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(sf.years_raw, ','), x -> TRY_TO_NUMBER(TRIM(x)))
        END AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*,
        CASE WHEN s.months_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(s.months_raw, ','), x ->
                CASE UPPER(TRIM(x))
                    WHEN 'JUL' THEN 1  WHEN 'AUG' THEN 2  WHEN 'SEP' THEN 3
                    WHEN 'OCT' THEN 4  WHEN 'NOV' THEN 5  WHEN 'DEC' THEN 6
                    WHEN 'JAN' THEN 7  WHEN 'FEB' THEN 8  WHEN 'MAR' THEN 9
                    WHEN 'APR' THEN 10 WHEN 'MAY' THEN 11 WHEN 'JUN' THEN 12
                END)
        END AS month_no_arr
    FROM sel_years s
),
resolved AS (
    SELECT sm.*,
        CASE WHEN ARRAY_SIZE(sm.year_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy)
             ELSE sm.year_arr END AS eff_years,
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) = 0
                THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) > 0
                THEN ARRAY_CONSTRUCT(12)
            ELSE sm.month_no_arr
        END AS fytd_month_nos,
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            ELSE sm.month_no_arr
        END AS mtd_month_nos
    FROM sel_months sm
),
fy_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        DATE_FROM_PARTS(y.VALUE::NUMBER - 1, 7, 1) AS fy_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN MAX(m.VALUE::NUMBER) <= 6 THEN 1 ELSE 0 END,
            MOD(MAX(m.VALUE::NUMBER) + 5, 12) + 1, 1
        )) AS fytd_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years) y,
         LATERAL FLATTEN(input => r.fytd_month_nos) m
    GROUP BY y.VALUE::NUMBER
),
mtd_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        m.VALUE::NUMBER AS fy_month_no,
        DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        ) AS m_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        )) AS m_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years) y,
         LATERAL FLATTEN(input => r.mtd_month_nos) m
)
SELECT
    -- ================= MTD =================
    SUM(CASE WHEN EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end)
             THEN v.NET_SALES END)              AS MTD_SALES_VALUE,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end)
             THEN v.SALES_CTN END)              AS MTD_VOLUME_CTN,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end)
             THEN v.SALES_UNITS END)            AS MTD_VOLUME_PCS,

    -- ================= FYTD =================
    SUM(CASE WHEN EXISTS (SELECT 1 FROM fy_ranges f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end)
             THEN v.NET_SALES END)              AS FYTD_SALES_VALUE,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM fy_ranges f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end)
             THEN v.SALES_CTN END)              AS FYTD_VOLUME_CTN,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM fy_ranges f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end)
             THEN v.SALES_UNITS END)            AS FYTD_VOLUME_PCS
FROM Gold.salesflo_datadump_vw v
WHERE v.APP_USER_TAGGED_TITLE <> 'SD'
  -- ✅ Conditional REGION (MULTI)
  AND (
        ARRAY_SIZE((SELECT region_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_REGION_MAPPING_1ST_DASH
            WHERE SOURCE = 'SECONDARY'
              AND (ARRAY_CONTAINS(UPPER(TRIM(REGION_CODE))::VARIANT,
                                  (SELECT region_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(REGION_NAME))::VARIANT,
                                     (SELECT region_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION))::VARIANT,
                          (SELECT region_arr FROM sel_filters))
      )
  -- ✅ Conditional CATEGORY (MULTI)
  AND (
        ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
            WHERE IN_SECONDARY = 1
              AND (ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_NAME))::VARIANT,
                                  (SELECT category_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_CODE))::VARIANT,
                                     (SELECT category_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CATEGORY))::VARIANT,
                          (SELECT category_arr FROM sel_filters))
      )
  -- ✅ Conditional BRAND (MULTI)
  AND (
        ARRAY_SIZE((SELECT brand_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_BRAND_MAPPING_1st_DASH
            WHERE IN_SECONDARY = 1
              AND ARRAY_CONTAINS(UPPER(TRIM(BRAND))::VARIANT,
                                 (SELECT brand_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.BRAND))::VARIANT,
                          (SELECT brand_arr FROM sel_filters))
      )
  -- ✅ CHANNEL_TYPE (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CHANNEL_TYPE))::VARIANT,
                          (SELECT channel_type_arr FROM sel_filters))
      )
  -- ✅ TOWN (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT town_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.TOWN_NAME))::VARIANT,
                          (SELECT town_arr FROM sel_filters))
      )
  -- ✅ Conditional DISTRIBUTOR (MULTI)
  AND (
        ARRAY_SIZE((SELECT distributor_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_DISTRIBUTOR_FILTER_1st_DASH
            WHERE ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_NAME))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.DISTRIBUTOR_CODE_RD))::VARIANT,
                          (SELECT distributor_arr FROM sel_filters))
      );














      -- -- =====================================================================
-- ✅ SECONDARY KPI #2 — MTD / FYTD PRODUCTIVE STORES & DISTRIBUTORS
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
-- =====================================================================
SET v_years        = '2026';             -- '2025,2026'
SET v_months       = 'NOV,FEB';          -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = NULL;               -- 'SD,KP'
SET v_category     = NULL;               -- 'Baby Diapers,Pants'
SET v_brand        = NULL;               -- 'Bona Plus,Momse'
SET v_channel_type = NULL;               -- 'MT,GT'
SET v_town         = NULL;               -- 'Karachi,Lahore'
SET v_distributor  = NULL;               -- 'D0458,D0459'

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN YEAR(CURRENT_DATE()) + 1
             ELSE YEAR(CURRENT_DATE())
        END                                                         AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN MONTH(CURRENT_DATE()) - 6
             ELSE MONTH(CURRENT_DATE()) + 6
        END                                                         AS current_fy_month_no,
        NULLIF(TRIM($v_years),        '')                           AS years_raw,
        NULLIF(TRIM($v_months),       '')                           AS months_raw,
        NULLIF(TRIM($v_region),       '')                           AS region_raw,
        NULLIF(TRIM($v_category),     '')                           AS category_raw,
        NULLIF(TRIM($v_brand),        '')                           AS brand_raw,
        NULLIF(TRIM($v_channel_type), '')                           AS channel_type_raw,
        NULLIF(TRIM($v_town),         '')                           AS town_raw,
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw
),
-- ✅ Build arrays for ALL filters (multi-select support)
sel_filters AS (
    SELECT p.*,
        CASE WHEN p.region_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.region_raw, ','), x -> UPPER(TRIM(x)))
        END AS region_arr,
        CASE WHEN p.category_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.category_raw, ','), x -> UPPER(TRIM(x)))
        END AS category_arr,
        CASE WHEN p.brand_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.brand_raw, ','), x -> UPPER(TRIM(x)))
        END AS brand_arr,
        CASE WHEN p.channel_type_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.channel_type_raw, ','), x -> UPPER(TRIM(x)))
        END AS channel_type_arr,
        CASE WHEN p.town_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.town_raw, ','), x -> UPPER(TRIM(x)))
        END AS town_arr,
        CASE WHEN p.distributor_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.distributor_raw, ','), x -> UPPER(TRIM(x)))
        END AS distributor_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*,
        CASE WHEN sf.years_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(sf.years_raw, ','), x -> TRY_TO_NUMBER(TRIM(x)))
        END AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*,
        CASE WHEN s.months_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(s.months_raw, ','), x ->
                CASE UPPER(TRIM(x))
                    WHEN 'JUL' THEN 1  WHEN 'AUG' THEN 2  WHEN 'SEP' THEN 3
                    WHEN 'OCT' THEN 4  WHEN 'NOV' THEN 5  WHEN 'DEC' THEN 6
                    WHEN 'JAN' THEN 7  WHEN 'FEB' THEN 8  WHEN 'MAR' THEN 9
                    WHEN 'APR' THEN 10 WHEN 'MAY' THEN 11 WHEN 'JUN' THEN 12
                END)
        END AS month_no_arr
    FROM sel_years s
),
resolved AS (
    SELECT sm.*,
        CASE WHEN ARRAY_SIZE(sm.year_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy)
             ELSE sm.year_arr END AS eff_years,
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) = 0
                THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 AND ARRAY_SIZE(sm.year_arr) > 0
                THEN ARRAY_CONSTRUCT(12)
            ELSE sm.month_no_arr
        END AS fytd_month_nos,
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            ELSE sm.month_no_arr
        END AS mtd_month_nos
    FROM sel_months sm
),
fy_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        DATE_FROM_PARTS(y.VALUE::NUMBER - 1, 7, 1) AS fy_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN MAX(m.VALUE::NUMBER) <= 6 THEN 1 ELSE 0 END,
            MOD(MAX(m.VALUE::NUMBER) + 5, 12) + 1, 1
        )) AS fytd_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years) y,
         LATERAL FLATTEN(input => r.fytd_month_nos) m
    GROUP BY y.VALUE::NUMBER
),
mtd_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        m.VALUE::NUMBER AS fy_month_no,
        DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        ) AS m_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        )) AS m_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years) y,
         LATERAL FLATTEN(input => r.mtd_month_nos) m
)
SELECT
    -- ================= MTD =================
    COUNT(DISTINCT CASE
        WHEN EXISTS (SELECT 1 FROM mtd_ranges m
                     WHERE v.DATE BETWEEN m.m_start AND m.m_end)
        THEN TRIM(v.OUTLET_CODE)
    END)                                            AS MTD_PRODUCTIVE_STORES,
    COUNT(DISTINCT CASE
        WHEN EXISTS (SELECT 1 FROM mtd_ranges m
                     WHERE v.DATE BETWEEN m.m_start AND m.m_end)
        THEN TRIM(v.DISTRIBUTOR_CODE)
    END)                                            AS MTD_PRODUCTIVE_DISTRIBUTOR,

    -- ================= FYTD =================
    COUNT(DISTINCT CASE
        WHEN EXISTS (SELECT 1 FROM fy_ranges f
                     WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end)
        THEN TRIM(v.OUTLET_CODE)
    END)                                            AS FYTD_PRODUCTIVE_STORES,
    COUNT(DISTINCT CASE
        WHEN EXISTS (SELECT 1 FROM fy_ranges f
                     WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end)
        THEN TRIM(v.DISTRIBUTOR_CODE)
    END)                                            AS FYTD_PRODUCTIVE_DISTRIBUTOR
FROM Gold.salesflo_datadump_vw v
WHERE v.APP_USER_TAGGED_TITLE <> 'SD'
  -- ✅ Conditional REGION (MULTI)
  AND (
        ARRAY_SIZE((SELECT region_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_REGION_MAPPING_1ST_DASH
            WHERE SOURCE = 'SECONDARY'
              AND (ARRAY_CONTAINS(UPPER(TRIM(REGION_CODE))::VARIANT,
                                  (SELECT region_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(REGION_NAME))::VARIANT,
                                     (SELECT region_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION))::VARIANT,
                          (SELECT region_arr FROM sel_filters))
      )
  -- ✅ Conditional CATEGORY (MULTI)
  AND (
        ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
            WHERE IN_SECONDARY = 1
              AND (ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_NAME))::VARIANT,
                                  (SELECT category_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_CODE))::VARIANT,
                                     (SELECT category_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CATEGORY))::VARIANT,
                          (SELECT category_arr FROM sel_filters))
      )
  -- ✅ Conditional BRAND (MULTI)
  AND (
        ARRAY_SIZE((SELECT brand_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_BRAND_MAPPING_1st_DASH
            WHERE IN_SECONDARY = 1
              AND ARRAY_CONTAINS(UPPER(TRIM(BRAND))::VARIANT,
                                 (SELECT brand_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.BRAND))::VARIANT,
                          (SELECT brand_arr FROM sel_filters))
      )
  -- ✅ CHANNEL_TYPE (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CHANNEL_TYPE))::VARIANT,
                          (SELECT channel_type_arr FROM sel_filters))
      )
  -- ✅ TOWN (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT town_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.TOWN_NAME))::VARIANT,
                          (SELECT town_arr FROM sel_filters))
      )
  -- ✅ Conditional DISTRIBUTOR (MULTI)
  AND (
        ARRAY_SIZE((SELECT distributor_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_DISTRIBUTOR_FILTER_1st_DASH
            WHERE ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_NAME))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.DISTRIBUTOR_CODE))::VARIANT,
                          (SELECT distributor_arr FROM sel_filters))
      );










-- =====================================================================
-- ✅ SECONDARY KPI #3 — DAILY NET SALES TREND (MTD)
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
-- =====================================================================
SET v_years        = '2025,2026';        -- '2025,2026'
SET v_months       = 'SEP,MAR,APR';      -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = NULL;               -- 'SD,KP'
SET v_category     = NULL;               -- 'Baby Diapers,Pants'
SET v_brand        = NULL;               -- 'Bona Plus,Momse'
SET v_channel_type = NULL;               -- 'MT,GT'
SET v_town         = NULL;               -- 'Karachi,Lahore'
SET v_distributor  = NULL;               -- 'D0458,D0459'

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN YEAR(CURRENT_DATE()) + 1
             ELSE YEAR(CURRENT_DATE())
        END                                                         AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN MONTH(CURRENT_DATE()) - 6
             ELSE MONTH(CURRENT_DATE()) + 6
        END                                                         AS current_fy_month_no,
        NULLIF(TRIM($v_years),        '')                           AS years_raw,
        NULLIF(TRIM($v_months),       '')                           AS months_raw,
        NULLIF(TRIM($v_region),       '')                           AS region_raw,
        NULLIF(TRIM($v_category),     '')                           AS category_raw,
        NULLIF(TRIM($v_brand),        '')                           AS brand_raw,
        NULLIF(TRIM($v_channel_type), '')                           AS channel_type_raw,
        NULLIF(TRIM($v_town),         '')                           AS town_raw,
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw
),
-- ✅ Build arrays for ALL filters (multi-select support)
sel_filters AS (
    SELECT p.*,
        CASE WHEN p.region_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.region_raw, ','), x -> UPPER(TRIM(x)))
        END AS region_arr,
        CASE WHEN p.category_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.category_raw, ','), x -> UPPER(TRIM(x)))
        END AS category_arr,
        CASE WHEN p.brand_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.brand_raw, ','), x -> UPPER(TRIM(x)))
        END AS brand_arr,
        CASE WHEN p.channel_type_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.channel_type_raw, ','), x -> UPPER(TRIM(x)))
        END AS channel_type_arr,
        CASE WHEN p.town_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.town_raw, ','), x -> UPPER(TRIM(x)))
        END AS town_arr,
        CASE WHEN p.distributor_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.distributor_raw, ','), x -> UPPER(TRIM(x)))
        END AS distributor_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*,
        CASE WHEN sf.years_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(sf.years_raw, ','), x -> TRY_TO_NUMBER(TRIM(x)))
        END AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*,
        CASE WHEN s.months_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(s.months_raw, ','), x ->
                CASE UPPER(TRIM(x))
                    WHEN 'JUL' THEN 1  WHEN 'AUG' THEN 2  WHEN 'SEP' THEN 3
                    WHEN 'OCT' THEN 4  WHEN 'NOV' THEN 5  WHEN 'DEC' THEN 6
                    WHEN 'JAN' THEN 7  WHEN 'FEB' THEN 8  WHEN 'MAR' THEN 9
                    WHEN 'APR' THEN 10 WHEN 'MAY' THEN 11 WHEN 'JUN' THEN 12
                END)
        END AS month_no_arr
    FROM sel_years s
),
resolved AS (
    SELECT sm.*,
        CASE WHEN ARRAY_SIZE(sm.year_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy)
             ELSE sm.year_arr END AS eff_years,
        -- MTD months only — KPI #3 doesn't need FYTD
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            ELSE sm.month_no_arr
        END AS mtd_month_nos
    FROM sel_months sm
),
mtd_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        m.VALUE::NUMBER AS fy_month_no,
        DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        ) AS m_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        )) AS m_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years) y,
         LATERAL FLATTEN(input => r.mtd_month_nos) m
)
-- ▼ Trend SELECT — aggregates by DATE across all MTD months/years
SELECT
    v.DATE                      AS SALES_DATE,
    DAY(v.DATE)                 AS DAY_OF_MONTH,
    SUM(v.NET_SALES)            AS NET_SALES
FROM Gold.salesflo_datadump_vw v
WHERE v.APP_USER_TAGGED_TITLE <> 'SD'
  AND EXISTS (
        SELECT 1 FROM mtd_ranges m
        WHERE v.DATE BETWEEN m.m_start AND m.m_end
      )
  -- ✅ Conditional REGION (MULTI)
  AND (
        ARRAY_SIZE((SELECT region_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_REGION_MAPPING_1ST_DASH
            WHERE SOURCE = 'SECONDARY'
              AND (ARRAY_CONTAINS(UPPER(TRIM(REGION_CODE))::VARIANT,
                                  (SELECT region_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(REGION_NAME))::VARIANT,
                                     (SELECT region_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION))::VARIANT,
                          (SELECT region_arr FROM sel_filters))
      )
  -- ✅ Conditional CATEGORY (MULTI)
  AND (
        ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
            WHERE IN_SECONDARY = 1
              AND (ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_NAME))::VARIANT,
                                  (SELECT category_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_CODE))::VARIANT,
                                     (SELECT category_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CATEGORY))::VARIANT,
                          (SELECT category_arr FROM sel_filters))
      )
  -- ✅ Conditional BRAND (MULTI)
  AND (
        ARRAY_SIZE((SELECT brand_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_BRAND_MAPPING_1st_DASH
            WHERE IN_SECONDARY = 1
              AND ARRAY_CONTAINS(UPPER(TRIM(BRAND))::VARIANT,
                                 (SELECT brand_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.BRAND))::VARIANT,
                          (SELECT brand_arr FROM sel_filters))
      )
  -- ✅ CHANNEL_TYPE (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CHANNEL_TYPE))::VARIANT,
                          (SELECT channel_type_arr FROM sel_filters))
      )
  -- ✅ TOWN (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT town_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.TOWN_NAME))::VARIANT,
                          (SELECT town_arr FROM sel_filters))
      )
  -- ✅ Conditional DISTRIBUTOR (MULTI)
  AND (
        ARRAY_SIZE((SELECT distributor_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_DISTRIBUTOR_FILTER_1st_DASH
            WHERE ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_NAME))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.DISTRIBUTOR_CODE_RD))::VARIANT,
                          (SELECT distributor_arr FROM sel_filters))
      )
GROUP BY v.DATE
ORDER BY v.DATE;










-- =====================================================================
-- ✅ SECONDARY KPI #4 — SALES VALUE BY CHANNEL TYPE (MTD)
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
-- =====================================================================
SET v_years        = '2024,2025';             -- '2025,2026'
SET v_months       = NULL;          -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = 'Karachi Total,PB,Peshawar Region';               -- 'SD,KP'
SET v_category     = 'AP006,Pants,Oral Care';               -- 'Baby Diapers,Pants'
SET v_brand        = NULL;               -- 'Bona Plus,Momse'
SET v_channel_type = NULL;               -- 'MT,GT'
SET v_town         = NULL;               -- 'Karachi,Lahore'
SET v_distributor  = NULL;               -- 'D0458,D0459'

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN YEAR(CURRENT_DATE()) + 1
             ELSE YEAR(CURRENT_DATE())
        END                                                         AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN MONTH(CURRENT_DATE()) - 6
             ELSE MONTH(CURRENT_DATE()) + 6
        END                                                         AS current_fy_month_no,
        NULLIF(TRIM($v_years),        '')                           AS years_raw,
        NULLIF(TRIM($v_months),       '')                           AS months_raw,
        NULLIF(TRIM($v_region),       '')                           AS region_raw,
        NULLIF(TRIM($v_category),     '')                           AS category_raw,
        NULLIF(TRIM($v_brand),        '')                           AS brand_raw,
        NULLIF(TRIM($v_channel_type), '')                           AS channel_type_raw,
        NULLIF(TRIM($v_town),         '')                           AS town_raw,
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw
),
-- ✅ Build arrays for ALL filters (multi-select support)
sel_filters AS (
    SELECT p.*,
        CASE WHEN p.region_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.region_raw, ','), x -> UPPER(TRIM(x)))
        END AS region_arr,
        CASE WHEN p.category_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.category_raw, ','), x -> UPPER(TRIM(x)))
        END AS category_arr,
        CASE WHEN p.brand_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.brand_raw, ','), x -> UPPER(TRIM(x)))
        END AS brand_arr,
        CASE WHEN p.channel_type_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.channel_type_raw, ','), x -> UPPER(TRIM(x)))
        END AS channel_type_arr,
        CASE WHEN p.town_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.town_raw, ','), x -> UPPER(TRIM(x)))
        END AS town_arr,
        CASE WHEN p.distributor_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.distributor_raw, ','), x -> UPPER(TRIM(x)))
        END AS distributor_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*,
        CASE WHEN sf.years_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(sf.years_raw, ','), x -> TRY_TO_NUMBER(TRIM(x)))
        END AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*,
        CASE WHEN s.months_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(s.months_raw, ','), x ->
                CASE UPPER(TRIM(x))
                    WHEN 'JUL' THEN 1  WHEN 'AUG' THEN 2  WHEN 'SEP' THEN 3
                    WHEN 'OCT' THEN 4  WHEN 'NOV' THEN 5  WHEN 'DEC' THEN 6
                    WHEN 'JAN' THEN 7  WHEN 'FEB' THEN 8  WHEN 'MAR' THEN 9
                    WHEN 'APR' THEN 10 WHEN 'MAY' THEN 11 WHEN 'JUN' THEN 12
                END)
        END AS month_no_arr
    FROM sel_years s
),
resolved AS (
    SELECT sm.*,
        CASE WHEN ARRAY_SIZE(sm.year_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy)
             ELSE sm.year_arr END AS eff_years,
        -- MTD months only
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            ELSE sm.month_no_arr
        END AS mtd_month_nos
    FROM sel_months sm
),
mtd_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        m.VALUE::NUMBER AS fy_month_no,
        DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        ) AS m_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        )) AS m_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years) y,
         LATERAL FLATTEN(input => r.mtd_month_nos) m
)
-- ▼ Breakdown SELECT — group by CHANNEL_TYPE across all MTD months/years
SELECT
    v.CHANNEL_TYPE,
    SUM(v.NET_SALES)                     AS SALES_VALUE
    -- SUM(v.SALES_CTN)                     AS VOLUME_CTN,
    -- SUM(v.SALES_UNITS)                   AS VOLUME_PCS,
    -- COUNT(DISTINCT TRIM(v.OUTLET_CODE))  AS PRODUCTIVE_STORES
FROM Gold.salesflo_datadump_vw v
WHERE v.APP_USER_TAGGED_TITLE <> 'SD'
  AND EXISTS (
        SELECT 1 FROM mtd_ranges m
        WHERE v.DATE BETWEEN m.m_start AND m.m_end
      )
  -- ✅ Conditional REGION (MULTI)
  AND (
        ARRAY_SIZE((SELECT region_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_REGION_MAPPING_1ST_DASH
            WHERE SOURCE = 'SECONDARY'
              AND (ARRAY_CONTAINS(UPPER(TRIM(REGION_CODE))::VARIANT,
                                  (SELECT region_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(REGION_NAME))::VARIANT,
                                     (SELECT region_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION))::VARIANT,
                          (SELECT region_arr FROM sel_filters))
      )
  -- ✅ Conditional CATEGORY (MULTI)
  AND (
        ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
            WHERE IN_SECONDARY = 1
              AND (ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_NAME))::VARIANT,
                                  (SELECT category_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_CODE))::VARIANT,
                                     (SELECT category_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CATEGORY))::VARIANT,
                          (SELECT category_arr FROM sel_filters))
      )
  -- ✅ Conditional BRAND (MULTI)
  AND (
        ARRAY_SIZE((SELECT brand_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_BRAND_MAPPING_1st_DASH
            WHERE IN_SECONDARY = 1
              AND ARRAY_CONTAINS(UPPER(TRIM(BRAND))::VARIANT,
                                 (SELECT brand_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.BRAND))::VARIANT,
                          (SELECT brand_arr FROM sel_filters))
      )
  -- ✅ CHANNEL_TYPE (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CHANNEL_TYPE))::VARIANT,
                          (SELECT channel_type_arr FROM sel_filters))
      )
  -- ✅ TOWN (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT town_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.TOWN_NAME))::VARIANT,
                          (SELECT town_arr FROM sel_filters))
      )
  -- ✅ Conditional DISTRIBUTOR (MULTI)
  AND (
        ARRAY_SIZE((SELECT distributor_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_DISTRIBUTOR_FILTER_1st_DASH
            WHERE ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_NAME))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.DISTRIBUTOR_CODE_RD))::VARIANT,
                          (SELECT distributor_arr FROM sel_filters))
      )
GROUP BY v.CHANNEL_TYPE
ORDER BY SALES_VALUE DESC;








-- =====================================================================
-- ✅ SECONDARY KPI #5 — NET SALES VALUE BY CATEGORY (MTD)
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
-- =====================================================================
SET v_years        = '2025,2026';        -- '2025,2026'
SET v_months       = 'NOV,MAR';          -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = NULL;               -- 'SD,KP'
SET v_category     = NULL;               -- 'Baby Diapers,Pants'
SET v_brand        = NULL;               -- 'Bona Plus,Momse'
SET v_channel_type = NULL;               -- 'MT,GT'
SET v_town         = NULL;               -- 'Karachi,Lahore'
SET v_distributor  = NULL;               -- 'D0458,D0459'

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN YEAR(CURRENT_DATE()) + 1
             ELSE YEAR(CURRENT_DATE())
        END                                                         AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN MONTH(CURRENT_DATE()) - 6
             ELSE MONTH(CURRENT_DATE()) + 6
        END                                                         AS current_fy_month_no,
        NULLIF(TRIM($v_years),        '')                           AS years_raw,
        NULLIF(TRIM($v_months),       '')                           AS months_raw,
        NULLIF(TRIM($v_region),       '')                           AS region_raw,
        NULLIF(TRIM($v_category),     '')                           AS category_raw,
        NULLIF(TRIM($v_brand),        '')                           AS brand_raw,
        NULLIF(TRIM($v_channel_type), '')                           AS channel_type_raw,
        NULLIF(TRIM($v_town),         '')                           AS town_raw,
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw
),
-- ✅ Build arrays for ALL filters (multi-select support)
sel_filters AS (
    SELECT p.*,
        CASE WHEN p.region_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.region_raw, ','), x -> UPPER(TRIM(x)))
        END AS region_arr,
        CASE WHEN p.category_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.category_raw, ','), x -> UPPER(TRIM(x)))
        END AS category_arr,
        CASE WHEN p.brand_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.brand_raw, ','), x -> UPPER(TRIM(x)))
        END AS brand_arr,
        CASE WHEN p.channel_type_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.channel_type_raw, ','), x -> UPPER(TRIM(x)))
        END AS channel_type_arr,
        CASE WHEN p.town_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.town_raw, ','), x -> UPPER(TRIM(x)))
        END AS town_arr,
        CASE WHEN p.distributor_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.distributor_raw, ','), x -> UPPER(TRIM(x)))
        END AS distributor_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*,
        CASE WHEN sf.years_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(sf.years_raw, ','), x -> TRY_TO_NUMBER(TRIM(x)))
        END AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*,
        CASE WHEN s.months_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(s.months_raw, ','), x ->
                CASE UPPER(TRIM(x))
                    WHEN 'JUL' THEN 1  WHEN 'AUG' THEN 2  WHEN 'SEP' THEN 3
                    WHEN 'OCT' THEN 4  WHEN 'NOV' THEN 5  WHEN 'DEC' THEN 6
                    WHEN 'JAN' THEN 7  WHEN 'FEB' THEN 8  WHEN 'MAR' THEN 9
                    WHEN 'APR' THEN 10 WHEN 'MAY' THEN 11 WHEN 'JUN' THEN 12
                END)
        END AS month_no_arr
    FROM sel_years s
),
resolved AS (
    SELECT sm.*,
        CASE WHEN ARRAY_SIZE(sm.year_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy)
             ELSE sm.year_arr END AS eff_years,
        -- MTD months only
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            ELSE sm.month_no_arr
        END AS mtd_month_nos
    FROM sel_months sm
),
mtd_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        m.VALUE::NUMBER AS fy_month_no,
        DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        ) AS m_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        )) AS m_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years) y,
         LATERAL FLATTEN(input => r.mtd_month_nos) m
)
-- ▼ Breakdown SELECT — group by CATEGORY across all MTD months/years
SELECT
    v.CATEGORY,
    SUM(v.NET_SALES)                     AS SALES_VALUE
    -- SUM(v.SALES_CTN)                     AS VOLUME_CTN,
    -- SUM(v.SALES_UNITS)                   AS VOLUME_PCS,
    -- COUNT(DISTINCT TRIM(v.OUTLET_CODE))  AS PRODUCTIVE_STORES
FROM Gold.salesflo_datadump_vw v
WHERE v.APP_USER_TAGGED_TITLE <> 'SD'
  AND EXISTS (
        SELECT 1 FROM mtd_ranges m
        WHERE v.DATE BETWEEN m.m_start AND m.m_end
      )
  -- ✅ Conditional REGION (MULTI)
  AND (
        ARRAY_SIZE((SELECT region_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_REGION_MAPPING_1ST_DASH
            WHERE SOURCE = 'SECONDARY'
              AND (ARRAY_CONTAINS(UPPER(TRIM(REGION_CODE))::VARIANT,
                                  (SELECT region_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(REGION_NAME))::VARIANT,
                                     (SELECT region_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION))::VARIANT,
                          (SELECT region_arr FROM sel_filters))
      )
  -- ✅ Conditional CATEGORY (MULTI)
  AND (
        ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
            WHERE IN_SECONDARY = 1
              AND (ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_NAME))::VARIANT,
                                  (SELECT category_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_CODE))::VARIANT,
                                     (SELECT category_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CATEGORY))::VARIANT,
                          (SELECT category_arr FROM sel_filters))
      )
  -- ✅ Conditional BRAND (MULTI)
  AND (
        ARRAY_SIZE((SELECT brand_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_BRAND_MAPPING_1st_DASH
            WHERE IN_SECONDARY = 1
              AND ARRAY_CONTAINS(UPPER(TRIM(BRAND))::VARIANT,
                                 (SELECT brand_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.BRAND))::VARIANT,
                          (SELECT brand_arr FROM sel_filters))
      )
  -- ✅ CHANNEL_TYPE (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CHANNEL_TYPE))::VARIANT,
                          (SELECT channel_type_arr FROM sel_filters))
      )
  -- ✅ TOWN (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT town_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.TOWN_NAME))::VARIANT,
                          (SELECT town_arr FROM sel_filters))
      )
  -- ✅ Conditional DISTRIBUTOR (MULTI)
  AND (
        ARRAY_SIZE((SELECT distributor_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_DISTRIBUTOR_FILTER_1st_DASH
            WHERE ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_NAME))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.DISTRIBUTOR_CODE_RD))::VARIANT,
                          (SELECT distributor_arr FROM sel_filters))
      )
GROUP BY v.CATEGORY
ORDER BY SALES_VALUE DESC;










-- =====================================================================
-- ✅ SECONDARY KPI #6 — TOP N BRANDS BY NET SALES VALUE (MTD)
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
-- =====================================================================
SET v_years        = '2025,2026';        -- '2025,2026'
SET v_months       = 'AUG,DEC,FEB,MAR';  -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = NULL;               -- 'SD,KP'
SET v_category     = 'Baby Diapers,Pants';--NULL;               -- 'Baby Diapers,Pants'
SET v_brand        = NULL;               -- 'Bona Plus,Momse'
SET v_channel_type = NULL;               -- 'MT,GT'
SET v_town         = NULL;               -- 'Karachi,Lahore'
SET v_distributor  = NULL;               -- 'D0458,D0459'
SET top_n          = 10;                 -- kitne top brands chahiye

WITH params AS (
    SELECT
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN YEAR(CURRENT_DATE()) + 1
             ELSE YEAR(CURRENT_DATE())
        END                                                         AS current_fy,
        CASE WHEN MONTH(CURRENT_DATE()) >= 7
             THEN MONTH(CURRENT_DATE()) - 6
             ELSE MONTH(CURRENT_DATE()) + 6
        END                                                         AS current_fy_month_no,
        NULLIF(TRIM($v_years),        '')                           AS years_raw,
        NULLIF(TRIM($v_months),       '')                           AS months_raw,
        NULLIF(TRIM($v_region),       '')                           AS region_raw,
        NULLIF(TRIM($v_category),     '')                           AS category_raw,
        NULLIF(TRIM($v_brand),        '')                           AS brand_raw,
        NULLIF(TRIM($v_channel_type), '')                           AS channel_type_raw,
        NULLIF(TRIM($v_town),         '')                           AS town_raw,
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw
),
-- ✅ Build arrays for ALL filters (multi-select support)
sel_filters AS (
    SELECT p.*,
        CASE WHEN p.region_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.region_raw, ','), x -> UPPER(TRIM(x)))
        END AS region_arr,
        CASE WHEN p.category_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.category_raw, ','), x -> UPPER(TRIM(x)))
        END AS category_arr,
        CASE WHEN p.brand_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.brand_raw, ','), x -> UPPER(TRIM(x)))
        END AS brand_arr,
        CASE WHEN p.channel_type_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.channel_type_raw, ','), x -> UPPER(TRIM(x)))
        END AS channel_type_arr,
        CASE WHEN p.town_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.town_raw, ','), x -> UPPER(TRIM(x)))
        END AS town_arr,
        CASE WHEN p.distributor_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(p.distributor_raw, ','), x -> UPPER(TRIM(x)))
        END AS distributor_arr
    FROM params p
),
sel_years AS (
    SELECT sf.*,
        CASE WHEN sf.years_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(sf.years_raw, ','), x -> TRY_TO_NUMBER(TRIM(x)))
        END AS year_arr
    FROM sel_filters sf
),
sel_months AS (
    SELECT s.*,
        CASE WHEN s.months_raw IS NULL THEN ARRAY_CONSTRUCT()
             ELSE TRANSFORM(SPLIT(s.months_raw, ','), x ->
                CASE UPPER(TRIM(x))
                    WHEN 'JUL' THEN 1  WHEN 'AUG' THEN 2  WHEN 'SEP' THEN 3
                    WHEN 'OCT' THEN 4  WHEN 'NOV' THEN 5  WHEN 'DEC' THEN 6
                    WHEN 'JAN' THEN 7  WHEN 'FEB' THEN 8  WHEN 'MAR' THEN 9
                    WHEN 'APR' THEN 10 WHEN 'MAY' THEN 11 WHEN 'JUN' THEN 12
                END)
        END AS month_no_arr
    FROM sel_years s
),
resolved AS (
    SELECT sm.*,
        CASE WHEN ARRAY_SIZE(sm.year_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy)
             ELSE sm.year_arr END AS eff_years,
        -- MTD months only
        CASE
            WHEN ARRAY_SIZE(sm.month_no_arr) = 0 THEN ARRAY_CONSTRUCT(sm.current_fy_month_no)
            ELSE sm.month_no_arr
        END AS mtd_month_nos
    FROM sel_months sm
),
mtd_ranges AS (
    SELECT
        y.VALUE::NUMBER AS fiscal_year,
        m.VALUE::NUMBER AS fy_month_no,
        DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        ) AS m_start,
        LAST_DAY(DATE_FROM_PARTS(
            y.VALUE::NUMBER - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END,
            MOD(m.VALUE::NUMBER + 5, 12) + 1, 1
        )) AS m_end
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years) y,
         LATERAL FLATTEN(input => r.mtd_month_nos) m
)
-- ▼ Top-N SELECT — group by BRAND, sort, limit
SELECT
    v.BRAND,
    SUM(v.NET_SALES)                     AS SALES_VALUE
    -- SUM(v.SALES_CTN)                     AS VOLUME_CTN,
    -- SUM(v.SALES_UNITS)                   AS VOLUME_PCS,
    -- COUNT(DISTINCT TRIM(v.OUTLET_CODE))  AS PRODUCTIVE_STORES
FROM Gold.salesflo_datadump_vw v
WHERE v.APP_USER_TAGGED_TITLE <> 'SD'
  AND EXISTS (
        SELECT 1 FROM mtd_ranges m
        WHERE v.DATE BETWEEN m.m_start AND m.m_end
      )
  -- ✅ Conditional REGION (MULTI)
  AND (
        ARRAY_SIZE((SELECT region_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_REGION_MAPPING_1ST_DASH
            WHERE SOURCE = 'SECONDARY'
              AND (ARRAY_CONTAINS(UPPER(TRIM(REGION_CODE))::VARIANT,
                                  (SELECT region_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(REGION_NAME))::VARIANT,
                                     (SELECT region_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION))::VARIANT,
                          (SELECT region_arr FROM sel_filters))
      )
  -- ✅ Conditional CATEGORY (MULTI)
  AND (
        ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
            WHERE IN_SECONDARY = 1
              AND (ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_NAME))::VARIANT,
                                  (SELECT category_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_CODE))::VARIANT,
                                     (SELECT category_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CATEGORY))::VARIANT,
                          (SELECT category_arr FROM sel_filters))
      )
  -- ✅ Conditional BRAND (MULTI)
  AND (
        ARRAY_SIZE((SELECT brand_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_BRAND_MAPPING_1st_DASH
            WHERE IN_SECONDARY = 1
              AND ARRAY_CONTAINS(UPPER(TRIM(BRAND))::VARIANT,
                                 (SELECT brand_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.BRAND))::VARIANT,
                          (SELECT brand_arr FROM sel_filters))
      )
  -- ✅ CHANNEL_TYPE (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT channel_type_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.CHANNEL_TYPE))::VARIANT,
                          (SELECT channel_type_arr FROM sel_filters))
      )
  -- ✅ TOWN (Secondary-only — MULTI)
  AND (
        ARRAY_SIZE((SELECT town_arr FROM sel_filters)) = 0
        OR ARRAY_CONTAINS(UPPER(TRIM(v.TOWN_NAME))::VARIANT,
                          (SELECT town_arr FROM sel_filters))
      )
  -- ✅ Conditional DISTRIBUTOR (MULTI)
  AND (
        ARRAY_SIZE((SELECT distributor_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_DISTRIBUTOR_FILTER_1st_DASH
            WHERE ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_CODE))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(DISTRIBUTOR_SAP_NAME))::VARIANT,
                                 (SELECT distributor_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.DISTRIBUTOR_CODE_RD))::VARIANT,
                          (SELECT distributor_arr FROM sel_filters))
      )
GROUP BY v.BRAND
ORDER BY SALES_VALUE DESC
LIMIT $top_n;









-- =====================================================================
-- QUERY 7: FULL FISCAL YEAR MONTHLY TREND (Jul → Jun)
-- Filter: APP_USER_TAGGED_TITLE <> 'SD', optional region
-- NOTE: only v_year is needed — no v_month for this chart
-- =====================================================================



SET v_year          = 2027;            -- Fiscal Year
--SET selected_region = 'Multan Region'; -- 'North' / 'South' / NULL for all

WITH params AS (
    SELECT
        $v_year                                                     AS fiscal_year,
        DATE_FROM_PARTS($v_year - 1, 7, 1)                          AS fy_start,
        DATE_FROM_PARTS($v_year, 6, 30)                             AS fy_end
),
months AS (
    -- All 12 fiscal months: Jul → Jun
    SELECT DATEADD('month', seq, p.fy_start) AS FY_MONTH_START
    FROM params p,
    (
        SELECT 0 AS seq UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
        UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7
        UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11
    )
),
secondary AS (
    SELECT
        DATE_TRUNC('month', v.DATE) AS FY_MONTH_START,
        SUM(v.NET_SALES)            AS SECONDARY_SALES_VALUE
    FROM Gold.salesflo_datadump_vw v
    WHERE v.DATE >= (SELECT fy_start FROM params)
      AND v.DATE <  DATEADD('year', 1, (SELECT fy_start FROM params))
      AND ($selected_region IS NULL OR v.REGION = $selected_region)
      AND v.APP_USER_TAGGED_TITLE <> 'SD'
    GROUP BY 1
)
SELECT
    TO_CHAR(m.FY_MONTH_START, 'Mon')   AS MONTH,
    m.FY_MONTH_START                   AS MONTH_START,
    s.SECONDARY_SALES_VALUE
FROM months m
LEFT JOIN secondary s ON s.FY_MONTH_START = m.FY_MONTH_START
ORDER BY m.FY_MONTH_START;











--region vise Targets vs achievements will be same 