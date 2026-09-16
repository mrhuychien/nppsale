-- ====================================================================
-- 112 — Bù "ai tạo" và "ai phụ trách" cho điểm bán cũ
-- ====================================================================
--
-- HAI LỖ HỔNG ĐÃ TẠO RA DỮ LIỆU TRỐNG
--
--   1. Màn NHẬP KHÁCH HÀNG LOẠT không đóng dấu `created_by`. Mà đó lại là
--      đường vào của phần lớn dữ liệu — nên gần như mọi điểm bán nhập từ
--      Excel đều "không rõ ai tạo". (Đã sửa ở mã nguồn.)
--   2. Màn TẠO TỪNG KHÁCH có đóng dấu `created_by` nhưng không tạo dòng
--      phân công. (Đã sửa ở mã nguồn.)
--
-- Migration này bù lại cho dữ liệu ĐÃ CÓ, theo hai chiều.
--
-- ⚠ NÓ KHÔNG BÙ ĐƯỢC HẾT, VÀ CỐ Ý KHÔNG ĐOÁN.
--
--   Điểm bán vừa không có `created_by` vừa không có ai phụ trách thì
--   trong cơ sở dữ liệu KHÔNG còn dấu vết nào để lần ra người tạo. Gán
--   bừa cho chủ NPP hay cho NVBH gần nhất là dựng ra một sự thật chưa
--   từng có. Phần NOTICE ở cuối đếm đúng số điểm bán như vậy để biết còn
--   bao nhiêu phải phân công tay.
-- ====================================================================

DO $$
DECLARE
  v_n1 int;
  v_n2 int;
  v_con int;
BEGIN
  -- ------------------------------------------------------------------
  -- Chiều 1: có người phụ trách → suy ra người tạo
  -- ------------------------------------------------------------------
  -- Cùng phép bù mig 032 đã làm, chạy lại cho những dòng thêm vào SAU
  -- lần đó. Lấy người phụ trách ĐẦU TIÊN theo ngày phân công.
  --
  -- ⚠ Chỉ điền vào ô đang TRỐNG. Đè lên `created_by` đang có giá trị là
  -- xoá mất một sự thật để thay bằng một phép suy đoán.
  WITH first_assignment AS (
    SELECT DISTINCT ON (customer_id) customer_id, user_id
    FROM customer_assignments
    WHERE status = 'active'
    ORDER BY customer_id, assigned_at NULLS LAST, id
  )
  UPDATE customers c
  SET created_by = fa.user_id
  FROM first_assignment fa
  WHERE c.id = fa.customer_id
    AND c.created_by IS NULL;
  GET DIAGNOSTICS v_n1 = ROW_COUNT;
  RAISE NOTICE 'Bù người tạo từ người phụ trách: % điểm bán', v_n1;

  -- ------------------------------------------------------------------
  -- Chiều 2: có người tạo là NVBH → phân công cho họ
  -- ------------------------------------------------------------------
  -- ⚠ CHỈ khi người tạo là vai trò `sales`, và ĐÚNG như quy tắc ở màn tạo
  -- mới (src/lib/customers/assign-creator.ts). Chủ NPP nhập liệu hành
  -- chính không phải là người đi tuyến — gán họ ghế 'primary' thì NVBH
  -- thật về sau chỉ còn ghế phụ.
  --
  -- ⚠ Và chỉ khi điểm bán CHƯA có ai phụ trách. Chen thêm một người vào
  -- điểm bán đã có chủ là đổi lại phân công mà không ai yêu cầu.
  INSERT INTO customer_assignments (customer_id, user_id, role, status, assigned_at)
  SELECT c.id, c.created_by, 'primary', 'active', COALESCE(c.created_at::date, CURRENT_DATE)
  FROM customers c
  JOIN users u ON u.id = c.created_by
  WHERE c.created_by IS NOT NULL
    AND u.role = 'sales'
    AND COALESCE(u.is_active, true)
    AND NOT EXISTS (
      SELECT 1 FROM customer_assignments a
      WHERE a.customer_id = c.id AND a.status = 'active'
    )
  -- Ràng buộc UNIQUE(customer_id, user_id) đã có; câu này chỉ để một dòng
  -- 'inactive' cũ không làm cả lệnh đổ.
  ON CONFLICT (customer_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_n2 = ROW_COUNT;
  RAISE NOTICE 'Phân công cho NVBH đã tạo điểm bán: % điểm bán', v_n2;

  -- ------------------------------------------------------------------
  -- Còn lại bao nhiêu
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_con
  FROM customers c
  WHERE NOT EXISTS (
    SELECT 1 FROM customer_assignments a
    WHERE a.customer_id = c.id AND a.status = 'active'
  );
  RAISE NOTICE '--- CÒN % điểm bán chưa có ai phụ trách — phải phân công tay ---', v_con;

  SELECT count(*) INTO v_con FROM customers WHERE created_by IS NULL;
  RAISE NOTICE '--- CÒN % điểm bán không rõ ai tạo (không còn dấu vết để lần ra) ---', v_con;
END $$;
