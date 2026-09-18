-- =====================================================================
-- 132 — DỰNG CÔNG NỢ CHO NHỮNG HÓA ĐƠN BÁN KHÔNG CÓ DÒNG NỢ NÀO
-- =====================================================================
--
-- VÌ SAO
--   Chủ nhà báo: "có 21 hóa đơn bán nhưng công nợ trắng".
--
--   Đúng như vậy, và đây là lỗ của mig 124. Phần backfill của nó dựng
--   `sales_invoices` từ các đơn đã hoàn thành, rồi GẮN các chứng từ cũ
--   vào hóa đơn mới (124, dòng 672):
--
--       UPDATE receivables SET invoice_id = v_inv
--       WHERE order_id = o.id AND invoice_id IS NULL;
--
--   Chỉ có UPDATE. KHÔNG có INSERT. Đơn nào trước đó đã có dòng công nợ
--   thì được gắn; đơn nào CHƯA từng có dòng nào thì hóa đơn sinh ra
--   trắng trơn — bán hàng có, giao hàng có, mà sổ nợ không ghi gì.
--
-- ⚠ ĐÂY LÀ TIỀN, NÊN KHÔNG ĐOÁN Ở BẤT CỨ CHỖ NÀO. Chỉ dựng dòng nợ cho
--   hóa đơn thoả CẢ HAI:
--     · chính nó chưa có dòng nợ nào (`receivables.invoice_id`), và
--     · ĐƠN của nó cũng không còn dòng nợ cũ chưa gắn.
--
--   Vế thứ hai mới là vế quan trọng. Một dòng nợ cũ `invoice_id` rỗng
--   trỏ vào đơn này nghĩa là khoản nợ ấy ĐÃ TỒN TẠI (và có thể đã thu
--   một phần); dựng thêm dòng nữa là đòi khách hai lần cùng một lô hàng.
--   Những ca đó KHÔNG tự sửa — migration nêu tên ra để chủ nhà xử tay.
--
-- ⚠ TÍNH LẠI QUA `_wf2b_recompute_receivable`, KHÔNG TỰ VIẾT INSERT.
--   Hàm đó đã biết trừ phiếu trả đã hoàn thành, biết tính hạn nợ theo
--   NETxx, biết kẹp về 0. Chép lại phép tính ở đây là từ nay có hai bản,
--   và bản nào đúng thì phải đọc cả hai mới biết.
--
-- ⚠ HẠN NỢ SẼ RƠI VÀO QUÁ KHỨ, và đó là ĐÚNG. Hóa đơn tháng trước thì
--   hạn của nó là tháng trước; những khoản này hiện ra ở nhóm quá hạn
--   ngay sau khi chạy. Đấy là sự thật đang bị giấu, không phải lỗi mới.
--
-- ⚠ CHẠY LẠI KHÔNG SINH THÊM. `_wf2b_recompute_receivable` thấy dòng nợ
--   đã có thì UPDATE chứ không INSERT, và vòng lặp chỉ nhặt hóa đơn chưa
--   có dòng nào.

-- ---------------------------------------------------------------------
-- 1. XEM TRƯỚC — in ra thứ sắp làm, trước khi làm
-- ---------------------------------------------------------------------
DO $preview$
DECLARE
  r        record;
  v_new    int := 0;
  v_amt    numeric := 0;
  v_risk   int := 0;
BEGIN
  FOR r IN
    SELECT si.id, si.invoice_code, si.total, si.invoice_date,
           so.order_code,
           EXISTS (
             SELECT 1 FROM receivables rc
             WHERE rc.order_id = si.order_id AND rc.invoice_id IS NULL
           ) AS has_legacy
    FROM sales_invoices si
    LEFT JOIN sales_orders so ON so.id = si.order_id
    WHERE si.status = 'posted'
      AND NOT EXISTS (
        SELECT 1 FROM receivables rc WHERE rc.invoice_id = si.id
      )
    ORDER BY si.invoice_date, si.invoice_code
  LOOP
    IF r.has_legacy THEN
      v_risk := v_risk + 1;
      -- VẤN ĐỀ: có dòng nợ cũ chưa gắn cho chính đơn này.
      RAISE NOTICE
        '132 BỎ QUA  % (đơn %): đơn còn dòng công nợ cũ chưa gắn hóa đơn. Gắn tay rồi chạy lại, đừng để migration đoán.',
        r.invoice_code, COALESCE(r.order_code, '—');
    ELSE
      v_new := v_new + 1;
      v_amt := v_amt + COALESCE(r.total, 0);
      -- THÔNG TIN: sẽ dựng dòng nợ.
      RAISE NOTICE '132 dựng nợ  % (đơn % · % · %)',
        r.invoice_code, COALESCE(r.order_code, '—'), r.invoice_date,
        to_char(COALESCE(r.total, 0), 'FM999G999G999');
    END IF;
  END LOOP;

  RAISE NOTICE '--- 132 xem trước: dựng % dòng nợ, tổng % · bỏ qua % hóa đơn phải xử tay ---',
    v_new, to_char(v_amt, 'FM999G999G999'), v_risk;
END;
$preview$;


-- ---------------------------------------------------------------------
-- 2. DỰNG
-- ---------------------------------------------------------------------
DO $fix$
DECLARE
  r      record;
  v_id   uuid;
  v_n    int := 0;
  v_fail int := 0;
BEGIN
  FOR r IN
    SELECT si.id, si.invoice_code
    FROM sales_invoices si
    WHERE si.status = 'posted'
      AND NOT EXISTS (
        SELECT 1 FROM receivables rc WHERE rc.invoice_id = si.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM receivables rc
        WHERE rc.order_id = si.order_id AND rc.invoice_id IS NULL
      )
    ORDER BY si.invoice_date, si.invoice_code
  LOOP
    v_id := public._wf2b_recompute_receivable(r.id);
    IF v_id IS NULL THEN
      -- ⚠ HÀM TRẢ `NULL` NGHĨA LÀ NÓ TỪ CHỐI DỰNG. Đếm im lặng rồi báo
      --   "xong" là để lại đúng cái lỗ vừa đi vá.
      v_fail := v_fail + 1;
      RAISE NOTICE '132 KHÔNG dựng được nợ cho % — xem lại tay.', r.invoice_code;
    ELSE
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '--- 132: đã dựng % dòng công nợ (% hóa đơn không dựng được) ---',
    v_n, v_fail;
END;
$fix$;


-- ---------------------------------------------------------------------
-- 3. Đối chiếu lại — còn sót thì nói ra
-- ---------------------------------------------------------------------
DO $check$
DECLARE
  v_left int;
BEGIN
  SELECT count(*) INTO v_left
  FROM sales_invoices si
  WHERE si.status = 'posted'
    AND NOT EXISTS (SELECT 1 FROM receivables rc WHERE rc.invoice_id = si.id);

  IF v_left > 0 THEN
    RAISE NOTICE
      '--- 132: CÒN % hóa đơn đã ghi sổ chưa có công nợ. Đây là những ca phải xử tay (xem dòng BỎ QUA bên trên) ---',
      v_left;
  ELSE
    RAISE NOTICE '--- 132: mọi hóa đơn đã ghi sổ đều có dòng công nợ ---';
  END IF;
END;
$check$;

NOTIFY pgrst, 'reload schema';
