-- ====================================================================
-- QUÉT PHIẾU TRẢ HÀNG ↔ CÔNG NỢ — chỉ ĐỌC, không sửa gì
--
-- Chủ nhà 25/09/2026: "quét lại hết phiếu trả hàng xem có phiếu nào ở trạng
-- thái chờ xử lý mà chưa trừ công nợ ko ?"
--
-- CÁCH DÙNG: dán vào Supabase SQL Editor → Run. Chạy trước VÀ sau khi chạy
-- migration 191 đều được (không đụng cột mới của 191). Không ra dòng nào là sổ
-- sạch. Mỗi dòng là một chứng từ cần xem, cột `nen_lam` nói việc cần làm.
--
-- Chạy kèm `scripts/sql/kham-so-that.sql` để biết migration nào còn chạy sót.
-- ====================================================================
WITH tru AS (
  -- Khoản trừ của từng hóa đơn — đúng công thức `_wf2b_recompute_receivable`
  -- (mig 133/186): phiếu tự sinh trừ từ Chờ xử lý, phiếu tự lập trừ khi hoàn thành.
  SELECT r.invoice_id, COALESCE(sum(COALESCE(r.credit_note_amount, 0)), 0) AS credits
  FROM returns r
  WHERE r.invoice_id IS NOT NULL
    AND ((r.credit_with_invoice AND r.status IN ('submitted', 'completed'))
         OR (NOT COALESCE(r.credit_with_invoice, false) AND r.status = 'completed'))
  GROUP BY r.invoice_id
)
SELECT * FROM (

-- 1. Phiếu TỰ SINH đang Chờ xử lý mà công nợ hóa đơn CHƯA trừ đúng
SELECT 1 AS nhom,
  'Phiếu tự sinh Chờ xử lý — công nợ HĐ chưa trừ đúng' AS loai,
  si.invoice_code AS chung_tu,
  c.store_name AS khach,
  ret.credit_note_amount AS tien_tra,
  'Công nợ HĐ ' || COALESCE(rc.amount::text, 'KHÔNG CÓ DÒNG') || ' — đúng phải là '
    || (si.total - COALESCE(t.credits, 0))::text AS chi_tiet,
  'Chạy mig 186/189 (xem kham-so-that.sql); vẫn còn thì báo lại' AS nen_lam
FROM returns ret
JOIN sales_invoices si ON si.id = ret.invoice_id
LEFT JOIN customers c ON c.id = ret.customer_id
LEFT JOIN receivables rc ON rc.invoice_id = si.id
LEFT JOIN tru t ON t.invoice_id = si.id
WHERE ret.status = 'submitted' AND ret.credit_with_invoice
  AND si.status = 'posted'
  AND (rc.id IS NULL OR abs(rc.amount - (si.total - COALESCE(t.credits, 0))) > 0.5)

UNION ALL
-- 2. Phiếu trả Chờ xử lý KHÔNG phải tự sinh — theo luật mới không được có
SELECT 2, 'Phiếu tự lập đang Chờ xử lý (chưa trừ nợ, chưa nhập kho)',
  COALESCE(si.invoice_code, 'phiếu ' || left(ret.id::text, 8)),
  c.store_name, ret.credit_note_amount,
  'Lập ' || to_char(ret.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'),
  'Mig 191 chuyển về Nháp; bấm Hoàn thành thì mới nhập kho + trừ nợ'
FROM returns ret
LEFT JOIN sales_invoices si ON si.id = ret.invoice_id
LEFT JOIN customers c ON c.id = ret.customer_id
WHERE ret.status = 'submitted' AND NOT COALESCE(ret.credit_with_invoice, false)

UNION ALL
-- 3. Hàng trả đi theo đơn KẸT Ở NHÁP dù đơn đã xuất hóa đơn (lỗi trước mig 189)
SELECT 3, 'Hàng trả theo đơn kẹt Nháp — đơn đã xuất HĐ, công nợ không trừ',
  so.order_code, c.store_name, ret.credit_note_amount,
  'Đơn có ' || (SELECT count(*) FROM sales_invoices s2 WHERE s2.order_id = so.id AND s2.status = 'posted')
    || ' hóa đơn đã ghi sổ',
  'Chạy mig 189 (nó tự gắn lại và tính lại công nợ)'
FROM returns ret
JOIN sales_orders so ON so.id = ret.order_id
LEFT JOIN customers c ON c.id = ret.customer_id
WHERE ret.status = 'draft' AND ret.invoice_id IS NULL
  AND COALESCE(ret.credit_note_amount, 0) > 0
  AND EXISTS (SELECT 1 FROM sales_invoices s2
              WHERE s2.order_id = so.id AND s2.status = 'posted' AND s2.created_at >= ret.created_at)

UNION ALL
-- 4. Phiếu tự lập KHÔNG gắn HĐ đã hoàn thành mà chưa trừ nợ
SELECT 4, 'Phiếu tự lập độc lập đã hoàn thành — chưa trừ công nợ',
  'phiếu ' || left(ret.id::text, 8), c.store_name, ret.credit_note_amount,
  'Hoàn thành ' || COALESCE(to_char(ret.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'), '?'),
  'Mig 191 ghi bù thành công nợ âm (dư có) cho khách'
FROM returns ret
LEFT JOIN customers c ON c.id = ret.customer_id
WHERE ret.status = 'completed' AND ret.invoice_id IS NULL AND ret.order_id IS NULL
  AND ret.applied_receipt_id IS NULL AND COALESCE(ret.credit_note_amount, 0) > 0
  -- `to_jsonb` để chạy được cả khi chưa có cột `return_id` (trước mig 191).
  AND NOT EXISTS (SELECT 1 FROM receivables rc WHERE to_jsonb(rc)->>'return_id' = ret.id::text)

UNION ALL
-- 5. Phiếu gắn HĐ đã trừ vào HĐ lại CÒN cấn trừ ở phiếu thu → trừ HAI LẦN
SELECT 5, 'Phiếu trả gắn HĐ bị trừ nợ hai lần (HĐ + cấn trừ ở phiếu thu)',
  si.invoice_code, c.store_name, ret.credit_note_amount,
  'Phiếu thu ' || COALESCE(cr.receipt_code, '?'),
  'Huỷ phiếu thu đó rồi lập lại không cấn phiếu trả (mig 191 đã chặn từ nay)'
FROM returns ret
JOIN sales_invoices si ON si.id = ret.invoice_id
LEFT JOIN cash_receipts cr ON cr.id = ret.applied_receipt_id
LEFT JOIN customers c ON c.id = ret.customer_id
WHERE ret.status = 'completed' AND ret.applied_receipt_id IS NOT NULL
  AND COALESCE(cr.status, '') <> 'voided'

UNION ALL
-- 6. Hóa đơn có phiếu trả mà công nợ lệch công thức (mọi trạng thái)
SELECT 6, 'Công nợ HĐ lệch với tiền hàng trả',
  si.invoice_code, c.store_name, t.credits,
  'Công nợ ' || COALESCE(rc.amount::text, 'KHÔNG CÓ DÒNG') || ' — đúng phải là '
    || (si.total - t.credits)::text,
  'Chạy mig 186/190; vẫn còn thì báo lại'
FROM tru t
JOIN sales_invoices si ON si.id = t.invoice_id AND si.status = 'posted'
LEFT JOIN receivables rc ON rc.invoice_id = si.id
LEFT JOIN customers c ON c.id = si.customer_id
WHERE rc.id IS NULL OR abs(rc.amount - (si.total - t.credits)) > 0.5

) x
ORDER BY nhom, chung_tu;
