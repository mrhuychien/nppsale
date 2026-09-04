-- ====================================================================
-- GIÁ TRỊ ENUM MISA CHƯA BIẾT NGHĨA — đo bằng dữ liệu thật của mình
--
-- CHỈ ĐỌC. Dán cả file vào Supabase → SQL Editor → Run.
-- Chạy SAU khi /api/einvoice/pull-snapshots đã kéo được ít nhất một lượt.
--
-- ------------------------------------------------------------------
-- VÌ SAO CÓ FILE NÀY
-- ------------------------------------------------------------------
-- Hai trục trạng thái MISA mới xác minh được một phần:
--
--   PublishStatus   0 = nháp, 3 = đã cấp mã          ← đã đo
--                   1, 2, 4, 5 = ?                    ← CHƯA ai đo
--   EInvoiceStatus  1 mới, 3 thay thế, 4 điều chỉnh,
--                   7 bị thay thế, 8 bị điều chỉnh    ← đã đo (5 hoá đơn thật)
--                   2, 5, 6 = ?                       ← CHƯA ai đo
--
-- Mã KHÔNG ĐOÁN khi gặp giá trị lạ: nó giữ nguyên trạng thái đang có và
-- ghi giá trị thô vào `invoices.misa_note`. Nhưng nếu không ai đi đọc
-- những ghi chú ấy thì cái chưa biết vẫn mãi chưa biết.
--
-- File này gom chúng lại: mỗi giá trị lạ kèm SỐ LƯỢNG và vài hoá đơn mẫu
-- để mở trên MISA đối chiếu bằng mắt. Đọc được nghĩa rồi thì khai thêm
-- vào RELATION_BY_CODE (src/lib/misa/status.ts) — và đó là chỗ DUY NHẤT
-- cần sửa, cả hai đường (refresh và vòng quét) đều đi qua nó.
--
-- ⚠ Sai ở hai enum này là sai báo cáo thuế. Đừng suy diễn từ tên hay từ
-- số lượng — mở đúng tờ hoá đơn trên MISA và đọc chữ trên màn hình.
-- ====================================================================


-- --- 1. EInvoiceStatus lạ (trục QUAN HỆ) ----------------------------
SELECT
  s.einvoice_status                                   AS gia_tri_la,
  COUNT(*)                                            AS so_hoa_don,
  MIN(s.inv_date)                                     AS som_nhat,
  MAX(s.inv_date)                                     AS muon_nhat,
  -- Mở đúng những tờ này trên MISA để đọc chữ ở ô "Trạng thái hoá đơn".
  (ARRAY_AGG(
     COALESCE(s.inv_series, '?') || ' · ' || COALESCE(s.inv_no, '?')
     ORDER BY s.inv_date DESC
   ))[1:5]                                            AS hoa_don_mau,
  (ARRAY_AGG(s.ref_id ORDER BY s.inv_date DESC))[1:3] AS ref_id_mau
FROM misa_invoice_snapshots s
WHERE s.einvoice_status IS NOT NULL
  AND s.einvoice_status NOT IN (1, 3, 4, 7, 8)
GROUP BY s.einvoice_status
ORDER BY COUNT(*) DESC;


-- --- 2. PublishStatus lạ (trục PHÁT HÀNH) ---------------------------
-- Cột `co_ma_cqt` là manh mối mạnh nhất: giá trị nào LUÔN đi kèm mã cơ
-- quan thuế thì gần như chắc là một dạng "đã phát hành".
SELECT
  s.publish_status                                    AS gia_tri_la,
  COUNT(*)                                            AS so_hoa_don,
  COUNT(*) FILTER (WHERE s.invoice_code IS NOT NULL)  AS co_ma_cqt,
  COUNT(*) FILTER (WHERE s.inv_no IS NOT NULL)        AS da_cap_so,
  (ARRAY_AGG(
     COALESCE(s.inv_series, '?') || ' · ' || COALESCE(s.inv_no, '?')
     ORDER BY s.inv_date DESC
   ))[1:5]                                            AS hoa_don_mau
FROM misa_invoice_snapshots s
WHERE s.publish_status IS NOT NULL
  AND s.publish_status NOT IN (0, 3)
GROUP BY s.publish_status
ORDER BY COUNT(*) DESC;


-- --- 3. Hoá đơn trong SỔ đang mang ghi chú "không rõ nghĩa" ---------
-- Vòng quét ghi giá trị thô vào misa_note khi không kết luận được. Đây là
-- những tờ đang đứng im ở một trạng thái có thể đã cũ.
SELECT
  i.id,
  i.misa_inv_series                                    AS ky_hieu,
  i.misa_inv_no                                        AS so_hd,
  i.misa_status                                        AS trang_thai_dang_ghi,
  i.total                                              AS tong_tien,
  i.misa_last_checked_at                               AS lan_quet_cuoi,
  i.misa_note
FROM invoices i
WHERE i.misa_note ILIKE '%không rõ nghĩa%'
ORDER BY i.issued_at DESC NULLS LAST
LIMIT 200;


-- --- 4. Cờ huỷ: tên field đã kích hoạt ------------------------------
-- Tên field huỷ đã xác minh là `IsInvoiceDeleted`; mã còn giữ ba tên dự
-- phòng. Nếu truy vấn này ra dòng nào KHÁC 'IsInvoiceDeleted' thì tài
-- khoản MISA này dùng tên khác — cập nhật CANCEL_FIELDS cho đúng thứ tự.
SELECT
  key_name                                            AS field_da_kich_hoat,
  COUNT(*)                                            AS so_hoa_don
FROM misa_invoice_snapshots s
CROSS JOIN LATERAL (
  SELECT k AS key_name
  FROM unnest(ARRAY['IsInvoiceDeleted','IsInvoiceCanceled','IsCanceled','IsCancelled']) AS k
  WHERE (s.raw -> k) = 'true'::jsonb
) f
GROUP BY key_name
ORDER BY COUNT(*) DESC;


-- --- 5. Sức khoẻ chung của lượt đối soát gần nhất --------------------
SELECT
  COALESCE(match_status, '(chưa đối soát)')           AS ro,
  COUNT(*)                                            AS so_dong,
  COALESCE(SUM(ABS(total_amount)), 0)                 AS tong_tien_tuyet_doi
FROM misa_invoice_snapshots
GROUP BY match_status
ORDER BY COUNT(*) DESC;
