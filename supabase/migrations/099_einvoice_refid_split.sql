-- ====================================================================
-- 099 — Tách RefID khỏi số hoá đơn MISA
--
-- LỖI ĐANG CHẠY
-- `invoices.misa_invoice_id` đang kiêm HAI vai, và vai sau xoá mất vai
-- trước:
--
--   publish/route.ts:307  ghi RefID (GUID mình sinh) vào cột này
--   refresh-status:110    ghi InvNo (số hoá đơn MISA cấp) ĐÈ LÊN
--
-- Dây chuyền hậu quả:
--   1. Lần refresh đầu chạy đúng, ghi InvNo đè GUID.
--   2. Lần refresh thứ hai gọi ?refID=<số hoá đơn> → MISA không biết →
--      "MISA không trả về dữ liệu HD." Câu đó chỉ người dùng đi soi MISA,
--      trong khi lỗi nằm ở chính chỗ này.
--   3. Mất khoá là mất đường hỏi: KHÔNG BAO GIỜ biết hoá đơn bị huỷ hay
--      bị thay thế trên MISA sau đó.
--   4. Deep-link MISA (src/lib/misa/web-url.ts) gãy.
--   5. Đã có người vá ở chỗ DÙNG thay vì chỗ GÂY RA: cả
--      publish/route.ts:84 lẫn invoices/[id]/page.tsx:231 đều phải
--      `uuidRe.test(misa_invoice_id)` để đoán xem cột này lúc này đang
--      giữ vai nào.
--
-- CÁCH SỬA: hai khoá, hai cột. Đây là ràng buộc kiến trúc, không phải
-- chuyện đặt tên.
--
--   misa_ref_id      GUID mình sinh, BẤT BIẾN     — chỉ publish ghi
--   misa_inv_no      số hoá đơn MISA cấp          — chỉ refresh ghi
--   misa_inv_series  ký hiệu (vd 1C25MHG)         — chỉ refresh ghi
--   misa_lookup_code TransactionID                — chỉ refresh ghi
--
-- BACKFILL — đọc kỹ phần này
-- Dòng nào `misa_invoice_id` còn đúng khuôn UUID thì RefID vẫn còn:
-- chép sang `misa_ref_id`. Dòng nào KHÔNG đúng khuôn UUID thì refresh đã
-- ghi đè mất RefID: chép giá trị đó sang `misa_inv_no` (nó là số hoá đơn),
-- để `misa_ref_id = NULL`, và ĐÁNH DẤU vào `misa_note`.
--
-- Không dọn im lặng. Những hoá đơn đó cần phát hành lại hoặc gán tay
-- RefID; không ai biết là bao nhiêu tờ thì không ai làm. Migration
-- RAISE NOTICE số lượng, và `misa_note` giữ dấu vết để tra lại bất cứ lúc
-- nào (xem supabase/diagnostics/einvoice_lost_refid.sql).
--
-- KHÔNG đụng RLS: invoices đã bật RLS ở mức DÒNG (mig 002/084), cột mới
-- tự nằm trong policy sẵn có. Cũng không có GRANT theo danh sách cột nào
-- trên bảng này nên cột mới thừa hưởng quyền hiện tại.
-- ====================================================================

-- --- 1. Cột mới -----------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS misa_ref_id text,
  ADD COLUMN IF NOT EXISTS misa_inv_no text,
  ADD COLUMN IF NOT EXISTS misa_inv_series text,
  ADD COLUMN IF NOT EXISTS misa_inv_date date,
  ADD COLUMN IF NOT EXISTS misa_invoice_code text,
  ADD COLUMN IF NOT EXISTS misa_relation text,
  ADD COLUMN IF NOT EXISTS misa_org_ref_id text,
  ADD COLUMN IF NOT EXISTS misa_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS misa_note text,
  ADD COLUMN IF NOT EXISTS misa_no_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN invoices.misa_ref_id IS
  'RefID (GUID) mình sinh lúc đẩy hoá đơn. BẤT BIẾN — chỉ publish được '
  'ghi. Đây là khoá DUY NHẤT để hỏi lại MISA về hoá đơn này; ghi đè nó là '
  'cắt đường hỏi.';
