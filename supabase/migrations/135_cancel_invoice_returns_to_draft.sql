-- =====================================================================
-- 135 — HUỶ HÓA ĐƠN: PHIẾU TRẢ KÈM ĐƠN QUAY HẲN VỀ NHÁP
-- =====================================================================
--
-- VÌ SAO
--   Chủ nhà chốt: "huỷ hoá đơn → đảo ngược lại trạng thái của trả hàng
--   về nháp, giống đảo trạng thái của đơn đặt hàng về phiếu tạm".
--
--   Mig 131 mới gỡ `invoice_id` và giữ nguyên trạng thái, nên phiếu trả
--   nằm lại ở 'Chờ xử lý' trong khi đơn đã lùi về Phiếu tạm. Hai chứng từ
--   của cùng một chuyến hàng chỉ về một nửa — người mở đơn ra thấy đơn
--   chưa xuất mà phiếu trả thì "đang chờ xử lý", và không biết phải xử lý
--   cái gì khi hàng còn chưa đi.
--
-- ⚠ CHỈ HẠ TRẠNG THÁI PHIẾU MÀ CHÍNH `post_invoice` ĐÃ NÂNG LÊN. Dấu
--   `credit_with_invoice` (mig 133) nói đúng điều đó: nó chỉ được đặt
--   trong câu `UPDATE ... SET status = 'submitted'` của `post_invoice`.
--   Hạ bừa mọi phiếu 'submitted' là xoá mất việc ai đó đã chủ động gửi
--   một phiếu trả độc lập đi, và không có đường nào biết để dựng lại.
--
-- ⚠ ĐỌC GIÁ TRỊ CŨ TRONG CÙNG MỘT `UPDATE`. `SET status = CASE WHEN
--   credit_with_invoice …` lấy giá trị TRƯỚC câu lệnh, nên đặt
--   `credit_with_invoice = false` ở cùng câu vẫn an toàn. Tách làm hai
--   câu thì câu sau không còn dấu để mà xét.
--
-- ⚠ CẦN MIG 131 VÀ 133 CHẠY TRƯỚC. 135 vá tiếp lên đúng câu hai bản ấy
--   để lại. Chưa có thì DỪNG và nói rõ thiếu bản nào.

DO $patch$
DECLARE
  v_oid  oid;
  v_src  text;
  v_stmt text;
  v_new  text;
  v_n    int;
  v_re   text := 'UPDATE returns[^;]*SET invoice_id = NULL[^;]+;';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cancel_invoice';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'CANCEL_INVOICE_MISSING: chưa có cancel_invoice — chạy migration 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF position('SET invoice_id = NULL' in v_src) = 0 THEN
    RAISE EXCEPTION
      'NEEDS_131: cancel_invoice còn huỷ thẳng phiếu trả. Chạy migration 131 trước rồi chạy lại 135.'
      USING ERRCODE = 'P0001';
  END IF;
  IF position('credit_with_invoice = false' in v_src) = 0 THEN
    RAISE EXCEPTION
      'NEEDS_133: cancel_invoice chưa gỡ dấu credit_with_invoice. Chạy migration 133 trước rồi chạy lại 135.'
      USING ERRCODE = 'P0001';
  END IF;

  IF position('THEN ''draft'' ELSE status END' in v_src) > 0 THEN
    RAISE NOTICE '135: cancel_invoice đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'CANCEL_INVOICE_SHAPE: tìm thấy % câu gỡ phiếu trả trong cancel_invoice (cần đúng 1). Thân hàm hiện tại:%',
      v_n, E'\n' || v_src USING ERRCODE = 'P0001';
  END IF;

  v_stmt := substring(v_src from v_re);

  v_new :=
    '-- ⚠ VỀ HẲN NHÁP (mig 135). Đơn lùi về Phiếu tạm thì phiếu trả kèm' || E'\n'
    || '  --   nó cũng phải lùi theo; để lại ở ''Chờ xử lý'' là bảo thủ kho đi' || E'\n'
    || '  --   xử lý một chuyến hàng chưa hề rời kho.' || E'\n'
    || '  -- ⚠ CHỈ HẠ PHIẾU MÀ `post_invoice` ĐÃ NÂNG — dấu `credit_with_invoice`' || E'\n'
    || '  --   nói đúng điều đó. Phiếu độc lập ai đó chủ động gửi đi thì giữ.' || E'\n'
    || '  UPDATE returns' || E'\n'
    || '  SET invoice_id = NULL,' || E'\n'
    || '      status = CASE WHEN credit_with_invoice THEN ''draft'' ELSE status END,' || E'\n'
    || '      credit_with_invoice = false' || E'\n'
    || '  WHERE invoice_id = p_invoice_id' || E'\n'
    || '    AND status IN (''draft'', ''submitted'')' || E'\n'
    || '    AND order_id IS NOT NULL;';

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '135: đã vá cancel_invoice — phiếu trả kèm đơn quay về nháp.';
END;
$patch$;


-- ---------------------------------------------------------------------
-- Dọn những phiếu đã bị mig 131 để lại ở 'Chờ xử lý'
-- ---------------------------------------------------------------------
--
-- ⚠ CHỈ NHẬN ĐÚNG DẤU VẾT: phiếu 'submitted', có gắn đơn, KHÔNG gắn hóa
--   đơn nào, và đơn của nó hiện KHÔNG có hóa đơn nào đã ghi sổ. Đó đúng
--   là phiếu bị bỏ lại sau một lần huỷ hóa đơn. Thiếu vế cuối là hạ nhầm
--   phiếu của một đơn đang có hóa đơn hiệu lực.
DO $fix$
DECLARE
  r   record;
  v_n int := 0;
BEGIN
  FOR r IN
    SELECT ret.id, so.order_code
    FROM returns ret
    JOIN sales_orders so ON so.id = ret.order_id
    WHERE ret.status = 'submitted'
      AND ret.invoice_id IS NULL
      AND so.status NOT IN ('cancelled', 'closed')
      AND NOT EXISTS (
        SELECT 1 FROM sales_invoices si
        WHERE si.order_id = ret.order_id AND si.status = 'posted'
      )
  LOOP
    UPDATE returns SET status = 'draft' WHERE id = r.id;
    v_n := v_n + 1;
    RAISE NOTICE '135: phiếu trả của đơn % lùi về nháp cùng đơn.', r.order_code;
  END LOOP;
  RAISE NOTICE '--- 135: lùi % phiếu trả về nháp ---', v_n;
END;
$fix$;

NOTIFY pgrst, 'reload schema';
