-- ====================================================================
-- 227 — SỬA LỖI ĐỘI TEST: HÓA ĐƠN, TRẢ HÀNG, CÔNG NỢ / PHIẾU THU, CÔNG NỢ NCC,
--       SỬA HĐ GIỮ VIỆC GIAO NỢ CỦA NPP, HUỶ RIÊNG PHIẾU KHO CỦA CHỨNG TỪ ĐÃ ĐẢO
--
-- VÌ SAO — đội test 04/10/2026 xác nhận các lỗi dưới đây trái luật chủ nhà đã chốt:
--   · Chủ nhà 24/09/2026: "làm tiếp phần doanh thu tính theo hoá đơn" — doanh thu / hạn nợ theo
--     `invoice_date`, mà `invoice_date` là ngày THEO GIỜ VN (CLAUDE.md §1). Mig 140 đã ghi: "Máy chủ
--     Supabase chạy giờ UTC … Từ 00:00 tới 07:00 giờ Việt Nam mỗi ngày, `CURRENT_DATE` vẫn còn là NGÀY
--     HÔM QUA" — nhưng `post_invoice`, `_wf2b_recompute_receivable`, `create_cash_receipt`,
--     `void_cash_receipt` vẫn dùng `current_date`: HĐ / phiếu thu lập 0h–7h sáng mang ngày hôm trước
--     (phiếu thu còn lệch với YYMMDD trong chính mã phiếu).
--   · Chủ nhà 28/09/2026: "…rồi khoá ghi thẳng" (mig 214) — "Tiền, tồn kho, trạng thái chứng từ chỉ
--     đổi qua RPC". Còn lọt:
--       – `returns.credited_at` của phiếu đã hoàn thành ghi thẳng được → ngày trừ doanh số
--         (`revenue_date`) nhảy sang kỳ khác.
--       – Công nợ NCC (`payables`, `payable_payments`) chưa khoá: sửa `paid`, chèn / xoá phiếu chi,
--         xoá khoản đã trả từ trình duyệt → `paid` lệch Σ phiếu chi (mig 167).
--   · Chủ nhà 25/09/2026 (mig 191): phiếu trả tự lập "hoàn thành = nhập kho và trừ nợ" — nhưng phiếu
--     trả nhận đơn giá / thuế ÂM → credit âm → "trả hàng" lại TĂNG nợ khách.
--   · Chủ nhà 24/09/2026 (SP001945, quy đổi đơn vị): huỷ phiếu trả 1,5 thùng thì dòng đảo kho ghi
--     2 thùng (cột `quantity` số nguyên) — thẻ kho hiện "nhập 1,5 / xuất 2".
--   · Chủ nhà 02/10/2026 (mig 223): "khi nghỉ bàn giao khách hàng và công nợ về npp. Npp sẽ phân phối
--     lại sau" — nhưng Sửa HĐ (dù không đổi gì) làm nợ NPP đã giao cho NV mới quay về "NPP / chưa gán".
--   · Luật tồn kho = thẻ kho: `cancel_stock_entry` vẫn huỷ riêng được phiếu kho của chứng từ ĐÃ ĐẢO
--     (phiếu xuất của HĐ đã huỷ / đã sửa, phiếu nhập hàng trả "(đã đảo)", phiếu "Hoàn kho do huỷ hóa
--     đơn") → kho bị hoàn / rút lần hai.
--
-- CÁCH LÀM — vá thân hàm đang chạy bằng `regexp_replace` (khuôn mig 212 / 214), mỗi chỗ phải khớp đúng
--   MỘT lần, có dấu "(mig 227)" để chạy lại không vá chồng. Hàm trigger khoá ghi thẳng chạy theo vai
--   người gọi (không SECURITY DEFINER) — RPC SECURITY DEFINER chạy vai chủ nên không bị chặn.
-- ====================================================================

-- 1. NGÀY CHỨNG TỪ THEO GIỜ VN ------------------------------------------------
DO $p$
DECLARE
  v_vas text[][] := ARRAY[
    -- hàm, mẫu, thay
    ARRAY['public.post_invoice(jsonb)',
          '(v_date\s*:=\s*COALESCE\(\(p->>''invoice_date''\)::date,\s*)current_date(\);)',
          '\1public.vn_today() /* (mig 227) ngày VN, không theo múi giờ phiên */\2'],
    ARRAY['public._wf2b_recompute_receivable(uuid)',
          '(COALESCE\(v\.invoice_date,\s*)current_date(\))',
          '\1public.vn_today() /* (mig 227) */\2'],
    ARRAY['public.create_cash_receipt(jsonb)',
          '(COALESCE\(\(p->>''receipt_date''\)::date,\s*)current_date(\))',
          '\1public.vn_today() /* (mig 227) ngày VN như mã PT-YYMMDD */\2'],
    ARRAY['public.void_cash_receipt(uuid, text)',
          '(v_due\s*<\s*)current_date(\s)',
          '\1public.vn_today() /* (mig 227) */\2']
  ];
  v_src text;
  v_n   int;
  i     int;
BEGIN
  FOR i IN 1 .. array_length(v_vas, 1) LOOP
    v_src := pg_get_functiondef(v_vas[i][1]::regprocedure);
    IF position('(mig 227)' IN v_src) > 0 THEN
      RAISE NOTICE '--- 227: % đã theo ngày VN, bỏ qua ---', v_vas[i][1];
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_vas[i][2], 'g');
    IF v_n <> 1 THEN
      RAISE EXCEPTION '227: thấy % chỗ current_date cần thay trong %, cần đúng 1', v_n, v_vas[i][1]
        USING ERRCODE = 'P0001';
    END IF;
    EXECUTE regexp_replace(v_src, v_vas[i][2], v_vas[i][3]);
  END LOOP;
