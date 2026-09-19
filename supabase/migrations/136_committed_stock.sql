-- =====================================================================
-- 136 — HÀNG ĐÃ ĐẶT NHƯNG CHƯA RỜI KHO
-- =====================================================================
--
-- VÌ SAO
--   Chủ nhà chốt hai việc:
--     1. "Thống kê hàng đặt, đổi trong đơn đã gửi (Phiếu tạm) để cạnh
--        tồn kho trong hiển thị mặt hàng"
--     2. "số lượng đặt hoặc đổi ko được lớn hơn tồn kho − hàng đã đặt
--        (hàng này chưa trừ kho nhưng đã đặt trong các đơn khác)"
--
--   Kho chỉ bị trừ ở `post_invoice` (lúc Xuất hàng). Từ lúc nhân viên
--   gửi Phiếu tạm tới lúc xuất, hàng vẫn nằm nguyên trong `batches` —
--   nên màn bán hàng đọc "Tồn 2.838" và BA nhân viên cùng bán hết 2.838
--   ấy trong cùng một buổi sáng. Không màn nào nói dối, chỉ là không màn
--   nào biết hai người kia đã hứa gì với khách.
--
-- ⚠ VÌ SAO PHẢI LÀ `SECURITY DEFINER`, DÙ MIG 093 CẤM ĐIỀU ĐÓ
--   RLS cho vai trò `sales` CHỈ thấy đơn của CHÍNH MÌNH
--   (002_rls_policies.sql:286-293 "Sales see own orders"). Cộng số đã
--   đặt bằng quyền người gọi thì mỗi nhân viên chỉ trừ được phần mình
--   đã hứa — tức là đúng cái lỗ hổng cần bịt vẫn còn nguyên, và tệ hơn
--   là màn hình trông như đã bịt.
--
--   Lệnh cấm ở mig 093 là về SỐ LIỆU TÀI CHÍNH (công nợ, doanh thu, lãi
--   lỗ). Hàm này trả về ĐÚNG hai cột: mã hàng và số lượng theo đơn vị cơ
--   sở. Không tiền, không khách, không mã đơn, không nhân viên. Đó cùng
--   một hạng thông tin với `batches.qty_on_hand` mà mọi vai trò đã nhìn
--   thấy trên màn bán hàng — chỉ là phần đã có người hứa trước.
--
-- ⚠ CHỈ ĐẾM ĐƠN ĐÃ GỬI. `draft` KHÔNG tính: nháp là giỏ hàng riêng của
--   một nhân viên, chưa hứa với ai. Đếm cả nháp là một cái nháp bỏ quên
--   từ tuần trước khoá luôn hàng của cả đơn vị, và người bị chặn không
--   có cách nào nhìn thấy cái nháp đó để mà xoá.
--
-- ⚠ `partially_invoiced` CÓ tính, nhưng chỉ phần CÒN LẠI
--   (`quantity − invoiced_qty`). Phần đã xuất đã trừ kho thật rồi; đếm
--   lại là trừ hai lần trên cùng một số hàng.
--
-- ⚠ HÀNG ĐỔI CŨNG RỜI KHO. Dòng `return_lines.is_exchange` của phiếu
--   trả kèm đơn đi theo đúng chuyến ấy — `get_invoiceable_lines`
--   (mig 125) đã coi chúng là hàng xuất. Không đếm ở đây thì phần đổi
--   biến mất khỏi phép trừ.
--
-- ⚠ ĐỔI ĐÃ XUẤT THÌ THÔI. `post_invoice` gắn `returns.invoice_id`; dấu
--   đó nghĩa là hàng đã đi. Thiếu điều kiện `invoice_id IS NULL` là trừ
--   hai lần đúng như trên.
--
-- ⚠ `return_lines` KHÔNG CÓ CỘT HỆ SỐ QUY ĐỔI (khác `sales_order_lines`).
--   Phải tra `product_units`, và cột ở bảng đó tên là `conversion`, KHÔNG
--   phải `conversion_factor` — gõ nhầm là 42703 lúc chạy. Cùng cái bẫy
--   mig 119 đã ghi lại.
--
-- ⚠ `p_exclude_order` LÀ BẮT BUỘC, KHÔNG PHẢI TIỆN ÍCH. Sửa một Phiếu
--   tạm mà không loại chính nó ra thì đơn tự chặn chính mình: 100 thùng
--   đã đặt của nó bị trừ khỏi tồn, rồi 100 thùng trong giỏ so với phần
--   còn lại → luôn vượt, không ai sửa nổi đơn của mình.

