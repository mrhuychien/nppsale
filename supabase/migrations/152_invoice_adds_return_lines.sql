-- ====================================================================
-- 152_invoice_adds_return_lines
--
-- THÊM HÀNG ĐỔI / TRẢ NGAY TRÊN MÀN XUẤT HÀNG VÀ SỬA HÓA ĐƠN.
--
-- ⚠ CHỦ NHÀ BÁO 21/09/2026: "Sao phần Tạo hoá đơn (Xuất hàng) và Sửa
--   hoá đơn không thêm được hàng đổi / trả. Tao muốn nó đủ chức năng
--   như khi Tạo đơn hàng cơ mà?".
--
-- Migration 149 mới cho SỬA và BỎ dòng trả đã có. Thiếu hẳn việc THÊM —
-- mà khách đưa hàng trả lại đúng lúc giao là chuyện thường ngày, và
-- người xuất hàng đang đứng ngay đó.
--
-- ⚠ THÊM DÒNG THÌ PHẢI CÓ PHIẾU ĐỂ GẮN VÀO. Ba trường hợp, xử lý khác
--   nhau, và gộp lại là sai một trong ba:
--     1. Đơn đã có phiếu trả đang chờ → thêm vào phiếu ấy.
--     2. Chưa có phiếu nào → DỰNG một phiếu mới, gắn đúng đơn và khách.
--     3. Có nhiều phiếu đang chờ → lấy phiếu CŨ NHẤT. Gộp vào một chỗ
--        thì người xử lý kho chỉ phải mở một phiếu; rải ra là mỗi lần
--        thêm một dòng lại sinh một phiếu mới.
--
-- ⚠ KHÔNG TỰ ĐẶT TRẠNG THÁI 'submitted' CHO PHIẾU MỚI. Phiếu trả kèm
--   đơn nằm ở `draft` cho tới khi hàng thực sự rời kho; `post_invoice`
--   (mig 125) mới là chỗ đẩy nó sang `submitted` và gắn `invoice_id`.
--   Tự đặt ở đây là một phiếu đòi nhập kho cho hàng chưa từng xuất.
--
-- ⚠ `line_total` TÍNH Ở SERVER, y như mig 149 — con số ấy đi thẳng vào
--   `credit_note_amount` rồi vào công nợ.
--
-- ⚠ VÀ TRẦN SỐ ĐƯỢC TRẢ VẪN DO `complete_return` GIỮ. Migration này chỉ
--   ghi ý định; lúc nhập kho thật, `complete_return` (mig 127) mới so
--   với số đã thực xuất trên hóa đơn và từ chối nếu trả quá. Không nhân
--   đôi luật ấy ở đây — hai bản của cùng một trần là hai bản sẽ lệch
--   nhau.
-- ====================================================================

