-- ====================================================================
-- MẶT HÀNG KHÔNG ĐƯỢC CÓ ĐƠN VỊ CƠ SỞ RỖNG
--
-- Nối tiếp mig 175. Nhật ký đơn (`order_activity_log`) trên sổ thật cho
-- thấy mọi dòng đơn đơn vị rỗng được TẠO trong ngày 17/09/2026, bởi bốn
-- người khác nhau; các lần sửa đơn sau đó (18/09) chỉ chép lại dòng cũ.
-- Mã màn bán hàng lúc ấy lấy đơn vị mặc định = `products.base_unit`, nên
-- dòng rỗng nghĩa là mặt hàng lúc đó có `base_unit = ''`. `NOT NULL` không
-- chặn chuỗi rỗng; form sản phẩm có chặn, nhưng các lối ghi khác thì không.
--
-- ⚠ Mig 175 đã đếm: 0 mặt hàng có đơn vị cơ sở rỗng — ràng buộc thêm vào
--   là hợp lệ ngay. Nếu vì lý do gì còn dòng rỗng, thêm `NOT VALID` để
--   chặn từ nay mà không làm hỏng migration; bảng tóm tắt đếm chúng.
-- ====================================================================

DO $rb$
DECLARE v_rong int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'products_base_unit_khong_rong'
                AND conrelid = 'public.products'::regclass) THEN
    RAISE NOTICE '--- 176: ràng buộc đã có, bỏ qua ---';
    RETURN;
  END IF;

  SELECT count(*) INTO v_rong FROM products WHERE btrim(base_unit) = '';
  IF v_rong = 0 THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_base_unit_khong_rong CHECK (btrim(base_unit) <> '');
  ELSE
    ALTER TABLE public.products
      ADD CONSTRAINT products_base_unit_khong_rong CHECK (btrim(base_unit) <> '') NOT VALID;
  END IF;
  RAISE NOTICE '--- 176: mặt hàng nay bắt buộc có đơn vị cơ sở (% dòng cũ còn rỗng) ---', v_rong;
END;
$rb$;

NOTIFY pgrst, 'reload schema';

SELECT 'Mặt hàng có đơn vị cơ sở rỗng (mong đợi 0)' AS hang_muc,
       count(*)::text AS so_dong
FROM products WHERE btrim(base_unit) = ''
UNION ALL
SELECT 'Ràng buộc products_base_unit_khong_rong',
       CASE WHEN convalidated THEN 'có, đã kiểm cả dòng cũ' ELSE 'có, chỉ chặn từ nay (NOT VALID)' END
FROM pg_constraint WHERE conname = 'products_base_unit_khong_rong';
