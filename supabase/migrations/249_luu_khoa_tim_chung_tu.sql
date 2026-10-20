-- ====================================================================
-- KHOÁ TÌM CỦA BẢNG CHỨNG TỪ LƯU SẴN — TÌM SỐ HOÁ ĐƠN / ĐƠN / PHIẾU KHÔNG TÍNH LẠI TỪNG DÒNG
--
-- VÌ SAO — chủ nhà 20/10/2026: "Kiểm tra giúp tao sao tìm kiếm số hóa đơn trong danh sách hóa đơn
--   chậm thế ?"
--
--   Mig 205 cho 9 bảng chứng từ khoá tìm `tim_kd` (mã viết liền, bỏ số 0 đầu, không dấu) dạng CỘT
--   TÍNH — hàm `tim_kd(<bảng>)` — với niềm tin Postgres "mở" hàm ra và đi chỉ mục trigram. Đo trên
--   sổ giả 40.000 hoá đơn, đúng câu trình duyệt gửi (vai `authenticated`, có RLS):
--     · KHÔNG BAO GIỜ đi chỉ mục. Dưới RLS, `ilike` không LEAKPROOF nên Postgres phải soát quyền
--       từng dòng TRƯỚC rồi mới so chữ — quét cả bảng. (Mig 207 còn đặt search_path cho hàm, nên
--       hàm không "mở" ra được nữa kể cả khi không có RLS.)
--     · Mỗi dòng TÍNH LẠI khoá (`khoa_tim_ds`: chuẩn hoá NFC, bỏ dấu, regexp) — ~0,18 ms một dòng, và
--       HAI lần khi chữ gõ có dấu câu ("HD251020-00123" → hai dạng khoá).
--     · Một lần gõ là 5–7 câu như thế (danh sách hai nhịp, đếm, cộng tiền, đếm theo trạng thái, đếm
--       theo tuyến). Giờ thật: chủ NPP gõ "HD251020-00123" → danh sách 20 dòng 42,5 giây, đếm 43,2 giây;
--       NVBH 15,7 giây. Sau mig này: ~1 giây mỗi câu (phần còn lại là soát quyền RLS từng dòng — chung
--       cho mọi danh sách, kể cả lúc không tìm).
--
-- LÀM GÌ
--   1. Mỗi bảng có cột THẬT `tim_kd` — đúng khoá cũ, tính MỘT lần lúc ghi (như hàng / khách / NCC,
--      mig 177). So chữ trên chuỗi đã có thì rẻ.
--   2. Điền cột KHÔNG bằng UPDATE (mig 205: ghi lại hàng chục nghìn chứng từ là chạy mọi trigger của
--      bảng — mốc "sửa lúc", khoá ghi thẳng, công nợ…): thêm cột GENERATED (Postgres viết lại bảng,
--      KHÔNG chạy trigger nào) rồi DROP EXPRESSION — cột thành cột thường, giữ nguyên giá trị.
--   3. Trigger `trg_zzzz_tim_kd` (hàm chung `_trg_tim_kd` của mig 177/205) giữ cột đúng về sau.
--      ⚠ KHÔNG ĐỂ GENERATED: cột generated từ chối mọi câu ghi có nhắc tới nó (mig 177) — màn nào đọc
--        `select("*")` rồi ghi lại nguyên dòng là vỡ.
--      ⚠ TÊN `zzzz` ĐỂ CHẠY SAU MỌI TRIGGER BEFORE KHÁC (Postgres chạy theo thứ tự tên) — kể cả trigger
--        ĐẶT MÃ (`trg_sales_orders_assign_code`, `trg_danh_so_phieu_tra`) và `trg_zzz_sua_luc`: chạy
--        trước thì khoá tính từ mã còn trống.
--   4. Bỏ hàm cột tính `tim_kd(<bảng>)` và chỉ mục biểu thức của mig 205 — dưới RLS chỉ mục không
--      dùng được, mà mỗi lần ghi vẫn phải tính khoá cho nó.
--   5. `_trg_tim_kd`: sửa dòng mà KHÔNG đổi cột nguồn (lô hàng đổi số lượng, phiếu thu đổi tiền…) thì
--      khỏi tính lại khoá. Ghi thẳng vào `tim_kd` thì vẫn bị tính đè.
--
-- Trình duyệt KHÔNG đổi: `tim_kd.ilike…` nay trúng cột thật; `coTimKd` vẫn dò ra có.
-- ⚠ ADD COLUMN viết lại bảng và KHOÁ bảng tới lúc chạy xong cả tệp (vài giây với cỡ sổ hiện tại) —
--   nên chạy lúc vắng. `users` làm sau cùng: mọi câu soát quyền đều đọc bảng này.
-- ⚠ Đổi luật `khoa_tim` sau này thì phải tính lại cột (như mig 205 đã làm với hàng / khách / NCC).
-- ====================================================================

-- 5. Trigger chung: chỉ tính lại khoá khi cột nguồn đổi, hoặc có ai ghi thẳng vào tim_kd
CREATE OR REPLACE FUNCTION public._trg_tim_kd()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_cu jsonb;
  v_doi boolean := true;
  v_gt text[] := '{}';
  i int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_cu := to_jsonb(OLD);
    v_doi := NEW.tim_kd IS DISTINCT FROM OLD.tim_kd;
  END IF;
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    v_gt := v_gt || COALESCE(v_row->>TG_ARGV[i], '');
    IF NOT v_doi AND (v_row->TG_ARGV[i]) IS DISTINCT FROM (v_cu->TG_ARGV[i]) THEN
      v_doi := true;
    END IF;
  END LOOP;
  IF v_doi THEN
    NEW.tim_kd := public.khoa_tim_ds(VARIADIC v_gt);
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public._trg_tim_kd() FROM PUBLIC, anon, authenticated;

