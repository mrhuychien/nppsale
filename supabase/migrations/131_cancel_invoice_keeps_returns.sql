-- =====================================================================
-- 131 — HUỶ HÓA ĐƠN THÌ GỠ PHIẾU TRẢ RA, KHÔNG HUỶ NÓ THEO
-- =====================================================================
--
-- VÌ SAO
--   Chủ nhà báo: tạo hóa đơn từ một đơn có hàng trả / hàng đổi, rồi huỷ
--   hóa đơn — phần đổi trả hàng trên màn chi tiết đơn bị gắn chữ "Đã
--   huỷ".
--
--   Đúng là code đang làm vậy. `cancel_invoice` (mig 125) kết bằng:
--
--       UPDATE returns
--       SET status = 'cancelled', …
--       WHERE invoice_id = p_invoice_id AND status IN ('draft','submitted');
--
--   với lý do ghi trong chú thích: "Phiếu trả đang chờ xử lý của hóa đơn
--   này mất chỗ bám."
--
-- ⚠ LÝ DO ẤY SAI VỚI PHIẾU TRẢ KÈM ĐƠN. Phiếu trả kèm đơn sinh ra từ lúc
--   NVBH lên đơn — TRƯỚC khi có hóa đơn nào. Nó bám vào ĐƠN
--   (`returns.order_id`), và `post_invoice` chỉ nhấc nó từ 'draft' lên
--   'submitted' rồi gắn thêm `invoice_id`. Huỷ hóa đơn là huỷ đúng cái
--   việc `post_invoice` vừa làm — chứ không phải huỷ luôn phiếu trả.
--
--   Hàng khách trả vẫn đang nằm ở đó ngoài đời. Gắn chữ "Đã huỷ" lên nó
--   là ghi vào sổ rằng khách chưa từng trả hàng, và người xử lý đơn lần
--   sau không còn gì để nhìn thấy mà xử lý.
--
-- ⚠ PHIẾU TRẢ ĐỘC LẬP THÌ NGƯỢC LẠI — HUỶ LÀ ĐÚNG. Phiếu không gắn đơn
--   nào (`order_id IS NULL`) chỉ trỏ vào đúng hóa đơn này; hóa đơn mất
--   thì nó mất chỗ bám thật. Nên bản vá tách đôi theo `order_id`, không
--   bỏ hẳn phép huỷ.
--
-- ⚠ GỠ LIÊN KẾT LÀ ĐỦ, KHÔNG CẦN HẠ TRẠNG THÁI. Phiếu quay về đúng chỗ
--   cũ: bám vào đơn, `invoice_id` rỗng. Lần xuất hóa đơn sau
--   `post_invoice` gắn lại bằng chính câu nó vẫn dùng
--   (`WHERE order_id = v_order AND status = 'draft'`), còn phiếu đã
--   'submitted' thì `_wf2_recompute_receivable` nhận nuôi khi đơn có
--   đúng một hóa đơn đã ghi sổ.
--
-- ⚠ VÁ BẰNG CÁCH THAY CÂU, KHÔNG CHÉP LẠI CẢ HÀM. `cancel_invoice` dài
--   ~150 dòng và phần hoàn kho theo lô là phần dễ chép sai nhất. Chép
--   lại nguyên văn ở đây là từ nay có hai bản, và bản nào đúng thì phải
--   đọc cả hai mới biết. Thay đúng một câu, và DỪNG NGAY nếu câu ấy
--   không còn hình dạng cũ.

