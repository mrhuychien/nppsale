-- ====================================================================
-- 137_committed_stock_stable_order
--
-- VÌ SAO CÓ BẢN VÁ NÀY
--
-- `committed_stock_by_product` (mig 136) trả về danh sách "hàng đã đặt
-- nhưng chưa rời kho", và trình duyệt đọc nó QUA NHIỀU TRANG:
-- `fetchAllForAggregate` gọi `.range(from, to)` nhiều lần, SONG SONG.
--
-- Hàm ở 136 kết thúc bằng `GROUP BY ... HAVING ...` và KHÔNG có `ORDER
-- BY`. Không có thứ tự cố định thì Postgres được quyền trả mỗi lần gọi
-- một thứ tự khác nhau — nên `OFFSET/LIMIT` chồng lên nó vừa LẶP dòng
-- vừa BỎ SÓT dòng.
--
-- ⚠ BỎ SÓT MỘT SẢN PHẨM NGHĨA LÀ SỐ "ĐÃ ĐẶT" CỦA NÓ VỀ 0, và màn bán
--   hàng lấy `tồn − 0 = tồn` làm mức cho phép đặt. Đó đúng là chuyện chủ
--   nhà báo: "vẫn cho nhân viên đặt hàng quá số lượng có thể đặt (tồn
--   kho − hàng đã đặt)". Lỗi chỉ lộ ra khi số mặt hàng đang có người đặt
--   vượt một trang (1.000 dòng) — tức là đúng lúc kho đã bận rộn.
--
-- ⚠ KHÔNG SỬA THẲNG VÀO FILE 136. Không biết chắc 136 đã chạy trên máy
--   chủ hay chưa; sửa tại chỗ thì máy đã chạy rồi sẽ không nhận được
--   thay đổi này. Một bản vá mới thì chạy được ở cả hai trường hợp.
--
-- KHÔNG ĐỔI GÌ KHÁC: cùng chữ ký, cùng phép tính, cùng quyền. Chỉ thêm
-- `ORDER BY` để việc chia trang có mốc ổn định.
-- ====================================================================

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
  HAVING SUM(x.qty) > 0
  -- ⚠ DÒNG DUY NHẤT THÊM SO VỚI 136 — xem phần đầu file. `pid` là khoá
  --   chính của `products` nên luôn duy nhất: mốc chia trang ổn định.
  ORDER BY x.pid;
END;
$$;

COMMENT ON FUNCTION public.committed_stock_by_product(uuid) IS
  'Số hàng (đơn vị cơ sở) đã hứa trong Phiếu tạm / đơn xuất một phần của đơn vị người gọi nhưng CHƯA trừ kho. Gồm cả dòng đổi hàng chưa xuất. p_exclude_order: bỏ qua đơn đang sửa. ORDER BY product_id để trình duyệt chia trang không lặp/sót dòng (mig 137).';

-- ⚠ SECURITY DEFINER thì phải khoá lại quyền gọi. `DROP` ở trên xoá luôn
--   mọi GRANT cũ, nên phải cấp lại — thiếu khối này là cả màn bán hàng
--   mất số "đã đặt" và quay về đúng lỗ hổng bản vá này đang bịt.
REVOKE ALL ON FUNCTION public.committed_stock_by_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.committed_stock_by_product(uuid) TO authenticated;

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'committed_stock_by_product';
  RAISE NOTICE '137: committed_stock_by_product — % hàm đang tồn tại, đã gắn ORDER BY product_id.', v_n;
END $$;

NOTIFY pgrst, 'reload schema';
