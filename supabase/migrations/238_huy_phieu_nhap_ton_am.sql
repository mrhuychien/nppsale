-- ====================================================================
-- 238 — HUỶ ĐƯỢC PHIẾU NHẬP ĐÃ XUẤT BỚT KHI ĐƠN VỊ CHO PHÉP TỒN KHO ÂM
--
-- VÌ SAO — chủ nhà 08/10/2026: "Hiện tại ko huỷ được phiếu nhập khi đã xuất kho 1 lượng. Trường hợp cho phép tồn kho
--   âm, hành động huỷ phiếu nhập được cho phép."
--   `cancel_purchase_invoice` (mig 142, cổng vai mig 166) chặn HANG_DA_XUAT hễ một lô của phiếu đã xuất bớt — kể cả
--   khi NPP đã bật "Cho phép bán vượt tồn kho" (`organizations.allow_oversell`, mig 138 / 222), tức là đã chấp nhận
--   tồn kho âm ở mọi phiếu xuất.
--
-- CÁCH LÀM — chép NGUYÊN bản đang chạy, chỉ đổi:
--   1. Bật `allow_oversell` → không chặn HANG_DA_XUAT. Tắt → chặn như cũ, câu báo nói thêm đường gỡ (bật tồn âm).
--   2. Lô của phiếu trừ ĐÚNG SỐ ĐÃ NHẬP: `còn − nhập`. Chưa xuất gì → 0 (y như cũ). Đã xuất X → lô −X: thẻ kho (phiếu
--      nhập huỷ, phiếu xuất còn) và tồn lô cùng một số; huỷ hoá đơn / phiếu xuất về sau cộng trả vào lô thì lô về 0.
--      Lô âm không bao giờ được xuất (mọi đường xuất lấy lô `qty_on_hand > 0`), màn tồn kho chỉ cộng lô dương —
--      y như phần bán vượt của mig 138. Hàng đã bán giữ nguyên giá vốn lúc bán (dấu vết lấy lô không đổi).
--   ⚠ Đã trả tiền NCC (DA_TRA_TIEN) vẫn chặn như cũ — huỷ phiếu là xoá mất khoản đã trả.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_org      uuid;
  v_status   text;
  v_entry    uuid;
  v_payable  uuid;
  v_uid      uuid := auth.uid();
  v_paid     numeric;
  v_bad      text;
  -- (mig 238) NPP cho phép tồn kho âm → huỷ được phiếu nhập dù hàng đã xuất bớt.
  v_cho_am   boolean;