-- ---------------------------------------------------------------------
-- 1. Vá `cancel_invoice`
-- ---------------------------------------------------------------------
DO $patch$
DECLARE
  v_oid   oid;
  v_src   text;
  v_stmt  text;
  v_new   text;
  v_n     int;
  v_re    text := 'UPDATE returns[^;]+status IN \(''draft'', ''submitted''\);';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cancel_invoice';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'CANCEL_INVOICE_MISSING: chưa có hàm cancel_invoice — chạy migration 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  -- Đã vá rồi thì đứng yên. Migration phải chạy lại được mà không đổi gì.
  IF position('order_id IS NULL' in v_src) > 0
     AND position('SET invoice_id = NULL' in v_src) > 0 THEN
    RAISE NOTICE '131: cancel_invoice đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');

  IF v_n <> 1 THEN
    -- ⚠ IN RA THỨ TÌM THẤY. Mig 126 đã học bài này một lần: báo "không
    --   đúng hình dạng" mà không nói hình dạng hiện tại là gì thì người
    --   chạy migration không có đường nào sửa tay.
    RAISE EXCEPTION
      'CANCEL_INVOICE_SHAPE: tìm thấy % câu huỷ phiếu trả trong cancel_invoice (cần đúng 1). Thân hàm hiện tại:%',
      v_n, E'\n' || v_src
      USING ERRCODE = 'P0001';
  END IF;

  v_stmt := substring(v_src from v_re);

  v_new :=
    '-- ⚠ PHIẾU TRẢ KÈM ĐƠN CHỈ GỠ KHỎI HÓA ĐƠN, KHÔNG HUỶ (mig 131).' || E'\n'
    || '  --   Nó có từ lúc lên đơn, trước khi có hóa đơn nào; huỷ theo là' || E'\n'
    || '  --   ghi vào sổ rằng khách chưa từng trả hàng.' || E'\n'
    || '  UPDATE returns' || E'\n'
    || '  SET invoice_id = NULL' || E'\n'
    || '  WHERE invoice_id = p_invoice_id' || E'\n'
    || '    AND status IN (''draft'', ''submitted'')' || E'\n'
    || '    AND order_id IS NOT NULL;' || E'\n'
    || E'\n'
    || '  -- Phiếu trả ĐỘC LẬP thì mất chỗ bám thật: nó chỉ trỏ vào hóa đơn' || E'\n'
    || '  -- này. Huỷ và ghi lý do.' || E'\n'
    || '  UPDATE returns' || E'\n'
    || '  SET status = ''cancelled'', cancelled_at = now(),' || E'\n'
    || '      cancel_reason = ''Hóa đơn '' || v.invoice_code || '' bị huỷ''' || E'\n'
    || '  WHERE invoice_id = p_invoice_id' || E'\n'
    || '    AND status IN (''draft'', ''submitted'')' || E'\n'
    || '    AND order_id IS NULL;';

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '131: đã vá cancel_invoice — phiếu trả kèm đơn nay chỉ bị gỡ liên kết.';
END;
$patch$;


-- ---------------------------------------------------------------------
-- 2. `post_invoice` phải gắn lại được phiếu trả vừa gỡ
-- ---------------------------------------------------------------------
--
-- ⚠ NỬA CÒN LẠI CỦA BẢN VÁ, và nếu thiếu thì nửa trên thành một lỗi mới.
--   Chạy thử trên Postgres thật cho thấy: huỷ hóa đơn xong, phiếu trả về
--   đúng trạng thái `submitted` với `invoice_id` rỗng — nhưng lần xuất
--   hóa đơn SAU không gắn nó lại, vì câu gắn của `post_invoice` chỉ nhặt
--   `status = 'draft'`:
--
--       UPDATE returns SET status = 'submitted', invoice_id = v_inv
--       WHERE order_id = v_order AND status = 'draft';
--
--   Phiếu trả khi ấy nằm mồ côi mãi: hàng khách trả không giảm công nợ
--   của bất kỳ hóa đơn nào, và không dòng nào báo.
--
-- ⚠ ĐÂY CŨNG LÀ MỘT LỖ VỐN ĐÃ CÓ. Phiếu trả được gửi thẳng từ màn Trả
--   hàng (thành 'submitted' trước khi đơn kịp xuất) cũng rơi vào đúng lỗ
--   này. `_wf2_recompute_receivable` có nhận nuôi phiếu mồ côi, nhưng chỉ
--   khi một RPC đơn trả chạy — không ai đảm bảo điều đó xảy ra.
--
-- ⚠ GIỮ NGUYÊN `invoice_id IS NULL`. Không có vế đó thì câu này giật
--   phiếu trả của một hóa đơn khác đang có hiệu lực sang tờ vừa xuất.
DO $patch2$
DECLARE
  v_oid  oid;
  v_src  text;
  v_stmt text;
  v_new  text;
  v_n    int;
  v_re   text := 'UPDATE returns SET status = ''submitted'', invoice_id = v_inv[^;]+;';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'post_invoice';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'POST_INVOICE_MISSING: chưa có hàm post_invoice — chạy migration 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF position('AND ret.invoice_id IS NULL' in v_src) > 0 THEN
    RAISE NOTICE '131: post_invoice đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'POST_INVOICE_SHAPE: tìm thấy % câu gắn phiếu trả trong post_invoice (cần đúng 1). Thân hàm hiện tại:%',
      v_n, E'\n' || v_src
      USING ERRCODE = 'P0001';
  END IF;

  v_stmt := substring(v_src from v_re);

  -- ⚠ ĐẶT BÍ DANH `ret`. `post_invoice` trả về `RETURNS TABLE (invoice_id
  --   uuid, …)`, nên `invoice_id` trần là BIẾN plpgsql, không phải cột —
  --   và Postgres chỉ phát hiện nhập nhằng lúc GỌI, không phải lúc tạo
  --   hàm. Đúng cái bẫy đã làm `reissue_invoice` không chạy được từ mig
  --   125 tới mig 128.
  v_new :=
    'UPDATE returns ret SET status = ''submitted'', invoice_id = v_inv' || E'\n'
    || '  WHERE ret.order_id = v_order' || E'\n'
    || '    AND ret.invoice_id IS NULL' || E'\n'
    || '    AND ret.status IN (''draft'', ''submitted'');';

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '131: đã vá post_invoice — phiếu trả mồ côi nay được gắn lại.';
END;
$patch2$;


