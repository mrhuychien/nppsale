-- ====================================================================
-- 098 — Giá trị tồn kho hiện 0đ dù kho còn hàng (sổ lỗi NPP-03)
--
-- CƠ CHẾ (đã đọc mã và dựng lại được)
--
-- View v_stock_balance_by_zone (mig 048:36-47) tính giá trị tồn như sau:
--
--     COALESCE(
--       (SELECT SUM(fl.qty_in_base_uom_remaining * fl.unit_cost)
--          FROM fifo_layers fl WHERE … AND fl.closed_at IS NULL),
--       SUM(n.qty_on_hand * COALESCE(n.unit_cost, 0))   -- lùi về giá lô
--     )
--
-- Ý đồ đúng: ưu tiên giá vốn FIFO, không có thì lùi về giá vốn theo lô.
-- Nhưng `COALESCE` chỉ lùi khi truy vấn con trả về NULL. `SUM` trên các
-- dòng có unit_cost = 0 trả về **0**, không phải NULL — và
-- `COALESCE(0, giá_lô)` cho ra **0**. Giá vốn theo lô vẫn đúng nhưng bị
-- ghi đè.
--
-- VÌ SAO unit_cost = 0 XẢY RA THƯỜNG XUYÊN, KHÔNG PHẢI CA HIẾM
-- fifo_layers chỉ được ghi ở một chỗ: nhánh nhận hàng chưa dùng về từ
-- tài xế (mig 047/051/057). Câu insert dùng `COALESCE(r.unit_cost, 0)`
-- (057:143), mà `r.unit_cost` lấy từ stock_entry_lines — nơi giá vốn chỉ
-- được đóng ở nhánh "Tự giao hàng" (xem
-- supabase/diagnostics/check_stock_not_deducted.sql, sổ lỗi NPP-01).
-- Nên đơn giao qua tài xế sinh ra lô có giá vốn 0, và từ đó mọi sản phẩm
-- ấy hiện giá trị tồn 0đ.
--
-- Hậu quả: thẻ KPI "Tổng giá trị tồn kho" ra 0đ trong khi các trang khác
-- (đọc thẳng batches.unit_cost) hiện số thật — đúng như sổ lỗi ghi "ba
-- chỗ trong cùng phân hệ Kho đưa ra ba giá trị tồn, thẻ KPI to nhất lại
-- là 0đ".
--
-- CÁCH SỬA
-- Đổi `COALESCE(x, y)` thành `COALESCE(NULLIF(x, 0), y)`.
-- Giá vốn FIFO bằng đúng 0 cho lượng hàng ĐANG CÒN nghĩa là "không có
-- thông tin giá", không phải "hàng không có giá trị" — nên phải lùi về
-- giá vốn theo lô, giống như khi không có lô FIFO nào.
--
-- Không sửa nhánh xuất kho ở đây: đó là NPP-01, cần chốt nghiệp vụ trước
-- (xem check_stock_not_deducted.sql). Migration này chỉ làm cho con số
-- hiển thị thôi hết sai — hàng tồn thật không đổi.
--
-- Phần còn lại của view giữ NGUYÊN VĂN mig 048.
-- ====================================================================

DROP VIEW IF EXISTS v_stock_balance_by_zone;

CREATE OR REPLACE VIEW v_stock_balance_by_zone AS
WITH normalized AS (
  SELECT
    b.org_id,
    b.product_id,
    COALESCE(b.warehouse_zone, 'sale') AS warehouse_zone,
    b.qty_on_hand,
    b.unit_cost
  FROM batches b
  WHERE b.qty_on_hand > 0
)
SELECT
  n.org_id,
  n.product_id,
  n.warehouse_zone,
  SUM(n.qty_on_hand)::numeric AS qty_in_base_uom,
  -- Prefer FIFO valuation; fallback to batch weighted-avg.
  -- [098] NULLIF(…, 0) là chỗ DUY NHẤT được sửa so với mig 048.
  --       Tổng FIFO bằng 0 (do lô nhận về từ tài xế có unit_cost = 0)
  --       trước đây ghi đè mất giá vốn theo lô, làm giá trị tồn hiện 0đ.
  COALESCE(
    NULLIF(
      (
        SELECT SUM(fl.qty_in_base_uom_remaining * fl.unit_cost)::numeric
        FROM fifo_layers fl
        WHERE fl.org_id = n.org_id
          AND fl.product_id = n.product_id
          AND fl.warehouse_zone = n.warehouse_zone
          AND fl.closed_at IS NULL
      ),
      0
    ),
    SUM(n.qty_on_hand * COALESCE(n.unit_cost, 0))::numeric
  ) AS value
FROM normalized n
GROUP BY n.org_id, n.product_id, n.warehouse_zone;

-- Mig 092 bật security_invoker cho view này để RLS vẫn áp dụng. DROP +
-- CREATE làm mất thuộc tính đó, nên phải đặt lại — bỏ quên là mở toàn bộ
-- số liệu tồn kho cho mọi vai trò mà không có lỗi nào báo ra.
ALTER VIEW v_stock_balance_by_zone SET (security_invoker = true);

COMMENT ON VIEW v_stock_balance_by_zone IS
  'T-09: per (product, warehouse_zone) qty + FIFO-valued cost. One row per '
  'zone (sale/date) per product with positive on-hand. Giá vốn FIFO bằng 0 '
  'được coi là KHÔNG CÓ THÔNG TIN và lùi về giá vốn theo lô (mig 098).';

GRANT SELECT ON v_stock_balance_by_zone TO authenticated;
