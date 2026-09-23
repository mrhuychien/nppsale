-- ====================================================================
-- XUẤT HÓA ĐƠN: MÁY CHỦ TỰ TRA HỆ SỐ QUY ĐỔI, KHÔNG TIN TRÌNH DUYỆT
--
-- Chủ nhà chốt 23/09/2026: "làm B".
--
-- ⚠ LỖI GỐC: `post_invoice` lấy `conversion_factor` của từng dòng Y NGUYÊN
--   từ tải trọng — cả `_wf2_export_order` (trừ kho `quantity × hệ số`) lẫn
--   `sales_invoice_lines.conversion_factor`. Màn POS "Sửa hóa đơn" từng
--   gửi 1 cho mọi dòng nạp lại: lập lại một dòng "2 thùng" (×24) là kho
--   chỉ trừ 2 hộp, tiền vẫn tính theo thùng. Màn đã sửa; migration này để
--   một màn gửi sai lần sau KHÔNG còn làm sai kho được nữa.
--   (Đã dò trên sổ thật: 0 hóa đơn bị ảnh hưởng — scripts/sql/do-hoa-don-lap-lai-sai-he-so.sql.)
--
-- ⚠ LUẬT TRA, THEO THỨ TỰ:
--     1. đơn vị = đơn vị cơ sở của mặt hàng        → 1
--     2. đơn vị có trong `product_units`            → hệ số ở đó
--     3. không tra được (đơn vị đã bị gỡ khỏi danh mục) → giữ số gửi lên
--   Nhánh 3 cố ý không chặn: chặn là hóa đơn của một đơn cũ không xuất
--   được chỉ vì danh mục đổi — và bảng tóm tắt bên dưới đếm ca ấy.
--
-- ⚠ VÁ CHUỖI BẢN ĐANG CHẠY, KHÔNG CHÉP LẠI THÂN HÀM — `post_invoice` đã
--   bị mig 128, 131, 152 vá; chép lại từ tệp 125 là xoá mất các miếng ấy
--   (bài học của mig 149). Chèn MỘT dòng chuẩn hoá ngay sau chỗ đọc
--   `v_lines`, nên cả phiếu xuất lẫn dòng hóa đơn đều đọc số đã tra.
--   `reissue_invoice` gọi `post_invoice`, nên được vá theo.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._chuan_he_so_dong_hoa_don(p_lines jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN jsonb_typeof(ord.l) = 'object' AND NULLIF(ord.l->>'product_id', '') IS NOT NULL THEN
        ord.l || jsonb_build_object('conversion_factor',
          CASE
            WHEN ord.l->>'unit_name' = p.base_unit THEN 1::numeric
            WHEN pu.conversion IS NOT NULL THEN pu.conversion::numeric
            ELSE COALESCE((ord.l->>'conversion_factor')::numeric, 1)
          END)
      ELSE ord.l
    END ORDER BY ord.i), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS ord(l, i)
  LEFT JOIN products p       ON p.id = NULLIF(ord.l->>'product_id', '')::uuid
  LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.unit_name = ord.l->>'unit_name'
$$;

-- Hàm nội bộ: chỉ `post_invoice` (chủ sở hữu) gọi.
REVOKE ALL ON FUNCTION public._chuan_he_so_dong_hoa_don(jsonb) FROM PUBLIC, anon, authenticated;

DO $vá$
DECLARE
  v_oid  oid;
  v_n    int;
  v_src  text;
  v_neo  text := 'v_lines := COALESCE(p->''lines'', ''[]''::jsonb);';
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'post_invoice' AND pr.prokind = 'f';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '174: tìm thấy % bản post_invoice, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;

  SELECT pr.oid INTO v_oid
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'post_invoice' AND pr.prokind = 'f';
  v_src := pg_get_functiondef(v_oid);

  IF position('_chuan_he_so_dong_hoa_don' IN v_src) > 0 THEN
    RAISE NOTICE '--- 174: post_invoice đã tự tra hệ số, bỏ qua ---';
    RETURN;
  END IF;

  IF (length(v_src) - length(replace(v_src, v_neo, ''))) / length(v_neo) <> 1 THEN
    RAISE EXCEPTION '174: không thấy đúng MỘT câu `%` trong post_invoice', v_neo USING ERRCODE = 'P0001';
  END IF;

  v_src := replace(v_src, v_neo, v_neo || E'\n  -- (mig 174) Hệ số quy đổi do máy chủ tra, không tin tải trọng.'
                                       || E'\n  v_lines := public._chuan_he_so_dong_hoa_don(v_lines);');
  EXECUTE v_src;
END;
$vá$;

DO $kiem$
DECLARE v_src text; v_def boolean;
BEGIN
  SELECT pg_get_functiondef(pr.oid), pr.prosecdef INTO v_src, v_def
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'post_invoice';
  IF position('_chuan_he_so_dong_hoa_don' IN v_src) = 0 THEN
    RAISE EXCEPTION '174: post_invoice chưa tự tra hệ số' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_def THEN
    RAISE EXCEPTION '174: post_invoice mất SECURITY DEFINER' USING ERRCODE = 'P0001';
  END IF;
  -- Các miếng vá cũ phải còn nguyên.
  IF position('_apply_return_adds' IN v_src) = 0 OR position('reissue_of' IN v_src) = 0
     OR position('UPDATE returns ret' IN v_src) = 0 THEN
    RAISE EXCEPTION '174: post_invoice mất miếng vá của mig 128 / 131 / 152' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 174: xuất hóa đơn nay tự tra hệ số quy đổi ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — chỉ đọc
-- ---------------------------------------------------------------------
SELECT 'Dòng hóa đơn còn hiệu lực có hệ số KHÁC danh mục' AS hang_muc,
       count(*)::text AS so_dong
FROM sales_invoice_lines sil
JOIN sales_invoices si ON si.id = sil.invoice_id AND si.status = 'posted'
JOIN products p ON p.id = sil.product_id
LEFT JOIN product_units pu ON pu.product_id = sil.product_id AND pu.unit_name = sil.unit_name
WHERE sil.conversion_factor <> CASE WHEN sil.unit_name = p.base_unit THEN 1 ELSE pu.conversion END
UNION ALL
SELECT 'Dòng hóa đơn có đơn vị KHÔNG còn trong danh mục (nhánh 3: giữ số gửi lên)',
       count(*)::text
FROM sales_invoice_lines sil
JOIN sales_invoices si ON si.id = sil.invoice_id AND si.status = 'posted'
JOIN products p ON p.id = sil.product_id
LEFT JOIN product_units pu ON pu.product_id = sil.product_id AND pu.unit_name = sil.unit_name
WHERE sil.unit_name <> p.base_unit AND pu.product_id IS NULL;
