-- ====================================================================
-- 128 — Số hóa đơn bỏ ngày tháng: HD-0001, bản lập lại thêm -1, -2, …
-- ====================================================================
--
-- VÌ SAO
--   Mẫu cũ `HD-YYMMDD-NNNN` (mig 125) đếm lại từ 1 MỖI NGÀY, nên số hóa
--   đơn không nói được "đây là tờ thứ mấy của nhà phân phối". Chủ NPP
--   chốt: chỉ cần `HD-xxxx` chạy liên tục, và bản lập lại thì gắn thêm
--   `-n` vào chính số đó — nhìn một cái là biết hai tờ cùng một gốc.
--
--       HD-0042      tờ gốc
--       HD-0042-1    sửa lần 1
--       HD-0042-2    sửa lần 2
--
-- ⚠ KHÔNG SUY SỐ CHẠY TỪ CHÍNH CHUỖI MÃ. Cách "lấy max của phần số
--   trong invoice_code rồi +1" nghe gọn nhưng hỏng ngay: mã cũ
--   `HD-260918-0001` đọc ra 260918, và bộ đếm nhảy lên 260919 — mọi hóa
--   đơn sau đó mang số vô nghĩa, không cách nào lùi lại. Thêm hai cột
--   thật để đếm, và chuỗi mã chỉ còn là thứ SINH RA từ chúng.
--
-- ⚠ ĐÁNH SỐ LẠI TOÀN BỘ HÓA ĐƠN CŨ — chủ nhà quyết, không phải mặc định
--   của migration. Lý do chấp nhận được: NPP đang ở đợt đầu, mấy số cũ
--   do backfill mig 124 tự sinh hôm qua chứ chưa phải số đã phát cho
--   khách. Nếu sau này có ai chạy lại file này trên một cơ sở dữ liệu đã
--   phát hành thật thì ĐỪNG — khối mục 3 sẽ báo và dừng.
--
-- ⚠ THỨ TỰ ĐÁNH LẠI LÀ NGÀY XUẤT, KHÔNG PHẢI `created_at`. Hóa đơn
--   backfill mang `invoice_date` của đơn gốc nhưng `created_at` là lúc
--   chạy migration — xếp theo `created_at` thì cả sổ cũ dồn thành một
--   cục theo thứ tự ngẫu nhiên.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Hai cột đếm
-- --------------------------------------------------------------------
-- `invoice_seq`   — số chạy của tờ GỐC, trong phạm vi một tổ chức.
-- `reissue_no`    — 0 với tờ gốc, n với lần sửa thứ n. Bản lập lại DÙNG
--                   LẠI `invoice_seq` của tờ nó thay thế.
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS invoice_seq int,
  ADD COLUMN IF NOT EXISTS reissue_no  int NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_invoices.invoice_seq IS
  'Số chạy của tờ gốc trong phạm vi tổ chức. Bản lập lại dùng lại số của '
  'tờ nó thay thế, và phân biệt bằng reissue_no.';
COMMENT ON COLUMN sales_invoices.reissue_no IS
  '0 = tờ gốc. n = lần sửa thứ n, mã có đuôi -n.';


-- --------------------------------------------------------------------
-- 2. Hàm dựng mã từ hai cột
-- --------------------------------------------------------------------
-- ⚠ MỘT CHỖ DỰNG MÃ. Ghép chuỗi ở nhiều nơi là một ngày nào đó hai nơi
--   ghép khác nhau, và hai tờ giấy cùng một hóa đơn in ra hai số.
CREATE OR REPLACE FUNCTION public._inv_code(p_seq int, p_reissue int)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'HD-' || lpad(COALESCE(p_seq, 0)::text, 4, '0')
         || CASE WHEN COALESCE(p_reissue, 0) > 0
                 THEN '-' || p_reissue::text ELSE '' END;
$$;


-- --------------------------------------------------------------------
-- 3. Đánh số lại toàn bộ hóa đơn cũ
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_eiv  int;
  v_n    int;
