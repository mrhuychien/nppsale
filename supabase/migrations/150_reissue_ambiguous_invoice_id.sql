-- ====================================================================
-- 150_reissue_ambiguous_invoice_id
--
-- SỬA HÓA ĐƠN CÓ PHIẾU TRẢ: "column reference invoice_id is ambiguous"
--
-- ⚠ CHỦ NHÀ BÁO 21/09/2026: "khi sửa hoá đơn chỉnh hàng trả về thì báo
--   lỗi column reference "invoice_id" is ambiguous".
--
-- NGUYÊN NHÂN. `reissue_invoice` khai báo
--   RETURNS TABLE (invoice_id uuid, invoice_code text, ...)
-- Mỗi tên trong `RETURNS TABLE` là một BIẾN OUT của plpgsql, có mặt
-- trong toàn thân hàm. Nên câu
--   SELECT ... FROM returns WHERE invoice_id = p_invoice_id
-- có `invoice_id` vừa là biến OUT vừa là cột của `returns` — Postgres
-- từ chối đoán, và ném lỗi ngay giữa giao dịch.
--
-- ⚠ LỖI NÀY CÓ TỪ MIGRATION 125, KHÔNG PHẢI DO 149. Câu ấy nằm nguyên
--   ở bản gốc. Trước 149 nó không nổ ra vì phép kiểm
--   REISSUE_BREAKS_RETURN đứng TRƯỚC và luôn từ chối trước khi chạy tới
--   dòng này — mọi lần sửa hóa đơn có phiếu trả đang chờ đều dừng ở câu
--   lỗi "huỷ phiếu trả trước". 149 làm phép kiểm ấy đi qua được, và cái
--   bẫy nằm sau nó lộ ra. Một lỗi ngủ đông sau một lỗi khác.
--
-- CÁCH SỬA: gọi đích danh `returns.invoice_id`. KHÔNG dùng
-- `#variable_conflict use_column` — nó đổi cách hiểu của CẢ thân hàm,
-- nên một biến khác trùng tên cột ở chỗ khác sẽ lặng lẽ đổi nghĩa.
-- Gọi đích danh chỉ sửa đúng chỗ sai, và đọc lên là thấy ngay.
--
-- ⚠ VẾ `SET invoice_id = ...` KHÔNG PHẢI LỖI và giữ nguyên: đích của
--   `SET` trong `UPDATE` luôn là cột, không bao giờ là biến, nên không
--   có gì để nhập nhằng.
--
-- Ngoài một dòng ấy, hàm giữ NGUYÊN bản 149.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.reissue_invoice(p_invoice_id uuid, p jsonb)
RETURNS TABLE (
  invoice_id uuid, invoice_code text, entry_id uuid, receivable_id uuid,
  short_qty numeric, near_expiry_skipped int, order_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old     record;
  v_new     record;
  v_missing text;
  v_payload jsonb;
  v_rets    uuid[];
  v_edited  int;
BEGIN
  SELECT si.id, si.org_id, si.order_id, si.invoice_code, si.status INTO v_old
  FROM sales_invoices si WHERE si.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_old.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ ÁP PHẦN SỬA PHIẾU TRẢ TRƯỚC KHI KIỂM (mig 149). Người dùng bỏ một
  --   món khỏi hóa đơn thì cũng bỏ dòng trả tương ứng, và phép kiểm
  --   ngay dưới nhìn thấy trạng thái ĐÃ sửa chứ không phải trạng thái cũ.
  v_edited := public._apply_return_edits(p_invoice_id, p->'return_edits');

  -- ⚠ Kiểm TRƯỚC KHI huỷ. Kiểm sau thì giao dịch có rollback thật,
  --   nhưng người dùng đã thấy "đang huỷ hóa đơn…" rồi mới nhận lỗi —
  --   và không cách nào biết hóa đơn cũ còn hay mất.
  SELECT string_agg(DISTINCT pr.name, ', ') INTO v_missing
  FROM return_lines rl
  JOIN returns r ON r.id = rl.return_id
  LEFT JOIN products pr ON pr.id = rl.product_id
  WHERE r.invoice_id = p_invoice_id
    AND r.status IN ('draft', 'submitted')
    AND rl.is_exchange = false
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
      WHERE (l->>'product_id')::uuid = rl.product_id
        AND COALESCE((l->>'quantity')::numeric, 0) > 0
        AND COALESCE((l->>'is_exchange')::boolean, false) = false
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'REISSUE_BREAKS_RETURN: hóa đơn mới không còn bán "%" mà phiếu trả đang chờ xử lý đòi trả. Bỏ dòng trả đó ở khối "Hàng đổi / trả kèm đơn" rồi lưu lại.',
      v_missing USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ Phiếu trả đang chờ được gỡ khỏi hóa đơn cũ TRƯỚC khi huỷ, nếu
  --   không `cancel_invoice` sẽ huỷ luôn chúng (PATCH 1 nói rõ: chuyển
  --   sang hóa đơn mới, KHÔNG huỷ). Tạm để `invoice_id` rỗng trong vài
  --   dòng lệnh, rồi nối lại ngay dưới.
  --
  -- ⚠ GHI NHỚ ĐÍCH DANH TỪNG PHIẾU. Nối lại bằng điều kiện
  --   "cùng đơn và `invoice_id` rỗng" sẽ vơ luôn những phiếu trả vốn dĩ
  --   đã rỗng từ trước — phiếu trả độc lập của đơn này bỗng dưng bị gắn
  --   vào một hóa đơn nó không liên quan.
  --
  -- ⚠ `returns.invoice_id` GỌI ĐÍCH DANH — ĐÂY LÀ CHỖ SỬA CỦA MIG 150.
  --   Để trần thì nó đụng biến OUT cùng tên ở `RETURNS TABLE`, và
  --   Postgres từ chối đoán.
  SELECT COALESCE(array_agg(id), '{}') INTO v_rets
  FROM returns
  WHERE returns.invoice_id = p_invoice_id AND status IN ('draft', 'submitted');

  UPDATE returns SET invoice_id = NULL WHERE id = ANY(v_rets);

  PERFORM public.cancel_invoice(
    p_invoice_id, 'Lập lại hóa đơn ' || v_old.invoice_code);

  v_payload := jsonb_set(COALESCE(p, '{}'::jsonb), '{order_id}',
                         to_jsonb(v_old.order_id::text));

  SELECT * INTO v_new FROM public.post_invoice(v_payload);

  UPDATE sales_invoices SET replaced_by   = v_new.invoice_id WHERE id = p_invoice_id;
  UPDATE sales_invoices SET replaced_from = p_invoice_id     WHERE id = v_new.invoice_id;

  UPDATE returns SET invoice_id = v_new.invoice_id WHERE id = ANY(v_rets);

  -- ⚠ PHIẾU TRẢ RỖNG DÒNG THÌ HUỶ HẲN, ĐỪNG ĐỂ NẰM CHỜ (mig 149).
  UPDATE returns
  SET status = 'cancelled',
      cancel_reason = 'Bỏ hết dòng trả khi sửa hóa đơn ' || v_old.invoice_code
  WHERE id = ANY(v_rets)
    AND status IN ('draft', 'submitted')
    AND NOT EXISTS (SELECT 1 FROM return_lines rl WHERE rl.return_id = returns.id);

  RETURN QUERY SELECT v_new.invoice_id, v_new.invoice_code, v_new.entry_id,
                      v_new.receivable_id, v_new.short_qty,
                      v_new.near_expiry_skipped, v_new.order_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reissue_invoice(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_ok boolean;
BEGIN
  -- Câu trần ấy không được còn trong bản ĐANG CHẠY.
  SELECT pg_get_functiondef(pr.oid) NOT LIKE '%WHERE invoice_id = p_invoice_id%'
    INTO v_ok
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'reissue_invoice';

  IF v_ok THEN
    RAISE NOTICE '--- 150: reissue_invoice đã gọi đích danh returns.invoice_id — sửa hóa đơn có phiếu trả chạy được ---';
  ELSE
    RAISE WARNING '--- 150 ⚠ reissue_invoice VẪN còn câu trần `invoice_id` — sửa hóa đơn có phiếu trả sẽ còn lỗi ---';
  END IF;
END $$;
