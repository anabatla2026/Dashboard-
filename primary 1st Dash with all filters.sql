




-- =====================================================================
-- ✅ PRIMARY KPI #1 — MTD / FYTD (Sales Value + CTN + PCS)
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND + DISTRIBUTOR
-- =====================================================================
SET v_years       = '2027';              -- '2025,2026'
SET v_months      = 'AUG';           -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region      = NULL;                -- 'SD,KP'
SET v_category    = NULL;                -- 'Baby Diapers,Pants'
SET v_brand       = NULL;                -- 'Bona Plus,Momse'
SET v_distributor = NULL;                -- '3400091,3400074'

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
        NULLIF(TRIM($v_years),       '')                            AS years_raw,
        NULLIF(TRIM($v_months),      '')                            AS months_raw,
        NULLIF(TRIM($v_region),      '')                            AS region_raw,
        NULLIF(TRIM($v_category),    '')                            AS category_raw,
        NULLIF(TRIM($v_brand),       '')                            AS brand_raw,
        NULLIF(TRIM($v_distributor), '')                            AS distributor_raw
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
    SUM(CASE WHEN EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.Posting_Date BETWEEN m.m_start AND m.m_end)
             THEN v.Value END)            AS MTD_SALES_VALUE,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.Posting_Date BETWEEN m.m_start AND m.m_end)
             THEN v.Qty_In_Ctn END)             AS MTD_VOLUME_CTN,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.Posting_Date BETWEEN m.m_start AND m.m_end)
             THEN v.Qty_In_Pcs END)             AS MTD_VOLUME_PCS,

    -- ================= FYTD =================
    SUM(CASE WHEN EXISTS (SELECT 1 FROM fy_ranges f WHERE v.Posting_Date BETWEEN f.fy_start AND f.fytd_end)
             THEN v.Value END)            AS FYTD_SALES_VALUE,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM fy_ranges f WHERE v.Posting_Date BETWEEN f.fy_start AND f.fytd_end)
             THEN v.Qty_In_Ctn END)             AS FYTD_VOLUME_CTN,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM fy_ranges f WHERE v.Posting_Date BETWEEN f.fy_start AND f.fytd_end)
             THEN v.Qty_In_Pcs END)             AS FYTD_VOLUME_PCS
FROM gold.zfi_sco_vw v
WHERE
 
  -- ✅ Conditional REGION (MULTI)
  (
    ARRAY_SIZE((SELECT region_arr FROM sel_filters)) = 0
    OR NOT EXISTS (
        SELECT 1 FROM GOLD.VW_REGION_MAPPING_1ST_DASH
        WHERE SOURCE = 'PRIMARY'
          AND (ARRAY_CONTAINS(UPPER(TRIM(REGION_CODE))::VARIANT,
                              (SELECT region_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(REGION_NAME))::VARIANT,
                                 (SELECT region_arr FROM sel_filters)))
    )
    OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION))::VARIANT,
                      (SELECT region_arr FROM sel_filters))
    OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION_NAME))::VARIANT,
                      (SELECT region_arr FROM sel_filters))
  )
  -- ✅ Conditional CATEGORY (MULTI) — UPDATED (flags-based, no duplicates)
  AND (
    ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
    OR NOT EXISTS (
        SELECT 1 FROM SALESDWH.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
        WHERE IN_PRIMARY = 1
          AND (ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_NAME))::VARIANT,
                              (SELECT category_arr FROM sel_filters))
               OR ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_CODE))::VARIANT,
                                 (SELECT category_arr FROM sel_filters)))
    )
    OR ARRAY_CONTAINS(UPPER(TRIM(v.MATERIAL_GROUP))::VARIANT,
                      (SELECT category_arr FROM sel_filters))
    OR ARRAY_CONTAINS(UPPER(TRIM(v.MATERIAL_GROUP_NAME))::VARIANT,
                      (SELECT category_arr FROM sel_filters))
  )
  -- ✅ Conditional BRAND (MULTI)
  AND (
    ARRAY_SIZE((SELECT brand_arr FROM sel_filters)) = 0
    OR NOT EXISTS (
        SELECT 1 FROM GOLD.VW_BRAND_MAPPING_1st_DASH
        WHERE IN_PRIMARY = 1
          AND ARRAY_CONTAINS(UPPER(TRIM(BRAND))::VARIANT,
                             (SELECT brand_arr FROM sel_filters))
    )
    OR ARRAY_CONTAINS(UPPER(TRIM(v.BRAND))::VARIANT,
                      (SELECT brand_arr FROM sel_filters))
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
    OR ARRAY_CONTAINS(UPPER(TRIM(v.PARTY_CODE))::VARIANT,
                      (SELECT distributor_arr FROM sel_filters))
    OR ARRAY_CONTAINS(UPPER(TRIM(v.SHIP_TO_PARTY))::VARIANT,
                      (SELECT distributor_arr FROM sel_filters))


  );








  -- =====================================================================