-- 1–4. Từng bảng chứng từ
DO $ct$
DECLARE
  r record;
  v_bt text;
  v_ds text;
  v_thieu int;
BEGIN
  -- Bảng → các cột ghép vào khoá, theo thứ tự của mig 205 (khoá phải y hệt).
  -- ⚠ THỨ TỰ BẢNG: bảng nhiều người đọc nhất làm sau cùng — khoá bảng giữ tới hết tệp.
  FOR r IN SELECT * FROM (VALUES
    ('batches',        ARRAY['batch_code']),
    ('stock_entries',  ARRAY['entry_code']),
    ('payables',       ARRAY['invoice_number']),
    ('cash_receipts',  ARRAY['receipt_code', 'notes']),
    ('invoices',       ARRAY['invoice_number', 'customer_name', 'misa_inv_no', 'misa_invoice_id']),
    ('returns',        ARRAY['return_code']),
    ('sales_orders',   ARRAY['order_code']),
    ('sales_invoices', ARRAY['invoice_code']),
    ('users',          ARRAY['full_name', 'phone'])
  ) x(bang, cot) LOOP
    -- Bảng / cột chưa có (sổ cài mới dở dang) thì bỏ qua, không làm hỏng cả tệp.
    SELECT count(*) INTO v_thieu FROM unnest(r.cot) c
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = r.bang AND column_name = c);
    IF to_regclass('public.' || r.bang) IS NULL OR v_thieu > 0 THEN
      RAISE NOTICE 'Bỏ qua %: thiếu bảng hoặc cột', r.bang;
      CONTINUE;
    END IF;

    -- 4. Cột tính + chỉ mục biểu thức của mig 205.
    EXECUTE format('DROP INDEX IF EXISTS public.%I', 'idx_' || r.bang || '_tim_kd_trgm');
    EXECUTE format('DROP FUNCTION IF EXISTS public.tim_kd(public.%I)', r.bang);

    -- 1 + 2. Cột thật: điền bằng một lần viết lại bảng (không trigger), rồi thành cột thường.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = r.bang AND column_name = 'tim_kd') THEN
      SELECT 'public.khoa_tim_ds(VARIADIC ARRAY[' || string_agg(format('%I::text', c), ', ') || '])'
        INTO v_bt FROM unnest(r.cot) c;
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN tim_kd text GENERATED ALWAYS AS (%s) STORED', r.bang, v_bt);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tim_kd DROP EXPRESSION IF EXISTS', r.bang);

    -- 3. Trigger giữ khoá đúng về sau — chạy SAU mọi trigger BEFORE khác (xem đầu tệp).
    SELECT string_agg(quote_literal(c), ', ') INTO v_ds FROM unnest(r.cot) c;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_zzzz_tim_kd ON public.%I', r.bang);
    EXECUTE format('CREATE TRIGGER trg_zzzz_tim_kd BEFORE INSERT OR UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public._trg_tim_kd(%s)', r.bang, v_ds);
  END LOOP;
END;
$ct$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Tóm tắt — chỉ đọc. Mong đợi: 9 bảng có cột thường `tim_kd`, 9 trigger, 0 hàm cột tính,
-- 0 chỉ mục biểu thức cũ, 0 hoá đơn / đơn lệch khoá (soát 1.000 tờ mới nhất — soát cả sổ là tính lại
-- khoá từng dòng, đúng cái chậm vừa bỏ, trong lúc bảng còn đang khoá).
-- ---------------------------------------------------------------------
SELECT 'Bảng chứng từ có cột tim_kd (cột thường)' AS hang_muc, count(*)::text AS gia_tri
  FROM pg_attribute a
 WHERE a.attname = 'tim_kd' AND NOT a.attisdropped AND a.attgenerated = ''
   AND a.attrelid IN (SELECT to_regclass('public.' || b) FROM unnest(ARRAY['sales_orders', 'sales_invoices', 'returns',
         'stock_entries', 'batches', 'payables', 'cash_receipts', 'users', 'invoices']) b)
UNION ALL
SELECT 'Trigger trg_zzzz_tim_kd', count(*)::text FROM pg_trigger WHERE tgname = 'trg_zzzz_tim_kd'
UNION ALL
SELECT 'Hàm cột tính tim_kd(<bảng>) còn lại', count(*)::text FROM pg_proc
 WHERE proname = 'tim_kd' AND pronamespace = 'public'::regnamespace
UNION ALL
SELECT 'Chỉ mục biểu thức khoa_tim_ds còn lại', count(*)::text FROM pg_indexes
 WHERE schemaname = 'public' AND indexname LIKE 'idx\_%\_tim\_kd\_trgm' AND indexdef LIKE '%khoa_tim_ds%'
UNION ALL
SELECT 'Hoá đơn lệch khoá (1.000 tờ mới nhất)', count(*)::text
  FROM (SELECT invoice_code, tim_kd FROM public.sales_invoices ORDER BY created_at DESC LIMIT 1000) x
 WHERE tim_kd IS DISTINCT FROM public.khoa_tim_ds(VARIADIC ARRAY[invoice_code::text])
UNION ALL
SELECT 'Đơn hàng lệch khoá (1.000 đơn mới nhất)', count(*)::text
  FROM (SELECT order_code, tim_kd FROM public.sales_orders ORDER BY created_at DESC LIMIT 1000) x
 WHERE tim_kd IS DISTINCT FROM public.khoa_tim_ds(VARIADIC ARRAY[order_code::text]);
