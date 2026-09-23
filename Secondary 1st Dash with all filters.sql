
















-- =====================================================================
-- ✅ SECONDARY KPI #1 — MTD / FYTD (Sales Value + CTN + PCS)
-- ADJUSTED VERSION: adds MT-Direct distributor primary sales top-up
--
-- Rule:
--   Accurate Secondary Sales
--     = SUM(net_sales) FROM Gold.salesflo_datadump_vw (excl. APP_USER_TAGGED_TITLE = 'SD')
--     + SUM(Value)     FROM gold.zfi_sco_vw for distributors listed in
--                       GOLD.MT_DIRECT_DISTRIBUTORS_VW
--       (these distributors' primary sales ARE their secondary sales,
--        since salesflo does not capture them — or under-captures them)
--
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
--                             + APP_USER_TAG  ✅ NEW
-- NOTE: CHANNEL_TYPE and TOWN have no equivalent in zfi_sco_vw (primary),
--       so they are applied to the secondary component only.
-- NOTE: APP_USER_TAG is secondary-only (no equivalent in zfi_sco_vw).
--       Default (NULL) => exclude 'SD'. User-supplied values => IN clause.
-- =====================================================================

SET v_years        = '2027';             -- '2025,2026'
SET v_months       = 'AUG';             -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = NULL;             -- 'SD,KP'
SET v_category     = NULL;--'Baby Diapers';             -- 'Baby Diapers,Pants'
SET v_brand        = NULL;             -- 'Bona Plus,Momse'
SET v_channel_type = NULL;             -- 'Wholesale,GT,MT'
SET v_town         = NULL;             -- 'Bhawalpur,Lahore'
SET v_distributor  = NULL;             -- 'D0458,D0459'
SET v_app_user_tag = 'MDSD,OB,SD - OB';             -- 'SD,ABC' | NULL (default: exclude SD)

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
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw,
        NULLIF(TRIM($v_app_user_tag), '')                           AS app_user_tag_raw   -- ✅ NEW
),
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
        END AS distributor_arr,
        -- ✅ NEW: sentinel '__EXCLUDE_SD__' when no user input → default behavior
        CASE
            WHEN p.app_user_tag_raw IS NULL THEN ARRAY_CONSTRUCT('__EXCLUDE_SD__')
            ELSE TRANSFORM(SPLIT(p.app_user_tag_raw, ','), x -> UPPER(TRIM(x)))
        END AS app_user_tag_arr
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
),
-- ✅ NEW: list of MT-direct distributor codes
mt_direct_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS DISTRIBUTOR_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
),
-- ✅ NEW: primary sales top-up for MT-direct distributors, MTD
primary_topup_mtd AS (
    SELECT
        SUM(v.Value)       AS TOPUP_SALES_VALUE,
        SUM(v.Qty_In_Ctn)  AS TOPUP_VOLUME_CTN,
        SUM(v.Qty_In_Pcs)  AS TOPUP_VOLUME_PCS
    FROM gold.zfi_sco_vw v
    WHERE EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.invoice_Date BETWEEN m.m_start AND m.m_end)
      AND UPPER(TRIM(v.PARTY_CODE)) IN (SELECT DISTRIBUTOR_CODE FROM mt_direct_codes)
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
      -- ✅ Conditional CATEGORY (MULTI)
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
),
-- ✅ NEW: primary sales top-up for MT-direct distributors, FYTD
primary_topup_fytd AS (
    SELECT
        SUM(v.Value)       AS TOPUP_SALES_VALUE,
        SUM(v.Qty_In_Ctn)  AS TOPUP_VOLUME_CTN,
        SUM(v.Qty_In_Pcs)  AS TOPUP_VOLUME_PCS
    FROM gold.zfi_sco_vw v
    WHERE EXISTS (SELECT 1 FROM fy_ranges f WHERE v.invoice_Date BETWEEN f.fy_start AND f.fytd_end)
      AND UPPER(TRIM(v.PARTY_CODE)) IN (SELECT DISTRIBUTOR_CODE FROM mt_direct_codes)
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
      -- ✅ Conditional CATEGORY (MULTI)
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
),
-- ✅ Original secondary aggregate (unchanged logic), isolated into its own CTE
secondary_agg AS (
    SELECT
        SUM(CASE WHEN EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end)
                 THEN v.NET_SALES END)              AS MTD_SALES_VALUE,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end)
                 THEN v.SALES_CTN END)              AS MTD_VOLUME_CTN,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM mtd_ranges m WHERE v.DATE BETWEEN m.m_start AND m.m_end)
                 THEN v.SALES_UNITS END)            AS MTD_VOLUME_PCS,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM fy_ranges f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end)
                 THEN v.NET_SALES END)              AS FYTD_SALES_VALUE,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM fy_ranges f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end)
                 THEN v.SALES_CTN END)              AS FYTD_VOLUME_CTN,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM fy_ranges f WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end)
                 THEN v.SALES_UNITS END)            AS FYTD_VOLUME_PCS
    FROM Gold.salesflo_datadump_vw v
    WHERE
        -- ✅ NEW: APP_USER_TAG (secondary-only, multi-select, default excludes SD)
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
                THEN v.APP_USER_TAGGED_TITLE <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(v.APP_USER_TAGGED_TITLE))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
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
)
-- ✅ FINAL: secondary + MT-direct primary top-up
SELECT
    COALESCE(sa.MTD_SALES_VALUE, 0)  + COALESCE(tm.TOPUP_SALES_VALUE, 0) AS MTD_SALES_VALUE,
    COALESCE(sa.MTD_VOLUME_CTN, 0)   + COALESCE(tm.TOPUP_VOLUME_CTN, 0)  AS MTD_VOLUME_CTN,
    COALESCE(sa.MTD_VOLUME_PCS, 0)   + COALESCE(tm.TOPUP_VOLUME_PCS, 0)  AS MTD_VOLUME_PCS,

    COALESCE(sa.FYTD_SALES_VALUE, 0) + COALESCE(tf.TOPUP_SALES_VALUE, 0) AS FYTD_SALES_VALUE,
    COALESCE(sa.FYTD_VOLUME_CTN, 0)  + COALESCE(tf.TOPUP_VOLUME_CTN, 0)  AS FYTD_VOLUME_CTN,
    COALESCE(sa.FYTD_VOLUME_PCS, 0)  + COALESCE(tf.TOPUP_VOLUME_PCS, 0)  AS FYTD_VOLUME_PCS