-- ✅ PRIMARY KPI #2 — DAILY NET SALES TREND (MTD)
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND + DISTRIBUTOR
-- =====================================================================
SET v_years       = null;                -- '2025,2026'
SET v_months      = NULL;               -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region      = NULL;;                -- 'SD,KP'
SET v_category    = NULL;                -- 'Baby Diapers,Pants'
SET v_brand       = NULL;                -- 'Bona Plus,Momse'
SET v_distributor = NULL;                -- '3400091,3400074'

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
        NULLIF(TRIM($v_years),       '')                            AS years_raw,
        NULLIF(TRIM($v_months),      '')                            AS months_raw,
        NULLIF(TRIM($v_region),      '')                            AS region_raw,
        NULLIF(TRIM($v_category),    '')                            AS category_raw,
        NULLIF(TRIM($v_brand),       '')                            AS brand_raw,
        NULLIF(TRIM($v_distributor), '')                            AS distributor_raw
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
        -- MTD months only — trend uses MTD rule
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
-- ▼ Trend SELECT — group by Posting_Date across all MTD months/years
SELECT
    v.Posting_Date              AS SALES_DATE,
    DAY(v.Posting_Date)         AS DAY_OF_MONTH,
    SUM(v.Value)          AS NET_SALES
FROM gold.zfi_sco_vw v
WHERE EXISTS (
        SELECT 1 FROM mtd_ranges m
        WHERE v.Posting_Date BETWEEN m.m_start AND m.m_end
      )
  -- ✅ Conditional REGION (MULTI)
  AND (
        ARRAY_SIZE((SELECT region_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_REGION_MAPPING_1ST_DASH
            WHERE SOURCE = 'PRIMARY'
              AND (ARRAY_CONTAINS(UPPER(TRIM(REGION_CODE))::VARIANT,
                                  (SELECT region_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(REGION_NAME))::VARIANT,
                                     (SELECT region_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION))::VARIANT,
                          (SELECT region_arr FROM sel_filters))
        OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION_NAME))::VARIANT,
                          (SELECT region_arr FROM sel_filters))
      )
  -- ✅ Conditional CATEGORY (MULTI) — flags-based, no duplicates
  AND (
        ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
            WHERE IN_PRIMARY = 1
              AND (ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_NAME))::VARIANT,
                                  (SELECT category_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_CODE))::VARIANT,
                                     (SELECT category_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.MATERIAL_GROUP))::VARIANT,
                          (SELECT category_arr FROM sel_filters))
        OR ARRAY_CONTAINS(UPPER(TRIM(v.MATERIAL_GROUP_NAME))::VARIANT,
                          (SELECT category_arr FROM sel_filters))
      )
  -- ✅ Conditional BRAND (MULTI)
  AND (
        ARRAY_SIZE((SELECT brand_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_BRAND_MAPPING_1st_DASH
            WHERE IN_PRIMARY = 1
              AND ARRAY_CONTAINS(UPPER(TRIM(BRAND))::VARIANT,
                                 (SELECT brand_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.BRAND))::VARIANT,
                          (SELECT brand_arr FROM sel_filters))
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
        OR ARRAY_CONTAINS(UPPER(TRIM(v.PARTY_CODE))::VARIANT,
                          (SELECT distributor_arr FROM sel_filters))
        OR ARRAY_CONTAINS(UPPER(TRIM(v.SHIP_TO_PARTY))::VARIANT,
                          (SELECT distributor_arr FROM sel_filters))
      )
GROUP BY v.Posting_Date
ORDER BY v.Posting_Date;










39079739.000
-- =====================================================================
-- ✅ PRIMARY KPI #3 — CATEGORY-WISE NET SALES (MTD)
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND + DISTRIBUTOR
-- =====================================================================
SET v_years       = '2027';              -- '2025,2026'
SET v_months      = 'AUG';                -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region      = NULL;                -- 'SD,KP'
SET v_category    = NULL;                -- 'Baby Diapers,Pants'
SET v_brand       = NULL;                -- 'Bona Plus,Momse'
SET v_distributor = NULL;                -- '3400091,3400074'

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
        NULLIF(TRIM($v_years),       '')                            AS years_raw,
        NULLIF(TRIM($v_months),      '')                            AS months_raw,
        NULLIF(TRIM($v_region),      '')                            AS region_raw,
        NULLIF(TRIM($v_category),    '')                            AS category_raw,
        NULLIF(TRIM($v_brand),       '')                            AS brand_raw,
        NULLIF(TRIM($v_distributor), '')                            AS distributor_raw
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
        -- MTD months only — breakdown uses MTD rule
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
-- ▼ Breakdown SELECT — group by Material_Group_Name across all MTD months/years
SELECT
    v.Material_Group_Name               AS CATEGORY,
    SUM(v.Value)                  AS NET_SALES,
     SUM(v.Qty_In_Ctn)                 AS VOLUME_CTN
    -- SUM(v.Qty_In_Pcs)                 AS VOLUME_PCS,
    -- COUNT(DISTINCT v.Invoice_No)      AS INVOICE_COUNT
FROM gold.zfi_sco_vw v
WHERE EXISTS (
        SELECT 1 FROM mtd_ranges m
        WHERE v.Posting_Date BETWEEN m.m_start AND m.m_end
      )
  -- ✅ Conditional REGION (MULTI)
  AND (
        ARRAY_SIZE((SELECT region_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_REGION_MAPPING_1ST_DASH
            WHERE SOURCE = 'PRIMARY'
              AND (ARRAY_CONTAINS(UPPER(TRIM(REGION_CODE))::VARIANT,
                                  (SELECT region_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(REGION_NAME))::VARIANT,
                                     (SELECT region_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION))::VARIANT,
                          (SELECT region_arr FROM sel_filters))
        OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION_NAME))::VARIANT,
                          (SELECT region_arr FROM sel_filters))
      )
  -- ✅ Conditional CATEGORY (MULTI) — flags-based, no duplicates
  AND (
        ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM SALESDWH.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
            WHERE IN_PRIMARY = 1
              AND (ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_NAME))::VARIANT,
                                  (SELECT category_arr FROM sel_filters))
                   OR ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_CODE))::VARIANT,
                                     (SELECT category_arr FROM sel_filters)))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.MATERIAL_GROUP))::VARIANT,
                          (SELECT category_arr FROM sel_filters))
        OR ARRAY_CONTAINS(UPPER(TRIM(v.MATERIAL_GROUP_NAME))::VARIANT,
                          (SELECT category_arr FROM sel_filters))
      )
  -- ✅ Conditional BRAND (MULTI)
  AND (
        ARRAY_SIZE((SELECT brand_arr FROM sel_filters)) = 0
        OR NOT EXISTS (
            SELECT 1 FROM GOLD.VW_BRAND_MAPPING_1st_DASH
            WHERE IN_PRIMARY = 1
              AND ARRAY_CONTAINS(UPPER(TRIM(BRAND))::VARIANT,
                                 (SELECT brand_arr FROM sel_filters))
        )
        OR ARRAY_CONTAINS(UPPER(TRIM(v.BRAND))::VARIANT,
                          (SELECT brand_arr FROM sel_filters))
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
        OR ARRAY_CONTAINS(UPPER(TRIM(v.PARTY_CODE))::VARIANT,
                          (SELECT distributor_arr FROM sel_filters))
        OR ARRAY_CONTAINS(UPPER(TRIM(v.SHIP_TO_PARTY))::VARIANT,
                          (SELECT distributor_arr FROM sel_filters))
      )