COMMENT ON COLUMN invoices.misa_inv_no IS
  'Số hoá đơn MISA cấp (InvNo). Chỉ vòng refresh/sync được ghi.';
COMMENT ON COLUMN invoices.misa_inv_series IS
  'Ký hiệu hoá đơn (vd 1C25MHG). Số hoá đơn KHÔNG định danh được nếu '
  'thiếu ký hiệu — hai ký hiệu khác nhau dùng chung dải số là chuyện '
  'thường.';
COMMENT ON COLUMN invoices.misa_inv_date IS
  'Ngày phát hành trên MISA (InvDate). Khác ngày ghi sổ — thiếu nó thì '
  'không biết kỳ thuế.';
COMMENT ON COLUMN invoices.misa_invoice_code IS
  'Mã cơ quan thuế cấp (InvoiceCode). Chỉ đơn vị dùng hoá đơn CÓ MÃ mới '
  'có; xem company_einvoice_config.misa_is_invoice_with_code.';
COMMENT ON COLUMN invoices.misa_relation IS
  'Trục QUAN HỆ, đọc từ EInvoiceStatus: new/replacement/adjustment/'
  'replaced/adjusted. Khác hẳn trục phát hành (PublishStatus) — hai trục '
  'nằm ở hai field.';
COMMENT ON COLUMN invoices.misa_org_ref_id IS
  'RefID của hoá đơn GỐC khi tờ này là bản thay thế/điều chỉnh.';
COMMENT ON COLUMN invoices.misa_no_locked IS
  'true = số hoá đơn do người GÁN TAY. Vòng quét không được ghi đè: '
  'misa_ref_id trên hoá đơn đó thường trỏ về tờ ĐÃ CHẾT, quét tiếp là ghi '
  'số chết đè lên số người vừa gán, lặng lẽ, mỗi lần chạy.';

-- --- 2. Nới CHECK của misa_status -----------------------------------
-- Ràng buộc gốc nằm ở mig 011, thêm KÈM cột bằng
-- `ADD COLUMN IF NOT EXISTS ... CHECK (...)`. Nếu cột đã tồn tại từ trước
-- thì cả câu lệnh bị bỏ qua — CHECK bao gồm. Nên KHÔNG được đoán tên
-- ràng buộc, cũng không được cho rằng nó tồn tại: tra trong catalog rồi
-- mới xử lý.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'invoices'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%misa_status%'
  LOOP
    EXECUTE format('ALTER TABLE invoices DROP CONSTRAINT %I', v_name);
    RAISE NOTICE 'Đã bỏ ràng buộc cũ trên misa_status: %', v_name;
  END LOOP;
END $$;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_misa_status_check CHECK (
    misa_status IS NULL OR misa_status IN (
      'pending',          -- đang đẩy lên
      'sent',             -- đã đẩy, MISA chưa cấp số
      'waiting_code',     -- đã cấp số, chờ cơ quan thuế cấp mã
      'signed',           -- đã phát hành (PublishStatus = 3, hoặc đã có mã CQT)
      'replaced',         -- BỊ thay thế → hết hiệu lực
      'cancelled',        -- bị huỷ trên MISA
      'amount_mismatch',  -- số tiền MISA khác sổ
      'error'
    )
  );

-- --- 3. Trục quan hệ: giá trị hợp lệ --------------------------------
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_misa_relation_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_misa_relation_check CHECK (
    misa_relation IS NULL OR misa_relation IN (
      'new',          -- 1 = hoá đơn mới
      'replacement',  -- 3 = hoá đơn thay thế (tờ này thay cho tờ khác)
      'adjustment',   -- 4 = hoá đơn điều chỉnh (tờ này điều chỉnh tờ khác)
      'replaced',     -- 7 = BỊ thay thế → hết hiệu lực
      'adjusted',     -- 8 = BỊ điều chỉnh → VẪN CÒN hiệu lực
      'unknown'       -- MISA trả giá trị lạ: KHÔNG ĐOÁN
    )
  );

-- --- 4. Backfill ----------------------------------------------------
DO $$
DECLARE
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_kept    integer;
  v_lost    integer;
