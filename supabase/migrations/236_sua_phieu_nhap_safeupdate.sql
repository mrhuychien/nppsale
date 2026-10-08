-- ====================================================================
-- 236 — SỬA PHIẾU NHẬP ĐÃ HOÀN THÀNH BÁO "UPDATE requires a WHERE clause"
--
-- VÌ SAO — chủ nhà 08/10/2026: "Sửa phiếu nhập NCC báo lỗi này? UPDATE requires a WHERE clause".
--   Supabase nạp tiện ích `safeupdate` cho mọi lượt gọi qua API (vai `authenticator` → PostgREST): câu UPDATE /
--   DELETE KHÔNG có WHERE bị từ chối ngay lúc phân tích — kể cả câu nằm trong hàm SECURITY DEFINER, kể cả trên bảng
--   tạm. `sua_phieu_nhap` (mig 235) tính SL cơ sở / giá vốn cho bảng tạm `_pn_moi` bằng một câu UPDATE trần, nên
--   MỌI lần lưu sửa phiếu nhập đã hoàn thành đều nổ ở đó. Cả giao dịch lùi lại — không có dữ liệu nào bị ghi dở.
--   Chạy thử bằng psql (vai postgres, không nạp safeupdate) thì không thấy lỗi — vì vậy lọt qua bộ thử 235.
--
-- CÁCH LÀM
--   1. `sua_phieu_nhap` y hệt bản mig 235, chỉ thêm `WHERE quantity > 0 AND cf > 0` cho câu UPDATE bảng tạm (vòng kiểm
--      ngay trước đã chặn SL / hệ số ≤ 0, nên điều kiện phủ đủ mọi dòng).
--   2. Quét bản đang chạy của MỌI hàm (pg_proc) trên sổ thử: đây là câu UPDATE / DELETE không WHERE DUY NHẤT.
--      Chốt `tests/sql-safeupdate-where.test.ts` canh từ nay; `scripts/sql/thu-236-sua-phieu-nhap-safeupdate.sql`
--      chạy lại bộ thử 235 dưới safeupdate (như API thật).
-- ====================================================================