END;
$p$;

-- Lối chèn thẳng khác (không qua RPC) cũng không được lệch ngày.
ALTER TABLE public.cash_receipts ALTER COLUMN receipt_date SET DEFAULT public.vn_today();
ALTER TABLE public.sales_invoices ALTER COLUMN invoice_date SET DEFAULT public.vn_today();

-- 2. returns.credited_at chỉ đổi qua RPC --------------------------------------
--   Bản mig 214 chừa `credited_at` trong danh sách sửa được → bỏ ra, và chặn rõ (cả phiếu nháp).
--   Đổi `return_date` hợp lệ vẫn chạy: trigger khoá (trg_khoa_…) chạy TRƯỚC trg_returns_credited_at
--   (thứ tự tên), lúc đó NEW.credited_at vẫn bằng OLD; `revenue_date` do trg_zz_… tính lại.
CREATE OR REPLACE FUNCTION public._khoa_ghi_thang_phieu_tra()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_cho text[] := ARRAY['notes', 'reason', 'return_date', 'sales_user_id', 'revenue_date'];
BEGIN
  IF NOT public._la_trinh_duyet() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'PHIEU_TRA_KHOA: phiếu trả lập ra ở Nháp — hoàn thành đi qua nút Hoàn thành'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'PHIEU_TRA_KHOA: chỉ xoá được phiếu trả Nháp — phiếu đã xử lý thì huỷ'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'PHIEU_TRA_KHOA: trạng thái phiếu trả chỉ đổi qua Hoàn thành / Huỷ (% → %)', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'draft'
     AND (to_jsonb(NEW) - v_cho) IS DISTINCT FROM (to_jsonb(OLD) - v_cho) THEN
    RAISE EXCEPTION 'PHIEU_TRA_KHOA: phiếu trả đã qua Nháp chỉ sửa được ghi chú / lý do / ngày / người đứng tên — sửa hàng, tiền đi qua màn sửa phiếu'
      USING ERRCODE = 'P0001';
  END IF;
  -- (mig 227) credited_at quyết ngày trừ doanh số (revenue_date) — chỉ RPC / trigger ngày chứng từ đổi.
  IF NEW.applied_receipt_id IS DISTINCT FROM OLD.applied_receipt_id
     OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
     OR NEW.credited_at IS DISTINCT FROM OLD.credited_at
     OR NEW.credit_with_invoice IS DISTINCT FROM OLD.credit_with_invoice THEN
    RAISE EXCEPTION 'PHIEU_TRA_KHOA: cột này chỉ đổi qua RPC' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;

