-- ====================================================================
-- DÒNG ĐƠN HÀNG CÓ ĐƠN VỊ RỖNG: TỪ ĐÂU RA — CHỈ ĐỌC
--
-- Câu dò trước (do-dong-hoa-don-don-vi-rong.sql): 42 dòng hóa đơn đơn vị
-- rỗng đều là hàng LẺ (giá khớp giá lẻ, kho trừ đúng) — nhưng rỗng từ
-- DÒNG ĐƠN HÀNG gốc. Câu này tìm màn nào ghi ra chúng:
--   · tu_hang_doi      — đơn đẩy từ hàng đợi /sell (có client_request_id)
--   · nhat_ky          — nhật ký dòng: thêm lúc tạo (add_line) hay sửa sau
--                        (edit_line), ai làm, đơn vị ghi lúc đó
--   · dong_cung_don_co_dv — trong CÙNG đơn có bao nhiêu dòng KHÁC có đơn vị
--                        (rỗng cả đơn → lỗi cả màn; rỗng lẻ tẻ → lỗi theo mặt hàng)
--   · dv_co_so_hien_nay — đơn vị cơ sở của mặt hàng bây giờ
-- ====================================================================
SELECT
  so.order_code AS don, so.created_at::date AS ngay_tao,
  so.client_request_id IS NOT NULL AS tu_hang_doi,
  nv.full_name AS nv_ban,
  p.sku, p.base_unit AS dv_co_so_hien_nay,
  trim_scale(sol.quantity) AS sl, trim_scale(sol.unit_price) AS don_gia,
  (SELECT count(*) FROM sales_order_lines x
    WHERE x.order_id = so.id AND btrim(x.unit_name) <> '') AS dong_cung_don_co_dv,
  (SELECT count(*) FROM sales_order_lines x
    WHERE x.order_id = so.id AND btrim(x.unit_name) = '') AS dong_cung_don_rong,
  (SELECT string_agg(
       l.action || ' ' || to_char(l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI')
       || ' dv=' || coalesce(l.changes->>'unit_name', '∅')
       || ' bởi ' || coalesce(u.full_name, '?'),
       ' | ' ORDER BY l.created_at)
     FROM order_activity_log l LEFT JOIN users u ON u.id = l.actor_id
    WHERE l.order_line_id = sol.id) AS nhat_ky
FROM sales_order_lines sol
JOIN sales_orders so ON so.id = sol.order_id
JOIN products p ON p.id = sol.product_id
LEFT JOIN users nv ON nv.id = so.sales_user_id
WHERE btrim(sol.unit_name) = ''
ORDER BY so.created_at, so.order_code, p.sku;

