-- ====================================================================
-- HUỶ HÓA ĐƠN RỒI THÌ SỬA ĐƠN ĐƯỢC
--
-- Chủ nhà báo 22/09/2026, kèm ảnh chụp:
--   "Không bỏ được mặt hàng … khỏi đơn: nó đã từng nằm trên một tờ hóa
--    đơn của đơn này, và tờ ấy vẫn còn trong sổ (kể cả khi đã huỷ)."
-- kèm câu hỏi: "ko hiểu đưa logic này vào làm gì?"
--
-- ⚠ CÂU TRẢ LỜI: KHÔNG AI ĐƯA LOGIC ẤY VÀO. Câu tiếng Việt trên chỉ là
--   bản dịch của một lời từ chối THẬT từ cơ sở dữ liệu — khoá ngoại
--   `sales_invoice_lines_order_line_id_fkey`, mã 23503. Giao diện đang
--   nói lại cho dễ hiểu. Chỗ sai nằm ở chính cái khoá ấy.
--
-- ĐÃ DỰNG LẠI TRÊN POSTGRES 16 THẬT
--
--   đơn 2 dòng → `post_invoice` → `cancel_invoice` → xoá 1 dòng đơn:
--     · trạng thái hóa đơn = cancelled
--     · `invoiced_qty` của CẢ HAI dòng đơn = 0
--     · nhưng 2 dòng hóa đơn VẪN trỏ vào 2 dòng đơn
--     · và lệnh xoá bị ném 23503
--
-- ⚠ CON TRỎ ẤY KHÔNG CÒN NUÔI CON SỐ NÀO. `sync_invoiced_qty` (mig 124)
--   chỉ cộng những hóa đơn `status = 'posted'`; hóa đơn đã huỷ đóng góp
--   đúng 0 — phép đo trên cho thấy thế. Sau khi huỷ, `order_line_id`
--   chỉ còn làm một việc duy nhất: CHẶN.
--
-- ⚠ VÀ HÓA ĐƠN ĐÃ HUỶ KHÔNG MẤT GÌ KHI NHẢ CON TRỎ. `sales_invoice_lines`
--   giữ bản chụp đầy đủ ngay trên chính nó: `product_id`, `unit_name`,
--   `conversion_factor`, `quantity`, `unit_price`, `line_discount`,
--   `line_total`, `vat_rate`. Con trỏ chỉ là đường LIÊN KẾT, và cột ấy
--   vốn đã cho phép NULL từ mig 124 (dòng hàng đổi và dòng NPP thêm
--   ngoài đơn đều để rỗng).
--
-- ⚠ ĐÂY LÀ NỬA CÒN LẠI CỦA MỘT LỖI CŨ. Trước mig 149, đường sửa đơn xoá
--   sạch dòng rồi chèn lại, và chính khoá ngoại này chặn — đơn từng xuất
--   hàng rồi huỷ hết hóa đơn thì VĨNH VIỄN không sửa được, trong khi màn
--   hình vẫn mời bấm Sửa. Mig 149 sửa cách ghi (so khớp thay vì xoá
--   sạch) nhưng KHÔNG đụng tới khoá ngoại, nên ca "bỏ hẳn một mặt hàng"
--   vẫn kẹt nguyên.
--
-- CÁCH SỬA
--
--   `cancel_invoice` nhả `order_line_id` của chính tờ vừa huỷ. Huỷ hóa
--   đơn là lúc tờ ấy thôi đòi hỏi gì ở đơn — nhả đúng lúc đó.
--
-- ⚠ CÒN KHOÁ NGOẠI THÌ GIỮ NGUYÊN, VÀ ĐÓ LÀ CỐ Ý. Hóa đơn `posted` vẫn
--   chặn việc bỏ dòng đơn, vì dòng ấy là hàng ĐÃ RỜI KHO. Đổi khoá thành
--   `ON DELETE SET NULL` là mở luôn cả ca ấy — bỏ được một dòng đã giao
--   thật mà không ai chặn. Đã đo: sau mig này, hóa đơn posted VẪN chặn.
--
-- ⚠ VÁ BẰNG CÁCH THÊM MỘT CÂU, KHÔNG CHÉP LẠI CẢ HÀM — và đây không
--   phải sở thích, nó là một lỗi tôi vừa suýt gây ra. Bản đầu của
--   migration này chép nguyên thân `cancel_invoice` từ MIG 125 rồi thêm
--   một khối. Chốt `migration-khong-de-mat-mieng-va` bắt được: mig 131
--   đã VÁ CHUỖI chính hàm ấy sau mig 125, nên chép từ 125 là âm thầm
--   xoá miếng vá của 131 — phiếu trả kèm đơn lại bị huỷ oan khi huỷ hóa
--   đơn, đúng lỗi chủ nhà đã báo một lần rồi. Mig 131 cũng đã ghi sẵn lý
--   do: hàm này dài ~150 dòng và phần hoàn kho theo lô là phần dễ chép
--   sai nhất.
--
-- ⚠ KHÔNG ĐỤNG `reissue_invoice`. Hàm ấy gọi `cancel_invoice` rồi gọi
--   `post_invoice` với TẢI TRỌNG DO NGƯỜI GỌI ĐƯA, chứ không đọc lại
--   dòng của tờ cũ — nên nhả con trỏ không ảnh hưởng. Đã đo: xuất lại
--   hóa đơn sau mig này vẫn gắn đúng dòng đơn, `invoiced_qty` đúng, và
--   tờ cũ đã huỷ vẫn đọc đủ dòng lẫn tiền.
--
-- ⚠ ĐÁNH SỐ 162. `main` giữ 158, 160; `newdesign` giữ 156, 157, 159, 161.
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. Vá `cancel_invoice`
-- ---------------------------------------------------------------------
DO $patch$
DECLARE
  v_oid  oid;
  v_src  text;
  v_stmt text;
  v_new  text;
  v_n    int;
  v_re   text := 'UPDATE sales_invoices\s+SET status = ''cancelled''[^;]+;';
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
  IF position('SET order_line_id = NULL' in v_src) > 0 THEN
    RAISE NOTICE '162: cancel_invoice đã vá từ trước — không đổi gì.';
  ELSE
    SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');

    IF v_n <> 1 THEN
      -- ⚠ IN RA THỨ TÌM THẤY — bài học của mig 126, mig 131 nhắc lại:
      --   báo "không đúng hình dạng" mà không nói hình dạng hiện tại là
      --   gì thì người chạy migration không có đường nào sửa tay.
      RAISE EXCEPTION
        'CANCEL_INVOICE_SHAPE: tìm thấy % câu đổi trạng thái hóa đơn trong cancel_invoice (cần đúng 1). Thân hàm hiện tại:%',
        v_n, E'\n' || v_src
        USING ERRCODE = 'P0001';
    END IF;

    v_stmt := substring(v_src from v_re);

    v_new := v_stmt || E'\n\n'
      || '  -- ⚠ NHẢ MÓC NỐI VỀ DÒNG ĐƠN (mig 162). Tờ đã huỷ giữ nguyên' || E'\n'
      || '  --   bản chụp của nó (mã hàng, đơn vị, số lượng, đơn giá, thuế' || E'\n'
      || '  --   suất đều nằm trên chính dòng hóa đơn), nên bỏ con trỏ' || E'\n'
      || '  --   KHÔNG làm mất một chữ nào. Giữ lại thì nó chỉ còn chặn' || E'\n'
      || '  --   người ta bỏ dòng ấy khỏi đơn, mãi mãi.' || E'\n'
      || '  UPDATE sales_invoice_lines' || E'\n'
      || '  SET order_line_id = NULL' || E'\n'
      || '  WHERE invoice_id = p_invoice_id AND order_line_id IS NOT NULL;';

    EXECUTE replace(v_src, v_stmt, v_new);
    RAISE NOTICE '162: đã vá cancel_invoice — huỷ hóa đơn nay nhả móc nối về dòng đơn.';
  END IF;