-- 3. Phiếu trả: đơn giá không âm, thuế trong [0, 1] ----------------------------
DO $p$
DECLARE
  v_src text;
  v_n   int;
  v_kiem text := '-- (mig 227) Đơn giá / thuế âm làm credit âm → "trả hàng" lại TĂNG nợ khách.' || chr(10)
    || '  IF EXISTS (' || chr(10)
    || '    SELECT 1 FROM jsonb_array_elements(%s) AS l227' || chr(10)
    || '    WHERE COALESCE((l227->>''quantity'')::numeric, 0) > 0' || chr(10)
    || '      AND (COALESCE((l227->>''unit_price'')::numeric, 0) < 0' || chr(10)
    || '           OR COALESCE((l227->>''vat_rate'')::numeric, 0) NOT BETWEEN 0 AND 1)' || chr(10)
    || '  ) THEN' || chr(10)
    || '    RAISE EXCEPTION ''BAD_PAYLOAD: đơn giá hàng trả không được âm, thuế phải trong khoảng 0 – 1 (0 – 100 phần trăm)'' USING ERRCODE = ''P0001'';' || chr(10)
    || '  END IF;' || chr(10);
  v_re text;
BEGIN
  -- 3a. save_pos_return: kiểm trước khi lập / sửa phiếu.
  v_src := pg_get_functiondef('public.save_pos_return(jsonb)'::regprocedure);
  IF position('(mig 227)' IN v_src) = 0 THEN
    v_re := '(\n)(\s*IF v_id IS NULL THEN\s*\n\s*INSERT INTO returns)';
    SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
    IF v_n <> 1 THEN
      RAISE EXCEPTION '227: thấy % chỗ lập phiếu trong save_pos_return, cần đúng 1', v_n USING ERRCODE = 'P0001';
    END IF;
    EXECUTE regexp_replace(v_src, v_re, '\1  ' || replace(format(v_kiem, 'v_lines'), '\', '\\') || '\2');
  END IF;

  -- 3b. _apply_return_adds (post_invoice / reissue_invoice thêm hàng trả).
  v_src := pg_get_functiondef('public._apply_return_adds(uuid, uuid, jsonb)'::regprocedure);
  IF position('(mig 227)' IN v_src) = 0 THEN
    v_re := '(\n)(\s*v_ret\s*:=\s*public\._pending_return_for\()';
    SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
    IF v_n <> 1 THEN
      RAISE EXCEPTION '227: thấy % chỗ _pending_return_for trong _apply_return_adds, cần đúng 1', v_n USING ERRCODE = 'P0001';
    END IF;
    EXECUTE regexp_replace(v_src, v_re, '\1  ' || replace(format(v_kiem, 'p_adds'), '\', '\\') || '\2');
  END IF;
END;
$p$;

-- Chặn ở tầng bảng cho mọi lối còn lại (create_return_with_lines, phiếu Nháp ghi thẳng).
-- NOT VALID: dòng cũ (nếu có) không làm hỏng migration; sổ sạch thì VALIDATE luôn.
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_lines_unit_price_khong_am'
                   AND conrelid = 'public.return_lines'::regclass) THEN
    ALTER TABLE public.return_lines ADD CONSTRAINT return_lines_unit_price_khong_am
      CHECK (unit_price IS NULL OR unit_price >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_lines_vat_rate_0_1'
                   AND conrelid = 'public.return_lines'::regclass) THEN
    ALTER TABLE public.return_lines ADD CONSTRAINT return_lines_vat_rate_0_1
      CHECK (vat_rate IS NULL OR vat_rate BETWEEN 0 AND 1) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.return_lines WHERE unit_price < 0) THEN
    ALTER TABLE public.return_lines VALIDATE CONSTRAINT return_lines_unit_price_khong_am;
  ELSE
    RAISE NOTICE '--- 227: còn dòng trả đơn giá âm — ràng buộc để NOT VALID, xem kham-so-that ---';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.return_lines WHERE vat_rate < 0 OR vat_rate > 1) THEN
    ALTER TABLE public.return_lines VALIDATE CONSTRAINT return_lines_vat_rate_0_1;
  ELSE
    RAISE NOTICE '--- 227: còn dòng trả thuế ngoài [0,1] — ràng buộc để NOT VALID, xem kham-so-that ---';
  END IF;
END;
$c$;

-- 4. cancel_return: dòng đảo ghi đúng SL giao dịch của dòng nhập (1,5 thùng, không phải 2) ------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.cancel_return(uuid, text)'::regprocedure);
  v_re1 text := '(sel\.qty_in_base_uom,\s*sel\.conversion_factor_snapshot)(\s+FROM stock_entry_lines sel)';
  v_re2 text := 'l\.quantity,\s*l\.quantity,\s*l\.qty_in_base_uom,\s*l\.unit_name,';
  v_n1 int;
  v_n2 int;
BEGIN
  IF position('(mig 227)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 227: cancel_return đã ghi SL giao dịch gốc, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n1 FROM regexp_matches(v_src, v_re1, 'g');
  SELECT count(*) INTO v_n2 FROM regexp_matches(v_src, v_re2, 'g');
  IF v_n1 <> 1 OR v_n2 <> 1 THEN
    RAISE EXCEPTION '227: cancel_return thấy % / % chỗ cần vá, cần đúng 1 / 1', v_n1, v_n2 USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_re1,
    '\1, sel.qty_in_transaction_uom AS sl_gd227, sel.transaction_uom AS dvt_gd227\2');
  v_src := regexp_replace(v_src, v_re2,
    'l.quantity, COALESCE(l.sl_gd227, l.quantity) /* (mig 227) SL giao dịch gốc, cột quantity là số nguyên */,'
    || ' l.qty_in_base_uom, COALESCE(l.dvt_gd227, l.unit_name),');
  EXECUTE v_src;
END;
$p$;

-- 5. reissue_invoice: tờ mới giữ NGƯỜI GIỮ NỢ của tờ cũ ---------------------------
--   cancel_invoice XOÁ phiếu nợ cũ, post_invoice sinh phiếu mới theo người của ĐƠN (NV đã nghỉ) →
--   trigger _cong_no_giu_ve_npp đẩy về NPP. Ghi nhớ người giữ nợ + cờ về NPP của phiếu cũ trước khi
--   huỷ, chép lại sau khối mig 182 (bật cờ npp.giao_cong_no để trigger cho qua, tắt ngay sau đó).
--   Chỉ chép người GIỮ NỢ — `sales_invoices.sales_user_id` (doanh số) vẫn của người cũ.
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure);
  v_re1 text := '(FROM receivables rc184 WHERE rc184\.invoice_id = p_invoice_id LIMIT 1;)';
  v_re2 text := '(WHERE rt182\.invoice_id = v_new\.invoice_id AND rt182\.status <> ''cancelled'';)';
  v_n1 int;
  v_n2 int;
