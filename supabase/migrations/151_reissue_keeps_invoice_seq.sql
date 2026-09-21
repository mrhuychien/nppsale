-- ====================================================================
-- 151_reissue_keeps_invoice_seq
--
-- TRẢ LẠI SỐ HÓA ĐƠN DẠNG HD-0042-1 KHI SỬA — thay vì cấp một số mới.
--
-- ⚠ CHỦ NHÀ BÁO 21/09/2026: "tại sao sửa hoá đơn lại ra 1 số hoá đơn
--   mới chứ ko phải bản cập nhật dạng -1 -2 như cũ".
--
-- ĐÂY LÀ LỖI DO MIGRATION 149 GÂY RA, KHÔNG PHẢI THIẾT KẾ.
--
-- Migration 128 dựng đúng cái chủ nhà mô tả: `invoice_seq` là số của tờ
-- GỐC, `reissue_no` là lần sửa, và `_inv_code()` ghép ra `HD-0042-1`.
-- Nó làm điều đó bằng cách VÁ CHUỖI thân hàm đang chạy
-- (`pg_get_functiondef` rồi `replace`), chèn vào `reissue_invoice` một
-- câu gắn `reissue_of` vào tải trọng gửi xuống `post_invoice`.
--
-- Migration 149 của tôi viết lại `reissue_invoice` bằng
-- `CREATE OR REPLACE`, chép thân hàm từ MIGRATION 125 — bản có TRƯỚC
-- khi 128 vá. Lệnh ấy ghi đè cả hàm, nên hai miếng vá của 128 biến mất
-- không một tiếng động:
--
--   1. mất câu gắn `reissue_of`  → bản sửa được cấp SỐ MỚI, mất hẳn mối
--      liên hệ với tờ gốc. Đây là thứ chủ nhà nhìn thấy.
--   2. mất bí danh `rr` ở câu gom phiếu trả → lỗi "column reference
--      invoice_id is ambiguous" quay lại. Migration 150 đã vá lại phần
--      này, nhưng lúc ấy tôi tưởng đó là lỗi ngủ đông từ mig 125 chứ
--      không biết mình vừa tự tay làm hỏng nó.
--
-- ⚠ BÀI HỌC, GHI LẠI ĐỂ KHỎI LẶP: `CREATE OR REPLACE FUNCTION` chép
--   thân hàm từ một migration CŨ sẽ ÂM THẦM XOÁ mọi miếng vá của các
--   migration sau nó. Muốn viết lại cả hàm thì phải chép từ bản ĐANG
--   CHẠY (`pg_get_functiondef`), không phải từ tệp cũ nhất tìm thấy.
--   Kho mã này đã có luật ấy cho chốt kiểm thử ("soi bản ĐANG CHẠY");
--   tôi đã không áp dụng nó cho chính migration.
--
-- ⚠ VÌ SAO KHÔNG VÁ CHUỖI NHƯ 128. Vá chuỗi là thứ khiến lỗi này khó
--   thấy ngay từ đầu — miếng vá không nằm trong tệp nào cả, chỉ tồn tại
--   trong cơ sở dữ liệu. Ở đây bản đang chạy là mig 150, do chính tôi
--   viết và đọc được, nên viết lại trọn hàm KÈM cả hai miếng vá là rõ
--   ràng hơn: từ nay đọc một tệp là thấy hết.
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
  --   không `cancel_invoice` sẽ huỷ luôn chúng. Tạm để `invoice_id`
  --   rỗng trong vài dòng lệnh, rồi nối lại ngay dưới.
  --
  -- ⚠ BÍ DANH `rr` — MIẾNG VÁ CỦA MIG 128, mục 6.2. `RETURNS TABLE
  --   (invoice_id uuid, …)` biến `invoice_id` thành BIẾN của hàm, nên
  --   một tên trần ở đây là "column reference invoice_id is ambiguous"
  --   NGAY GIỮA GIAO DỊCH. Postgres chỉ phát hiện lúc CHẠY, không phải
  --   lúc tạo hàm.
  SELECT COALESCE(array_agg(rr.id), '{}') INTO v_rets
  FROM returns rr
  WHERE rr.invoice_id = p_invoice_id AND rr.status IN ('draft', 'submitted');

  UPDATE returns SET invoice_id = NULL WHERE id = ANY(v_rets);

  PERFORM public.cancel_invoice(
    p_invoice_id, 'Lập lại hóa đơn ' || v_old.invoice_code);

  v_payload := jsonb_set(COALESCE(p, '{}'::jsonb), '{order_id}',
                         to_jsonb(v_old.order_id::text));
  -- ⚠ MIẾNG VÁ CỦA MIG 128, mục 6 — THỨ MIGRATION 149 ĐÃ LÀM MẤT.
  --   `post_invoice` thấy `reissue_of` thì DÙNG LẠI `invoice_seq` của tờ
  --   cũ và tăng `reissue_no`, cho ra HD-0042-1. Không có câu này thì nó
  --   cấp một số chạy mới, và người tra sổ nhìn HD-0042 với HD-0087
  --   không tài nào biết tờ sau thay tờ trước.
  v_payload := jsonb_set(v_payload, '{reissue_of}',
                         to_jsonb(p_invoice_id::text));

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

-- --------------------------------------------------------------------
-- Kiểm BẢN ĐANG CHẠY, không kiểm tệp.
--
-- ⚠ ĐÚNG CÁI ĐÃ CỨU ĐƯỢC LẦN NÀY NẾU CÓ TỪ TRƯỚC. Mig 149 tạo hàm
--   SẠCH về cú pháp, nên mọi phép kiểm cấu trúc đều xanh; thứ mất đi
--   chỉ lộ ra khi đọc thân hàm đang chạy trong cơ sở dữ liệu.
-- --------------------------------------------------------------------
DO $$
DECLARE v_src text; v_thieu text := '';
BEGIN
  SELECT pg_get_functiondef(pr.oid) INTO v_src
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'reissue_invoice';

  IF position('{reissue_of}' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [mất miếng vá reissue_of của mig 128 — bản sửa sẽ mang số mới]';
  END IF;
  IF position('rr.invoice_id = p_invoice_id' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [mất bí danh rr — sẽ lỗi invoice_id is ambiguous]';
  END IF;
  IF position('_apply_return_edits' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [mất phần sửa phiếu trả của mig 149]';
  END IF;

  IF v_thieu = '' THEN
    RAISE NOTICE '--- 151: reissue_invoice đủ cả ba phần — giữ số gốc HD-xxxx-n, hết nhập nhằng, sửa được phiếu trả ---';
  ELSE
    RAISE WARNING '--- 151 ⚠ reissue_invoice THIẾU:% ---', v_thieu;
  END IF;
END $$;