FROM secondary_agg sa
CROSS JOIN primary_topup_mtd tm
CROSS JOIN primary_topup_fytd tf;















-- =====================================================================
-- ✅ SECONDARY KPI #2 — MTD / FYTD PRODUCTIVE STORES & DISTRIBUTORS
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
--                             + APP_USER_TAG  ✅ NEW
-- NOTE: APP_USER_TAG is secondary-only.
--       Default (NULL) => exclude 'SD'. User-supplied values => IN clause.
-- =====================================================================
SET v_years        = '2026';             -- '2025,2026'
SET v_months       = 'NOV,FEB';          -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = NULL;               -- 'SD,KP'
SET v_category     = NULL;               -- 'Baby Diapers,Pants'
SET v_brand        = NULL;               -- 'Bona Plus,Momse'
SET v_channel_type = NULL;               -- 'MT,GT'
SET v_town         = NULL;               -- 'Karachi,Lahore'
SET v_distributor  = NULL;               -- 'D0458,D0459'
SET v_app_user_tag = NULL;               -- 'SD,ABC' | NULL (default: exclude SD)  ✅ NEW

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
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw,
        NULLIF(TRIM($v_app_user_tag), '')                           AS app_user_tag_raw   -- ✅ NEW
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
        END AS distributor_arr,
        -- ✅ NEW: sentinel '__EXCLUDE_SD__' when no user input → default behavior
        CASE
            WHEN p.app_user_tag_raw IS NULL THEN ARRAY_CONSTRUCT('__EXCLUDE_SD__')
            ELSE TRANSFORM(SPLIT(p.app_user_tag_raw, ','), x -> UPPER(TRIM(x)))
        END AS app_user_tag_arr
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
WHERE
    -- ✅ NEW: APP_USER_TAG (secondary-only, multi-select, default excludes SD)
    CASE
        WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT,
                            (SELECT app_user_tag_arr FROM sel_filters))
            THEN v.APP_USER_TAGGED_TITLE <> 'SD'
        ELSE ARRAY_CONTAINS(UPPER(TRIM(v.APP_USER_TAGGED_TITLE))::VARIANT,
                            (SELECT app_user_tag_arr FROM sel_filters))
    END
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
-- ADJUSTED VERSION: adds MT-Direct distributor primary sales top-up
--
-- Rule (same as KPI #1):
--   Accurate Secondary Sales
--     = SUM(net_sales) FROM Gold.salesflo_datadump_vw (excl. APP_USER_TAGGED_TITLE = 'SD')
--     + SUM(Value)     FROM gold.zfi_sco_vw for distributors listed in
--                       GOLD.MT_DIRECT_DISTRIBUTORS_VW
--
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
--                             + APP_USER_TAG  ✅ NEW
-- NOTE: CHANNEL_TYPE and TOWN have no equivalent in zfi_sco_vw (primary),
--       so they are applied to the secondary component only.
-- NOTE: APP_USER_TAG is secondary-only.
--       Default (NULL) => exclude 'SD'. User-supplied values => IN clause.
-- =====================================================================

SET v_years        = '2027';        -- '2025,2026'
SET v_months       = 'AUG';        -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = NULL;        -- 'SD,KP'
SET v_category     = NULL;        -- 'Baby Diapers,Pants'
SET v_brand        = NULL;        -- 'Bona Plus,Momse'
SET v_channel_type = NULL;        -- 'MT,GT'
SET v_town         = NULL;        -- 'Karachi,Lahore'
SET v_distributor  = NULL;        -- 'D0458,D0459'
SET v_app_user_tag = NULL;        -- 'SD,ABC' | NULL (default: exclude SD)  ✅ NEW

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
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw,
        NULLIF(TRIM($v_app_user_tag), '')                           AS app_user_tag_raw   -- ✅ NEW
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
        END AS distributor_arr,
        -- ✅ NEW: sentinel '__EXCLUDE_SD__' when no user input → default behavior
        CASE
            WHEN p.app_user_tag_raw IS NULL THEN ARRAY_CONSTRUCT('__EXCLUDE_SD__')
            ELSE TRANSFORM(SPLIT(p.app_user_tag_raw, ','), x -> UPPER(TRIM(x)))
        END AS app_user_tag_arr
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
),
-- ✅ NEW: list of MT-direct distributor codes
mt_direct_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS DISTRIBUTOR_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
),
-- ✅ NEW: secondary daily trend (grouped by DATE)
secondary_daily AS (
    SELECT
        v.DATE                      AS SALES_DATE,
        SUM(v.NET_SALES)            AS NET_SALES
    FROM Gold.salesflo_datadump_vw v
    WHERE
        -- ✅ NEW: APP_USER_TAG (secondary-only, multi-select, default excludes SD)
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
                THEN v.APP_USER_TAGGED_TITLE <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(v.APP_USER_TAGGED_TITLE))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
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
),
-- ✅ NEW: primary daily trend for MT-direct distributors only (grouped by invoice_Date)
primary_daily AS (
    SELECT
        v.invoice_Date              AS SALES_DATE,
        SUM(v.Value)                AS NET_SALES
    FROM gold.zfi_sco_vw v
    WHERE EXISTS (
            SELECT 1 FROM mtd_ranges m
            WHERE v.invoice_Date BETWEEN m.m_start AND m.m_end
          )
      AND UPPER(TRIM(v.PARTY_CODE)) IN (SELECT DISTRIBUTOR_CODE FROM mt_direct_codes)
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
      -- ✅ Conditional CATEGORY (MULTI)
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
    GROUP BY v.invoice_Date
)
-- ✅ FINAL: union secondary + MT-direct primary daily, re-aggregate by date
SELECT
    SALES_DATE,
    DAY(SALES_DATE)     AS DAY_OF_MONTH,
    SUM(NET_SALES)      AS NET_SALES