GROUP BY v.Material_Group_Name
ORDER BY NET_SALES DESC;











-- =====================================================================
-- ✅ PRIMARY KPI #4 — TOP N BRANDS (MTD, global across all years)
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND + DISTRIBUTOR
-- =====================================================================
SET v_years       = '2027';              -- '2025,2026'
SET v_months      = 'AUG';               -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region      = NULL;                -- 'SD,KP'
SET v_category    = NULL;                -- 'Baby Diapers,Pants'
SET v_brand       = NULL;                -- 'Bona Plus,Momse'
SET v_distributor = NULL;                -- '3400091,3400074'
SET top_n         = 10;

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
        NULLIF(TRIM($v_years),       '')                            AS years_raw,
        NULLIF(TRIM($v_months),      '')                            AS months_raw,
        NULLIF(TRIM($v_region),      '')                            AS region_raw,
        NULLIF(TRIM($v_category),    '')                            AS category_raw,
        NULLIF(TRIM($v_brand),       '')                            AS brand_raw,
        NULLIF(TRIM($v_distributor), '')                            AS distributor_raw
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
),
-- Global brand MTD sum across ALL selected (year × month) pairs
brand_sales AS (
    SELECT
        v.Brand                                     AS BRAND,
        SUM(v.Value)                          AS NET_SALES
        -- SUM(v.Qty_In_Ctn)                        AS VOLUME_CTN,
        -- SUM(v.Qty_In_Pcs)                        AS VOLUME_PCS,
        -- COUNT(DISTINCT v.Invoice_No)             AS INVOICE_COUNT
    FROM gold.zfi_sco_vw v
    WHERE v.Brand IS NOT NULL
      AND EXISTS (
            SELECT 1 FROM mtd_ranges m
            WHERE v.Posting_Date BETWEEN m.m_start AND m.m_end
          )
      -- ✅ Conditional REGION (MULTI)
      AND (
            ARRAY_SIZE((SELECT region_arr FROM sel_filters)) = 0
            OR NOT EXISTS (
                SELECT 1 FROM GOLD.VW_REGION_MAPPING_1ST_DASH
                WHERE SOURCE = 'PRIMARY'
                  AND (ARRAY_CONTAINS(UPPER(TRIM(REGION_CODE))::VARIANT,
                                      (SELECT region_arr FROM sel_filters))
                       OR ARRAY_CONTAINS(UPPER(TRIM(REGION_NAME))::VARIANT,
                                         (SELECT region_arr FROM sel_filters)))
            )
            OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION))::VARIANT,
                              (SELECT region_arr FROM sel_filters))
            OR ARRAY_CONTAINS(UPPER(TRIM(v.REGION_NAME))::VARIANT,
                              (SELECT region_arr FROM sel_filters))
          )
      -- ✅ Conditional CATEGORY (MULTI) — flags-based, no duplicates
      AND (
            ARRAY_SIZE((SELECT category_arr FROM sel_filters)) = 0
            OR NOT EXISTS (
                SELECT 1 FROM SALESDWH.GOLD.VW_CATEGORY_MAPPING_1ST_DASH
                WHERE IN_PRIMARY = 1
                  AND (ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_NAME))::VARIANT,
                                      (SELECT category_arr FROM sel_filters))
                       OR ARRAY_CONTAINS(UPPER(TRIM(CATEGORY_CODE))::VARIANT,
                                         (SELECT category_arr FROM sel_filters)))
            )
            OR ARRAY_CONTAINS(UPPER(TRIM(v.MATERIAL_GROUP))::VARIANT,
                              (SELECT category_arr FROM sel_filters))
            OR ARRAY_CONTAINS(UPPER(TRIM(v.MATERIAL_GROUP_NAME))::VARIANT,
                              (SELECT category_arr FROM sel_filters))
          )
      -- ✅ Conditional BRAND (MULTI)
      AND (
            ARRAY_SIZE((SELECT brand_arr FROM sel_filters)) = 0
            OR NOT EXISTS (
                SELECT 1 FROM GOLD.VW_BRAND_MAPPING_1st_DASH
                WHERE IN_PRIMARY = 1
                  AND ARRAY_CONTAINS(UPPER(TRIM(BRAND))::VARIANT,
                                     (SELECT brand_arr FROM sel_filters))
            )
            OR ARRAY_CONTAINS(UPPER(TRIM(v.BRAND))::VARIANT,
                              (SELECT brand_arr FROM sel_filters))
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
            OR ARRAY_CONTAINS(UPPER(TRIM(v.PARTY_CODE))::VARIANT,
                              (SELECT distributor_arr FROM sel_filters))
            OR ARRAY_CONTAINS(UPPER(TRIM(v.SHIP_TO_PARTY))::VARIANT,
                              (SELECT distributor_arr FROM sel_filters))
          )
    GROUP BY v.Brand
)
SELECT
    BRAND,
    NET_SALES