BEGIN
  -- ⚠ DỪNG NẾU ĐÃ CÓ HÓA ĐƠN ĐIỆN TỬ PHÁT HÀNH. Số trên tờ đã gửi cơ
  --   quan thuế không được đổi — đổi là sổ của mình và sổ của thuế nói
  --   hai số khác nhau cho cùng một giao dịch.
  SELECT count(*) INTO v_eiv
  FROM invoices i
  WHERE i.sales_invoice_id IS NOT NULL AND i.misa_inv_no IS NOT NULL;

  IF v_eiv > 0 THEN
    RAISE EXCEPTION
      'INV_CODE_ISSUED: % hóa đơn điện tử đã phát hành — không đánh số lại được. Bỏ mục 3 của migration 128 và chỉ áp mẫu mới cho hóa đơn lập từ nay.',
      v_eiv USING ERRCODE = 'P0001';
  END IF;

  -- Tờ GỐC: đánh số chạy theo ngày xuất, trong phạm vi tổ chức.
  --
  -- ⚠ "TỜ GỐC" = `replaced_from IS NULL`. Không phải `status='posted'`:
  --   một tờ gốc bị huỷ thẳng (không lập lại) vẫn phải giữ số của nó,
  --   nếu không thì mọi tờ sau nó tụt một số và sổ thủng một lỗ.
  WITH g AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY org_id
             ORDER BY invoice_date, created_at, id
           ) AS n
    FROM sales_invoices
    WHERE replaced_from IS NULL
  )
  UPDATE sales_invoices si
  SET invoice_seq = g.n, reissue_no = 0
  FROM g WHERE g.id = si.id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 128: % tờ gốc được đánh số lại ---', v_n;

  -- Bản lập lại: đi theo chuỗi `replaced_from` về tới tờ gốc.
  --
  -- ⚠ ĐỆ QUY, KHÔNG PHẢI MỘT PHÉP NỐI. Sửa lần 2 trỏ về bản sửa lần 1,
  --   chứ không trỏ thẳng về tờ gốc — nối một tầng là bản thứ hai không
  --   tra ra số gốc và nằm lại với `invoice_seq` rỗng.
  WITH RECURSIVE chain AS (
    SELECT si.id, si.replaced_from, si.invoice_seq AS root_seq, 0 AS depth
    FROM sales_invoices si
    WHERE si.replaced_from IS NULL

    UNION ALL

    SELECT c2.id, c2.replaced_from, chain.root_seq, chain.depth + 1
    FROM sales_invoices c2
    JOIN chain ON c2.replaced_from = chain.id
  )
  UPDATE sales_invoices si
  SET invoice_seq = chain.root_seq, reissue_no = chain.depth
  FROM chain
  WHERE chain.id = si.id AND chain.depth > 0;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 128: % bản lập lại được gắn vào số gốc ---', v_n;

  -- ⚠ CÒN SÓT DÒNG NÀO LÀ DỪNG. `invoice_seq` rỗng nghĩa là có một hóa
  --   đơn không nằm trong chuỗi nào — dây `replaced_from` đứt ở đâu đó.
  --   Để nó đi tiếp là sinh mã `HD-0000` trùng nhau hàng loạt.
  SELECT count(*) INTO v_n FROM sales_invoices WHERE invoice_seq IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'INV_CODE_ORPHAN: % hóa đơn không tra được số gốc (dây replaced_from đứt). Sửa tay trước khi chạy tiếp.',
      v_n USING ERRCODE = 'P0001';
  END IF;

  UPDATE sales_invoices
  SET invoice_code = public._inv_code(invoice_seq, reissue_no);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 128: % hóa đơn mang mã mới ---', v_n;
END $$;

ALTER TABLE sales_invoices ALTER COLUMN invoice_seq SET NOT NULL;

-- ⚠ CHẶN TRÙNG Ở TẦNG CƠ SỞ DỮ LIỆU, không chỉ trông vào hàm cấp số.
--   Hai người bấm Xuất hàng cùng lúc mà khoá tư vấn hỏng thì chỉ mục này
--   là thứ cuối cùng giữ cho sổ không có hai tờ cùng số.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoices_seq
  ON sales_invoices(org_id, invoice_seq, reissue_no);