-- --------------------------------------------------------------------
-- Phiếu trả đang chờ của một đơn — có thì lấy, không thì dựng.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pending_return_for(
  p_order_id uuid,
  p_invoice_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ret uuid;
  o     record;
BEGIN
  -- ⚠ CŨ NHẤT TRƯỚC. Gộp mọi dòng thêm tay vào MỘT phiếu để người xử lý
  --   kho chỉ phải mở một chỗ.
  SELECT r.id INTO v_ret
  FROM returns r
  WHERE r.order_id = p_order_id
    AND r.status IN ('draft', 'submitted')
  ORDER BY r.created_at
  LIMIT 1;

  IF v_ret IS NOT NULL THEN
    RETURN v_ret;
  END IF;

  SELECT so.id, so.org_id, so.customer_id INTO o
  FROM sales_orders so WHERE so.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO returns (org_id, order_id, customer_id, requested_by, invoice_id, status, reason)
  VALUES (o.org_id, o.id, o.customer_id, auth.uid(), p_invoice_id, 'draft', 'damaged')
  RETURNING id INTO v_ret;

  RETURN v_ret;
END;
$$;

COMMENT ON FUNCTION public._pending_return_for(uuid, uuid) IS
  'Phiếu trả đang chờ của một đơn; dựng mới nếu chưa có. Phiếu mới luôn ở '
  'draft — post_invoice mới là chỗ đẩy sang submitted khi hàng rời kho.';


-- --------------------------------------------------------------------
-- Thêm dòng hàng đổi / trả.
--
-- Hình dạng mỗi phần tử:
--   { product_id, unit_name, quantity, unit_price, vat_rate, is_exchange, note }
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_return_adds(
  p_order_id   uuid,
  p_invoice_id uuid,
  p_adds       jsonb
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a       jsonb;
  v_ret   uuid;
  v_qty   numeric;
  v_price numeric;
  v_vat   numeric;
  v_count int := 0;
BEGIN
  IF p_adds IS NULL OR jsonb_typeof(p_adds) <> 'array'
     OR jsonb_array_length(p_adds) = 0 THEN
    RETURN 0;
  END IF;

  -- ⚠ CHỈ DỰNG PHIẾU KHI THẬT SỰ CÓ DÒNG ĐỂ THÊM. Gọi sớm hơn là mỗi
  --   lần lưu hóa đơn lại đẻ một phiếu trả rỗng.
  v_ret := public._pending_return_for(p_order_id, p_invoice_id);

  FOR a IN SELECT * FROM jsonb_array_elements(p_adds)
  LOOP
    v_qty   := COALESCE((a->>'quantity')::numeric, 0);
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;
    v_price := COALESCE((a->>'unit_price')::numeric, 0);
    v_vat   := COALESCE((a->>'vat_rate')::numeric, 0);

    INSERT INTO return_lines (
      return_id, product_id, unit_name, quantity, unit_price, vat_rate,
      line_total, is_exchange, note
    ) VALUES (
      v_ret,
      (a->>'product_id')::uuid,
      COALESCE(a->>'unit_name', ''),
      v_qty,
      v_price,
      v_vat,
      -- ⚠ CÙNG CÔNG THỨC VỚI `toReturnLine` VÀ `_apply_return_edits`.
      --   Lệch một đồng là người dùng đọc cho khách một con số, còn sổ
      --   ghi một con số khác.
      round(v_qty * v_price * (1 + v_vat)),
      COALESCE((a->>'is_exchange')::boolean, false),
      NULLIF(a->>'note', '')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public._apply_return_adds(uuid, uuid, jsonb) IS
  'Thêm dòng hàng đổi/trả vào phiếu trả đang chờ của đơn, dựng phiếu nếu '
  'chưa có. line_total tính ở server. Trần số được trả vẫn do '
  'complete_return giữ.';


-- --------------------------------------------------------------------
-- `reissue_invoice` — nhận thêm `return_adds`.
--
-- ⚠ CHÉP TỪ BẢN ĐANG CHẠY (mig 151), KHÔNG TỪ TỆP CŨ. Đây đúng là lỗi
--   đã làm mất số hóa đơn HD-xxxx-n hôm nay: mig 149 chép thân hàm từ
--   mig 125 và xoá sạch miếng vá của mig 128. Bản dưới giữ đủ cả ba
--   phần — `reissue_of`, bí danh `rr`, và `_apply_return_edits`.
-- --------------------------------------------------------------------
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
  v_added   int;
BEGIN
  SELECT si.id, si.org_id, si.order_id, si.invoice_code, si.status INTO v_old
  FROM sales_invoices si WHERE si.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_old.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ SỬA/BỎ TRƯỚC (mig 149), THÊM SAU (mig 152) — rồi mới kiểm.
  --   Thứ tự ấy có ý: một dòng vừa thêm KHÔNG được mang `line_id` nào
  --   để bị chính lượt sửa này bỏ đi.
  v_edited := public._apply_return_edits(p_invoice_id, p->'return_edits');
  v_added  := public._apply_return_adds(v_old.order_id, p_invoice_id, p->'return_adds');

  -- ⚠ Kiểm TRƯỚC KHI huỷ. Kiểm sau thì giao dịch có rollback thật,
  --   nhưng người dùng đã thấy "đang huỷ hóa đơn…" rồi mới nhận lỗi.
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

  -- ⚠ BÍ DANH `rr` — MIẾNG VÁ CỦA MIG 128, mục 6.2. Tên trần ở đây là
  --   "column reference invoice_id is ambiguous" ngay giữa giao dịch.
  SELECT COALESCE(array_agg(rr.id), '{}') INTO v_rets
  FROM returns rr
  WHERE rr.invoice_id = p_invoice_id AND rr.status IN ('draft', 'submitted');

  UPDATE returns SET invoice_id = NULL WHERE id = ANY(v_rets);

  PERFORM public.cancel_invoice(
    p_invoice_id, 'Lập lại hóa đơn ' || v_old.invoice_code);

  v_payload := jsonb_set(COALESCE(p, '{}'::jsonb), '{order_id}',
                         to_jsonb(v_old.order_id::text));
  -- ⚠ GỠ `return_adds` TRƯỚC KHI GỌI `post_invoice` — NẾU KHÔNG DÒNG
  --   TRẢ BỊ THÊM HAI LẦN. `reissue_invoice` đã áp phần thêm ở trên (để
  --   phép kiểm nhìn thấy), rồi nó gọi `post_invoice` với CÙNG tải
  --   trọng ấy, mà `post_invoice` nay cũng áp `return_adds`. Đo trên
  --   Postgres thật trước khi phát hành: thêm 1 dòng trả 216.000 và 1
  --   dòng đổi thì sổ ghi thành hai bản mỗi loại, credit vọt từ
  --   316.000 lên 532.000 — tiền trừ công nợ khách GẤP ĐÔI.
  --
  -- ⚠ CHỈ GỠ `return_adds`. `return_edits` thì `post_invoice` không
  --   đụng tới, gỡ luôn là dọn một thứ không ai nhờ và che mất ý định
  --   của tải trọng khi đọc lại sau này.
  v_payload := v_payload - 'return_adds';
  -- ⚠ MIẾNG VÁ CỦA MIG 128, mục 6 — giữ số gốc HD-xxxx-n.
  v_payload := jsonb_set(v_payload, '{reissue_of}',
                         to_jsonb(p_invoice_id::text));

  SELECT * INTO v_new FROM public.post_invoice(v_payload);

  UPDATE sales_invoices SET replaced_by   = v_new.invoice_id WHERE id = p_invoice_id;
  UPDATE sales_invoices SET replaced_from = p_invoice_id     WHERE id = v_new.invoice_id;

  UPDATE returns SET invoice_id = v_new.invoice_id WHERE id = ANY(v_rets);

  -- ⚠ PHIẾU TRẢ RỖNG DÒNG THÌ HẠ VỀ PHIẾU TẠM — KHÔNG HUỶ NỮA.
  --
  -- ⚠ MIG 149 HUỶ HẲN, VÀ ĐÓ LÀ MỘT QUYẾT ĐỊNH SAI CỦA TÔI. Chủ nhà
  --   báo 21/09/2026: "tại sao khi huỷ hoá đơn lại huỷ cả phần trả về
  --   của Đơn hàng", kèm ảnh một phiếu trả mang nhãn "Đã huỷ · −0đ".
  --   Huỷ là ghi vào sổ rằng khách CHƯA TỪNG trả hàng — trong khi hàng
  --   có thể đang nằm đó thật, và không còn gì để người xử lý nhìn
  --   thấy. Đúng cái sai mà migration 131 đã sửa một lần cho
  --   `cancel_invoice`; tôi lặp lại nó ở chỗ khác.
  --
  -- ⚠ `draft` LÀ TRẠNG THÁI SẴN CÓ CHO ĐÚNG VIỆC NÀY — chủ nhà hỏi
  --   "có cần để thêm 1 trạng thái phiếu tạm cho phiếu trả để còn back
  --   trạng thái khi huỷ hoá đơn?". Không cần thêm: `cancel_invoice`
  --   (mig 131 + 133) đã hạ phiếu về `draft` và gỡ `invoice_id` đúng
  --   như vậy. Ở đây chỉ việc làm giống nó.
  --
  -- ⚠ VÀ CHỈ ĐỤNG KHI CHÍNH LƯỢT NÀY LÀM RỖNG NÓ (`v_edited > 0`).
  --   Không có điều kiện ấy thì một phiếu vốn dĩ đã rỗng từ trước bị
  --   hạ trạng thái ở lần sửa hóa đơn kế tiếp, dù người dùng không hề
  --   chạm vào nó.
  IF v_edited > 0 THEN
    UPDATE returns
    SET status = 'draft', invoice_id = NULL
    WHERE id = ANY(v_rets)
      AND status IN ('draft', 'submitted')
      AND NOT EXISTS (SELECT 1 FROM return_lines rl WHERE rl.return_id = returns.id);
  END IF;

  RETURN QUERY SELECT v_new.invoice_id, v_new.invoice_code, v_new.entry_id,
                      v_new.receivable_id, v_new.short_qty,
                      v_new.near_expiry_skipped, v_new.order_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reissue_invoice(uuid, jsonb) TO authenticated;


-- --------------------------------------------------------------------
-- `post_invoice` — nhận `return_adds` ở lần XUẤT HÀNG đầu tiên.
--
-- ⚠ VÁ CHUỖI BẢN ĐANG CHẠY, KHÔNG VIẾT LẠI. `post_invoice` đã bị mig
--   128 và mig 131 vá; chép lại thân hàm từ tệp là xoá đúng hai miếng
--   vá ấy — sai lầm của mig 149, không lặp lại.
--
-- ⚠ CHÈN TRƯỚC CÂU GẮN PHIẾU TRẢ. `post_invoice` đẩy phiếu trả của đơn
--   sang `submitted` và gắn `invoice_id`; dòng vừa thêm phải có mặt
--   TRƯỚC lúc đó, nếu không nó nằm lại ở một phiếu `draft` không gắn
--   hóa đơn nào.
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_src  text;
  v_oid  oid;
  v_n    int;
  v_from text;
  v_to   text;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'post_invoice' AND pr.prokind = 'f';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ADD_RET_NO_FN: tìm thấy % bản post_invoice, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pr.oid INTO v_oid
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'post_invoice' AND pr.prokind = 'f';
  v_src := pg_get_functiondef(v_oid);

  -- Đã vá rồi thì thôi — migration chạy lại không được chèn hai lần.
  IF position('_apply_return_adds' IN v_src) > 0 THEN
    RAISE NOTICE '--- 152: post_invoice đã có sẵn miếng vá, bỏ qua ---';
    RETURN;
  END IF;

  -- ⚠ NEO NGẮN VÀ DUY NHẤT. Bản đầu neo cả câu
  --   `UPDATE returns ret SET status = ''submitted'', invoice_id = v_inv`
  --   — nhưng mig 133 đã thêm `credit_with_invoice = true` và ngắt câu
  --   ấy xuống dòng, nên chuỗi dài không còn khớp. Neo càng dài càng
  --   dễ vỡ vì một migration sau đó; `UPDATE returns ret` chỉ xuất
  --   hiện đúng một lần và là thứ khó đổi nhất.
  v_from := 'UPDATE returns ret';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION
      'ADD_RET_SHAPE: không tìm thấy câu gắn phiếu trả (bản vá mig 131) trong post_invoice'
      USING ERRCODE = 'P0001';
  END IF;

  -- Chèn ĐÚNG MỘT LẦN, ngay trước câu ấy.
  v_to := 'PERFORM public._apply_return_adds(v_order, v_inv, p->''return_adds'');'
          || E'\n  ' || v_from;
  IF (length(v_src) - length(replace(v_src, v_from, ''))) / length(v_from) <> 1 THEN
    RAISE EXCEPTION 'ADD_RET_SHAPE: tìm thấy nhiều câu `%` trong post_invoice', v_from
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  EXECUTE v_src;
  RAISE NOTICE '--- 152: post_invoice nhận thêm return_adds — xuất hàng lần đầu cũng thêm được hàng trả ---';
END $$;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_src text; v_thieu text := '';
BEGIN
  SELECT pg_get_functiondef(pr.oid) INTO v_src
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'reissue_invoice';
  IF position('{reissue_of}' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [reissue_invoice mất miếng vá reissue_of]';
  END IF;
  IF position('_apply_return_adds' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [reissue_invoice chưa nhận return_adds]';
  END IF;

  SELECT pg_get_functiondef(pr.oid) INTO v_src
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'post_invoice';
  IF position('_apply_return_adds' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [post_invoice chưa nhận return_adds]';
  END IF;
  IF position('reissue_of' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [post_invoice mất miếng vá reissue_of của mig 128]';
  END IF;
  IF position('UPDATE returns ret' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [post_invoice mất miếng vá mig 131]';
  END IF;

  IF v_thieu = '' THEN
    RAISE NOTICE '--- 152: cả hai đường xuất hóa đơn đều thêm được hàng đổi/trả, và không miếng vá nào bị mất ---';
  ELSE
    RAISE WARNING '--- 152 ⚠ THIẾU:% ---', v_thieu;
  END IF;
END $$;