BEGIN
  IF position('(mig 227)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 227: reissue_invoice đã giữ người giữ nợ, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n1 FROM regexp_matches(v_src, v_re1, 'g');
  SELECT count(*) INTO v_n2 FROM regexp_matches(v_src, v_re2, 'g');
  IF v_n1 <> 1 OR v_n2 <> 1 THEN
    RAISE EXCEPTION '227: reissue_invoice thấy % / % chỗ cần vá, cần đúng 1 / 1', v_n1, v_n2 USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_re1,
    '\1' || chr(10)
    || '    -- (mig 227) Ghi nhớ NGƯỜI GIỮ NỢ của tờ cũ (NPP có thể đã giao lại nợ của NV nghỉ việc).' || chr(10)
    || '    PERFORM set_config(''npp.reissue_nguoi_no'', COALESCE((' || chr(10)
    || '      SELECT jsonb_build_object(''u'', rc227.sales_user_id, ''t'', rc227.ve_npp_luc)::text' || chr(10)
    || '      FROM receivables rc227 WHERE rc227.invoice_id = p_invoice_id LIMIT 1), ''''), true);');
  v_src := regexp_replace(v_src, v_re2,
    '\1' || chr(10)
    || '  -- (mig 227) Tờ mới giữ NGƯỜI GIỮ NỢ của tờ cũ — không để nợ NPP đã giao lại quay về "NPP / chưa gán".' || chr(10)
    || '  DECLARE' || chr(10)
    || '    v227 jsonb := NULLIF(current_setting(''npp.reissue_nguoi_no'', true), '''')::jsonb;' || chr(10)
    || '  BEGIN' || chr(10)
    || '    PERFORM set_config(''npp.reissue_nguoi_no'', '''', true);' || chr(10)
    || '    IF v227 IS NOT NULL THEN' || chr(10)
    || '      PERFORM set_config(''npp.giao_cong_no'', ''on'', true);' || chr(10)
    || '      UPDATE receivables rc227' || chr(10)
    || '         SET sales_user_id = NULLIF(v227->>''u'', '''')::uuid,' || chr(10)
    || '             ve_npp_luc    = NULLIF(v227->>''t'', '''')::timestamptz' || chr(10)
    || '       WHERE rc227.invoice_id = v_new.invoice_id;' || chr(10)
    || '      PERFORM set_config(''npp.giao_cong_no'', '''', true);' || chr(10)
    || '    END IF;' || chr(10)
    || '  END;');
  EXECUTE v_src;
