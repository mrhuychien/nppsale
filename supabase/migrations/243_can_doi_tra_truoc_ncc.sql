-- ====================================================================
-- 243 — BẢNG CÂN ĐỐI: dòng "Trả trước cho NCC"; phải trả NCC tính RÒNG THEO TỪNG NCC
--
-- VÌ SAO — chủ nhà 11/10/2026: "thêm dòng trả trước cho NCC vào".
--   `finance_balance_sheet` (mig 228) cộng phải trả NCC bằng GREATEST(0, amount − paid) TỪNG DÒNG: dòng trả trước của
--   phiếu chi trả NCC (mig 242: amount 0, paid = phần trả dư) và dòng âm của phiếu trả NCC bị kẹp về 0. Tiền NCC đang
--   giữ của mình không nằm ở đâu trên bảng cân đối — tiền đã giảm mà tài sản không có gì bù, nên vốn chủ (phần chênh)
--   hụt đúng bằng số ấy. Lại lệch màn Công nợ NCC (mig 231: KHÔNG kẹp dòng âm).
--
-- CÁCH LÀM
--   Nợ ròng của TỪNG NCC = Σ(amount − paid) trên dòng chưa 'paid' — đúng cách `payables_by_supplier` / `tongNoNcc` cộng.
--   NCC ròng dương → "Phải trả NCC" (nguồn vốn); NCC ròng âm → "Trả trước cho NCC" (tài sản) — như TT200: dư Có
--   TK 331 → phải trả người bán, dư Nợ chi tiết theo TỪNG người bán → trả trước cho người bán. Không bù trừ GIỮA hai NCC.
--   Hàm trả thêm cột `supplier_prepayments` → đổi kiểu trả về → DROP rồi CREATE, cấp lại quyền (bài học mig 121).
--   Mọi phần khác giữ nguyên bản mig 228: mốc ngày giờ VN, cấn trừ không phải tiền, phải thu KHÔNG kẹp dòng âm.
-- ====================================================================

DROP FUNCTION IF EXISTS public.finance_balance_sheet(date);
CREATE FUNCTION public.finance_balance_sheet(p_as_of date)
RETURNS TABLE(cash numeric, accounts_receivable numeric, inventory numeric, accounts_payable numeric, unpaid_expenses numeric,
              supplier_prepayments numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  WITH
  moc AS (
    -- (mig 228) Hết ngày p_as_of theo giờ VN.
    SELECT ((p_as_of + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS den
  ),
  cash_in AS (
    SELECT COALESCE(SUM(COALESCE(p.amount, 0)), 0) AS v
    FROM payments p
    JOIN receivables r ON r.id = p.receivable_id
    CROSS JOIN moc
    WHERE r.org_id = public.user_org_id()
      AND p.collected_at < moc.den
      -- ⚠ Q13 — CẤN TRỪ KHÔNG PHẢI TIỀN VÀO KÉT (mig 121).
      AND COALESCE(p.method, '') NOT IN ('return_credit', 'credit_applied')
  ),
  paid_payables AS (
    SELECT COALESCE(SUM(COALESCE(pp.amount, 0)), 0) AS v
    FROM payable_payments pp
    JOIN payables pa ON pa.id = pp.payable_id
    CROSS JOIN moc
    WHERE pa.org_id = public.user_org_id()
      AND pp.paid_at < moc.den
  ),
  exp AS (
    SELECT
      COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE is_paid), 0)     AS paid,
      COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE NOT is_paid), 0) AS unpaid
    FROM expenses
    WHERE org_id = public.user_org_id()
      AND expense_date <= p_as_of
  ),
  ar AS (
    /* ⚠ KHÔNG kẹp từng dòng về 0 (CLAUDE.md, mig 186): dòng âm là dư có của khách, trừ vào tổng phải thu. */
    SELECT COALESCE(SUM(COALESCE(amount, 0) - COALESCE(paid, 0)), 0) AS v
    FROM receivables
    WHERE org_id = public.user_org_id() AND status <> 'paid'
  ),
  inv AS (
    SELECT COALESCE(SUM(COALESCE(qty_on_hand, 0) * COALESCE(unit_cost, 0)), 0) AS v
    FROM batches
    WHERE org_id = public.user_org_id() AND COALESCE(qty_on_hand, 0) > 0
  ),
  ncc AS (
    /* (mig 243) Nợ ròng theo TỪNG NCC — KHÔNG kẹp từng dòng (mig 231): dòng âm của phiếu trả NCC, dòng trả trước của
       phiếu chi NCC (mig 242) trừ vào nợ của chính NCC ấy. */
    SELECT supplier_id, SUM(COALESCE(amount, 0) - COALESCE(paid, 0)) AS rong
    FROM payables
    WHERE org_id = public.user_org_id() AND status <> 'paid'
    GROUP BY supplier_id
  ),
  ap AS (
    -- Ròng dương → phải trả NCC; ròng âm → trả trước cho NCC (tiền NCC đang giữ của mình).
    SELECT COALESCE(SUM(GREATEST(rong, 0)), 0)  AS phai_tra,
           COALESCE(SUM(GREATEST(-rong, 0)), 0) AS tra_truoc
    FROM ncc
  )
  SELECT
    cash_in.v - paid_payables.v - exp.paid,
    ar.v,
    inv.v,
    ap.phai_tra,
    exp.unpaid,
    ap.tra_truoc
  FROM cash_in, paid_payables, exp, ar, inv, ap;
$fn$;
REVOKE EXECUTE ON FUNCTION public.finance_balance_sheet(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_balance_sheet(date) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 243: bảng cân đối có dòng Trả trước cho NCC (ròng theo từng NCC)' AS buoc,
       CASE WHEN position('supplier_prepayments' IN pg_get_function_result('public.finance_balance_sheet(date)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM (SELECT 1 FROM payables WHERE status <> 'paid' GROUP BY org_id, supplier_id
                               HAVING SUM(COALESCE(amount, 0) - COALESCE(paid, 0)) < 0) x) AS ncc_dang_tra_truoc,
       (SELECT COALESCE(SUM(-r), 0) FROM (SELECT SUM(COALESCE(amount, 0) - COALESCE(paid, 0)) AS r FROM payables
                                          WHERE status <> 'paid' GROUP BY org_id, supplier_id) x WHERE r < 0) AS tong_tra_truoc;
