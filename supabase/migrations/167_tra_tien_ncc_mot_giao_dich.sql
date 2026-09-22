-- ====================================================================
-- TRẢ TIỀN NCC TRONG MỘT GIAO DỊCH, CỘNG DỒN Ở MÁY CHỦ
--
-- Rơi ra từ đợt QA 22/09/2026.
--
-- ⚠ TRƯỚC ĐÂY (`payables/[id]/page.tsx`): trình duyệt chèn
--   `payable_payments` rồi tự tính `paid = payable.paid + amt` từ con số
--   ĐỌC LÚC MỞ TRANG, rồi ghi đè `payables.paid`. Hai lệnh rời nhau.
--
--   ĐÃ ĐO TRÊN POSTGRES 16: hai tab kế toán cùng mở lúc paid = 0, ghi lần
--   lượt 3tr rồi 2tr →
--       payables.paid          = 2.000.000
--       sum(payable_payments)  = 5.000.000
--       payables_by_supplier   : còn nợ 3.000.000
--   NCC đã được trả đủ mà sổ báo còn nợ 3tr — kế toán trả thêm lần nữa.
--   Và bước 2 hỏng (mạng rớt) thì bước 1 vẫn còn: tiền đã ghi chi mà nợ
--   không giảm.
--
-- ⚠ SAU: `record_payable_payment` khoá dòng công nợ (`FOR UPDATE`), cộng
--   dồn `paid = paid + amt` ở máy chủ, tính trạng thái ở máy chủ, và ghi
--   cả hai vế trong CÙNG một giao dịch. Khuôn của `create_cash_receipt`.
--
-- ⚠ VAI CHÉP ĐÚNG RLS "Manage payables" / "Manage payable payments"
--   (owner, accountant) — hàm SECURITY DEFINER bỏ qua RLS thì phải tự
--   kiểm đúng cái ấy (bài học mig 166).
--
-- ⚠ ĐỐI SOÁT MỘT CHIỀU, như mig 164: chỉ vá khoản mà tiền ĐÃ CHI
--   (sum payable_payments) LỚN HƠN `paid`. Chiều ngược lại là bình
--   thường — công nợ đầu kỳ nhập sẵn `paid` mà không có phiếu chi nào.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.record_payable_payment(
  p_payable_id uuid,
  p_amount     numeric,
  p_method     text,
  p_notes      text DEFAULT NULL
)
RETURNS TABLE (payment_id uuid, new_paid numeric, new_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org    uuid;
  v_amount numeric;
  v_paid   numeric;
  v_pid    uuid;
  v_status text;
BEGIN
  IF COALESCE(public.user_role(), '') NOT IN ('owner', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN: chỉ chủ NPP hoặc kế toán được ghi trả tiền NCC.'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'BAD_AMOUNT: số tiền phải lớn hơn 0.' USING ERRCODE = 'P0001';
  END IF;

  -- Khoá TRƯỚC khi đọc số đã trả: đọc rồi mới khoá thì hai lượt song
  -- song cùng thấy số cũ — đúng cái lỗi đang vá.
  SELECT org_id, amount, COALESCE(paid, 0)
    INTO v_org, v_amount, v_paid
  FROM payables WHERE id = p_payable_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYABLE_NOT_FOUND: không tìm thấy khoản công nợ NCC này.' USING ERRCODE = 'P0001';
  END IF;
  IF v_org IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH: khoản công nợ này không thuộc đơn vị của bạn.' USING ERRCODE = '42501';
  END IF;
  IF p_amount > v_amount - v_paid THEN
    RAISE EXCEPTION 'OVERPAY: số tiền vượt quá công nợ còn lại (còn %).', v_amount - v_paid
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO payable_payments (payable_id, amount, method, paid_by, notes)
  VALUES (p_payable_id, p_amount, NULLIF(p_method, ''), auth.uid(), NULLIF(p_notes, ''))
  RETURNING id INTO v_pid;

  v_paid   := v_paid + p_amount;
  v_status := CASE WHEN v_paid >= v_amount THEN 'paid' ELSE 'partial' END;

  UPDATE payables SET paid = v_paid, status = v_status WHERE id = p_payable_id;

  RETURN QUERY SELECT v_pid, v_paid, v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.record_payable_payment(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payable_payment(uuid, numeric, text, text) TO authenticated;


-- ---------------------------------------------------------------------
-- Đối soát: tiền đã chi mà công nợ chưa trừ (một chiều)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS _167_vua_va;
CREATE TEMP TABLE _167_vua_va AS
SELECT py.id, COALESCE(py.paid, 0) AS paid_cu, x.tong
FROM payables py
JOIN (SELECT payable_id, sum(amount) AS tong FROM payable_payments GROUP BY payable_id) x
  ON x.payable_id = py.id
WHERE x.tong > COALESCE(py.paid, 0);

UPDATE payables py
SET paid   = v.tong,
    status = CASE WHEN v.tong >= py.amount THEN 'paid' ELSE 'partial' END
FROM _167_vua_va v
WHERE py.id = v.id;

DO $kiem$
BEGIN
  IF to_regprocedure('public.record_payable_payment(uuid,numeric,text,text)') IS NULL THEN
    RAISE EXCEPTION '167: chưa dựng được record_payable_payment' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM payables py
    JOIN (SELECT payable_id, sum(amount) AS tong FROM payable_payments GROUP BY payable_id) x
      ON x.payable_id = py.id
    WHERE x.tong > COALESCE(py.paid, 0)
  ) THEN
    RAISE EXCEPTION '167: vẫn còn công nợ NCC mà tiền đã chi lớn hơn số đã trừ' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 167: trả tiền NCC nay cộng dồn ở máy chủ, trong một giao dịch ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — thứ DUY NHẤT trình soạn SQL của Supabase hiện ra
-- ---------------------------------------------------------------------
SELECT 'Công nợ NCC vừa vá (tiền đã chi > số đã trừ)' AS hang_muc,
       count(*)::text AS so_khoan,
       coalesce(sum(tong - paid_cu), 0)::text AS so_tien
FROM _167_vua_va
UNION ALL
SELECT 'Công nợ NCC ghi trừ nhiều hơn tiền đã chi (đầu kỳ nhập sẵn — bình thường)',
       count(*)::text,
       coalesce(sum(COALESCE(py.paid, 0) - COALESCE(x.tong, 0)), 0)::text
FROM payables py
LEFT JOIN (SELECT payable_id, sum(amount) AS tong FROM payable_payments GROUP BY payable_id) x
  ON x.payable_id = py.id
WHERE COALESCE(py.paid, 0) > COALESCE(x.tong, 0);