FROM (
    SELECT SALES_DATE, NET_SALES FROM secondary_daily
    UNION ALL
    SELECT SALES_DATE, NET_SALES FROM primary_daily
)
GROUP BY SALES_DATE
ORDER BY SALES_DATE;














-- =====================================================================
-- ✅ SECONDARY KPI #4 — SALES VALUE BY CHANNEL TYPE (MTD)
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
--                             + APP_USER_TAG  ✅ NEW
-- NOTE: APP_USER_TAG is secondary-only.
--       Default (NULL) => exclude 'SD'. User-supplied values => IN clause.
-- =====================================================================
SET v_years        = '2024,2025';             -- '2025,2026'
SET v_months       = NULL;          -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = 'Karachi Total,PB,Peshawar Region';               -- 'SD,KP'
SET v_category     = 'AP006,Pants,Oral Care';               -- 'Baby Diapers,Pants'
SET v_brand        = NULL;               -- 'Bona Plus,Momse'
SET v_channel_type = NULL;               -- 'MT,GT'
SET v_town         = NULL;               -- 'Karachi,Lahore'
SET v_distributor  = NULL;               -- 'D0458,D0459'
SET v_app_user_tag = NULL;               -- 'SD,ABC' | NULL (default: exclude SD)  ✅ NEW

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
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw,
        NULLIF(TRIM($v_app_user_tag), '')                           AS app_user_tag_raw   -- ✅ NEW
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
        END AS distributor_arr,
        -- ✅ NEW: sentinel '__EXCLUDE_SD__' when no user input → default behavior
        CASE
            WHEN p.app_user_tag_raw IS NULL THEN ARRAY_CONSTRUCT('__EXCLUDE_SD__')
            ELSE TRANSFORM(SPLIT(p.app_user_tag_raw, ','), x -> UPPER(TRIM(x)))
        END AS app_user_tag_arr
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
WHERE
    -- ✅ NEW: APP_USER_TAG (secondary-only, multi-select, default excludes SD)
    CASE
        WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT,
                            (SELECT app_user_tag_arr FROM sel_filters))
            THEN v.APP_USER_TAGGED_TITLE <> 'SD'
        ELSE ARRAY_CONTAINS(UPPER(TRIM(v.APP_USER_TAGGED_TITLE))::VARIANT,
                            (SELECT app_user_tag_arr FROM sel_filters))
    END
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
-- ADJUSTED VERSION: adds MT-Direct distributor primary sales top-up
--
-- Rule (same as KPI #1):
--   Accurate Secondary Sales
--     = SUM(net_sales) FROM Gold.salesflo_datadump_vw (excl. APP_USER_TAGGED_TITLE = 'SD')
--     + SUM(Value)     FROM gold.zfi_sco_vw for distributors listed in
--                       GOLD.MT_DIRECT_DISTRIBUTORS_VW
--
-- PRIMARY CATEGORY COLUMN = v.MATERIAL_GROUP_NAME
--
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
--                             + APP_USER_TAG  ✅ NEW
-- NOTE: CHANNEL_TYPE and TOWN have no equivalent in zfi_sco_vw (primary),
--       so they are applied to the secondary component only.
-- NOTE: APP_USER_TAG is secondary-only.
--       Default (NULL) => exclude 'SD'. User-supplied values => IN clause.
-- =====================================================================

SET v_years        = '2027';        -- '2025,2026'
SET v_months       = 'AUG';          -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = NULL;               -- 'SD,KP'
SET v_category     = 'Baby Diapers';               -- 'Baby Diapers,Pants'
SET v_brand        = NULL;               -- 'Bona Plus,Momse'
SET v_channel_type = NULL;               -- 'MT,GT'
SET v_town         = NULL;               -- 'Karachi,Lahore'
SET v_distributor  = NULL;               -- 'D0458,D0459'
SET v_app_user_tag = NULL;               -- 'SD,ABC' | NULL (default: exclude SD)  ✅ NEW

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
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw,
        NULLIF(TRIM($v_app_user_tag), '')                           AS app_user_tag_raw   -- ✅ NEW
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
        END AS distributor_arr,
        -- ✅ NEW: sentinel '__EXCLUDE_SD__' when no user input → default behavior
        CASE
            WHEN p.app_user_tag_raw IS NULL THEN ARRAY_CONSTRUCT('__EXCLUDE_SD__')
            ELSE TRANSFORM(SPLIT(p.app_user_tag_raw, ','), x -> UPPER(TRIM(x)))
        END AS app_user_tag_arr
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
),
-- ✅ NEW: list of MT-direct distributor codes
mt_direct_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS DISTRIBUTOR_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
),
-- ✅ NEW: secondary by category (grouped by CATEGORY)
secondary_by_category AS (
    SELECT
        v.CATEGORY                          AS CATEGORY,
        SUM(v.NET_SALES)                    AS SALES_VALUE,
        SUM(SALES_CTN)                      AS SALES_CTN
    FROM Gold.salesflo_datadump_vw v
    WHERE
        -- ✅ NEW: APP_USER_TAG (secondary-only, multi-select, default excludes SD)
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
                THEN v.APP_USER_TAGGED_TITLE <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(v.APP_USER_TAGGED_TITLE))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
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
),
-- ✅ NEW: primary by category (MT-direct only) — CATEGORY = MATERIAL_GROUP_NAME
primary_by_category AS (
    SELECT
        v.MATERIAL_GROUP_NAME               AS CATEGORY,
        SUM(v.Value)                        AS SALES_VALUE,
        SUM(V.QTY_IN_CTN)                   AS SALES_CTN
    FROM gold.zfi_sco_vw v
    WHERE EXISTS (
            SELECT 1 FROM mtd_ranges m
            WHERE v.invoice_Date BETWEEN m.m_start AND m.m_end
          )
      AND UPPER(TRIM(v.PARTY_CODE)) IN (SELECT DISTRIBUTOR_CODE FROM mt_direct_codes)
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
      -- ✅ Conditional CATEGORY (MULTI) — uses MATERIAL_GROUP_NAME
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
    GROUP BY v.MATERIAL_GROUP_NAME
)
-- ✅ FINAL: union secondary + MT-direct primary by category, re-aggregate
SELECT
    CATEGORY,
    SUM(SALES_VALUE) AS SALES_VALUE,
    SUM(SALES_CTN) AS SALES_CTN
