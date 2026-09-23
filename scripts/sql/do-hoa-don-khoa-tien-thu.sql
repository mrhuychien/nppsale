-- ====================================================================
-- HÓA ĐƠN BỊ KHOÁ "ĐÃ CÓ TIỀN THU" — TỪ ĐÂU RA — CHỈ ĐỌC
--
-- Chủ nhà báo 23/09/2026: sửa hóa đơn báo LOCKED_HAS_PAYMENT "mặc dù hoá
-- đơn chưa hề thu tiền". Khoá bật khi CÓ BẤT KỲ một trong ba thứ:
--   A. `receivables.paid > 0` của hóa đơn
--   B. một dòng phiếu thu (chưa huỷ) gắn `invoice_id` = hóa đơn
--   C. một dòng phiếu thu (chưa huỷ) KHÔNG gắn hóa đơn mà trỏ CÙNG ĐƠN
-- Câu này liệt kê từng hóa đơn đang bị khoá và đúng dòng gây khoá.
-- Nhánh "vì sao" ghi `loai` (kind) và số tiền: dòng 0đ, dòng cấn trừ hàng
-- trả, hay phiếu thu của đơn chứ không phải của hóa đơn.
-- ====================================================================
SELECT
  si.invoice_code AS hoa_don, si.invoice_date AS ngay,
  so.order_code AS don,
  trim_scale(rc.paid) AS cong_no_da_tra,
  CASE WHEN crl.invoice_id = si.id THEN 'B gắn hóa đơn'
       WHEN crl.id IS NOT NULL      THEN 'C gắn ĐƠN, không gắn hóa đơn'
       ELSE 'A chỉ có công nợ đã trả' END AS nhanh,
  cr.receipt_code AS phieu_thu, cr.status AS tt_phieu,
  crl.kind AS loai, trim_scale(crl.amount) AS so_tien,
  to_char(cr.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') AS luc,
  u.full_name AS nguoi_lap
FROM sales_invoices si
JOIN sales_orders so ON so.id = si.order_id
LEFT JOIN receivables rc ON rc.invoice_id = si.id
LEFT JOIN cash_receipt_lines crl
       ON crl.invoice_id = si.id
       OR (crl.invoice_id IS NULL AND crl.order_id = si.order_id)
LEFT JOIN cash_receipts cr ON cr.id = crl.receipt_id
LEFT JOIN users u ON u.id = cr.created_by
WHERE si.status = 'posted'
  AND (COALESCE(rc.paid, 0) > 0 OR (crl.id IS NOT NULL AND cr.status <> 'voided'))
  AND (crl.id IS NULL OR cr.status <> 'voided')
ORDER BY si.invoice_date DESC, si.invoice_code;
