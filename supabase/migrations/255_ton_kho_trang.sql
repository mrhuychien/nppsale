-- ====================================================================
-- RPC "TỒN KHO HIỆN TẠI" — máy chủ gộp tồn theo mặt hàng, lọc, tìm, sắp, phân trang, kèm tổng cộng
--
-- VÌ SAO — chủ nhà 23/10/2026 "tốc độ load trang chậm lắm" → đợt 4 (24/10/2026 "lần lượt hoàn thành toàn bộ"):
--   màn Kho hàng (máy tính lẫn điện thoại) mở là kéo CẢ bảng tồn theo khu (v_stock_balance_by_zone) + CẢ 2.500 mặt
--   hàng kèm đơn vị về máy rồi mới gộp, lọc "còn tồn", tìm, cộng tổng và chia trang ở trình duyệt — mỗi lần mở ≈ 1 MB
--   JSON. Nay máy chủ làm hết: máy chỉ nhận trang đang xem (20–50 dòng) kèm tổng số dòng và TỔNG CỘNG của toàn bộ
--   tập đã lọc — dòng "N sản phẩm — tổng giá trị X" và dòng Tổng cộng vẫn đúng trên cả sổ, không phải trên một trang.
--
-- LÀM GÌ
--   ton_kho_trang(p_tim, p_con_ton, p_sap, p_offset, p_limit):
--   · Gộp `v_stock_balance_by_zone` (security_invoker — RLS tự lọc) theo mặt hàng: kho bán / kho date SL + giá trị.
--   · Luật dòng NHƯ MÀN CŨ (`gopTonTheoSanPham`, rà soát 03/10/2026): mã ngừng bán CHỈ lên bảng khi còn tồn khác 0;
--     "chỉ hiện hàng còn tồn" (p_con_ton) = tổng SL > 0; bỏ lọc ấy thì thêm mã ĐANG BÁN hết tồn (SL 0).
--   · Tìm (p_tim) theo khoá `tim_kd` của mặt hàng (sku + tên + mã vạch, mig 177/205) — MỌI từ gõ phải có mặt, không dấu,
--     mỗi từ viết liền (như `viMatchAllWords` ở trình duyệt). Dòng chưa có `tim_kd` thì tính tại chỗ (`khoa_tim_ds`).
--   · Sắp (p_sap): 'ten' (A–Z tiếng Việt khi sổ có collation vi-x-icu), 'gia-tri' (giá trị cao trước), 'so-luong'
--     (tồn nhiều trước) — trùng thì theo tên rồi id, để các trang không lặp không sót.
--   · Mỗi dòng kèm total_count và sum_* (cửa sổ trên toàn tập đã lọc, tính TRƯỚC khi cắt trang). p_limit 1..500.
--   ⚠ SECURITY INVOKER — không viết lại luật quyền; NVBH chỉ thấy hàng công ty mình (RLS products / batches).
--   ⚠ Trình duyệt chưa gọi được RPC (sổ chưa chạy migration) thì màn lùi về cách cũ — xem stock-balance-table.tsx.
-- ====================================================================

DO $mk$
DECLARE
  v_col text := CASE WHEN EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'vi-x-icu') THEN ' COLLATE "vi-x-icu"' ELSE '' END;