-- ── Sửa tại chỗ phiếu nhập đã hoàn thành (bản mig 235 + WHERE cho câu UPDATE bảng tạm) ─────────────────────────
-- p_head: { supplier_id, invoice_number, invoice_date, warehouse_zone, discount, vat_override, notes }
-- p_lines: [{ product_id, unit_name, quantity, unit_price, line_discount, vat_rate, conversion_factor, notes }] (theo thứ tự)
CREATE OR REPLACE FUNCTION public.sua_phieu_nhap(p_invoice_id uuid, p_head jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_inv       purchase_invoices%ROWTYPE;
  v_uid       uuid := auth.uid();
  v_supplier  uuid;
  v_zone      text;
  v_discount  numeric;
  v_vat_ovr   numeric;
  v_entry     uuid;
  v_code      text;
  v_seq       int;
  v_sub       numeric := 0;
  v_vat       numeric := 0;
  v_total     numeric;
  v_paid      numeric;
  v_loi       text[] := '{}';
  v_doi_gia   uuid[] := '{}';
  v_moi       uuid;
  v_shelf     int;
  r           record;
  o           record;
  i           int := 0;
BEGIN
  SELECT * INTO v_inv FROM purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu nhập này.' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu nhập này không thuộc đơn vị của bạn.' USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ KIỂM VAI (mig 166) — cùng vai với RLS phiếu nhập (mig 163).
  IF COALESCE(public.user_role(), '') NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không được sửa phiếu nhập.' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'PHIEU_CHUA_HOAN_THANH: Chỉ sửa tại chỗ phiếu nhập đã hoàn thành (phiếu tạm lưu như thường).' USING ERRCODE = 'P0001';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'PHIEU_TRONG: Phiếu nhập phải có ít nhất một dòng hàng.' USING ERRCODE = 'P0001';
  END IF;

  v_supplier := COALESCE(NULLIF(p_head->>'supplier_id', '')::uuid, v_inv.supplier_id);
  IF NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = v_supplier AND s.org_id = v_inv.org_id) THEN
    RAISE EXCEPTION 'NCC_KHONG_HOP_LE: Nhà cung cấp không thuộc đơn vị.' USING ERRCODE = 'P0001';
  END IF;
  v_zone := COALESCE(NULLIF(p_head->>'warehouse_zone', ''), v_inv.warehouse_zone, 'sale');
  IF v_zone NOT IN ('sale', 'date') THEN
    RAISE EXCEPTION 'KHO_KHONG_HOP_LE: Kho nhập không hợp lệ.' USING ERRCODE = 'P0001';
  END IF;
  v_discount := GREATEST(0, COALESCE(NULLIF(p_head->>'discount', '')::numeric, 0));
  v_vat_ovr := NULLIF(p_head->>'vat_override', '')::numeric;
  v_code := v_inv.receipt_code;

  -- Dòng mới (đã kiểm) và lô cũ của phiếu.
  DROP TABLE IF EXISTS _pn_moi;
  DROP TABLE IF EXISTS _pn_cu;
  CREATE TEMP TABLE _pn_moi (
    stt int, product_id uuid, unit_name text, quantity numeric, unit_price numeric, line_discount numeric,
    vat_rate numeric, cf numeric, notes text, base numeric, cost numeric, batch_id uuid
  ) ON COMMIT DROP;
  INSERT INTO _pn_moi (stt, product_id, unit_name, quantity, unit_price, line_discount, vat_rate, cf, notes)
  SELECT e.ord::int,
         NULLIF(e.v->>'product_id', '')::uuid,
         btrim(COALESCE(e.v->>'unit_name', '')),
         COALESCE(NULLIF(e.v->>'quantity', '')::numeric, 0),
         COALESCE(NULLIF(e.v->>'unit_price', '')::numeric, 0),
         COALESCE(NULLIF(e.v->>'line_discount', '')::numeric, 0),
         COALESCE(NULLIF(e.v->>'vat_rate', '')::numeric, 0),
         COALESCE(NULLIF(e.v->>'conversion_factor', '')::numeric, 1),
         NULLIF(e.v->>'notes', '')
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS e(v, ord);

  FOR r IN SELECT * FROM _pn_moi ORDER BY stt LOOP
    IF r.product_id IS NULL OR NOT EXISTS (SELECT 1 FROM products p WHERE p.id = r.product_id AND p.org_id = v_inv.org_id) THEN
      RAISE EXCEPTION 'HANG_KHONG_HOP_LE: Dòng % — mặt hàng không thuộc đơn vị.', r.stt USING ERRCODE = 'P0001';
    END IF;
    IF r.unit_name = '' THEN
      RAISE EXCEPTION 'DON_VI_TRONG: Dòng % chưa có đơn vị tính.', r.stt USING ERRCODE = 'P0001';
    END IF;
    IF r.quantity <= 0 OR r.cf <= 0 THEN
      RAISE EXCEPTION 'SO_LUONG_KHONG_HOP_LE: Dòng % có số lượng không lớn hơn 0.', r.stt USING ERRCODE = 'P0001';
    END IF;
    IF r.unit_price < 0 OR r.line_discount < 0 THEN
      RAISE EXCEPTION 'GIA_KHONG_HOP_LE: Dòng % có giá / giảm giá âm.', r.stt USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- ⚠ GIÁ VỐN TRÊN TIỀN ĐÃ TRỪ GIẢM GIÁ DÒNG, theo ĐƠN VỊ CƠ SỞ — như `complete_purchase_invoice` (mig 145).
  -- ⚠ (mig 236) PHẢI CÓ WHERE: Supabase nạp `safeupdate` cho mọi lượt gọi qua API — UPDATE / DELETE không WHERE bị
  --   chặn "UPDATE requires a WHERE clause", kể cả trên bảng tạm trong hàm. Sau vòng kiểm trên, mọi dòng đều có
  --   SL > 0 và hệ số > 0, nên điều kiện này phủ đủ mọi dòng (và không bao giờ chia cho 0).
  UPDATE _pn_moi SET base = quantity * cf, cost = (quantity * unit_price - line_discount) / (quantity * cf)
  WHERE quantity > 0 AND cf > 0;

  v_entry := v_inv.stock_entry_id;
  IF v_entry IS NULL THEN
    INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes, warehouse_zone)
    VALUES (v_inv.org_id, v_code, 'import', 'posted', now(), v_uid, v_supplier, 'Nhập kho từ phiếu nhập hàng ' || v_code, v_zone)
    RETURNING id INTO v_entry;
  END IF;

  CREATE TEMP TABLE _pn_cu ON COMMIT DROP AS
    SELECT sel.id AS sel_id, b.id AS batch_id, b.product_id, b.batch_code,
           b.qty_initial, b.qty_on_hand, b.unit_cost,
           (COALESCE(b.qty_initial, 0) - COALESCE(b.qty_on_hand, 0)) AS da_xuat,
           false AS dung
    FROM stock_entry_lines sel
    JOIN batches b ON b.id = sel.batch_id
    WHERE sel.entry_id = v_entry;
  PERFORM 1 FROM batches b JOIN _pn_cu c ON c.batch_id = b.id FOR UPDATE OF b;

  -- Khớp dòng mới ↔ lô cũ cùng mặt hàng, theo thứ tự.
  FOR r IN SELECT * FROM _pn_moi ORDER BY stt LOOP
    SELECT * INTO o FROM _pn_cu c WHERE c.product_id = r.product_id AND NOT c.dung ORDER BY c.batch_code, c.batch_id LIMIT 1;
    IF FOUND THEN
      UPDATE _pn_cu SET dung = true WHERE batch_id = o.batch_id;
      UPDATE _pn_moi SET batch_id = o.batch_id WHERE stt = r.stt;
      IF r.base < o.da_xuat THEN
        v_loi := v_loi || format('%s: đã xuất %s %s, số lượng mới chỉ %s',
          (SELECT p.name FROM products p WHERE p.id = r.product_id),
          trim(to_char(o.da_xuat, 'FM999999990.###')), (SELECT p.base_unit FROM products p WHERE p.id = r.product_id),
          trim(to_char(r.base, 'FM999999990.###')));
      END IF;
    END IF;
  END LOOP;
  -- Lô cũ không còn dòng nào: chỉ bỏ được khi chưa xuất gì.
  FOR o IN SELECT c.*, p.name FROM _pn_cu c JOIN products p ON p.id = c.product_id WHERE NOT c.dung AND c.da_xuat <> 0 LOOP
    v_loi := v_loi || format('%s: đã xuất %s — không bỏ dòng này được', o.name, trim(to_char(o.da_xuat, 'FM999999990.###')));
  END LOOP;
  IF array_length(v_loi, 1) > 0 THEN
    RAISE EXCEPTION 'DA_XUAT_NHIEU_HON: Hàng của phiếu đã xuất nhiều hơn số lượng sửa — %. Giữ số lượng tối thiểu bằng số đã xuất, hoặc lập phiếu trả hàng NCC / điều chỉnh kho.',
      array_to_string(v_loi, ' · ') USING ERRCODE = 'P0001';
  END IF;

  -- Bỏ lô không còn dòng (chưa xuất gì).
  UPDATE batches b SET qty_on_hand = 0, status = 'cancelled'
  FROM _pn_cu c WHERE c.batch_id = b.id AND NOT c.dung;
  DELETE FROM stock_entry_lines sel USING _pn_cu c WHERE sel.id = c.sel_id AND NOT c.dung;

  -- Lô giữ lại: số lượng / giá / kho theo phiếu mới; phần đã xuất giữ nguyên trên lô.
  FOR r IN SELECT m.*, c.sel_id, c.da_xuat, c.unit_cost AS gia_cu FROM _pn_moi m JOIN _pn_cu c ON c.batch_id = m.batch_id LOOP
    UPDATE batches
    SET qty_initial = r.base,
        qty_on_hand = r.base - r.da_xuat,
        unit_cost = r.cost,
        status = CASE WHEN status = 'cancelled' THEN 'available' ELSE status END,
        warehouse_zone = CASE WHEN warehouse_zone IS DISTINCT FROM v_zone AND v_zone IS DISTINCT FROM v_inv.warehouse_zone THEN v_zone ELSE warehouse_zone END
    WHERE id = r.batch_id;
    UPDATE stock_entry_lines
    SET product_id = r.product_id, unit_name = r.unit_name, quantity = ROUND(r.base)::integer, unit_cost = r.cost,
        qty_in_base_uom = r.base, qty_in_transaction_uom = r.quantity, transaction_uom = r.unit_name,
        conversion_factor_snapshot = r.cf
    WHERE id = r.sel_id;
    IF r.gia_cu IS DISTINCT FROM r.cost THEN
      v_doi_gia := v_doi_gia || r.batch_id;
    END IF;
  END LOOP;

  -- Dòng mới chưa có lô → lô mới như `complete_purchase_invoice`.
  SELECT COALESCE(max(NULLIF(substring(c.batch_code FROM '-(\d+)$'), '')::int), 0) INTO v_seq FROM _pn_cu c;
  FOR r IN SELECT m.*, p.shelf_life_days FROM _pn_moi m JOIN products p ON p.id = m.product_id WHERE m.batch_id IS NULL ORDER BY m.stt LOOP
    v_seq := v_seq + 1;
    v_shelf := COALESCE(r.shelf_life_days, 0);
    INSERT INTO batches (org_id, product_id, batch_code, manufactured_at, expires_at, qty_initial, qty_on_hand, status, unit_cost, warehouse_zone)
    VALUES (v_inv.org_id, r.product_id, v_code || '-' || lpad(v_seq::text, 3, '0'), public.vn_today(),
            CASE WHEN v_shelf > 0 THEN public.vn_today() + v_shelf ELSE DATE '2099-12-31' END,
            r.base, r.base, 'available', r.cost, v_zone)
    RETURNING id INTO v_moi;
    INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, unit_cost, qty_in_base_uom,
                                   qty_in_transaction_uom, transaction_uom, conversion_factor_snapshot)
    VALUES (v_entry, r.product_id, v_moi, r.unit_name, ROUND(r.base)::integer, r.cost, r.base, r.quantity, r.unit_name, r.cf);
    UPDATE _pn_moi SET batch_id = v_moi WHERE stt = r.stt;
  END LOOP;

  -- Giá vốn của phần ĐÃ XUẤT từ lô đổi giá: dấu vết lấy lô + đơn giá bình quân của dòng xuất; dòng xuất ghi thẳng lô
  -- (trả NCC, điều chỉnh) lấy giá lô. Chỉ phiếu XUẤT — dòng nhập lại từ phiếu trả khách giữ giá đã chụp.
  IF array_length(v_doi_gia, 1) > 0 THEN
    UPDATE stock_line_consumptions slc SET unit_cost = b.unit_cost
    FROM batches b WHERE b.id = slc.batch_id AND slc.batch_id = ANY (v_doi_gia);
    UPDATE stock_entry_lines l SET unit_cost = s.gia
    FROM (
      SELECT slc.line_id, SUM(slc.qty_in_base_uom * slc.unit_cost) / NULLIF(SUM(slc.qty_in_base_uom), 0) AS gia
      FROM stock_line_consumptions slc
      WHERE slc.line_id IN (SELECT line_id FROM stock_line_consumptions WHERE batch_id = ANY (v_doi_gia))
      GROUP BY slc.line_id
    ) s
    WHERE l.id = s.line_id AND s.gia IS NOT NULL;
    UPDATE stock_entry_lines l SET unit_cost = b.unit_cost
    FROM batches b, stock_entries e
    WHERE l.batch_id = b.id AND b.id = ANY (v_doi_gia)
      AND e.id = l.entry_id AND e.type = 'export' AND l.entry_id <> v_entry
      AND NOT EXISTS (SELECT 1 FROM stock_line_consumptions x WHERE x.line_id = l.id);
  END IF;

  -- Dòng phiếu nhập: ghi lại theo phiếu mới.
  DELETE FROM purchase_invoice_lines WHERE invoice_id = p_invoice_id;
  INSERT INTO purchase_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, line_discount, vat_rate,
                                      conversion_factor, line_total, notes, sort_order)
  SELECT p_invoice_id, m.product_id, m.unit_name, m.quantity, m.unit_price, m.line_discount, m.vat_rate, m.cf,
         GREATEST(0, m.quantity * m.unit_price - m.line_discount) * (1 + m.vat_rate), m.notes, m.stt
  FROM _pn_moi m ORDER BY m.stt;

  -- Tổng tiền như `complete_purchase_invoice` (mig 145): thuế gõ tay thắng thuế cộng dòng; kẹp tổng về 0.
  SELECT COALESCE(SUM(quantity * unit_price - line_discount), 0),
         COALESCE(SUM((quantity * unit_price - line_discount) * vat_rate), 0)
    INTO v_sub, v_vat FROM _pn_moi;
  IF v_vat_ovr IS NOT NULL THEN
    v_vat := GREATEST(0, v_vat_ovr);
  END IF;
  v_total := GREATEST(0, v_sub + v_vat - v_discount);

  UPDATE purchase_invoices
  SET supplier_id = v_supplier,
      invoice_number = NULLIF(btrim(COALESCE(p_head->>'invoice_number', '')), ''),
      invoice_date = COALESCE(NULLIF(p_head->>'invoice_date', '')::date, invoice_date),
      warehouse_zone = v_zone,
      discount = v_discount,
      vat_override = v_vat_ovr,
      notes = NULLIF(btrim(COALESCE(p_head->>'notes', '')), ''),
      subtotal = v_sub, vat = v_vat, total = v_total,
      stock_entry_id = v_entry
  WHERE id = p_invoice_id;
  UPDATE stock_entries SET supplier_id = v_supplier, warehouse_zone = v_zone WHERE id = v_entry;

  -- Công nợ NCC: sửa tại chỗ, tiền đã trả giữ nguyên.
  IF v_inv.payable_id IS NOT NULL THEN
    SELECT COALESCE(paid, 0) INTO v_paid FROM payables WHERE id = v_inv.payable_id FOR UPDATE;
    UPDATE payables
    SET amount = v_total,
        supplier_id = v_supplier,
        invoice_number = NULLIF(btrim(COALESCE(p_head->>'invoice_number', '')), ''),
        status = CASE WHEN abs(v_total - v_paid) < 0.01 AND v_paid > 0 THEN 'paid'
                      WHEN v_paid > 0 THEN 'partial'
                      ELSE 'open' END
    WHERE id = v_inv.payable_id;
  ELSE
    INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status)
    VALUES (v_inv.org_id, v_supplier, v_entry, NULLIF(btrim(COALESCE(p_head->>'invoice_number', '')), ''), v_total, 0, 'open')
    RETURNING id INTO v_moi;
    UPDATE purchase_invoices SET payable_id = v_moi WHERE id = p_invoice_id;
    v_paid := 0;
  END IF;

  -- Bảng giá nhập (mig 234) theo phiếu đã sửa.
  PERFORM public._ghi_gia_nhap_tu_phieu(p_invoice_id);

  RETURN jsonb_build_object('id', p_invoice_id, 'total', v_total, 'paid', v_paid,
                            'so_dong', (SELECT count(*) FROM _pn_moi), 'doi_gia_lo', COALESCE(array_length(v_doi_gia, 1), 0));
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.sua_phieu_nhap(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sua_phieu_nhap(uuid, jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 236: sửa phiếu nhập đã hoàn thành chạy được qua API (safeupdate)' AS buoc,
       CASE WHEN to_regprocedure('public.sua_phieu_nhap(uuid,jsonb,jsonb)') IS NOT NULL
             AND position('(mig 236)' IN pg_get_functiondef('public.sua_phieu_nhap(uuid,jsonb,jsonb)'::regprocedure)) > 0
             AND position('WHERE quantity > 0 AND cf > 0' IN pg_get_functiondef('public.sua_phieu_nhap(uuid,jsonb,jsonb)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua;