-- ---------------------------------------------------------------------
-- 3. Dựng lại những phiếu trả đã bị huỷ oan
-- ---------------------------------------------------------------------
--
-- ⚠ CHỈ NHẬN ĐÚNG DẤU VẾT CỦA LỖI NÀY, không quét rộng. Dấu vết là cả
--   bốn điều kiện cùng lúc: đã huỷ, lý do đúng câu `cancel_invoice` ghi,
--   có gắn đơn, và hóa đơn nó trỏ vào đang ở trạng thái 'cancelled'.
--   Thiếu một điều kiện là dựng lại cả những phiếu trả do người dùng chủ
--   động huỷ — sửa một lỗi bằng cách tạo ra một lỗi to hơn.
--
-- ⚠ ĐƠN ĐÃ HUỶ / ĐÃ ĐÓNG THÌ ĐỂ YÊN. Phiếu trả kèm một đơn không còn
--   chạy nữa thì huỷ vẫn là đúng, dù nó bị huỷ vì lý do gì.
DO $fix$
DECLARE
  r          record;
  v_posted   int;
  v_inv      uuid;
  v_draft    int := 0;
  v_relink   int := 0;
  v_skip     int := 0;
BEGIN
  FOR r IN
    SELECT ret.id, ret.order_id, so.order_code
    FROM returns ret
    JOIN sales_invoices si ON si.id = ret.invoice_id
    JOIN sales_orders   so ON so.id = ret.order_id
    WHERE ret.status = 'cancelled'
      AND ret.order_id IS NOT NULL
      AND si.status = 'cancelled'
      AND ret.cancel_reason LIKE 'Hóa đơn % bị huỷ'
      AND so.status NOT IN ('cancelled', 'closed')
  LOOP
    -- ⚠ KHÔNG DÙNG `min(si2.id)`. Postgres 16 không có hàm gộp `min` cho
    --   kiểu uuid, và lỗi ấy chỉ nổ lúc CHẠY — `CREATE FUNCTION` nhận hết.
    --   Đếm và lấy dòng là hai câu riêng.
    SELECT count(*) INTO v_posted
    FROM sales_invoices si2
    WHERE si2.order_id = r.order_id AND si2.status = 'posted';

    SELECT si2.id INTO v_inv
    FROM sales_invoices si2
    WHERE si2.order_id = r.order_id AND si2.status = 'posted'
    ORDER BY si2.invoice_date, si2.id
    LIMIT 1;

    IF v_posted = 0 THEN
      -- Đơn chưa có hóa đơn nào còn hiệu lực: phiếu trả quay về đúng chỗ
      -- nó đứng trước khi xuất hàng — kèm đơn, chưa đi đâu. Lần
      -- `post_invoice` sau sẽ nhấc nó lên 'submitted' và gắn hóa đơn.
      UPDATE returns
      SET status = 'draft', invoice_id = NULL,
          cancelled_at = NULL, cancel_reason = NULL
      WHERE id = r.id;
      v_draft := v_draft + 1;

    ELSIF v_posted = 1 THEN
      -- Đơn đã xuất lại bằng một hóa đơn khác: gắn thẳng vào hóa đơn ấy,
      -- đúng thứ `post_invoice` đã làm lần đầu.
      UPDATE returns
      SET status = 'submitted', invoice_id = v_inv,
          cancelled_at = NULL, cancel_reason = NULL
      WHERE id = r.id;
      v_relink := v_relink + 1;

    ELSE
      -- ⚠ HAI HÓA ĐƠN TRỞ LÊN THÌ KHÔNG ĐOÁN. Gắn nhầm hóa đơn là ghi
      --   giảm công nợ vào đúng một tờ chứng từ sai. Để nguyên và nêu tên
      --   đơn để chủ nhà tự chọn.
      v_skip := v_skip + 1;
      RAISE NOTICE '131: đơn % có % hóa đơn đã ghi sổ — phiếu trả % để nguyên, phải chọn tay.',
        r.order_code, v_posted, r.id;
    END IF;
  END LOOP;

  RAISE NOTICE '131: dựng lại % phiếu trả về nháp, gắn lại % phiếu vào hóa đơn còn hiệu lực, bỏ qua % phiếu.',
    v_draft, v_relink, v_skip;
END;
$fix$;

NOTIFY pgrst, 'reload schema';