BEGIN
  SELECT org_id, status, stock_entry_id, payable_id
    INTO v_org, v_status, v_entry, v_payable
  FROM purchase_invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu nhập này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu nhập này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ KIỂM VAI (mig 166). Hàm SECURITY DEFINER bỏ qua RLS, nên phải
  --   tự kiểm đúng vai mà RLS của bảng đang kiểm. Bỏ qua khi được
  --   gọi từ trong một RPC khác đã tự kiểm quyền (npp.via_rpc).
  IF current_setting('npp.via_rpc', true) IS DISTINCT FROM 'on'
     AND COALESCE(public.user_role(), '') NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không được làm thao tác kho / mua hàng này.'
      USING ERRCODE = '42501';
  END IF;
  -- Idempotent.
  IF v_status = 'cancelled' THEN
    RETURN p_invoice_id;
  END IF;

  -- Phiếu còn tạm thì huỷ là đổi một chữ; chưa đụng gì tới kho hay nợ.
  IF v_status = 'draft' THEN
    UPDATE purchase_invoices
    SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
        cancel_reason = p_reason
    WHERE id = p_invoice_id;
    RETURN p_invoice_id;
  END IF;

  -- 4.1 Tiền đã trả rồi thì không huỷ được.
  IF v_payable IS NOT NULL THEN
    SELECT COALESCE(paid, 0) INTO v_paid FROM payables WHERE id = v_payable;
    IF COALESCE(v_paid, 0) > 0 THEN
      RAISE EXCEPTION 'DA_TRA_TIEN: Phiếu này đã trả NCC % — huỷ phiếu là xoá mất khoản đã trả. Gỡ phiếu chi trước, hoặc lập phiếu trả hàng NCC.', v_paid
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT COALESCE(allow_oversell, false) INTO v_cho_am FROM organizations WHERE id = v_org;

  -- 4.2 Hàng đã động thì không huỷ được — TRỪ KHI NPP cho phép tồn kho âm (mig 238). Nói rõ MẶT HÀNG NÀO — bắt
  --     người dùng tự dò cả phiếu là bỏ phí việc mình vừa tra ra.
  IF v_entry IS NOT NULL THEN
    SELECT string_agg(
             p.name || ' (nhập ' || b.qty_initial || ', còn ' || b.qty_on_hand || ')',
             ' · ' ORDER BY p.name)
      INTO v_bad
    FROM stock_entry_lines sel
    JOIN batches  b ON b.id = sel.batch_id
    JOIN products p ON p.id = sel.product_id
    WHERE sel.entry_id = v_entry
      AND b.qty_on_hand <> b.qty_initial;

    IF v_bad IS NOT NULL AND NOT COALESCE(v_cho_am, false) THEN
      RAISE EXCEPTION 'HANG_DA_XUAT: Không huỷ được vì hàng của phiếu đã xuất bớt — %. Lập phiếu trả hàng NCC hoặc phiếu điều chỉnh kho — hoặc bật "Cho phép bán vượt tồn kho" (Cài đặt › Đơn vị) để huỷ: phần đã xuất thành tồn âm.', v_bad
        USING ERRCODE = 'P0001';
    END IF;

    -- (mig 238) Trừ ĐÚNG SỐ ĐÃ NHẬP khỏi lô rồi đóng phiếu kho. Chưa xuất gì → 0 như cũ; đã xuất X (chỉ khi cho phép
    --   tồn âm) → lô −X, khớp thẻ kho. Lô còn dương (hàng trả về vượt số đã xuất) thì giữ mở cho số hàng ấy.
    UPDATE batches b
    SET qty_on_hand = b.qty_on_hand - b.qty_initial,
        status = CASE WHEN b.qty_on_hand - b.qty_initial > 0 THEN b.status ELSE 'cancelled' END
    FROM stock_entry_lines sel
    WHERE sel.entry_id = v_entry AND b.id = sel.batch_id;

    UPDATE stock_entries SET status = 'cancelled' WHERE id = v_entry;
  END IF;

  /**
   * 4.3 Đóng phiếu TRƯỚC, xoá công nợ SAU.
   *
   * ⚠ THỨ TỰ NÀY LÀ BẮT BUỘC, KHÔNG PHẢI SỞ THÍCH.
   *   `purchase_invoices.payable_id` có khoá ngoại trỏ tới `payables`,
   *   nên xoá dòng nợ khi phiếu còn trỏ vào nó là Postgres từ chối
   *   ("still referenced from table"). Phải gỡ con trỏ trước.
   *
   * ⚠ XOÁ HẲN DÒNG NỢ, KHÔNG ĐÁNH DẤU. `payables.status` chỉ nhận
   *   open/partial/paid/overdue — không có 'cancelled'. Để nó lại ở
   *   'open' là một khoản nợ ma vẫn cộng vào công nợ NCC mãi mãi. Vết
   *   tích nằm ở chính phiếu: `cancelled_at`, `cancelled_by`,
   *   `cancel_reason`. An toàn vì mục 4.1 đã chắc chắn chưa trả đồng nào.
   */
  UPDATE purchase_invoices
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
      cancel_reason = p_reason, payable_id = NULL
  WHERE id = p_invoice_id;

  IF v_payable IS NOT NULL THEN
    DELETE FROM payables WHERE id = v_payable;
  END IF;

  RETURN p_invoice_id;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.cancel_purchase_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_invoice(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 238: huỷ phiếu nhập đã xuất bớt khi cho phép tồn kho âm' AS buoc,
       CASE WHEN position('v_cho_am' IN pg_get_functiondef('public.cancel_purchase_invoice(uuid,text)'::regprocedure)) > 0
             AND position('b.qty_on_hand - b.qty_initial' IN pg_get_functiondef('public.cancel_purchase_invoice(uuid,text)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM organizations WHERE allow_oversell) AS npp_cho_ton_am;