-- --------------------------------------------------------------------
-- 4. Cấp số cho hóa đơn mới
-- --------------------------------------------------------------------
-- ⚠ KHOÁ TRƯỚC KHI ĐẾM, và khoá theo TỔ CHỨC (mẫu cũ khoá theo tổ chức +
--   ngày, giờ không còn ngày trong mã nữa). Hai người bấm cùng lúc thì
--   cả hai đọc ra cùng một số, một giao dịch vỡ vì chỉ mục duy nhất —
--   không sai sổ, nhưng người thứ hai nhận một lỗi lạ hoắc.
--
-- ⚠ `max + 1`, KHÔNG PHẢI `count + 1`. Đếm thì một tờ bị xoá tay là số
--   tiếp theo trùng với một tờ đang sống.
CREATE OR REPLACE FUNCTION public._wf2b_next_invoice_seq(p_org uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_org::text));
  SELECT COALESCE(max(invoice_seq), 0) + 1 INTO v_n
  FROM sales_invoices WHERE org_id = p_org;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._wf2b_next_invoice_seq(uuid) FROM PUBLIC;

-- Hàm cũ không còn ai gọi sau khi mục 5 thay `post_invoice`.
DROP FUNCTION IF EXISTS public._wf2b_next_invoice_code(uuid, date);


-- --------------------------------------------------------------------
-- 5. `post_invoice` — nhận thêm `reissue_of` để giữ số gốc
-- --------------------------------------------------------------------
-- ⚠ VÁ ĐÚNG NHỮNG CÂU CẦN VÁ TRONG THÂN HÀM ĐANG CHẠY, không chép lại cả
--   400 dòng. Chép lại là dựng một bản sao thứ hai mà không ai đối chiếu
--   được với bản gốc; vá thì nếu câu cần vá không còn đúng hình dạng,
--   khối này DỪNG thay vì âm thầm để nguyên.
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
    RAISE EXCEPTION 'INV_CODE_NO_FN: tìm thấy % bản post_invoice, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pr.oid INTO v_oid
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'post_invoice' AND pr.prokind = 'f';
  v_src := pg_get_functiondef(v_oid);

  -- 5.1 Khai thêm hai biến.
  v_from := '  v_status    text;';
  v_to   := '  v_status    text;' || E'\n' ||
            '  v_seq       int;' || E'\n' ||
            '  v_reissue   int := 0;';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy khai báo v_status trong post_invoice'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  -- 5.2 Thay chỗ cấp mã.
  --
  -- ⚠ CÓ `reissue_of` THÌ DÙNG LẠI SỐ CỦA TỜ CŨ và tăng đuôi. Cấp số mới
  --   cho một bản sửa là mất hẳn mối liên hệ giữa hai tờ — người tra sổ
  --   nhìn HD-0042 và HD-0087 không thể biết tờ sau thay tờ trước.
  v_from := '  v_code := public._wf2b_next_invoice_code(o.org_id, v_date);';
  v_to := ''
    || '  IF (p->>''reissue_of'') IS NOT NULL THEN' || E'\n'
    || '    SELECT si0.invoice_seq, si0.reissue_no + 1 INTO v_seq, v_reissue' || E'\n'
    || '    FROM sales_invoices si0 WHERE si0.id = (p->>''reissue_of'')::uuid;' || E'\n'
    || '    IF v_seq IS NULL THEN' || E'\n'
    || '      RAISE EXCEPTION ''INVOICE_NOT_FOUND'' USING ERRCODE = ''P0001'';' || E'\n'
    || '    END IF;' || E'\n'
    || '  ELSE' || E'\n'
    || '    v_seq := public._wf2b_next_invoice_seq(o.org_id);' || E'\n'
    || '    v_reissue := 0;' || E'\n'
    || '  END IF;' || E'\n'
    || '  v_code := public._inv_code(v_seq, v_reissue);';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy chỗ cấp mã trong post_invoice'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  -- 5.3 Ghi hai cột đếm vào dòng hóa đơn.
  v_from := '    org_id, invoice_code, order_id, customer_id, sales_user_id,';
  v_to   := '    org_id, invoice_code, invoice_seq, reissue_no, order_id, customer_id, sales_user_id,';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy danh sách cột của INSERT sales_invoices'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  v_from := '    o.org_id, v_code, v_order, o.customer_id, o.sales_user_id,';
  v_to   := '    o.org_id, v_code, v_seq, v_reissue, v_order, o.customer_id, o.sales_user_id,';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy danh sách giá trị của INSERT sales_invoices'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  EXECUTE v_src;
  RAISE NOTICE '--- 128: post_invoice đã chuyển sang mã HD-xxxx ---';