-- ---------------------------------------------------------------------
-- 1. Hàm cộng số đã đặt
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.committed_stock_by_product(uuid);

CREATE FUNCTION public.committed_stock_by_product(p_exclude_order uuid DEFAULT NULL)
RETURNS TABLE (product_id uuid, committed_base numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  v_org := public.user_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'NO_ORG: Tài khoản chưa được gắn đơn vị nên không đọc được số hàng đã đặt.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH live_orders AS (
    SELECT so.id
    FROM sales_orders so
    WHERE so.org_id = v_org
      AND so.status IN ('submitted', 'partially_invoiced')
      AND (p_exclude_order IS NULL OR so.id <> p_exclude_order)
  ),
  from_lines AS (
    SELECT sol.product_id AS pid,
           SUM(
             GREATEST(0, sol.quantity - COALESCE(sol.invoiced_qty, 0))
             * COALESCE(sol.conversion_factor, 1)
           ) AS qty
    FROM sales_order_lines sol
    JOIN live_orders lo ON lo.id = sol.order_id
    GROUP BY sol.product_id
  ),
  from_exchange AS (
    SELECT rl.product_id AS pid,
           SUM(rl.quantity * COALESCE(pu.conversion, 1)) AS qty
    FROM return_lines rl
    JOIN returns r ON r.id = rl.return_id
    JOIN live_orders lo ON lo.id = r.order_id
    LEFT JOIN product_units pu
           ON pu.product_id = rl.product_id
          AND pu.unit_name  = rl.unit_name
    WHERE rl.is_exchange = true
      AND r.invoice_id IS NULL
      AND r.status IN ('draft', 'submitted')
    GROUP BY rl.product_id
  )
  SELECT x.pid, SUM(x.qty)::numeric
  FROM (SELECT * FROM from_lines UNION ALL SELECT * FROM from_exchange) x
  GROUP BY x.pid
  HAVING SUM(x.qty) > 0;
END;
$$;

COMMENT ON FUNCTION public.committed_stock_by_product(uuid) IS
  'Số hàng (đơn vị cơ sở) đã hứa trong Phiếu tạm / đơn xuất một phần của đơn vị người gọi nhưng CHƯA trừ kho. Gồm cả dòng đổi hàng chưa xuất. p_exclude_order: bỏ qua đơn đang sửa.';

-- ⚠ SECURITY DEFINER thì phải khoá lại quyền gọi. Mặc định Postgres cấp
--   EXECUTE cho PUBLIC — để nguyên là ai chạm được database cũng gọi được.
REVOKE ALL ON FUNCTION public.committed_stock_by_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.committed_stock_by_product(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Chỉ mục cho phép cộng ở trên
-- ---------------------------------------------------------------------
-- Không có nó thì mỗi lần mở màn bán hàng là một lần quét toàn bảng đơn.
CREATE INDEX IF NOT EXISTS idx_sales_orders_org_status
  ON sales_orders (org_id, status);
CREATE INDEX IF NOT EXISTS idx_return_lines_exchange
  ON return_lines (product_id) WHERE is_exchange = true;

-- ---------------------------------------------------------------------
-- 3. Kiểm: nói ra con số ngay lúc chạy migration
-- ---------------------------------------------------------------------
DO $check$
DECLARE
  v_orders int;
  v_lines  int;
  v_ex     int;
BEGIN
  SELECT count(*) INTO v_orders
  FROM sales_orders WHERE status IN ('submitted', 'partially_invoiced');

  SELECT count(*) INTO v_lines
  FROM sales_order_lines sol
  JOIN sales_orders so ON so.id = sol.order_id
  WHERE so.status IN ('submitted', 'partially_invoiced')
    AND GREATEST(0, sol.quantity - COALESCE(sol.invoiced_qty, 0)) > 0;

  SELECT count(*) INTO v_ex
  FROM return_lines rl
  JOIN returns r ON r.id = rl.return_id
  JOIN sales_orders so ON so.id = r.order_id
  WHERE rl.is_exchange = true
    AND r.invoice_id IS NULL
    AND r.status IN ('draft', 'submitted')
    AND so.status IN ('submitted', 'partially_invoiced');

  RAISE NOTICE '--- 136: % đơn đang giữ hàng, % dòng bán còn lại, % dòng đổi chưa xuất ---',
    v_orders, v_lines, v_ex;
END;
$check$;

NOTIFY pgrst, 'reload schema';
