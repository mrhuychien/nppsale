-- ====================================================================
-- 247 — SỬA HOÁ ĐƠN GIỮ HỆ SỐ QUY ĐỔI CỦA TỜ CŨ
--
-- VÌ SAO — chủ nhà 16/10/2026: "sửa nốt … đổi hệ số quy đổi trong danh mục (vd thùng 24 → 20) rồi Sửa một hoá đơn cũ,
--   thì tờ mới lấy hệ số mới chứ không giữ số cũ".
--
-- ⚠ GỐC: mig 174 cho `post_invoice` TỰ TRA hệ số theo danh mục (`_chuan_he_so_dong_hoa_don`, không tin số trình duyệt
--   gửi) — đúng cho hoá đơn MỚI. Nhưng `reissue_invoice` (Sửa HĐ) cũng đi qua `post_invoice`, nên tờ sửa lấy hệ số
--   danh mục LÚC SỬA: "2 thùng" của tờ cũ (48 lon) thành 2 × 20 = 40 lon. Hệ quả: huỷ tờ cũ trả 48 lon về kho, tờ mới
--   chỉ xuất 40 — kho dôi 8 lon; số đã xuất của dòng đơn thành 40 / 24 = 1,67 thùng; số lượng đơn vị cơ sở ở báo cáo /
--   hàng khách đã lấy sai theo. Màn POS vẫn nạp đúng hệ số chụp của dòng (`donViNapLai`) — chỉ máy chủ đè.
--
-- ⚠ LUẬT MỚI (vẫn KHÔNG tin số trình duyệt gửi):
--     Sửa HĐ: dòng CÙNG mặt hàng + CÙNG đơn vị với một dòng của tờ cũ → hệ số CHỤP trên tờ cũ.
--             Đơn vị khác / mặt hàng mới → tra danh mục như mig 174.
--     Hoá đơn mới (không qua Sửa HĐ) → giữ nguyên luật mig 174.
--   Đơn vị cơ sở luôn là 1 (như cũ).
--
-- ⚠ TỜ CŨ ĐI QUA CỜ PHIÊN `npp.he_so_tu_hd` DO CHÍNH `reissue_invoice` ĐẶT (rồi gỡ ngay sau khi gọi `post_invoice`) —
--   KHÔNG đọc `reissue_of` trong tải trọng: `post_invoice` gọi thẳng được từ trình duyệt, còn cờ phiên thì không.
-- ⚠ VÁ CHUỖI BẢN ĐANG CHẠY (như mig 174 / 227), không chép lại thân hàm: mỗi chỗ vá phải thấy đúng 1 lần, không thì dừng.
-- ====================================================================

-- 1) Chuẩn hoá hệ số có tờ cũ ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._chuan_he_so_dong_hoa_don(p_lines jsonb, p_hd_cu uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN jsonb_typeof(ord.l) = 'object' AND NULLIF(ord.l->>'product_id', '') IS NOT NULL THEN
        ord.l || jsonb_build_object('conversion_factor',
          CASE
            WHEN ord.l->>'unit_name' = p.base_unit THEN 1::numeric
            WHEN cu.he_so IS NOT NULL THEN cu.he_so
            WHEN pu.conversion IS NOT NULL THEN pu.conversion::numeric
            ELSE COALESCE((ord.l->>'conversion_factor')::numeric, 1)
          END)
      ELSE ord.l
    END ORDER BY ord.i), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS ord(l, i)
  LEFT JOIN products p       ON p.id = NULLIF(ord.l->>'product_id', '')::uuid
  LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.unit_name = ord.l->>'unit_name'
  -- Hệ số CHỤP trên tờ cũ cho đúng mặt hàng + đơn vị (Sửa HĐ). Tờ thường không có `p_hd_cu` → NULL.
  LEFT JOIN LATERAL (
    SELECT max(sil.conversion_factor) AS he_so
      FROM sales_invoice_lines sil
     WHERE p_hd_cu IS NOT NULL
       AND sil.invoice_id = p_hd_cu
       AND sil.product_id = p.id
       AND sil.unit_name = ord.l->>'unit_name'
       AND sil.conversion_factor > 0
  ) cu ON true
$fn$;
-- Hàm nội bộ: chỉ `post_invoice` (chủ sở hữu) gọi.
REVOKE ALL ON FUNCTION public._chuan_he_so_dong_hoa_don(jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- 2) post_invoice: chuẩn hoá có tờ cũ (đọc cờ phiên) ---------------------------------------------------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure);
  v_a   text := 'v_lines := public._chuan_he_so_dong_hoa_don(v_lines);';
  v_b   text := 'v_lines := public._chuan_he_so_dong_hoa_don(v_lines, NULLIF(current_setting(''npp.he_so_tu_hd'', true), '''')::uuid);'
              || ' -- (mig 247) Sửa HĐ: giữ hệ số chụp trên tờ cũ';
  v_n   int;
BEGIN
  IF position('(mig 247)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 247: post_invoice đã đọc hệ số tờ cũ, bỏ qua ---';
    RETURN;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, v_a, ''))) / length(v_a);
  IF v_n <> 1 THEN
    RAISE EXCEPTION '247: post_invoice thấy % chỗ cần vá, cần đúng 1 (chạy mig 174 trước)', v_n USING ERRCODE = 'P0001';
  END IF;
  EXECUTE replace(v_src, v_a, v_b);
END;
$p$;

-- 3) reissue_invoice: đặt cờ phiên = tờ cũ quanh lời gọi post_invoice ---------------------------------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure);
  v_a   text := '  SELECT * INTO v_new FROM public.post_invoice(v_payload);';
  v_b   text := '  -- (mig 247) Dòng cùng mặt hàng + đơn vị với tờ cũ giữ hệ số CHỤP trên tờ cũ (danh mục có thể đã đổi).' || chr(10)
              || '  PERFORM set_config(''npp.he_so_tu_hd'', p_invoice_id::text, true);' || chr(10)
              || '  SELECT * INTO v_new FROM public.post_invoice(v_payload);' || chr(10)
              || '  PERFORM set_config(''npp.he_so_tu_hd'', '''', true);';
  v_n   int;
BEGIN
  IF position('(mig 247)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 247: reissue_invoice đã đặt cờ hệ số tờ cũ, bỏ qua ---';
    RETURN;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, v_a, ''))) / length(v_a);
  IF v_n <> 1 THEN
    RAISE EXCEPTION '247: reissue_invoice thấy % chỗ cần vá, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  EXECUTE replace(v_src, v_a, v_b);
END;
$p$;

NOTIFY pgrst, 'reload schema';

-- Tóm tắt: hai chỗ vá + số dòng của các tờ ĐÃ sửa trước đây mà hệ số khác tờ cũ cùng mặt hàng + đơn vị (bị lỗi cũ —
-- chỉ đếm để biết, không tự sửa: đổi hệ số một tờ đã ghi sổ là phải làm lại cả phiếu kho).
SELECT
  position('(mig 247)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) > 0 AS post_invoice_doc_to_cu,
  position('(mig 247)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0 AS reissue_dat_co,
  (SELECT count(*)
     FROM sales_invoices sn
     JOIN sales_invoice_lines ln ON ln.invoice_id = sn.id
     JOIN sales_invoice_lines lo ON lo.invoice_id = sn.replaced_from
                                AND lo.product_id = ln.product_id AND lo.unit_name = ln.unit_name
    WHERE sn.replaced_from IS NOT NULL AND lo.conversion_factor > 0
      AND ln.conversion_factor <> lo.conversion_factor) AS dong_sua_hd_lech_he_so_truoc_day;