END;
$patch$;

-- ---------------------------------------------------------------------
-- 2. Vá các tờ đã huỷ từ trước
-- ---------------------------------------------------------------------
--
-- ⚠ CHỈ SỬA HÀM THÌ NHỮNG TỜ HUỶ HÔM QUA VẪN KẸT MÃI, và chủ nhà đang
--   có đơn kẹt ngay bây giờ.
--
-- ⚠ CHỈ ĐỘNG VÀO TỜ ĐÃ HUỶ. Hóa đơn `posted` giữ nguyên con trỏ — đó là
--   thứ nuôi `invoiced_qty` và là thứ chặn việc bỏ một dòng đã giao.
--
-- ⚠ KHỐI NÀY PHẢI MỞ `npp.via_rpc`, VÀ ĐÓ KHÔNG PHẢI MẸO LÁCH. Chủ nhà
--   chạy bản đầu của migration này trên sổ thật và vấp:
--
--     ERROR: ORDER_LOCKED: đơn đã xuất hàng, không sửa dòng được.
--     CONTEXT: guard_order_lines_locked() ← sync_invoiced_qty()
--              ← UPDATE sales_invoice_lines SET order_line_id = NULL
--
--   Đường đi: nhả con trỏ → `trg_sync_invoiced_qty` chạy `UPDATE
--   sales_order_lines` → `guard_order_lines_locked` (mig 124) chặn, vì
--   đơn đang `partially_invoiced`. MIG 124 ĐÃ GHI SẴN CÁI BẪY NÀY hai
--   lần trong chính tệp của nó ("Migration tự vấp chốt chặn của chính
--   mình") và né được bằng cách dựng trigger ở cuối file — nhưng mig 162
--   chạy khi trigger ấy đã đứng sẵn, nên chỉ còn đúng một đường: cái cửa
--   mà chính chốt ấy chừa cho các RPC.
--
-- ⚠ PHÉP ĐO CŨ CỦA TÔI QUÁ HẸP NÊN KHÔNG BẮT ĐƯỢC: mỗi đơn chỉ một hóa
--   đơn, huỷ xong `_wf2b_sync_order_status` trả đơn về `confirmed` nên
--   chốt chặn không có gì để kêu. Sổ thật có đơn mang HAI tờ — một
--   `posted` giữ đơn ở `partially_invoiced`, một đã huỷ. Nay đã dựng
--   đúng ca ấy trên Postgres 16 và thấy lại nguyên văn lỗi trên.
--
-- ⚠ VÀ PHÉP TÍNH LẠI ẤY LÀ MỘT LẦN GHI ĐÈ ĐÚNG BẰNG GIÁ TRỊ CŨ, không
--   phải một thay đổi bị bịt miệng. `sync_invoiced_qty` chỉ cộng hóa đơn
--   `status = 'posted'`; tờ đã huỷ vốn đóng góp 0, nhả con trỏ của nó
--   thì tổng không đổi. Không nói suông: khối dưới chụp `invoiced_qty`
--   TRƯỚC, so lại SAU, và NÉM nếu có một dòng nào lệch.
DO $fix$
DECLARE v_n int; v_lech int;
BEGIN
  -- Chạy lại lần hai trong CÙNG một giao dịch thì bảng tạm còn đó và
  -- `CREATE` sẽ nổ. Migration phải chạy lại được. (Hỏi `to_regclass`
  -- thay vì `DROP … IF EXISTS` để người chạy không phải đọc một dòng
  -- NOTICE "does not exist, skipping" ở lần chạy bình thường.)
  IF to_regclass('pg_temp._162_truoc') IS NOT NULL THEN
    EXECUTE 'DROP TABLE _162_truoc';
  END IF;
  CREATE TEMP TABLE _162_truoc ON COMMIT DROP AS
    SELECT id, invoiced_qty FROM sales_order_lines;

  PERFORM set_config('npp.via_rpc', 'on', true);

  UPDATE sales_invoice_lines sil
  SET order_line_id = NULL
  FROM sales_invoices si
  WHERE si.id = sil.invoice_id
    AND si.status = 'cancelled'
    AND sil.order_line_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- ⚠ ĐÓNG CỬA LẠI NGAY. `set_config(..., true)` sống đến hết GIAO DỊCH
  --   chứ không hết khối DO — để ngỏ là phần còn lại của migration chạy
  --   mà không chốt nào canh.
  PERFORM set_config('npp.via_rpc', '', true);

  SELECT count(*) INTO v_lech
  FROM sales_order_lines sol
  JOIN _162_truoc t ON t.id = sol.id
  WHERE COALESCE(t.invoiced_qty, 0) <> COALESCE(sol.invoiced_qty, 0);

  IF v_lech > 0 THEN
    RAISE EXCEPTION
      '162: nhả con trỏ đã làm ĐỔI invoiced_qty của % dòng đơn — lẽ ra phải bằng 0. Dừng lại, không nuốt.',
      v_lech
      USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE '--- 162: huỷ hóa đơn rồi sửa đơn được · đã nhả % dòng của hóa đơn đã huỷ · invoiced_qty không dòng nào đổi ---', v_n;
END;
$fix$;

-- ---------------------------------------------------------------------
-- 3. Tự kiểm — cả hai miếng vá phải còn sống
-- ---------------------------------------------------------------------
--
-- ⚠ KIỂM CẢ MIẾNG VÁ CỦA MIG 131, không chỉ của chính mình. Hai miếng vá
--   nằm trên CÙNG một hàm; nếu ai đó viết lại `cancel_invoice` từ một
--   bản cũ thì mất cả hai, và không có tệp nào để đọc ra điều đó.
DO $kiem$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cancel_invoice';

  IF position('SET order_line_id = NULL' in v_src) = 0 THEN
    RAISE EXCEPTION '162: miếng vá của chính migration này KHÔNG có trong hàm đang chạy';
  END IF;
  IF position('SET invoice_id = NULL' in v_src) = 0
     OR position('order_id IS NULL' in v_src) = 0 THEN
    RAISE EXCEPTION
      '162: miếng vá của mig 131 (phiếu trả kèm đơn chỉ gỡ liên kết, không huỷ) đã BIẾN MẤT khỏi cancel_invoice';
  END IF;
  RAISE NOTICE '162: cả miếng vá của mig 131 lẫn của mig 162 đều còn trong hàm đang chạy.';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';