FROM (
    SELECT CATEGORY, SALES_VALUE, SALES_CTN FROM secondary_by_category
    UNION ALL
    SELECT CATEGORY, SALES_VALUE, SALES_CTN FROM primary_by_category
)
WHERE CATEGORY IS NOT NULL
GROUP BY CATEGORY
ORDER BY SALES_VALUE DESC;













-- =====================================================================
-- ✅ SECONDARY KPI #6 — TOP N BRANDS BY NET SALES VALUE (MTD)
-- ADJUSTED VERSION: adds MT-Direct distributor primary sales top-up
--
-- Rule (same as KPI #1):
--   Accurate Secondary Sales
--     = SUM(net_sales) FROM Gold.salesflo_datadump_vw (excl. APP_USER_TAGGED_TITLE = 'SD')
--     + SUM(Value)     FROM gold.zfi_sco_vw for distributors listed in
--                       GOLD.MT_DIRECT_DISTRIBUTORS_VW
--
-- Filters (ALL MULTI-SELECT): REGION + CATEGORY + BRAND
--                             + CHANNEL_TYPE + TOWN + DISTRIBUTOR
--                             + APP_USER_TAG  ✅ NEW
-- NOTE: CHANNEL_TYPE and TOWN have no equivalent in zfi_sco_vw (primary),
--       so they are applied to the secondary component only.
-- NOTE: APP_USER_TAG is secondary-only.
--       Default (NULL) => exclude 'SD'. User-supplied values => IN clause.
-- =====================================================================

SET v_years        = '2027';        -- '2025,2026'
SET v_months       = 'AUG';  -- 'SEP' | 'SEP,NOV,FEB' | NULL
SET v_region       = NULL;               -- 'SD,KP'
SET v_category     = NULL;--NULL;               -- 'Baby Diapers,Pants'
SET v_brand        = NULL;               -- 'Bona Plus,Momse'
SET v_channel_type = NULL;               -- 'MT,GT'
SET v_town         = NULL;               -- 'Karachi,Lahore'
SET v_distributor  = NULL;               -- 'D0458,D0459'
SET v_app_user_tag = NULL;               -- 'SD,ABC' | NULL (default: exclude SD)  ✅ NEW
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
        NULLIF(TRIM($v_distributor),  '')                           AS distributor_raw,
        NULLIF(TRIM($v_app_user_tag), '')                           AS app_user_tag_raw   -- ✅ NEW
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
        END AS distributor_arr,
        -- ✅ NEW: sentinel '__EXCLUDE_SD__' when no user input → default behavior
        CASE
            WHEN p.app_user_tag_raw IS NULL THEN ARRAY_CONSTRUCT('__EXCLUDE_SD__')
            ELSE TRANSFORM(SPLIT(p.app_user_tag_raw, ','), x -> UPPER(TRIM(x)))
        END AS app_user_tag_arr
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
),
-- ✅ NEW: list of MT-direct distributor codes
mt_direct_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS DISTRIBUTOR_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
),
-- ✅ NEW: secondary by brand (grouped by BRAND)
secondary_by_brand AS (
    SELECT
        v.BRAND                             AS BRAND,
        SUM(v.NET_SALES)                    AS SALES_VALUE
    FROM Gold.salesflo_datadump_vw v
    WHERE
        -- ✅ NEW: APP_USER_TAG (secondary-only, multi-select, default excludes SD)
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
                THEN v.APP_USER_TAGGED_TITLE <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(v.APP_USER_TAGGED_TITLE))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
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
),
-- ✅ NEW: primary by brand (MT-direct only), grouped by BRAND
primary_by_brand AS (
    SELECT
        v.BRAND                             AS BRAND,
        SUM(v.Value)                        AS SALES_VALUE
    FROM gold.zfi_sco_vw v
    WHERE EXISTS (
            SELECT 1 FROM mtd_ranges m
            WHERE v.invoice_Date BETWEEN m.m_start AND m.m_end
          )
      AND UPPER(TRIM(v.PARTY_CODE)) IN (SELECT DISTRIBUTOR_CODE FROM mt_direct_codes)
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
      -- ✅ Conditional CATEGORY (MULTI)
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
    GROUP BY v.BRAND
)
-- ✅ FINAL: union secondary + MT-direct primary by brand, re-aggregate, Top-N
SELECT
    BRAND,
    SUM(SALES_VALUE) AS SALES_VALUE