FROM brand_sales
ORDER BY NET_SALES DESC
LIMIT $top_n;













--this will be same 
-- =====================================================================
-- QUERY 5: FULL FISCAL YEAR MONTHLY TREND (Jul → Jun)
--          NOTE: only v_year is needed — no v_month for this chart
-- =====================================================================
SET v_year          = 2027;        -- Fiscal Year
SET selected_region = NULL;        -- enable later when region mapping is ready

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
primary_sales AS (
    SELECT
        DATE_TRUNC('month', Posting_Date) AS FY_MONTH_START,
        SUM(Value)                  AS PRIMARY_SALES_VALUE
    FROM gold.zfi_sco_vw
    WHERE Posting_Date >= (SELECT fy_start FROM params)
      AND Posting_Date <  DATEADD('year', 1, (SELECT fy_start FROM params))
      AND ($selected_region IS NULL OR Region_Name = $selected_region)
    GROUP BY 1
)
SELECT
    TO_CHAR(m.FY_MONTH_START, 'Mon')   AS MONTH,
    m.FY_MONTH_START                   AS MONTH_START,
    p.PRIMARY_SALES_VALUE
FROM months m
LEFT JOIN primary_sales p ON p.FY_MONTH_START = m.FY_MONTH_START
ORDER BY m.FY_MONTH_START;