END $$;


-- --------------------------------------------------------------------
-- 6. `reissue_invoice` — truyền `reissue_of` xuống
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
  WHERE ns.nspname = 'public' AND pr.proname = 'reissue_invoice' AND pr.prokind = 'f';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'INV_CODE_NO_FN: tìm thấy % bản reissue_invoice, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pr.oid INTO v_oid
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'reissue_invoice' AND pr.prokind = 'f';
  v_src := pg_get_functiondef(v_oid);

  -- ⚠ GẮN `reissue_of` VÀO TẢI TRỌNG, ngay cạnh chỗ gắn `order_id` — một
  --   câu, cùng một kiểu, để người đọc sau thấy hai thứ đi cùng nhau.
  v_from := '  v_payload := jsonb_set(COALESCE(p, ''{}''::jsonb), ''{order_id}'','
            || E'\n' || '                         to_jsonb(v_old.order_id::text));';
  v_to := ''
    || '  v_payload := jsonb_set(COALESCE(p, ''{}''::jsonb), ''{order_id}'',' || E'\n'
    || '                         to_jsonb(v_old.order_id::text));' || E'\n'
    || '  v_payload := jsonb_set(v_payload, ''{reissue_of}'',' || E'\n'
    || '                         to_jsonb(p_invoice_id::text));';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy chỗ dựng tải trọng trong reissue_invoice'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  -- ------------------------------------------------------------------
  -- 6.2 SỬA LUÔN MỘT LỖI CÓ SẴN TỪ MIG 125 — `reissue_invoice` chưa từng
  --     chạy được.
  --
  -- `RETURNS TABLE (invoice_id uuid, …)` biến `invoice_id` thành một BIẾN
  -- của hàm. Câu dưới đây hỏi bảng `returns` bằng đúng cái tên ấy mà
  -- không gắn bí danh, nên Postgres không biết nên hiểu là biến hay cột:
  --
  --     ERROR: column reference "invoice_id" is ambiguous
  --
  -- ⚠ HÀM TẠO RA VẪN SẠCH, lỗi chỉ nổ lúc CHẠY tới câu đó. Nên cả mig
  --   125 lẫn mọi chốt cấu trúc đều xanh, còn nút "Sửa hóa đơn" thì hỏng
  --   ngay lần bấm đầu tiên. Tìm ra bằng cách chạy thật trên Postgres,
  --   không phải bằng đọc mã.
  --
  -- ⚠ GẮN BÍ DANH, KHÔNG ĐỔI TÊN CỘT TRẢ VỀ. Đổi tên cột trả về là đổi
  --   hợp đồng của RPC, và mã ứng dụng đang đọc `invoice_id`.
  v_from := '  SELECT COALESCE(array_agg(id), ''{}'') INTO v_rets' || E'\n'
            || '  FROM returns' || E'\n'
            || '  WHERE invoice_id = p_invoice_id AND status IN (''draft'', ''submitted'');';
  v_to   := '  SELECT COALESCE(array_agg(rr.id), ''{}'') INTO v_rets' || E'\n'
            || '  FROM returns rr' || E'\n'
            || '  WHERE rr.invoice_id = p_invoice_id AND rr.status IN (''draft'', ''submitted'');';
  IF position(v_from IN v_src) = 0 THEN
    RAISE EXCEPTION 'INV_CODE_SHAPE: không tìm thấy câu gom phiếu trả trong reissue_invoice'
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from, v_to);

  EXECUTE v_src;
  RAISE NOTICE '--- 128: reissue_invoice giữ số gốc, chỉ tăng đuôi (và hết nhập nhằng invoice_id) ---';
END $$;


NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_bad int;
  v_max int;
BEGIN
  -- Còn mã nào mang ngày tháng không.
  SELECT count(*) INTO v_bad FROM sales_invoices
  WHERE invoice_code !~ '^HD-[0-9]{4,}(-[0-9]+)?$';
  SELECT COALESCE(max(invoice_seq), 0) INTO v_max FROM sales_invoices;
  RAISE NOTICE '--- 128: % mã chưa đúng mẫu · số chạy đang ở % ---', v_bad, v_max;
END $$;