FROM (
    SELECT BRAND, SALES_VALUE FROM secondary_by_brand
    UNION ALL
    SELECT BRAND, SALES_VALUE FROM primary_by_brand
)
WHERE BRAND IS NOT NULL
GROUP BY BRAND
ORDER BY SALES_VALUE DESC
LIMIT $top_n;







-- =====================================================================
-- ✅ FY MONTHLY TREND — SALES VALUE + CTN + PCS
-- ADJUSTED VERSION: adds MT-Direct distributor primary sales top-up
--
-- Rule (same as KPI #1):
--   Accurate Secondary Sales
--     = SUM(net_sales/SALES_CTN/SALES_UNITS) FROM Gold.salesflo_datadump_vw
--                                             (excl. APP_USER_TAGGED_TITLE = 'SD')
--     + SUM(Value/Qty_In_Ctn/Qty_In_Pcs)      FROM gold.zfi_sco_vw for distributors
--                                             listed in GOLD.MT_DIRECT_DISTRIBUTORS_VW
--
-- Region filter is OPTIONAL — pass NULL (or leave as-is) for all regions.
-- =====================================================================

SET v_year   = 2027;            -- Fiscal Year
SET v_region = NULL;            -- NULL = all regions | 'Multan Region' | 'North' | 'South'

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
-- ✅ NEW: list of MT-direct distributor codes
mt_direct_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS DISTRIBUTOR_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
),
-- ✅ Secondary component (Salesflo)
secondary AS (
    SELECT
        DATE_TRUNC('month', v.DATE) AS FY_MONTH_START,
        SUM(v.NET_SALES)            AS SECONDARY_SALES_VALUE,
        SUM(v.SALES_CTN)            AS SECONDARY_VOLUME_CTN,
        SUM(v.SALES_UNITS)          AS SECONDARY_VOLUME_PCS
    FROM Gold.salesflo_datadump_vw v
    WHERE v.DATE >= (SELECT fy_start FROM params)
      AND v.DATE <  DATEADD('year', 1, (SELECT fy_start FROM params))
      AND ($v_region IS NULL OR v.REGION = $v_region)   -- ✅ optional region
      AND v.APP_USER_TAGGED_TITLE <> 'SD'
    GROUP BY 1
),
-- ✅ NEW: MT-Direct primary top-up component (zfi_sco_vw)
primary AS (
    SELECT
        DATE_TRUNC('month', v.invoice_Date) AS FY_MONTH_START,
        SUM(v.Value)                        AS PRIMARY_SALES_VALUE,
        SUM(v.Qty_In_Ctn)                   AS PRIMARY_VOLUME_CTN,
        SUM(v.Qty_In_Pcs)                   AS PRIMARY_VOLUME_PCS
    FROM gold.zfi_sco_vw v
    WHERE v.invoice_Date >= (SELECT fy_start FROM params)
      AND v.invoice_Date <  DATEADD('year', 1, (SELECT fy_start FROM params))
      AND ($v_region IS NULL OR v.REGION = $v_region)   -- ✅ optional region
      AND UPPER(TRIM(v.PARTY_CODE)) IN (SELECT DISTRIBUTOR_CODE FROM mt_direct_codes)
    GROUP BY 1
),
-- ✅ Combined = secondary + MT-direct top-up
combined AS (
    SELECT
        FY_MONTH_START,
        SUM(SALES_VALUE)    AS SALES_VALUE,
        SUM(VOLUME_CTN)     AS VOLUME_CTN,
        SUM(VOLUME_PCS)     AS VOLUME_PCS
    FROM (
        SELECT FY_MONTH_START, SECONDARY_SALES_VALUE AS SALES_VALUE,
               SECONDARY_VOLUME_CTN  AS VOLUME_CTN,
               SECONDARY_VOLUME_PCS  AS VOLUME_PCS
        FROM secondary
        UNION ALL
        SELECT FY_MONTH_START, PRIMARY_SALES_VALUE   AS SALES_VALUE,
               PRIMARY_VOLUME_CTN    AS VOLUME_CTN,
               PRIMARY_VOLUME_PCS    AS VOLUME_PCS
        FROM primary
    )
    GROUP BY FY_MONTH_START
)
SELECT
    TO_CHAR(m.FY_MONTH_START, 'Mon')   AS MONTH,
    m.FY_MONTH_START                   AS MONTH_START,
    COALESCE(c.SALES_VALUE, 0)         AS SALES_VALUE,
    COALESCE(c.VOLUME_CTN, 0)          AS VOLUME_CTN,
    COALESCE(c.VOLUME_PCS, 0)          AS VOLUME_PCS