BEGIN
  EXECUTE format($q$
CREATE OR REPLACE FUNCTION public.ton_kho_trang(
  p_tim text DEFAULT NULL,
  p_con_ton boolean DEFAULT true,
  p_sap text DEFAULT 'ten',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  product_id uuid,
  sku text,
  name text,
  base_unit text,
  status text,
  units jsonb,
  sale_qty numeric,
  sale_value numeric,
  date_qty numeric,
  date_value numeric,
  total_qty numeric,
  total_value numeric,
  total_count bigint,
  sum_sale_qty numeric,
  sum_sale_value numeric,
  sum_date_qty numeric,
  sum_date_value numeric,
  sum_total_qty numeric,
  sum_total_value numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  WITH tu AS (
    /* Từ gõ: bỏ dấu, hạ chữ thường, mỗi từ viết liền (như viQueryWords) — rỗng = khớp tất cả. */
    SELECT DISTINCT regexp_replace(t.w, '[^a-z0-9]+', '', 'g') AS w
    FROM regexp_split_to_table(public.khong_dau(coalesce(p_tim, '')), ' ') AS t(w)
  ),
  ton AS (
    SELECT v.product_id,
           coalesce(sum(v.qty_in_base_uom) FILTER (WHERE v.warehouse_zone = 'date'), 0) AS date_qty,
           coalesce(sum(v.value)           FILTER (WHERE v.warehouse_zone = 'date'), 0) AS date_value,
           coalesce(sum(v.qty_in_base_uom) FILTER (WHERE v.warehouse_zone IS DISTINCT FROM 'date'), 0) AS sale_qty,
           coalesce(sum(v.value)           FILTER (WHERE v.warehouse_zone IS DISTINCT FROM 'date'), 0) AS sale_value
    FROM public.v_stock_balance_by_zone v
    GROUP BY v.product_id
  ),
  sp AS (
    SELECT p.id, p.sku, p.name, p.base_unit, p.status,
           coalesce(t.sale_qty, 0) AS sale_qty, coalesce(t.sale_value, 0) AS sale_value,
           coalesce(t.date_qty, 0) AS date_qty, coalesce(t.date_value, 0) AS date_value
    FROM public.products p
    LEFT JOIN ton t ON t.product_id = p.id
    WHERE (coalesce(p.status, 'active') = 'active' OR coalesce(t.sale_qty, 0) <> 0 OR coalesce(t.date_qty, 0) <> 0)
      AND (NOT coalesce(p_con_ton, true) OR coalesce(t.sale_qty, 0) + coalesce(t.date_qty, 0) > 0)
      AND NOT EXISTS (
        SELECT 1 FROM tu
        WHERE tu.w <> ''
          AND coalesce(p.tim_kd, public.khoa_tim_ds(p.sku, p.name, p.barcode)) NOT LIKE '%%' || tu.w || '%%'
      )
  )
  SELECT s.id, s.sku, s.name, s.base_unit, s.status,
         (SELECT jsonb_agg(jsonb_build_object('unit_name', u.unit_name, 'conversion', u.conversion) ORDER BY u.conversion DESC)
            FROM public.product_units u WHERE u.product_id = s.id) AS units,
         s.sale_qty, s.sale_value, s.date_qty, s.date_value,
         s.sale_qty + s.date_qty AS total_qty,
         s.sale_value + s.date_value AS total_value,
         count(*) OVER () AS total_count,
         sum(s.sale_qty) OVER () AS sum_sale_qty,
         sum(s.sale_value) OVER () AS sum_sale_value,
         sum(s.date_qty) OVER () AS sum_date_qty,
         sum(s.date_value) OVER () AS sum_date_value,
         sum(s.sale_qty + s.date_qty) OVER () AS sum_total_qty,
         sum(s.sale_value + s.date_value) OVER () AS sum_total_value
  FROM sp s
  ORDER BY CASE WHEN p_sap = 'gia-tri' THEN s.sale_value + s.date_value
                WHEN p_sap = 'so-luong' THEN s.sale_qty + s.date_qty
                ELSE 0 END DESC,
           s.name%s, s.id
  OFFSET greatest(coalesce(p_offset, 0), 0)
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 500);
$fn$
$q$, v_col);
END
$mk$;

GRANT EXECUTE ON FUNCTION public.ton_kho_trang(text, boolean, text, integer, integer) TO authenticated;
COMMENT ON FUNCTION public.ton_kho_trang(text, boolean, text, integer, integer) IS
  'Tồn kho hiện tại theo mặt hàng (mig 255): gộp kho bán / kho date, lọc còn tồn, tìm theo tim_kd, sắp, phân trang; mỗi dòng kèm total_count + tổng cộng của cả tập đã lọc. RLS tự lọc (INVOKER).';

NOTIFY pgrst, 'reload schema';

SELECT 'RPC tồn kho phân trang (mig 255)' AS hang_muc,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'ton_kho_trang') AS so_ham,
       (SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'vi-x-icu') THEN 'vi-x-icu' ELSE 'mặc định' END) AS sap_ten;
