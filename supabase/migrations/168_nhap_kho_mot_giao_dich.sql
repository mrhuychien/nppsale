-- ====================================================================
-- NHẬP KHO (VÀ TỒN ĐẦU KỲ) TRONG MỘT GIAO DỊCH, KÈM CÔNG NỢ NCC
--
-- Rơi ra từ đợt QA 22/09/2026.
--
-- ⚠ TRƯỚC ĐÂY `/inventory/stock-in` và hộp "Nhập tồn đầu kỳ" ở màn Sản
--   phẩm ghi 3–4 lệnh RỜI từ trình duyệt:
--     stock_entries (posted) → batches (có tồn) → stock_entry_lines → payables
--   Không có giao dịch bao trùm, không có bước dọn:
--     · lệnh dòng hỏng ⇒ phiếu `posted` RỖNG và lô đã có tồn mà thẻ kho
--       không có dòng nào;
--     · lệnh công nợ bị RLS chặn với thủ kho ("Manage payables" chỉ cho
--       owner/accountant) — ĐÃ ĐO: warehouse chèn `payables` → 42501 — và
--       màn hình NUỐT lỗi ấy (`console.warn`), vẫn báo "Tồn kho đã được
--       cập nhật". Hàng đã vào kho, khoản phải trả NCC biến mất.
--
-- ⚠ SAU: `post_stock_import(p jsonb)` làm trọn bốn việc trong MỘT giao
--   dịch. Hỏng bất cứ chỗ nào là không có gì được ghi.
--
-- ⚠ VAI: chép RLS "Owner/Warehouse can manage stock entries" (owner,
--   warehouse) — cổng của phiếu kho. Công nợ NCC là HỆ QUẢ kế toán của
--   phiếu nhập có NCC, nên thủ kho lập phiếu thì công nợ được ghi theo —
--   đúng như `complete_purchase_invoice` đã làm cho luồng Phiếu nhập.
--
-- ⚠ TRÌNH DUYỆT VẪN TÍNH quy đổi, giá vốn, mã lô (logic ấy đã có chốt ở
--   phía TS); máy chủ KIỂM: sản phẩm và NCC thuộc NPP mình, số lượng > 0,
--   giá vốn ≥ 0, số tiền công nợ ≥ 0.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.post_stock_import(p jsonb)
RETURNS TABLE (entry_id uuid, entry_code text, payable_id uuid, lines_written int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid := public.user_org_id();
  v_entry    uuid;
  v_code     text := NULLIF(trim(p->>'entry_code'), '');
  v_posted   timestamptz := COALESCE((p->>'posted_at')::timestamptz, now());
  v_supplier uuid := NULLIF(p->>'supplier_id', '')::uuid;
  v_pay_amt  numeric := COALESCE((p->'payable'->>'amount')::numeric, 0);
  v_payable  uuid;
  v_batch    uuid;
  v_n        int := 0;
  l          jsonb;
BEGIN
  IF COALESCE(public.user_role(), '') NOT IN ('owner', 'warehouse') THEN
    RAISE EXCEPTION 'FORBIDDEN: chỉ chủ NPP hoặc thủ kho được lập phiếu nhập kho.'
      USING ERRCODE = '42501';
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: tài khoản chưa gắn đơn vị.' USING ERRCODE = '42501';
  END IF;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: thiếu mã phiếu.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'lines') = 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: phiếu nhập cần ít nhất một dòng hàng.' USING ERRCODE = 'P0001';
  END IF;
  IF v_supplier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM suppliers WHERE id = v_supplier AND org_id = v_org
  ) THEN
    RAISE EXCEPTION 'ORG_MISMATCH: nhà cung cấp không thuộc đơn vị của bạn.' USING ERRCODE = '42501';
  END IF;
  IF v_pay_amt < 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: số tiền công nợ NCC không được âm.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes)
  VALUES (v_org, v_code, 'import', 'posted', v_posted, auth.uid(), v_supplier, NULLIF(p->>'notes', ''))
  RETURNING id INTO v_entry;

  FOR l IN SELECT * FROM jsonb_array_elements(p->'lines')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM products WHERE id = (l->>'product_id')::uuid AND org_id = v_org) THEN
      RAISE EXCEPTION 'ORG_MISMATCH: sản phẩm % không thuộc đơn vị của bạn.', l->>'product_id'
        USING ERRCODE = '42501';
    END IF;
    IF COALESCE((l->>'base_qty')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'BAD_PAYLOAD: dòng % có số lượng không hợp lệ.', v_n + 1 USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE((l->>'base_cost')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'BAD_PAYLOAD: dòng % có giá vốn âm.', v_n + 1 USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO batches (org_id, product_id, batch_code, manufactured_at, expires_at, location,
                         qty_initial, qty_on_hand, unit_cost, received_at)
    VALUES (
      v_org,
      (l->>'product_id')::uuid,
      COALESCE(NULLIF(trim(l->>'batch_code'), ''), 'LOT-' || v_code || '-' || (v_n + 1)),
      NULLIF(l->>'manufactured_at', '')::date,
      COALESCE(NULLIF(l->>'expires_at', '')::date, DATE '2099-12-31'),
      NULLIF(trim(l->>'location'), ''),
      (l->>'base_qty')::numeric,
      (l->>'base_qty')::numeric,
      COALESCE((l->>'base_cost')::numeric, 0),
      -- Khoá thứ tự FIFO (mig 107): ngày GHI SỔ của phiếu, không phải lúc tạo.
      v_posted
    )
    RETURNING id INTO v_batch;

    INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, qty_in_base_uom,
                                   qty_in_transaction_uom, transaction_uom, conversion_factor_snapshot, unit_cost)
    VALUES (
      v_entry,
      (l->>'product_id')::uuid,
      v_batch,
      COALESCE(l->>'unit_name', ''),
      (l->>'base_qty')::numeric,
      (l->>'base_qty')::numeric,
      COALESCE((l->>'qty_tx')::numeric, (l->>'base_qty')::numeric),
      COALESCE(l->>'unit_name', ''),
      COALESCE((l->>'conv')::numeric, 1),
      COALESCE((l->>'base_cost')::numeric, 0)
    );
    v_n := v_n + 1;
  END LOOP;

  IF v_supplier IS NOT NULL AND v_pay_amt > 0 THEN
    INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
    VALUES (v_org, v_supplier, v_entry, NULLIF(trim(p->'payable'->>'invoice_number'), ''),
            v_pay_amt, 0, 'open', 'Nhập kho ' || v_code)
    RETURNING id INTO v_payable;
  END IF;

  RETURN QUERY SELECT v_entry, v_code, v_payable, v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.post_stock_import(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_stock_import(jsonb) TO authenticated;

DO $kiem$
BEGIN
  IF to_regprocedure('public.post_stock_import(jsonb)') IS NULL THEN
    RAISE EXCEPTION '168: chưa dựng được post_stock_import' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 168: nhập kho nay ghi trọn trong một giao dịch, kèm công nợ NCC ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — thứ DUY NHẤT trình soạn SQL của Supabase hiện ra.
-- Đếm DẤU VẾT của lỗi cũ trên dữ liệu thật (migration này KHÔNG sửa
-- chúng — cần người xem từng phiếu).
-- ---------------------------------------------------------------------
SELECT 'Phiếu nhập có NCC mà không có công nợ NCC (dấu vết lỗi nuốt 42501)' AS hang_muc,
       count(*)::text AS so_phieu,
       coalesce(string_agg(se.entry_code, ', ' ORDER BY se.posted_at DESC), '') AS ma_phieu
FROM stock_entries se
WHERE se.type = 'import' AND se.status = 'posted' AND se.supplier_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM payables py WHERE py.stock_entry_id = se.id)
  AND NOT EXISTS (SELECT 1 FROM purchase_invoices pi WHERE pi.stock_entry_id = se.id)
  AND se.entry_code LIKE 'IN-%'
UNION ALL
SELECT 'Phiếu nhập đã ghi sổ mà không có dòng nào (dấu vết ghi nửa chừng)',
       count(*)::text,
       coalesce(string_agg(se.entry_code, ', ' ORDER BY se.posted_at DESC), '')
FROM stock_entries se
WHERE se.type = 'import' AND se.status = 'posted'
  AND NOT EXISTS (SELECT 1 FROM stock_entry_lines l WHERE l.entry_id = se.id);