FROM months m
LEFT JOIN combined c ON c.FY_MONTH_START = m.FY_MONTH_START
ORDER BY m.FY_MONTH_START;














--region vise Targets vs achievements will be same

-- =====================================================================
-- ✅ SECONDARY KPI #7 — REGION-WISE TARGET vs ACHIEVEMENT
-- MTD + FYTD | Filters: v_years + v_months + APP_USER_TAG  ✅ NEW
-- FY 2027 = Jul 2026 → Jun 2027
-- TARGETS_VW stores CALENDAR year/month → converted via FY map
--
-- ADJUSTED VERSION: adds MT-Direct distributor primary sales top-up
--   to the Achievement side (consistent with KPI #1).
--   Rule:
--     Accurate Secondary Sales
--       = SUM(net_sales) FROM Gold.salesflo_datadump_vw (excl. APP_USER_TAGGED_TITLE = 'SD')
--       + SUM(Value)     FROM gold.zfi_sco_vw for distributors listed in
--                         GOLD.MT_DIRECT_DISTRIBUTORS_VW
--   Grouped by REGION on both sides.
--
-- NOTE: APP_USER_TAG is secondary-only.
--       Default (NULL) => exclude 'SD'. User-supplied values => IN clause.
-- =====================================================================
SET v_years        = '2027';        -- '' | '2026' | '2025,2026'
SET v_months       = 'AUG';         -- '' | 'SEP'  | 'JUL,SEP'
SET v_app_user_tag = NULL;          -- 'SD,ABC' | NULL (default: exclude SD)  ✅ NEW

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
        NULLIF(TRIM($v_years),  '')                                 AS years_raw,
        NULLIF(TRIM($v_months), '')                                 AS months_raw,
        NULLIF(TRIM($v_app_user_tag), '')                           AS app_user_tag_raw   -- ✅ NEW
),
-- ✅ NEW: build APP_USER_TAG array (with default sentinel)
sel_filters AS (
    SELECT p.*,
        CASE
            WHEN p.app_user_tag_raw IS NULL THEN ARRAY_CONSTRUCT('__EXCLUDE_SD__')
            ELSE TRANSFORM(SPLIT(p.app_user_tag_raw, ','), x -> UPPER(TRIM(x)))
        END AS app_user_tag_arr
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
),
-- =====================================================================
-- ✅ FY → CALENDAR MAP (built from resolved, not mtd_ranges)
-- =====================================================================
targets_cal_map_mtd AS (
    SELECT DISTINCT
        y.VALUE::NUMBER                                     AS fy_year,
        m.VALUE::NUMBER                                     AS fy_month_no,
        y.VALUE::NUMBER
          - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END AS cal_year,
        CASE MOD(m.VALUE::NUMBER + 5, 12) + 1
            WHEN 1  THEN 'JAN' WHEN 2  THEN 'FEB' WHEN 3  THEN 'MAR'
            WHEN 4  THEN 'APR' WHEN 5  THEN 'MAY' WHEN 6  THEN 'JUN'
            WHEN 7  THEN 'JUL' WHEN 8  THEN 'AUG' WHEN 9  THEN 'SEP'
            WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DEC'
        END                                                 AS cal_month_name
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years) y,
         LATERAL FLATTEN(input => r.mtd_month_nos) m
),
targets_cal_map_fytd AS (
    SELECT DISTINCT
        y.VALUE::NUMBER                                     AS fy_year,
        m.VALUE::NUMBER                                     AS fy_month_no,
        y.VALUE::NUMBER
          - CASE WHEN m.VALUE::NUMBER <= 6 THEN 1 ELSE 0 END AS cal_year,
        CASE MOD(m.VALUE::NUMBER + 5, 12) + 1
            WHEN 1  THEN 'JAN' WHEN 2  THEN 'FEB' WHEN 3  THEN 'MAR'
            WHEN 4  THEN 'APR' WHEN 5  THEN 'MAY' WHEN 6  THEN 'JUN'
            WHEN 7  THEN 'JUL' WHEN 8  THEN 'AUG' WHEN 9  THEN 'SEP'
            WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DEC'
        END                                                 AS cal_month_name
    FROM resolved r,
         LATERAL FLATTEN(input => r.eff_years) y,
         LATERAL FLATTEN(input => r.fytd_month_nos) m
),
-- =====================================================================
-- TARGETS — MTD (matched on CALENDAR year + month)
-- =====================================================================
targets_agg_mtd AS (
    SELECT
        TRIM(t.DIST_CODE) AS distributor_code,
        SUM(t.VALUE)      AS total_target_mtd
    FROM GOLD.TARGETS_VW t
    JOIN targets_cal_map_mtd cm
      ON t.target_year::NUMBER = cm.cal_year
     AND UPPER(TRIM(t.target_month)) = cm.cal_month_name
    GROUP BY TRIM(t.DIST_CODE)
),
-- =====================================================================
-- TARGETS — FYTD (matched on CALENDAR year + month)
-- =====================================================================
targets_agg_fytd AS (
    SELECT
        TRIM(t.DIST_CODE) AS distributor_code,
        SUM(t.VALUE)      AS total_target_fytd
    FROM GOLD.TARGETS_VW t
    JOIN targets_cal_map_fytd cm
      ON t.target_year::NUMBER = cm.cal_year
     AND UPPER(TRIM(t.target_month)) = cm.cal_month_name
    GROUP BY TRIM(t.DIST_CODE)
),
targets_by_region_mtd AS (
    SELECT
        d.new_region             AS region,
        SUM(ta.total_target_mtd) AS targets_by_region_mtd
    FROM targets_agg_mtd ta
    JOIN SALESDWH.GOLD.DISTRIBUTOR_MASTER_VW d
      ON ta.distributor_code = TRIM(d.Distributor_Code)
    GROUP BY d.new_region
),
targets_by_region_fytd AS (
    SELECT
        d.new_region              AS region,
        SUM(ta.total_target_fytd) AS targets_by_region_fytd
    FROM targets_agg_fytd ta
    JOIN SALESDWH.GOLD.DISTRIBUTOR_MASTER_VW d
      ON ta.distributor_code = TRIM(d.Distributor_Code)
    GROUP BY d.new_region
),
-- =====================================================================
-- ✅ NEW: list of MT-direct distributor codes
-- =====================================================================
mt_direct_codes AS (
    SELECT DISTINCT UPPER(TRIM(DISTRIBUTOR_SAP_CODE)) AS DISTRIBUTOR_CODE
    FROM GOLD.MT_DIRECT_DISTRIBUTORS_VW
),
-- =====================================================================
-- ACHIEVEMENTS BY REGION — SECONDARY ONLY (MTD + FYTD)
-- =====================================================================
secondary_by_region AS (
    SELECT
        v.REGION                                          AS region,
        SUM(CASE WHEN EXISTS (
                SELECT 1 FROM mtd_ranges m
                WHERE v.DATE BETWEEN m.m_start AND m.m_end)
            THEN v.NET_SALES END)                         AS secondary_mtd,
        SUM(CASE WHEN EXISTS (
                SELECT 1 FROM fy_ranges f
                WHERE v.DATE BETWEEN f.fy_start AND f.fytd_end)
            THEN v.NET_SALES END)                         AS secondary_fytd
    FROM gold.salesflo_datadump_vw v
    WHERE
        -- ✅ NEW: APP_USER_TAG (secondary-only, multi-select, default excludes SD)
        CASE
            WHEN ARRAY_CONTAINS('__EXCLUDE_SD__'::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
                THEN v.APP_USER_TAGGED_TITLE <> 'SD'
            ELSE ARRAY_CONTAINS(UPPER(TRIM(v.APP_USER_TAGGED_TITLE))::VARIANT,
                                (SELECT app_user_tag_arr FROM sel_filters))
        END
    GROUP BY v.REGION
),
-- =====================================================================
-- ✅ NEW: ACHIEVEMENTS BY REGION — MT-DIRECT PRIMARY TOP-UP (MTD + FYTD)
-- =====================================================================
primary_by_region AS (
    SELECT
        v.REGION                                          AS region,
        SUM(CASE WHEN EXISTS (
                SELECT 1 FROM mtd_ranges m
                WHERE v.invoice_Date BETWEEN m.m_start AND m.m_end)
            THEN v.Value END)                             AS topup_mtd,
        SUM(CASE WHEN EXISTS (
                SELECT 1 FROM fy_ranges f
                WHERE v.invoice_Date BETWEEN f.fy_start AND f.fytd_end)
            THEN v.Value END)                             AS topup_fytd
    FROM gold.zfi_sco_vw v
    WHERE UPPER(TRIM(v.PARTY_CODE)) IN (SELECT DISTRIBUTOR_CODE FROM mt_direct_codes)
    GROUP BY v.REGION
),
-- =====================================================================
-- ✅ FINAL ACHIEVEMENTS = secondary + MT-direct top-up (combined by region)
-- =====================================================================
achievements_by_region AS (
    SELECT
        region,
        SUM(secondary_mtd)  AS total_achievement_mtd,
        SUM(secondary_fytd) AS total_achievement_fytd
    FROM (
        SELECT region, secondary_mtd, secondary_fytd FROM secondary_by_region
        UNION ALL
        SELECT region, topup_mtd,     topup_fytd     FROM primary_by_region
    )
    WHERE region IS NOT NULL
    GROUP BY region
)

SELECT
    COALESCE(t.region, a.region, tf.region)     AS region,
    t.targets_by_region_mtd,
    a.total_achievement_mtd,
    tf.targets_by_region_fytd,
    a.total_achievement_fytd
FROM targets_by_region_mtd t
FULL OUTER JOIN targets_by_region_fytd tf ON t.region = tf.region
FULL OUTER JOIN achievements_by_region a  ON COALESCE(t.region, tf.region) = a.region
ORDER BY total_achievement_mtd, targets_by_region_mtd, region DESC;