BEGIN
  -- 4a. Còn đúng khuôn UUID → RefID vẫn nguyên.
  UPDATE invoices
     SET misa_ref_id = misa_invoice_id
   WHERE misa_ref_id IS NULL
     AND misa_invoice_id IS NOT NULL
     AND misa_invoice_id ~* v_uuid_re;
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  -- 4b. Không đúng khuôn UUID → refresh đã ghi đè mất RefID. Giá trị
  --     đang nằm đó là SỐ HOÁ ĐƠN, chuyển sang đúng cột của nó.
  --     Bỏ qua rác cũ '<Chưa cấp số>' (bug cũ đã fix, xem publish:82).
  --
  --     `misa_inv_no IS NULL` KHÔNG thừa. Thiếu nó thì chạy lại migration
  --     lần hai vẫn khớp đúng những dòng đó (misa_ref_id còn NULL,
  --     misa_invoice_id còn nguyên) và nối thêm đoạn ghi chú lần nữa —
  --     đã đo: lần 2 báo "2 hoá đơn MẤT RefID" y như lần 1. Nó cũng
  --     chặn việc đè số cũ lên số mà vòng refresh đã ghi đúng.
  UPDATE invoices
     SET misa_inv_no = misa_invoice_id,
         misa_note = COALESCE(misa_note || E'\n', '')
                     || 'MẤT RefID: cột misa_invoice_id cũ đã bị số hoá đơn ghi đè '
                     || '(mig 099). Không tra cứu lại được trên MISA — cần phát hành '
                     || 'lại hoặc gán tay RefID.'
   WHERE misa_ref_id IS NULL
     AND misa_inv_no IS NULL
     AND misa_invoice_id IS NOT NULL
     AND misa_invoice_id !~* v_uuid_re
     AND misa_invoice_id NOT LIKE '<%';
  GET DIAGNOSTICS v_lost = ROW_COUNT;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'BACKFILL 099';
  RAISE NOTICE '  % hoá đơn giữ được RefID.', v_kept;
  RAISE NOTICE '  % hoá đơn MẤT RefID — đã đánh dấu vào misa_note.', v_lost;
  IF v_lost > 0 THEN
    RAISE NOTICE '  Những tờ này KHÔNG hỏi lại MISA được. Liệt kê bằng:';
    RAISE NOTICE '    supabase/diagnostics/einvoice_lost_refid.sql';
  END IF;
  RAISE NOTICE '=====================================================';
END $$;

-- --- 5. Hai hoá đơn cùng số là lỗi, chặn ở tầng DB ------------------
-- Partial: chỉ ràng buộc khi đã có số. Hoá đơn chưa cấp số (NULL) thì
-- bao nhiêu tờ cũng được.
-- Ký hiệu vào khoá vì hai ký hiệu khác nhau dùng chung dải số là chuyện
-- thường; COALESCE để ký hiệu NULL không làm rỗng cả khoá (NULL trong
-- unique index là "khác nhau hết", tức không chặn được gì).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_misa_inv_no
  ON invoices (org_id, COALESCE(misa_inv_series, ''), misa_inv_no)
  WHERE misa_inv_no IS NOT NULL;

-- --- 6. Chỉ mục cho vòng quét ---------------------------------------
-- Lượt 2 sắp theo misa_last_checked_at NULLS FIRST; không có chỉ mục thì
-- mỗi lần chạy là một lần quét toàn bảng invoices.
CREATE INDEX IF NOT EXISTS idx_invoices_misa_sync
  ON invoices (org_id, misa_last_checked_at NULLS FIRST)
  WHERE misa_ref_id IS NOT NULL;

-- --- 7. Cột cũ: giữ lại, đánh dấu không dùng nữa ---------------------
-- KHÔNG drop trong migration này. Còn mã đang chạy đọc nó (danh sách hoá
-- đơn, trang chi tiết), và drop cột là thao tác không lùi được. Drop ở
-- migration sau, khi đã xác nhận không còn ai đọc.
COMMENT ON COLUMN invoices.misa_invoice_id IS
  'KHÔNG DÙNG NỮA (mig 099) — cột này từng kiêm cả RefID lẫn số hoá đơn '
  'và vai sau xoá mất vai trước. Dùng misa_ref_id / misa_inv_no. Giữ lại '
  'để đối chiếu; sẽ drop ở migration sau.';
