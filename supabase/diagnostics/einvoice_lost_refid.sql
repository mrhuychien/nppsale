-- ====================================================================
-- HOÁ ĐƠN MẤT RefID MISA — đo mức thiệt hại (mig 099)
--
-- CHỈ ĐỌC. Không sửa một dòng dữ liệu nào. Dán cả file vào
-- Supabase → SQL Editor → Run.
--
-- ------------------------------------------------------------------
-- VÌ SAO CÓ DANH SÁCH NÀY
-- ------------------------------------------------------------------
-- Trước mig 099, cột `invoices.misa_invoice_id` kiêm hai vai:
--   • publish ghi RefID (GUID) — khoá để hỏi lại MISA
--   • refresh-status ghi InvNo (số hoá đơn) ĐÈ LÊN
-- Nên với mỗi hoá đơn đã từng bấm "Làm mới trạng thái", RefID bị xoá.
--
-- Mất RefID nghĩa là KHÔNG CÒN ĐƯỜNG HỎI: không biết được hoá đơn đó
-- sau này có bị huỷ hay bị thay thế trên MISA hay không, và deep-link
-- sang MISA cũng không dựng được.
--
-- ------------------------------------------------------------------
-- XỬ LÝ RA SAO
-- ------------------------------------------------------------------
-- Với mỗi tờ trong truy vấn 2, chọn MỘT trong hai:
--   a) Mở MISA, tìm đúng hoá đơn theo ký hiệu + số, copy RefID (GUID
--      trên thanh địa chỉ) rồi gán tay:
--        UPDATE invoices SET misa_ref_id = '<guid>', misa_note = NULL
--         WHERE id = '<id>';
--   b) Nếu tờ đó chưa thực sự phát hành trên MISA: xoá dấu vết MISA và
--      phát hành lại từ app.
--
-- Không có RefID thì vòng quét tự động (§3) bỏ qua tờ này — đúng như
-- thiết kế: quét bằng khoá sai còn tệ hơn không quét.
-- ====================================================================


-- --- 1. QUY MÔ -----------------------------------------------------
SELECT
  'Hoá đơn mất RefID'                     AS chi_tieu,
  COUNT(*)                                AS so_hoa_don,
  COALESCE(SUM(total), 0)                 AS tong_tien,
  MIN(issued_at)::date                    AS cu_nhat,
  MAX(issued_at)::date                    AS moi_nhat
FROM invoices
WHERE misa_ref_id IS NULL
  AND misa_inv_no IS NOT NULL;


-- --- 2. DANH SÁCH CỤ THỂ -------------------------------------------
SELECT
  i.id,
  i.invoice_number                                   AS so_noi_bo,
  i.misa_inv_series                                  AS ky_hieu,
  i.misa_inv_no                                      AS so_misa,
  i.misa_status                                      AS trang_thai,
  i.customer_name                                    AS khach_hang,
  i.total                                            AS tong_tien,
  (i.issued_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS ngay_phat_hanh,
  i.misa_lookup_code                                 AS ma_tra_cuu
FROM invoices i
WHERE i.misa_ref_id IS NULL
  AND i.misa_inv_no IS NOT NULL
ORDER BY i.issued_at DESC NULLS LAST
LIMIT 500;


-- --- 3. ĐỐI CHIẾU: einvoice_logs có thể còn giữ RefID --------------
-- Log lưu nguyên payload gửi đi, mà payload[0].RefID chính là GUID đã
-- mất. Nếu tờ nào còn log thì lấy lại được RefID mà không cần mở MISA.
-- Cột `refid_tim_duoc` khác NULL = chép thẳng vào misa_ref_id được.
SELECT
  i.id,
  i.misa_inv_series                                    AS ky_hieu,
  i.misa_inv_no                                        AS so_misa,
  (l.request_payload -> 0 ->> 'RefID')                 AS refid_tim_duoc,
  l.attempt_at
FROM invoices i
LEFT JOIN LATERAL (
  SELECT el.request_payload, el.attempt_at
  FROM einvoice_logs el
  WHERE el.invoice_id = i.id
    AND el.status = 'success'
    AND jsonb_typeof(el.request_payload) = 'array'
    AND (el.request_payload -> 0 ->> 'RefID') IS NOT NULL
  ORDER BY el.attempt_at DESC
  LIMIT 1
) l ON true
WHERE i.misa_ref_id IS NULL
  AND i.misa_inv_no IS NOT NULL
ORDER BY (l.request_payload IS NOT NULL) DESC, i.issued_at DESC NULLS LAST
LIMIT 500;
