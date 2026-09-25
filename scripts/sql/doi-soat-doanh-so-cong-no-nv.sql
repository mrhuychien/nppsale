-- ====================================================================
-- ĐỐI SOÁT DOANH SỐ ↔ CÔNG NỢ THEO NHÂN VIÊN — chỉ ĐỌC, không sửa gì
--
-- VÌ SAO — chủ nhà 25/09/2026: "rà soát lại toàn bộ cho tao tại sao doanh số nhân
--   viên lại lệch so với công nợ nhân viên". Chạy trên Supabase SQL editor.
--
-- ĐỌC KẾT QUẢ
--   Bảng 1: mỗi nhân viên một dòng, TOÀN THỜI GIAN.
--     doanh_so_thuan = Σ HĐ đã ghi sổ − Σ hàng trả đã trừ doanh số (revenue_date).
--     no_phat_sinh   = Σ dòng nợ của HĐ + Σ dòng nợ âm của phiếu trả (TRƯỚC khi thu tiền).
--     chenh_lech     phải = 0. Khác 0 thì xem bảng 2.
--     con_no         = Σ(amount − paid) dòng chưa 'paid' — đúng số màn "Công nợ theo NV".
--   Bảng 2: từng chứng từ gây lệch, cột `loai` nói lý do.
--   Màn doanh số chọn KỲ (tháng này…), còn công nợ là mọi khoản còn mở — so hai màn
--   ấy trực tiếp thì luôn lệch; so ở đây.
-- ====================================================================
WITH inv AS (
  SELECT si.sales_user_id uid, SUM(COALESCE(si.total, 0)) ban
  FROM sales_invoices si WHERE si.status = 'posted' GROUP BY 1),
tra AS (
  SELECT r.sales_user_id uid, SUM(COALESCE(r.credit_note_amount, 0)) tra
  FROM returns r WHERE r.revenue_date IS NOT NULL GROUP BY 1),
rc AS (
  SELECT rc.sales_user_id uid,
    SUM(rc.amount) FILTER (WHERE rc.invoice_id IS NOT NULL)                          no_hoa_don,
    SUM(rc.amount) FILTER (WHERE rc.return_id IS NOT NULL)                           no_phieu_tra,
    SUM(rc.amount) FILTER (WHERE COALESCE(rc.opening_balance, false))                no_dau_ky,
    SUM(rc.amount) FILTER (WHERE rc.invoice_id IS NULL AND rc.return_id IS NULL
                             AND NOT COALESCE(rc.opening_balance, false))            no_cu_theo_don,
    SUM(COALESCE(rc.paid, 0))                                                        da_thu,
    SUM(rc.amount - COALESCE(rc.paid, 0)) FILTER (WHERE rc.status <> 'paid')        con_no
  FROM receivables rc GROUP BY 1),
k AS (SELECT uid FROM inv UNION SELECT uid FROM tra UNION SELECT uid FROM rc)
SELECT COALESCE(u.full_name, '(chưa gán NV)') AS nhan_vien,
       COALESCE(inv.ban, 0) AS hoa_don,
       COALESCE(tra.tra, 0) AS hang_tra,
       COALESCE(inv.ban, 0) - COALESCE(tra.tra, 0) AS doanh_so_thuan,
       COALESCE(rc.no_hoa_don, 0) + COALESCE(rc.no_phieu_tra, 0) AS no_phat_sinh,
       (COALESCE(inv.ban, 0) - COALESCE(tra.tra, 0))
         - (COALESCE(rc.no_hoa_don, 0) + COALESCE(rc.no_phieu_tra, 0)) AS chenh_lech,
       COALESCE(rc.no_dau_ky, 0) AS no_dau_ky,
       COALESCE(rc.no_cu_theo_don, 0) AS no_cu_theo_don,
       COALESCE(rc.da_thu, 0) AS da_thu,
       COALESCE(rc.con_no, 0) AS con_no
FROM k
LEFT JOIN inv ON inv.uid IS NOT DISTINCT FROM k.uid
LEFT JOIN tra ON tra.uid IS NOT DISTINCT FROM k.uid
LEFT JOIN rc  ON rc.uid  IS NOT DISTINCT FROM k.uid
LEFT JOIN users u ON u.id = k.uid
ORDER BY abs((COALESCE(inv.ban, 0) - COALESCE(tra.tra, 0))
             - (COALESCE(rc.no_hoa_don, 0) + COALESCE(rc.no_phieu_tra, 0))) DESC;

-- Bảng 2 — chứng từ gây lệch
SELECT 'nợ HĐ khác người HĐ (chạy mig 194)' AS loai, si.invoice_code AS ma,
       rc.sales_user_id AS nv_cong_no, si.sales_user_id AS nv_chung_tu, rc.amount AS so_tien
FROM receivables rc JOIN sales_invoices si ON si.id = rc.invoice_id
WHERE rc.sales_user_id IS DISTINCT FROM si.sales_user_id
UNION ALL
SELECT 'nợ âm khác người phiếu trả (chạy mig 194)', r.return_code, rc.sales_user_id, r.sales_user_id, rc.amount
FROM receivables rc JOIN returns r ON r.id = rc.return_id
WHERE rc.sales_user_id IS DISTINCT FROM r.sales_user_id
UNION ALL
SELECT 'phiếu trả gắn HĐ khác người HĐ (chạy mig 194)', r.return_code, si.sales_user_id, r.sales_user_id, -r.credit_note_amount
FROM returns r JOIN sales_invoices si ON si.id = r.invoice_id
WHERE r.revenue_date IS NOT NULL AND r.sales_user_id IS DISTINCT FROM si.sales_user_id
UNION ALL
SELECT 'trừ doanh số nhưng không trừ nợ', r.return_code, NULL, r.sales_user_id, -r.credit_note_amount
FROM returns r
WHERE r.revenue_date IS NOT NULL AND (
     (r.invoice_id IS NOT NULL AND NOT (
         (r.credit_with_invoice AND r.status IN ('submitted', 'completed'))
      OR (NOT COALESCE(r.credit_with_invoice, false) AND r.status = 'completed')))
  OR (r.invoice_id IS NULL AND r.order_id IS NOT NULL)
  OR (r.invoice_id IS NULL AND r.order_id IS NULL AND r.applied_receipt_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM receivables x WHERE x.return_id = r.id)))
UNION ALL
SELECT 'phiếu trả cấn ở phiếu thu kiểu cũ (nằm trong tiền đã thu)', r.return_code, NULL, r.sales_user_id, -r.credit_note_amount
FROM returns r WHERE r.revenue_date IS NOT NULL AND r.applied_receipt_id IS NOT NULL AND r.invoice_id IS NULL
UNION ALL
SELECT 'HĐ ghi sổ thiếu dòng công nợ', si.invoice_code, NULL, si.sales_user_id, si.total
FROM sales_invoices si WHERE si.status = 'posted'
  AND NOT EXISTS (SELECT 1 FROM receivables x WHERE x.invoice_id = si.id)
ORDER BY 1, 2;
