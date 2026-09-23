-- ====================================================================
-- DÒNG HÀNG KHÔNG ĐƯỢC CÓ ĐƠN VỊ RỖNG
--
-- Chủ nhà dò sổ thật 23/09/2026 (scripts/sql/do-dong-hoa-don-don-vi-rong.sql):
-- 42 dòng hóa đơn còn hiệu lực (17–22/09) có `unit_name = ''`, hệ số 1.
-- Cả 42 đều là hàng LẺ — đơn giá khớp giá lẻ, kho trừ đúng theo đơn vị cơ
-- sở — nên KHÔNG lệch kho, không lệch tiền. Nhưng hóa đơn in ra, hóa đơn
-- điện tử và báo cáo theo đơn vị đều hiện một ô trống, và chữ rỗng ấy
-- đến từ DÒNG ĐƠN HÀNG gốc: `sales_order_lines.unit_name` là NOT NULL,
-- nhưng NOT NULL không chặn chuỗi rỗng.
--
-- ⚠ HAI VIỆC:
--   1. Trigger trên `sales_order_lines`, `sales_invoice_lines`,
--      `return_lines`: đơn vị rỗng (hoặc toàn khoảng trắng) nghĩa là ĐƠN
--      VỊ CƠ SỞ — điền tên đơn vị cơ sở vào. Màn nào gửi rỗng lần sau thì
--      sổ vẫn ghi đúng tên.
--      Trừ khi hệ số KHÁC 1: rỗng mà hệ số 24 là không biết 24 cái gì —
--      từ chối, không đoán (`UNIT_MISSING`).
--   2. Điền lại tên đơn vị cơ sở cho các dòng cũ đơn vị rỗng, hệ số 1, ở
--      `sales_order_lines` và `sales_invoice_lines`. CHỈ đổi CHỮ: số lượng,
--      giá, hệ số, kho, công nợ giữ nguyên.
--
-- ⚠ KHÔNG ĐỤNG `return_lines` CŨ: sửa dòng phiếu trả là chạy lại trigger
--   tính `credit_note_amount` → công nợ khách. Bảng tóm tắt chỉ ĐẾM.
-- ⚠ KHÔNG ĐỤNG `stock_entry_lines`: sổ kho bị khoá ghi thẳng
--   (`trg_khoa_ghi_thang_dong_kho`), và cột tính kho là `qty_in_base_uom`.
--
-- ⚠ CHẠY CÂU DÒ scripts/sql/do-nguon-dong-don-don-vi-rong.sql TRƯỚC:
--   migration này điền lại các dòng rỗng, chạy sau thì câu dò không còn
--   gì để tìm màn gây lỗi.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._trg_don_vi_rong_la_co_so()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_base text;
  v_he_so numeric;
BEGIN
  IF btrim(COALESCE(NEW.unit_name, '')) <> '' THEN
    RETURN NEW;
  END IF;

  -- `return_lines` không có cột hệ số → coi là 1.
  v_he_so := COALESCE((to_jsonb(NEW)->>'conversion_factor')::numeric, 1);
  IF v_he_so <> 1 THEN
    RAISE EXCEPTION 'UNIT_MISSING: dòng hàng thiếu đơn vị tính mà hệ số quy đổi là % — chọn lại đơn vị rồi lưu.', v_he_so
      USING ERRCODE = 'P0001';
  END IF;

  SELECT p.base_unit INTO v_base FROM products p WHERE p.id = NEW.product_id;
  IF btrim(COALESCE(v_base, '')) = '' THEN
    RAISE EXCEPTION 'UNIT_MISSING: mặt hàng chưa có đơn vị cơ sở — điền đơn vị trong danh mục hàng rồi lưu lại.'
      USING ERRCODE = 'P0001';
  END IF;

  NEW.unit_name := v_base;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public._trg_don_vi_rong_la_co_so() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_don_vi_rong_la_co_so ON public.sales_order_lines;
CREATE TRIGGER trg_don_vi_rong_la_co_so
  BEFORE INSERT OR UPDATE OF unit_name, conversion_factor ON public.sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION public._trg_don_vi_rong_la_co_so();

DROP TRIGGER IF EXISTS trg_don_vi_rong_la_co_so ON public.sales_invoice_lines;
CREATE TRIGGER trg_don_vi_rong_la_co_so
  BEFORE INSERT OR UPDATE OF unit_name, conversion_factor ON public.sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public._trg_don_vi_rong_la_co_so();

DROP TRIGGER IF EXISTS trg_don_vi_rong_la_co_so ON public.return_lines;
CREATE TRIGGER trg_don_vi_rong_la_co_so
  BEFORE INSERT OR UPDATE OF unit_name ON public.return_lines
  FOR EACH ROW EXECUTE FUNCTION public._trg_don_vi_rong_la_co_so();

-- ---------------------------------------------------------------------
-- Điền lại dòng cũ — chỉ chữ đơn vị
-- ---------------------------------------------------------------------
DO $dien$
DECLARE
  v_hd int;
  v_don int;
BEGIN
  -- Đơn đã xuất hàng bị `guard_order_lines_locked` khoá sửa dòng; cờ này
  -- là lối các RPC dùng, chỉ sống trong giao dịch của khối này.
  PERFORM set_config('npp.via_rpc', 'on', true);

  UPDATE sales_invoice_lines sil
     SET unit_name = p.base_unit
    FROM products p
   WHERE p.id = sil.product_id
     AND btrim(sil.unit_name) = ''
     AND sil.conversion_factor = 1
     AND btrim(p.base_unit) <> '';
  GET DIAGNOSTICS v_hd = ROW_COUNT;

  UPDATE sales_order_lines sol
     SET unit_name = p.base_unit
    FROM products p
   WHERE p.id = sol.product_id
     AND btrim(sol.unit_name) = ''
     AND sol.conversion_factor = 1
     AND btrim(p.base_unit) <> '';
  GET DIAGNOSTICS v_don = ROW_COUNT;

  PERFORM set_config('npp.via_rpc', '', true);
  RAISE NOTICE '--- 175: điền đơn vị cơ sở cho % dòng hóa đơn, % dòng đơn hàng ---', v_hd, v_don;
END;
$dien$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — chỉ đọc. Mong đợi: ba dòng đầu 0.
-- ---------------------------------------------------------------------
SELECT 'Dòng hóa đơn còn đơn vị rỗng' AS hang_muc,
       count(*)::text AS so_dong
FROM sales_invoice_lines WHERE btrim(unit_name) = ''
UNION ALL
SELECT 'Dòng đơn hàng còn đơn vị rỗng', count(*)::text
FROM sales_order_lines WHERE btrim(unit_name) = ''
UNION ALL
SELECT 'Mặt hàng chưa có đơn vị cơ sở', count(*)::text
FROM products WHERE btrim(base_unit) = ''
UNION ALL
SELECT 'Dòng phiếu trả đơn vị rỗng (KHÔNG sửa — chỉ đếm)', count(*)::text
FROM return_lines WHERE btrim(unit_name) = '';