END;
$p$;

-- 6. cancel_stock_entry: không huỷ riêng phiếu kho của chứng từ ĐÃ ĐẢO ------------------
--   Hở cũ: chỉ chặn HĐ 'posted' và phiếu trả 'completed' khớp nguyên văn ghi chú; phiếu
--   "Hoàn kho do huỷ hóa đơn" / "Đảo phiếu trả" không có chặn nào.
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.cancel_stock_entry(uuid, text)'::regprocedure);
  v_re  text := '(\n)(\s*IF v_type NOT IN \(''import'', ''export''\) THEN)';
  v_n   int;
BEGIN
  IF position('(mig 227)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 227: cancel_stock_entry đã chặn chứng từ đã đảo, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '227: thấy % chỗ kiểm loại phiếu trong cancel_stock_entry, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  EXECUTE regexp_replace(v_src, v_re,
    '\1'
    || '  -- (mig 227) Phiếu kho của chứng từ ĐÃ ĐẢO: hàng đã hoàn / rút bằng chính hàm huỷ của chứng từ' || chr(10)
    || '  --   gốc — huỷ riêng phiếu kho là hoàn / rút LẦN HAI, thẻ kho lệch tồn.' || chr(10)
    || '  DECLARE' || chr(10)
    || '    v227_hd  text;' || chr(10)
    || '    v227_ghi text;' || chr(10)
    || '  BEGIN' || chr(10)
    || '    SELECT se227.notes INTO v227_ghi FROM stock_entries se227 WHERE se227.id = p_entry_id;' || chr(10)
    || '    SELECT si227.invoice_code INTO v227_hd FROM sales_invoices si227' || chr(10)
    || '     WHERE si227.stock_entry_id = p_entry_id AND si227.status <> ''posted'' LIMIT 1;' || chr(10)
    || '    IF v227_hd IS NOT NULL THEN' || chr(10)
    || '      RAISE EXCEPTION ''ENTRY_HAS_INVOICE: phiếu % thuộc hóa đơn % đã huỷ / đã sửa — hàng đã hoàn kho lúc huỷ / sửa hóa đơn, không huỷ riêng phiếu kho được.'',' || chr(10)
    || '        v_code, v227_hd USING ERRCODE = ''P0001'';' || chr(10)
    || '    END IF;' || chr(10)
    || '    IF v227_ghi LIKE ''Nhập lại từ phiếu trả %'' OR v227_ghi LIKE ''Đảo phiếu trả %'' THEN' || chr(10)
    || '      RAISE EXCEPTION ''ENTRY_HAS_SOURCE: phiếu % là hàng khách trả. Huỷ / sửa phiếu trả hàng đó thay vì huỷ riêng phiếu kho.'',' || chr(10)
    || '        v_code USING ERRCODE = ''P0001'';' || chr(10)
    || '    END IF;' || chr(10)
    || '    IF v227_ghi LIKE ''Hoàn kho do huỷ hóa đơn %'' THEN' || chr(10)
    || '      RAISE EXCEPTION ''ENTRY_HAS_SOURCE: phiếu % là hàng hoàn kho khi huỷ hóa đơn — hóa đơn vẫn Đã huỷ, không huỷ riêng phiếu kho được.'',' || chr(10)
    || '        v_code USING ERRCODE = ''P0001'';' || chr(10)
    || '    END IF;' || chr(10)
    || '  END;' || chr(10)
    || '\2');
END;
$p$;

-- 7. CÔNG NỢ NCC: khoá ghi thẳng tiền từ trình duyệt (khuôn mig 214) -------------------
--   Chừa đúng những việc màn hình hợp lệ đang làm:
--     · Thêm công nợ NCC (payables/new) / Nợ đầu kỳ NCC: chèn khoản CHƯA TRẢ (paid = 0).
--     · Sửa số hóa đơn / hạn / ghi chú; đổi trạng thái tay (quá hạn / mở lại) đúng với số đã trả.
--     · Nợ đầu kỳ: sửa số tiền (trạng thái đi kèm), xoá khoản chưa trả.
--     · Xoá khoản chưa trả đồng nào, không có phiếu chi (kể cả khoản gắn phiếu nhập — cancel_stock_entry
--       bảo "Xoá công nợ NCC đó trước").
--     · Xác nhận phiếu chi (`verified_by`, `verified_at`).
--   Trả tiền NCC đi qua `record_payable_payment`; phiếu nhập / trả NCC qua RPC của chúng.
CREATE OR REPLACE FUNCTION public._khoa_ghi_thang_no_ncc()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_paid numeric;
  v_amt  numeric;
BEGIN
  IF NOT public._la_trinh_duyet() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.paid, 0) <> 0 OR COALESCE(NEW.status, 'open') NOT IN ('open', 'overdue') THEN
      RAISE EXCEPTION 'NO_NCC_KHOA: màn hình chỉ thêm được khoản nợ NCC chưa trả — trả tiền đi qua nút Ghi trả NCC'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.paid, 0) <> 0
       OR EXISTS (SELECT 1 FROM payable_payments pp WHERE pp.payable_id = OLD.id) THEN
      RAISE EXCEPTION 'NO_NCC_KHOA: chỉ xoá được khoản nợ NCC chưa trả đồng nào (không có phiếu chi)'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.paid IS DISTINCT FROM OLD.paid
     OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.stock_entry_id IS DISTINCT FROM OLD.stock_entry_id
     OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.amount IS DISTINCT FROM OLD.amount
         AND (NOT COALESCE(OLD.opening_balance, false) OR OLD.stock_entry_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'NO_NCC_KHOA: số nợ / số đã trả NCC chỉ đổi qua phiếu nhập, phiếu trả NCC, Ghi trả NCC (RPC)'
      USING ERRCODE = 'P0001';
  END IF;
  -- Trạng thái tay phải khớp số đã trả.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_paid := COALESCE(NEW.paid, 0);
    v_amt  := COALESCE(NEW.amount, 0);
    IF NOT ((NEW.status = 'paid'    AND v_paid >= v_amt - 0.01)
         OR (NEW.status = 'partial' AND v_paid > 0 AND v_paid < v_amt)
         OR (NEW.status = 'open'    AND v_paid = 0 AND v_amt > 0)
         OR (NEW.status = 'overdue' AND v_paid < v_amt)) THEN
      RAISE EXCEPTION 'NO_NCC_KHOA: trạng thái % không khớp số đã trả % / %', NEW.status, v_paid, v_amt
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_no_ncc ON public.payables;
CREATE TRIGGER trg_khoa_ghi_thang_no_ncc
  BEFORE INSERT OR UPDATE OR DELETE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public._khoa_ghi_thang_no_ncc();

CREATE OR REPLACE FUNCTION public._khoa_ghi_thang_chi_ncc()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF NOT public._la_trinh_duyet() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Chỉ được xác nhận (đối chiếu) một phiếu chi.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['verified_by', 'verified_at']) = (to_jsonb(OLD) - ARRAY['verified_by', 'verified_at']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CHI_NCC_KHOA: tiền trả NCC chỉ ghi qua nút Ghi trả NCC (RPC record_payable_payment)'
    USING ERRCODE = 'P0001';
END;
$fn$;
DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_chi_ncc ON public.payable_payments;
CREATE TRIGGER trg_khoa_ghi_thang_chi_ncc
  BEFORE INSERT OR UPDATE OR DELETE ON public.payable_payments
  FOR EACH ROW EXECUTE FUNCTION public._khoa_ghi_thang_chi_ncc();

NOTIFY pgrst, 'reload schema';

SELECT 'mig 227: hóa đơn / trả hàng / công nợ / NCC / phiếu kho đã đảo' AS buoc,
       CASE WHEN position('(mig 227)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) > 0
             AND position('(mig 227)' IN pg_get_functiondef('public._wf2b_recompute_receivable(uuid)'::regprocedure)) > 0
             AND position('(mig 227)' IN pg_get_functiondef('public.create_cash_receipt(jsonb)'::regprocedure)) > 0
             AND position('(mig 227)' IN pg_get_functiondef('public.void_cash_receipt(uuid, text)'::regprocedure)) > 0
             AND position('(mig 227)' IN pg_get_functiondef('public._khoa_ghi_thang_phieu_tra()'::regprocedure)) > 0
             AND position('(mig 227)' IN pg_get_functiondef('public.save_pos_return(jsonb)'::regprocedure)) > 0
             AND position('(mig 227)' IN pg_get_functiondef('public._apply_return_adds(uuid, uuid, jsonb)'::regprocedure)) > 0
             AND position('(mig 227)' IN pg_get_functiondef('public.cancel_return(uuid, text)'::regprocedure)) > 0
             AND position('(mig 227)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0
             AND position('(mig 227)' IN pg_get_functiondef('public.cancel_stock_entry(uuid, text)'::regprocedure)) > 0
             AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_khoa_ghi_thang_no_ncc', 'trg_khoa_ghi_thang_chi_ncc')) = 2
             AND (SELECT count(*) FROM pg_constraint WHERE conname IN ('return_lines_unit_price_khong_am', 'return_lines_vat_rate_0_1')) = 2
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM pg_constraint WHERE conname IN ('return_lines_unit_price_khong_am', 'return_lines_vat_rate_0_1')
          AND NOT convalidated) AS rang_buoc_chua_validate;
