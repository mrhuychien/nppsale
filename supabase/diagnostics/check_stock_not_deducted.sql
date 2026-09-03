-- ====================================================================
-- ĐO MỨC LỆCH TỒN KHO — đơn đã giao mà chưa trừ tồn (sổ lỗi NPP-01)
--
-- CHỈ ĐỌC. Không sửa một dòng dữ liệu nào. Dán cả file vào
-- Supabase → SQL Editor → Run.
--
-- ------------------------------------------------------------------
-- VẤN ĐỀ ĐANG ĐO
-- ------------------------------------------------------------------
-- Trong mã nguồn hiện tại, tồn kho chỉ bị trừ ở ĐÚNG MỘT chỗ: nút
-- "Tự giao hàng" ở trang chi tiết phiếu xuất
-- (src/app/(dashboard)/inventory/entries/[id]/page.tsx:246-285 — trừ
-- batches theo FEFO rồi đóng giá vốn lên stock_entry_lines.unit_cost).
--
-- Vòng đời đơn có nhánh thứ hai KHÔNG đi qua chỗ đó:
--
--   Xuất kho          → tạo phiếu xuất nháp        (không trừ tồn)
--   Bàn giao tài xế   → deliveries/[id]/handover   (không trừ tồn)
--   Thu tiền          → đơn chuyển 'delivered'     (không trừ tồn)
--
-- Đã rà toàn bộ mã: `grep -rn "qty_on_hand:" src/` cho thấy mọi chỗ
-- ghi khác đều là NHẬP kho, nhập lại hàng trả, kiểm kê hoặc sửa tay.
-- Không có RPC/trigger nào trong 97 migration trừ tồn khi xuất.
--
-- Hậu quả: đơn giao qua tài xế đạt trạng thái "đã giao" nhưng tồn kho
-- giữ nguyên. Kéo theo:
--   • tồn kho hiển thị CAO HƠN thực tế
--   • giá vốn không được ghi → báo cáo lãi lỗ ra biên 100% (NPP-06)
--   • các con số tồn ở những trang khác nhau lệch nhau (NPP-03)
--   • cảnh báo "cần nhập hàng" tính trên tồn sai (NPP-14)
--
-- ------------------------------------------------------------------
-- VÌ SAO CHƯA SỬA TRONG MÃ
-- ------------------------------------------------------------------
-- Nối thêm một điểm trừ tồn là quyết định NGHIỆP VỤ, không phải kỹ
-- thuật: trừ lúc bàn giao cho tài xế, lúc tài xế xác nhận giao xong,
-- hay lúc đăng phiếu xuất? Chọn sai chỗ thì trừ HAI LẦN — và trừ hai
-- lần phá dữ liệu, trong khi lỗi hiện tại chỉ làm tồn cao hơn thật
-- (còn cứu được bằng kiểm kê). Cần chốt nghiệp vụ trước khi sửa mã.
--
-- Logic FEFO đã có sẵn và đang chạy đúng ở nhánh "Tự giao hàng" — sửa
-- là dùng lại nó, không phải viết mới.
--
-- ------------------------------------------------------------------
-- ĐỌC KẾT QUẢ
-- ------------------------------------------------------------------
-- Truy vấn 1 — quy mô: bao nhiêu phiếu xuất chưa trừ tồn, trị giá bao
--   nhiêu. Không có dòng nào = không có phiếu nào bị bỏ sót.
-- Truy vấn 2 — danh sách phiếu cụ thể để đối chiếu tay.
-- Truy vấn 3 — lệch tồn theo từng sản phẩm: cột `tồn_lẽ_ra` là con số
--   tồn đúng nếu tất cả phiếu bị bỏ sót đều đã trừ.
--
-- Dấu hiệu nhận biết một phiếu CHƯA được trừ tồn: mọi dòng của nó có
-- unit_cost = 0 hoặc NULL. Nhánh "Tự giao hàng" luôn đóng unit_cost > 0
-- khi trừ (miễn là lô có giá nhập). Đây là dấu hiệu GIÁN TIẾP nên
-- truy vấn 2 in kèm ngày để đối chiếu — lô nhập giá 0 cũng cho
-- unit_cost = 0 và sẽ bị đếm oan.
-- ====================================================================


-- --- 1. QUY MÔ -----------------------------------------------------
SELECT
  'Phiếu xuất chưa trừ tồn' AS chi_tieu,
  COUNT(DISTINCT se.id)                                  AS so_phieu,
  COALESCE(SUM(sel.qty_in_base_uom), 0)                  AS tong_don_vi_chua_tru,
  COUNT(DISTINCT sel.product_id)                         AS so_san_pham_anh_huong
FROM stock_entries se
JOIN stock_entry_lines sel ON sel.entry_id = se.id
WHERE se.type = 'export'
  AND se.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM stock_entry_lines x
    WHERE x.entry_id = se.id
      AND COALESCE(x.unit_cost, 0) > 0
  );


-- --- 2. DANH SÁCH PHIẾU --------------------------------------------
SELECT
  se.entry_code                                    AS ma_phieu,
  (se.posted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS ngay_dang,
  COUNT(sel.id)                                    AS so_dong,
  SUM(sel.qty_in_base_uom)                         AS tong_don_vi,
  se.notes
FROM stock_entries se
JOIN stock_entry_lines sel ON sel.entry_id = se.id
WHERE se.type = 'export'
  AND se.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM stock_entry_lines x
    WHERE x.entry_id = se.id
      AND COALESCE(x.unit_cost, 0) > 0
  )
GROUP BY se.id, se.entry_code, se.posted_at, se.notes
ORDER BY se.posted_at DESC
LIMIT 200;


-- --- 3. LỆCH TỒN THEO SẢN PHẨM -------------------------------------
WITH bo_sot AS (
  SELECT sel.product_id, SUM(sel.qty_in_base_uom) AS qty_chua_tru
  FROM stock_entries se
  JOIN stock_entry_lines sel ON sel.entry_id = se.id
  WHERE se.type = 'export'
    AND se.status = 'posted'
    AND NOT EXISTS (
      SELECT 1 FROM stock_entry_lines x
      WHERE x.entry_id = se.id
        AND COALESCE(x.unit_cost, 0) > 0
    )
  GROUP BY sel.product_id
),
ton_hien_tai AS (
  SELECT product_id, SUM(qty_on_hand) AS ton
  FROM batches
  GROUP BY product_id
)
SELECT
  p.sku,
  p.name                                        AS ten_san_pham,
  p.base_unit                                   AS dvt,
  COALESCE(t.ton, 0)                            AS ton_dang_hien,
  b.qty_chua_tru                                AS chua_tru,
  COALESCE(t.ton, 0) - b.qty_chua_tru           AS ton_le_ra
FROM bo_sot b
JOIN products p ON p.id = b.product_id
LEFT JOIN ton_hien_tai t ON t.product_id = b.product_id
ORDER BY b.qty_chua_tru DESC
LIMIT 200;
