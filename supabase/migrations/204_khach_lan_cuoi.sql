-- ====================================================================
-- ĐƠN GẦN NHẤT + LẦN GHÉ GẦN NHẤT CỦA MỘT TRANG KHÁCH — MỘT LƯỢT
--
-- VÌ SAO — chủ nhà 27/09/2026: "kiểm tra sao danh sách khách hàng load lâu vậy?".
--   Danh sách 20 khách hiện nhanh, nhưng hai cột "Đơn gần nhất" / "Lần ghé gần nhất" đọc
--   bằng một trang 1.000 dòng đơn (và 1.000 dòng ghé thăm) của cả 20 khách; khách mua đều là
--   vượt 1.000 dòng, màn phải hỏi bù TỪNG khách một — hơn 40 lượt đi mạng, các ô treo "…".
--   Hàm này trả đúng MỘT dòng mỗi khách (LATERAL … LIMIT 1 trên chỉ mục khách + ngày).
--
-- SECURITY INVOKER: chạy bằng quyền người gọi — RLS của sales_orders / visit_logs vẫn áp
--   (NVBH chỉ thấy đơn / lần ghé mình được thấy), như câu đọc cũ.
-- ====================================================================

CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_date
  ON public.sales_orders (customer_id, order_date DESC, id DESC);

CREATE OR REPLACE FUNCTION public.khach_lan_cuoi(p_ids uuid[])
RETURNS TABLE (
  customer_id uuid,
  order_code text,
  order_date date,
  order_total numeric,
  visit_date date,
  check_in_at timestamptz,
  visit_result text,
  visit_user_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  SELECT k.id,
         o.order_code, o.order_date, o.total,
         v.visit_date, v.check_in_at, v.result, u.full_name
    FROM unnest(p_ids) AS k(id)
    LEFT JOIN LATERAL (
      SELECT so.order_code, so.order_date, so.total
        FROM public.sales_orders so
       WHERE so.customer_id = k.id
       ORDER BY so.order_date DESC, so.id DESC
       LIMIT 1
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT vl.visit_date, vl.check_in_at, vl.result, vl.sales_user_id
        FROM public.visit_logs vl
       WHERE vl.customer_id = k.id
       ORDER BY vl.visit_date DESC, vl.check_in_at DESC, vl.id DESC
       LIMIT 1
    ) v ON true
    LEFT JOIN public.users u ON u.id = v.sales_user_id
$fn$;

REVOKE EXECUTE ON FUNCTION public.khach_lan_cuoi(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.khach_lan_cuoi(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'khach_lan_cuoi' AS ham,
       to_regprocedure('public.khach_lan_cuoi(uuid[])') IS NOT NULL AS da_co,
       (SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_sales_orders_customer_date') AS chi_muc;
