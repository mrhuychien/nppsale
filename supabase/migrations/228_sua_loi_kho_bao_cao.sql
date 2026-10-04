-- ====================================================================
-- 228 — SỬA LỖI KHO & BÁO CÁO (đợt đội test 04/10/2026)
--
-- VÌ SAO — các đội test "Kho & mua hàng", "Báo cáo", "Danh mục, Quyền", "Liên mô-đun" báo lỗi đã xác minh
--   (scripts/sql/doi-test/{kho,bao-cao,danh-muc,lien-module}-loi.sql). Mỗi lỗi trái một luật chủ nhà đã chốt:
--   · Chủ nhà 25/09/2026 (mig 192): "Rà soát lại toàn bộ doanh số tính bằng số đi - số trả" →
--     CLAUDE.md: "Lãi gộp = doanh thu thuần − (giá vốn − giá vốn hàng trả đã nhập kho)".
--   · Chủ nhà 24/09/2026: "làm tiếp phần doanh thu tính theo hoá đơn" → CLAUDE.md: "`invoice_date` là DATE:
--     so bằng ngày theo giờ VN (`vnDateKey`), không so với mốc ISO/UTC".
--   · Chủ nhà 30/09/2026 (mig 217): "Khi hủy hóa đơn -> coi như đóng đơn hàng -> Chuyển luôn đơn hàng về trạng
--     thái Đã hủy" — HĐ huỷ không còn doanh thu, hàng đã hoàn kho thì cũng không còn giá vốn.
--   · CLAUDE.md "Quyền": "Tiền, tồn kho, trạng thái chứng từ chỉ đổi qua RPC" + luật mig 166: hàm SECURITY
--     DEFINER bỏ qua RLS nên phải tự kiểm đúng vai mà RLS của bảng đang kiểm.
--
-- CÁC PHẦN
--   1. Trả cổng vai "(mig 166)" cho post_stock_issue / complete_supplier_return / cancel_supplier_return — mig 222
--      chép lại ba hàm từ bản TRƯỚC 166 nên rơi mất cổng (NVBH ghi sổ được phiếu xuất kho, gửi / huỷ phiếu trả
--      NCC). Thân hàm = đúng bản 222, chỉ thêm khối KIỂM VAI ngay sau chỗ kiểm NPP. Cuối tệp có khối tự kiểm
--      cả 8 hàm của mig 166: migration sau quên chép cổng là lộ ngay.
--   2. v_stock_movements (thẻ kho theo kho — ngăn kéo "Lịch sử"): dòng không có lô (phiếu xuất kho lẻ) lấy kho
--      của đầu phiếu thay vì mặc định 'sale'; phiếu CHUYỂN KHO tách hai dòng: −SL ở kho nguồn, +SL ở kho đích.
--   3. stock_entry_lines.quantity integer → numeric: phiếu kiểm kê hàng tồn lẻ (2,5) lưu được chênh lệch −0,5.
--   4. Mã đơn duy nhất THEO NPP (org_id, order_code) — số chạy đã đếm theo NPP từ mig 130, ràng buộc toàn bảng
--      của mig 001 làm NPP thứ hai không tạo được DH-0001.
--   5. finance_pnl: không cộng giá vốn phiếu xuất của HĐ ĐÃ HUỶ (kể cả tờ cũ của HĐ đã sửa) và phiếu
--      "Đảo phiếu trả …"; mốc ngày theo giờ VN (+07:00) thay cho nửa đêm UTC.
--   6. bao_cao_so_ban: giá vốn bình quân (gv) bỏ phiếu xuất của HĐ đã huỷ và phiếu "Đảo phiếu trả …" (giá 0 kéo
--      bình quân xuống → lãi gộp Báo cáo tổng hợp cao giả).
--   7. finance_cash_flow / finance_balance_sheet: mốc ngày theo giờ VN (tiền thu 00:00–06:59 giờ VN không còn
--      rơi sang hôm trước).
-- ⚠ Chưa đổi cancel_return (dòng xuất đảo vẫn ghi unit_cost 0): báo cáo nay bỏ hẳn phiếu đảo khỏi giá vốn nên
--   giá 0 không còn kéo số; đổi giá trên phiếu đảo là việc của luồng phiếu trả.
-- ====================================================================

-- ====================================================================
-- 1. Cổng vai cho ba RPC kho / trả NCC (thân hàm = đúng bản mig 222 + khối KIỂM VAI của mig 166)
-- ⚠ Hàm người dùng gọi (SECURITY DEFINER, tự kiểm org + vai) — giữ GRANT cho authenticated như bản cũ.
-- ⚠ Ai CREATE OR REPLACE một trong 8 RPC của mig 166 thì PHẢI chép cả khối "(mig 166)" — khối tự kiểm cuối tệp.
-- ====================================================================

-- 1a. Trả hàng NCC (vai như RLS supplier_returns: owner, manager, accountant, warehouse)
CREATE OR REPLACE FUNCTION public.complete_supplier_return(p_return_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_status text;
  v_supplier uuid;
  v_zone text;
  v_other_zone text;
  v_return_code text;
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_payable_id uuid;
  v_seq int := 0;
  v_base_qty numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  v_pname text;
  v_punit text;
  v_avail_zone numeric;
  v_avail_other numeric;
  v_discount numeric;
  v_vat_ovr numeric;
  v_sub numeric := 0;
  v_vat numeric := 0;
  v_total numeric;
  -- (mig 222) Đơn vị cho bán vượt tồn → phiếu trả NCC cũng xuất được khi kho không đủ.
  v_cho_am boolean;
  v_gia_von numeric;
  r record;
BEGIN
  SELECT org_id, status, supplier_id, warehouse_zone, return_code,
         COALESCE(discount, 0), vat_override
    INTO v_org, v_status, v_supplier, v_zone, v_return_code, v_discount, v_vat_ovr
  FROM supplier_returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu trả NCC này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu trả này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ KIỂM VAI (mig 166). Hàm SECURITY DEFINER bỏ qua RLS, nên phải
  --   tự kiểm đúng vai mà RLS của bảng đang kiểm. Bỏ qua khi được
  --   gọi từ trong một RPC khác đã tự kiểm quyền (npp.via_rpc).
  --   (mig 228) mig 222 chép lại hàm từ bản trước 166 nên rơi mất khối này — trả lại.
  IF current_setting('npp.via_rpc', true) IS DISTINCT FROM 'on'
     AND COALESCE(public.user_role(), '') NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không được làm thao tác kho / mua hàng này.'
      USING ERRCODE = '42501';
  END IF;
  -- ⚠ IDEMPOTENT: bấm hai lần không được xuất kho hai lần.
  IF v_status = 'completed' THEN
    RETURN p_return_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CON_NHAP: Phiếu đang ở trạng thái "%" — chỉ phiếu nháp mới gửi được.', v_status
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_return_lines WHERE return_id = p_return_id) THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CO_HANG: Phiếu chưa có dòng hàng nào.'
      USING ERRCODE = 'P0001';
  END IF;

  v_other_zone := CASE WHEN v_zone = 'sale' THEN 'date' ELSE 'sale' END;
  SELECT COALESCE(allow_oversell, false) INTO v_cho_am FROM organizations WHERE id = v_org;

  IF v_return_code IS NULL OR v_return_code = '' THEN
    v_return_code := 'TH-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
    UPDATE supplier_returns SET return_code = v_return_code WHERE id = p_return_id;
  END IF;

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes, warehouse_zone)
  VALUES (
    v_org,
    'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'export', 'posted', now(), v_uid, v_supplier,
    'Xuất kho trả NCC — phiếu ' || v_return_code || ' (kho: ' || v_zone || ')',
    v_zone
  )
  RETURNING id INTO v_entry_id;

  FOR r IN
    SELECT l.id, l.product_id, l.unit_name, l.quantity, l.unit_price,
           COALESCE(l.line_discount, 0) AS line_discount,
           COALESCE(l.vat_rate, 0)      AS vat_rate,
           COALESCE(l.conversion_factor, 1) AS cf
    FROM supplier_return_lines l
    WHERE l.return_id = p_return_id
    ORDER BY l.sort_order, l.id
  LOOP
    /**
     * ⚠ TIỀN VÀ HÀNG TÍNH RIÊNG. `line_discount` chỉ trừ TIỀN; số lượng
     *   hàng trả vẫn là `quantity × conversion_factor`. Lẫn hai thứ là
     *   giảm giá 10% biến thành trả thiếu 10% số hàng.
     */
    v_sub := v_sub + (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount);
    v_vat := v_vat + (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount) * r.vat_rate;

    v_base_qty := COALESCE(r.quantity, 0) * r.cf;
    v_need := v_base_qty;
    IF v_need <= 0 THEN
      CONTINUE;
    END IF;

    FOR v_batch IN
      SELECT id, qty_on_hand, unit_cost
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available'
        AND qty_on_hand > 0
      -- FIFO: hạn cũ đi trước; `id` ở cuối cho thứ tự ổn định.
      ORDER BY expires_at NULLS LAST, created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.qty_on_hand);

      UPDATE batches SET qty_on_hand = qty_on_hand - v_take WHERE id = v_batch.id;

      -- ⚠ CHÉP Y NGUYÊN 071. Migration này CHỈ đụng tới TIỀN; đổi thêm
      --   `conversion_factor_snapshot` hay kiểu của `quantity` ở đây là
      --   lén sửa tờ phiếu xuất kho trong một migration nói về giảm giá.
      v_seq := v_seq + 1;
      INSERT INTO stock_entry_lines (
        entry_id, product_id, batch_id, unit_name, quantity,
        qty_in_base_uom, qty_in_transaction_uom, transaction_uom,
        conversion_factor_snapshot, unit_cost
      ) VALUES (
        v_entry_id, r.product_id, v_batch.id, r.unit_name, v_take,
        v_take, v_take, r.unit_name,
        1, COALESCE(v_batch.unit_cost, 0)
      );

      v_need := v_need - v_take;
    END LOOP;

    IF v_need > 0 AND v_cho_am THEN
      /* (mig 222) CHO XUẤT ÂM — như `post_stock_export`: phần thiếu vẫn ghi lên phiếu (không gắn lô, không trừ lô
         nào), tồn kho xuống dưới số trên phiếu cho tới khi nhập bù / kiểm kê. Giá vốn = giá lô gần nhất của mã.
         Huỷ phiếu (`cancel_supplier_return`) chỉ hoàn dòng có lô — phần thiếu không bị cộng khống lại. */
      SELECT unit_cost INTO v_gia_von FROM batches
       WHERE org_id = v_org AND product_id = r.product_id
       ORDER BY received_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1;
      v_seq := v_seq + 1;
      INSERT INTO stock_entry_lines (
        entry_id, product_id, batch_id, unit_name, quantity,
        qty_in_base_uom, qty_in_transaction_uom, transaction_uom,
        conversion_factor_snapshot, unit_cost, notes
      ) VALUES (
        v_entry_id, r.product_id, NULL, r.unit_name, v_need,
        v_need, v_need, r.unit_name,
        1, COALESCE(v_gia_von, 0), 'Xuất vượt tồn (đơn vị cho bán vượt tồn kho)'
      );
      v_need := 0;
    END IF;

    IF v_need > 0 THEN
      SELECT name, base_unit INTO v_pname, v_punit FROM products WHERE id = r.product_id;
      SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_avail_zone
      FROM batches
      WHERE org_id = v_org AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available';
      SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_avail_other
      FROM batches
      WHERE org_id = v_org AND product_id = r.product_id
        AND warehouse_zone = v_other_zone
        AND COALESCE(status, 'available') = 'available';

      -- ⚠ GIỮ NGUYÊN VĂN CÂU LỖI CỦA 071, kể cả dấu `|`. Màn hình dịch
      --   câu này bằng `friendlyReturnError`, và nó nhận dạng bằng đúng
      --   chuỗi `INSUFFICIENT_STOCK` rồi cắt theo dấu `|`. Đổi chữ ở đây
      --   là người dùng nhận nguyên câu lỗi thô của Postgres.
      RAISE EXCEPTION
        'INSUFFICIENT_STOCK | % (%): cần %, kho % còn %, kho % còn %',
        COALESCE(v_pname, r.product_id::text),
        COALESCE(v_punit, 'đv cơ sở'),
        v_base_qty,
        CASE WHEN v_zone = 'date' THEN 'hàng date' ELSE 'hàng bán' END,
        v_avail_zone,
        CASE WHEN v_other_zone = 'date' THEN 'hàng date' ELSE 'hàng bán' END,
        v_avail_other
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ⚠ TIỀN THUẾ: SỐ GÕ TAY THẮNG SỐ TỰ CỘNG, cùng luật với phiếu nhập.
  IF v_vat_ovr IS NOT NULL THEN
    v_vat := GREATEST(0, v_vat_ovr);
  END IF;

  v_total := GREATEST(0, v_sub + v_vat - v_discount);

  /**
   * ⚠ DÒNG NỢ MANG SỐ ÂM — đây là khoản NCC trả lại mình. Ghi số dương
   *   là cộng thêm nợ thay vì giảm nợ, và công nợ NCC sai gấp đôi giá
   *   trị phiếu.
   */
  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_return_code,
    -v_total, 0, 'open',
    'Hoàn trả NCC — phiếu ' || v_return_code
  )
  RETURNING id INTO v_payable_id;

  UPDATE supplier_returns
  SET status = 'completed',
      subtotal = v_sub,
      vat = v_vat,
      total = v_total,
      completed_at = now(),
      completed_by = v_uid,
      stock_entry_id = v_entry_id,
      payable_credit_id = v_payable_id
  WHERE id = p_return_id;

  RETURN p_return_id;
END;
$fn$;

-- 1b. Phiếu xuất kho lẻ (vai như RLS stock_entries: owner, warehouse)
CREATE OR REPLACE FUNCTION public.post_stock_issue(p_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org      uuid;
  v_status   text;
  v_type     text;
  v_zone     text;
  v_code     text;
  v_uid      uuid := auth.uid();
  v_need     numeric;
  v_take     numeric;
  v_avail    numeric;
  v_pname    text;
  v_batch    record;
  -- (mig 222) Đơn vị cho bán vượt tồn → phiếu xuất kho cũng ghi sổ được khi kho không đủ.
  v_cho_am   boolean;
  r          record;
BEGIN
  SELECT org_id, status, type, warehouse_zone, entry_code
    INTO v_org, v_status, v_type, v_zone, v_code
  FROM stock_entries WHERE id = p_entry_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu xuất kho này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ KIỂM VAI (mig 166). Hàm SECURITY DEFINER bỏ qua RLS, nên phải
  --   tự kiểm đúng vai mà RLS của bảng đang kiểm. Bỏ qua khi được
  --   gọi từ trong một RPC khác đã tự kiểm quyền (npp.via_rpc).
  --   (mig 228) mig 222 chép lại hàm từ bản trước 166 nên rơi mất khối này — trả lại.
  IF current_setting('npp.via_rpc', true) IS DISTINCT FROM 'on'
     AND COALESCE(public.user_role(), '') NOT IN ('owner', 'warehouse') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không được làm thao tác kho / mua hàng này.'
      USING ERRCODE = '42501';
  END IF;
  IF v_type <> 'export' THEN
    RAISE EXCEPTION 'SAI_LOAI_PHIEU: Phiếu này không phải phiếu xuất kho.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ IDEMPOTENT. Bấm hai lần, hoặc bấm rồi mạng rớt rồi bấm lại,
  --   KHÔNG được trừ kho hai lần.
  IF v_status = 'posted' THEN
    RETURN p_entry_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CON_TAM: Phiếu đang ở trạng thái "%" — chỉ phiếu tạm mới ghi sổ được.', v_status
      USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(allow_oversell, false) INTO v_cho_am FROM organizations WHERE id = v_org;
  IF NOT EXISTS (SELECT 1 FROM stock_entry_lines WHERE entry_id = p_entry_id) THEN
    RAISE EXCEPTION 'PHIEU_KHONG_CO_HANG: Phiếu chưa có dòng hàng nào.'
      USING ERRCODE = 'P0001';
  END IF;

  /**
   * LƯỢT MỘT — KIỂM ĐỦ HÀNG, GOM THEO MẶT HÀNG.
   *
   * ⚠ GOM TRƯỚC KHI KIỂM. Người dùng có thể lỡ thêm cùng một mã thành
   *   hai dòng; kiểm từng dòng riêng thì mỗi dòng tự thấy "đủ hàng"
   *   trong khi tổng hai dòng thì không, và kho xuống âm.
   *
   * ⚠ KIỂM TRỌN VẸN TRƯỚC KHI TRỪ MỘT ĐƠN VỊ NÀO. Trừ dần rồi mới phát
   *   hiện thiếu ở mặt hàng thứ năm là đã đụng vào bốn mặt hàng đầu —
   *   đúng là giao dịch sẽ quay lui, nhưng thông báo lỗi lúc đó chỉ nói
   *   được về một mặt hàng. Kiểm trước thì nói được ngay cái nào thiếu.
   */
  FOR r IN
    SELECT sel.product_id,
           MIN(sel.unit_name) AS unit_name,
           SUM(sel.qty_in_base_uom) AS need
    FROM stock_entry_lines sel
    WHERE sel.entry_id = p_entry_id
    GROUP BY sel.product_id
    HAVING SUM(sel.qty_in_base_uom) > 0
  LOOP
    SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_avail
    FROM batches
    WHERE org_id = v_org AND product_id = r.product_id
      AND warehouse_zone = v_zone AND COALESCE(status, 'available') = 'available';

    IF v_avail < r.need AND NOT v_cho_am THEN
      SELECT name INTO v_pname FROM products WHERE id = r.product_id;
      RAISE EXCEPTION
        'KHONG_DU_TON: % — cần % %, kho % chỉ còn %. Giảm số lượng, đổi kho, hoặc nhập bù rồi ghi sổ lại.',
        COALESCE(v_pname, r.product_id::text),
        r.need, COALESCE(r.unit_name, 'đv cơ sở'),
        CASE WHEN v_zone = 'date' THEN 'hàng date' ELSE 'hàng bán' END,
        v_avail
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  /**
   * LƯỢT HAI — TRỪ THẬT, THEO TỪNG DÒNG.
   *
   * ⚠ PHẢI ĐI THEO DÒNG, KHÔNG THEO MẶT HÀNG ĐÃ GOM.
   *   `stock_line_consumptions` khoá theo `line_id` chứ không theo
   *   `entry_id`, nên mỗi vết lấy lô phải gắn được vào đúng dòng phiếu
   *   đã sinh ra nó. Gom rồi ghi vết là không có `line_id` để ghi.
   */
  FOR r IN
    SELECT sel.id AS line_id, sel.product_id, sel.qty_in_base_uom AS need
    FROM stock_entry_lines sel
    WHERE sel.entry_id = p_entry_id AND sel.qty_in_base_uom > 0
    ORDER BY sel.id
  LOOP
    v_need := r.need;

    FOR v_batch IN
      SELECT id, qty_on_hand, unit_cost
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available'
        AND qty_on_hand > 0
      -- ⚠ FIFO: hạn cũ đi trước. `id` ở cuối để thứ tự ỔN ĐỊNH khi hai
      --   lô cùng hạn cùng ngày tạo — không có nó thì hai lần chạy cho
      --   hai kết quả khác nhau.
      ORDER BY expires_at NULLS LAST, created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.qty_on_hand);

      UPDATE batches SET qty_on_hand = qty_on_hand - v_take WHERE id = v_batch.id;

      -- ⚠ VẾT LẤY LÔ — thứ làm cho phiếu này huỷ được sau này
      --   (`cancel_stock_entry`, migration 139). Phiếu xuất không có
      --   vết thì migration đó TỪ CHỐI huỷ.
      INSERT INTO stock_line_consumptions (line_id, batch_id, qty_in_base_uom, unit_cost)
      VALUES (r.line_id, v_batch.id, v_take, v_batch.unit_cost);

      v_need := v_need - v_take;
    END LOOP;

    -- ⚠ CHỐT CHẶN DỰ PHÒNG. Lượt một đã kiểm đủ, nhưng một giao dịch
    --   khác có thể vừa lấy mất hàng giữa hai lượt. Thà nổ ở đây còn
    --   hơn ghi sổ một phiếu xuất thiếu trong im lặng.
    -- (mig 222) Cho xuất âm: phần thiếu nằm trên phiếu, không trừ lô nào (như `post_stock_export`); huỷ phiếu
    --   (`cancel_stock_entry`) chỉ hoàn theo vết lấy lô nên không cộng khống phần ấy.
    IF v_need > 0 AND NOT v_cho_am THEN
      SELECT name INTO v_pname FROM products WHERE id = r.product_id;
      RAISE EXCEPTION
        'KHONG_DU_TON: % — hàng vừa bị lấy mất trong lúc ghi sổ, còn thiếu %. Thử lại.',
        COALESCE(v_pname, r.product_id::text), v_need
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  UPDATE stock_entries
  SET status = 'posted', posted_at = now()
  WHERE id = p_entry_id;

  RETURN p_entry_id;
END;
$fn$;

-- 1c. Huỷ phiếu trả NCC (vai như RLS supplier_returns)
CREATE OR REPLACE FUNCTION public.cancel_supplier_return(
  p_return_id uuid,
  p_reason    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org     uuid;
  v_status  text;
  v_entry   uuid;
  v_payable uuid;
  v_uid     uuid := auth.uid();
  v_paid    numeric;
  v_dead    text;
  v_n       int := 0;
BEGIN
  SELECT org_id, status, stock_entry_id, payable_credit_id
    INTO v_org, v_status, v_entry, v_payable
  FROM supplier_returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu trả NCC này.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu trả này không thuộc đơn vị của bạn.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ KIỂM VAI (mig 166). Hàm SECURITY DEFINER bỏ qua RLS, nên phải
  --   tự kiểm đúng vai mà RLS của bảng đang kiểm. Bỏ qua khi được
  --   gọi từ trong một RPC khác đã tự kiểm quyền (npp.via_rpc).
  --   (mig 228) mig 222 chép lại hàm từ bản trước 166 nên rơi mất khối này — trả lại.
  IF current_setting('npp.via_rpc', true) IS DISTINCT FROM 'on'
     AND COALESCE(public.user_role(), '') NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không được làm thao tác kho / mua hàng này.'
      USING ERRCODE = '42501';
  END IF;

  -- ⚠ IDEMPOTENT. Bấm hai lần, hoặc bấm rồi mạng rớt rồi bấm lại, KHÔNG
  --   được cộng hàng về kho hai lần.
  IF v_status = 'cancelled' THEN
    RETURN p_return_id;
  END IF;

  -- Phiếu còn tạm thì huỷ là đổi một chữ; chưa đụng gì tới kho hay nợ.
  IF v_status = 'draft' THEN
    UPDATE supplier_returns
    SET status = 'cancelled', cancel_reason = p_reason
    WHERE id = p_return_id;
    RETURN p_return_id;
  END IF;

  -- 1) NCC đã cấn trừ tiền thì không huỷ được.
  IF v_payable IS NOT NULL THEN
    SELECT COALESCE(paid, 0) INTO v_paid FROM payables WHERE id = v_payable;
    IF COALESCE(v_paid, 0) <> 0 THEN
      RAISE EXCEPTION 'DA_CAN_TRU: Khoản giảm công nợ của phiếu này đã được cấn trừ (%). Gỡ phần cấn trừ trước rồi mới huỷ phiếu.', v_paid
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_entry IS NOT NULL THEN
    -- 2) Lô đã chết thì không cộng về được.
    SELECT string_agg(DISTINCT p.name, ' · ' ORDER BY p.name)
      INTO v_dead
    FROM stock_entry_lines sel
    JOIN products p ON p.id = sel.product_id
    LEFT JOIN batches b ON b.id = sel.batch_id
    WHERE sel.entry_id = v_entry
      -- (mig 222) Dòng KHÔNG LÔ là phần xuất vượt tồn — không trừ lô nào nên không có gì để hoàn, không chặn huỷ.
      AND sel.batch_id IS NOT NULL
      AND (b.id IS NULL OR COALESCE(b.status, 'available') <> 'available');

    IF v_dead IS NOT NULL THEN
      RAISE EXCEPTION 'LO_DA_DONG: Không huỷ được vì lô hàng đã lấy không còn mở — %. Lập phiếu nhập kho điều chỉnh thay vì huỷ phiếu này.', v_dead
        USING ERRCODE = 'P0001';
    END IF;

    /**
     * 3) Cộng trả về ĐÚNG lô đã lấy.
     *
     * ⚠ `sel.quantity` LÀ SỐ THEO ĐƠN VỊ CƠ SỞ. `complete_supplier_return`
     *   ghi `v_take` (đã quy đổi) vào cả `quantity` lẫn
     *   `qty_in_base_uom`, nên cộng lại bằng chính cột đó là đối xứng.
     *   Dùng `qty_in_base_uom` cho chắc: nó là `numeric(18,6)` còn
     *   `quantity` là `integer` đã bị làm tròn.
     *
     * ⚠ GOM `SUM` THEO LÔ TRƯỚC (migration 147). Không gom thì Postgres
     *   chỉ lấy MỘT dòng `stock_entry_lines` cho mỗi lô và bỏ im lặng
     *   phần còn lại — một phiếu lấy 10 rồi lấy thêm 5 từ cùng một lô
     *   sẽ chỉ được cộng trả 10. Xem chú thích đầu tệp.
     */
    WITH gom AS (
      SELECT sel.batch_id, SUM(sel.qty_in_base_uom) AS qty
      FROM stock_entry_lines sel
      WHERE sel.entry_id = v_entry AND sel.batch_id IS NOT NULL
      GROUP BY sel.batch_id
    )
    UPDATE batches b
    SET qty_on_hand = b.qty_on_hand + gom.qty
    FROM gom
    WHERE b.id = gom.batch_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE stock_entries SET status = 'cancelled' WHERE id = v_entry;
  END IF;

  /**
   * 4) Gỡ con trỏ TRƯỚC, xoá dòng nợ SAU.
   *
   * ⚠ THỨ TỰ BẮT BUỘC. `supplier_returns.payable_credit_id` có khoá
   *   ngoại trỏ tới `payables`; xoá dòng nợ khi phiếu còn trỏ vào nó là
   *   Postgres từ chối. Đã gặp đúng lỗi này ở migration 142.
   *
   * ⚠ XOÁ HẲN, KHÔNG ĐÁNH DẤU. `payables.status` không có giá trị
   *   'cancelled'; để dòng âm nằm lại ở 'open' là một khoản giảm nợ ma
   *   trừ mãi vào công nợ NCC. Vết tích nằm ở chính phiếu.
   */
  UPDATE supplier_returns
  SET status = 'cancelled', cancel_reason = p_reason, payable_credit_id = NULL
  WHERE id = p_return_id;

  IF v_payable IS NOT NULL THEN
    DELETE FROM payables WHERE id = v_payable;
  END IF;

  RAISE NOTICE 'Huỷ phiếu trả NCC %: cộng trả % lô về kho.', p_return_id, v_n;
  RETURN p_return_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.complete_supplier_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_supplier_return(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.post_stock_issue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_stock_issue(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_supplier_return(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_return(uuid, text) TO authenticated;

-- ====================================================================
-- 2. Thẻ kho theo kho (v_stock_movements)
--
-- ⚠ Bản 048 lấy kho từ lô của DÒNG (`sel.batch_id`) và coi mọi phiếu ≠ export là số dương:
--   - phiếu xuất kho lẻ (mig 144) và phiếu chuyển kho (mig 148) ghi lô vào `stock_line_consumptions`, KHÔNG
--     lên dòng → dòng rơi về kho 'sale' dù hàng đi từ kho date;
--   - phiếu chuyển kho mang dấu + ở kho 'sale' → kho bán dư, kho date thiếu.
--   Nay: dòng không có lô ăn theo kho của ĐẦU PHIẾU; phiếu chuyển kho = hai dòng (nguồn −, đích +). Dòng thứ hai
--   có `id` riêng (md5 của id dòng + ':dich') vì ngăn kéo phân trang theo `id`.
-- ⚠ Không lấy kho từ `stock_line_consumptions`: huỷ HĐ / hoàn kho TRỪ vết lô về 0 (`_wf2_restock`), nên vết lô
--   không còn nói phiếu xuất cũ đã lấy bao nhiêu từ kho nào.
-- ====================================================================
CREATE OR REPLACE VIEW public.v_stock_movements
WITH (security_invoker = true) AS
SELECT
  sel.id,
  se.org_id,
  sel.product_id,
  -- (mig 228) Chuyển kho: dòng này là phía NGUỒN. Phiếu khác: lô của dòng, không có lô thì kho đầu phiếu.
  CASE WHEN se.type = 'transfer' THEN COALESCE(se.warehouse_zone, 'sale')
       ELSE COALESCE(b.warehouse_zone, se.warehouse_zone, 'sale') END AS warehouse_zone,
  se.posted_at,
  se.created_at,
  se.type AS entry_type,
  se.status AS entry_status,
  se.entry_code,
  se.id AS entry_id,
  sel.unit_name AS transaction_uom,
  sel.qty_in_transaction_uom,
  sel.qty_in_base_uom,
  sel.conversion_factor_snapshot AS conversion_factor,
  sel.unit_cost,
  -- Nhập +, xuất −, chuyển kho − ở kho nguồn, kiểm kê giữ dấu của chênh lệch.
  CASE se.type
    WHEN 'import'   THEN sel.qty_in_base_uom
    WHEN 'export'   THEN -sel.qty_in_base_uom
    WHEN 'transfer' THEN -abs(sel.qty_in_base_uom)
    ELSE sel.qty_in_base_uom
  END AS signed_qty_in_base_uom,
  se.ref_order_ids
FROM stock_entry_lines sel
JOIN stock_entries     se ON se.id = sel.entry_id
LEFT JOIN batches      b  ON b.id  = sel.batch_id
WHERE se.status <> 'cancelled'
UNION ALL
-- (mig 228) Phía ĐÍCH của phiếu chuyển kho: +SL ở kho nhận.
SELECT
  md5(sel.id::text || ':dich')::uuid AS id,
  se.org_id,
  sel.product_id,
  se.dest_warehouse_zone AS warehouse_zone,
  se.posted_at,
  se.created_at,
  se.type AS entry_type,
  se.status AS entry_status,
  se.entry_code,
  se.id AS entry_id,
  sel.unit_name AS transaction_uom,
  sel.qty_in_transaction_uom,
  sel.qty_in_base_uom,
  sel.conversion_factor_snapshot AS conversion_factor,
  sel.unit_cost,
  abs(sel.qty_in_base_uom) AS signed_qty_in_base_uom,
  se.ref_order_ids
FROM stock_entry_lines sel
JOIN stock_entries     se ON se.id = sel.entry_id
WHERE se.status <> 'cancelled'
  AND se.type = 'transfer'
  AND se.dest_warehouse_zone IS NOT NULL;

COMMENT ON VIEW public.v_stock_movements IS
  'Thẻ kho theo kho (mig 228): mỗi dòng phiếu kho kèm đầu phiếu và SL cơ sở có dấu (nhập +, xuất −, kiểm kê theo dấu chênh lệch); chuyển kho = hai dòng (nguồn −, đích +). Dòng không có lô ăn theo kho của đầu phiếu.';
GRANT SELECT ON public.v_stock_movements TO authenticated;

-- ====================================================================
-- 3. Kiểm kê số lẻ — stock_entry_lines.quantity integer → numeric
--
-- ⚠ Nhập kho cho phép SL lẻ (2,5) nhưng `quantity` là integer từ mig 001: màn /inventory/stocktake-adjust gửi
--   chênh lệch −0,5 → "invalid input syntax for type integer", phiếu kiểm kê không lưu được — mà mọi điều
--   chỉnh tồn phải đi qua phiếu kiểm kê. `post_stock_adjustment` cộng / trừ theo `quantity` nên đổi kiểu cột
--   là đủ (không cần sửa hàm). Kiểu `numeric` trơn (không scale) để số nguyên cũ vẫn hiện "5", không "5.000000".
-- ⚠ View duy nhất bám cột này là v_uom_audit (pg_depend) — bỏ ra rồi dựng lại y như cũ.
-- ====================================================================
DO $alter$
BEGIN
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.stock_entry_lines'::regclass AND attname = 'quantity') = 'integer' THEN
    DROP VIEW IF EXISTS public.v_uom_audit;
    ALTER TABLE public.stock_entry_lines ALTER COLUMN quantity TYPE numeric USING quantity::numeric;
  END IF;
END;
$alter$;

CREATE OR REPLACE VIEW public.v_uom_audit
WITH (security_invoker = true) AS
SELECT
  sel.id,
  se.org_id,
  sel.entry_id,
  sel.product_id,
  sel.quantity,
  sel.qty_in_base_uom,
  sel.qty_in_transaction_uom,
  sel.transaction_uom,
  sel.conversion_factor_snapshot
FROM stock_entry_lines sel
JOIN stock_entries se ON se.id = sel.entry_id
WHERE sel.quantity <> sel.qty_in_base_uom
  AND sel.transaction_uom IS NULL;
GRANT SELECT ON public.v_uom_audit TO authenticated;

-- ====================================================================
-- 4. Mã đơn duy nhất theo NPP
--
-- ⚠ mig 130 cấp số chạy THEO NPP (`_next_order_seq(org_id)`, chỉ mục (org_id, order_seq)) nhưng ràng buộc
--   `UNIQUE (order_code)` của mig 001 vẫn là toàn bảng → NPP A có DH-0001 thì đơn đầu của NPP B nổ
--   "duplicate key … sales_orders_order_code_key". Hoá đơn / phiếu trả / phiếu thu đều đã duy nhất theo org.
-- ⚠ Không nhánh nào bắt lỗi theo TÊN ràng buộc này (create_order_with_lines bắt unique_violation rồi tra
--   theo client_request_id; màn tạo đơn dò mã 23505) — đổi tên không làm vỡ chỗ nào.
-- ====================================================================
DO $chk$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT org_id, order_code FROM sales_orders GROUP BY org_id, order_code HAVING count(*) > 1
  ) t;
  IF v_n > 0 THEN
    RAISE EXCEPTION '228: có % mã đơn trùng trong cùng NPP — xử lý trước khi tạo chỉ mục (org_id, order_code).', v_n
      USING ERRCODE = 'P0001';
  END IF;
END;
$chk$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_code ON public.sales_orders (org_id, order_code);
ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS sales_orders_order_code_key;

-- ====================================================================
-- 5. finance_pnl — giá vốn đúng luật lãi gộp, mốc ngày giờ VN
--
-- ⚠ Giá vốn XUẤT chỉ tính phiếu xuất của hàng THẬT SỰ BÁN:
--   - bỏ phiếu xuất của HĐ ĐÃ HUỶ (`sales_invoices.stock_entry_id`, status 'cancelled') — cả tờ cũ của HĐ đã
--     Sửa (reissue_invoice đi qua đường huỷ). Doanh thu đã bỏ HĐ huỷ theo trạng thái; giá vốn bỏ theo đúng
--     trạng thái ấy thì hai vế cùng kỳ, cùng luật (phiếu "Hoàn kho do huỷ hóa đơn" là nhập, vốn không vào
--     đây).
--   - bỏ phiếu "Đảo phiếu trả …" (cancel_return): đó là đảo phiếu NHẬP hàng trả, không phải hàng bán; phiếu
--     nhập bị đảo đã mang đuôi "(đã đảo)" nên cũng không còn trong giá vốn hàng trả.
-- ⚠ Mốc ngày: `p_from::timestamptz` là nửa đêm theo múi giờ PHIÊN (Supabase = UTC) = 07:00 sáng giờ VN —
--   phiếu 00:00–06:59 giờ VN rơi sang hôm trước, lệch bao_cao_so_ban (mốc +07:00).
-- ====================================================================
CREATE OR REPLACE FUNCTION public.finance_pnl(p_from date, p_to date)
RETURNS TABLE (
  revenue        numeric,
  order_count    bigint,
  cogs           numeric,
  exp_cogs       numeric,
  exp_operating  numeric,
  exp_hr         numeric,
  exp_financial  numeric,
  exp_tax        numeric,
  exp_other      numeric,
  total_expenses numeric,
  revenue_gross  numeric,
  returns_value  numeric,
  returns_cogs   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  WITH moc AS (
    -- (mig 228) Đầu ngày p_from và đầu ngày sau p_to theo giờ VN.
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')       AS tu,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')   AS den
  ),
  rev AS (
    SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS revenue,
           COUNT(DISTINCT order_id) AS order_count
    FROM sales_invoices
    WHERE org_id = public.user_org_id()
      AND public.is_revenue_invoice_status(status)
      AND invoice_date >= p_from
      AND invoice_date <= p_to
  ),
  tra AS (
    -- (mig 192) Hàng trả theo ngày trừ doanh số — cùng luật với công nợ.
    SELECT COALESCE(SUM(COALESCE(credit_note_amount, 0)), 0) AS value
    FROM returns
    WHERE org_id = public.user_org_id()
      AND revenue_date >= p_from
      AND revenue_date <= p_to
  ),
  cogs AS (
    -- ⚠ SL THEO ĐƠN VỊ CƠ SỞ (mig 187): `unit_cost` là giá mỗi đơn vị cơ sở,
    --   còn `quantity` của phiếu xuất là SL theo đơn vị giao dịch (thùng).
    SELECT COALESCE(SUM(
             ABS(COALESCE(l.qty_in_base_uom, COALESCE(l.quantity, 0) * COALESCE(l.conversion_factor_snapshot, 1)))
             * COALESCE(l.unit_cost, 0)
           ), 0) AS cogs
    FROM stock_entry_lines l
    JOIN stock_entries e ON e.id = l.entry_id
    CROSS JOIN moc
    WHERE e.org_id = public.user_org_id()
      AND e.type = 'export'
      AND e.status = 'posted'
      AND e.posted_at >= moc.tu
      AND e.posted_at <  moc.den
      -- (mig 228) Không phải hàng bán: phiếu đảo của phiếu trả đã huỷ.
      AND COALESCE(e.notes, '') NOT LIKE 'Đảo phiếu trả %'
      -- (mig 228) HĐ đã huỷ (kể cả tờ cũ của HĐ đã sửa): không doanh thu thì không giá vốn.
      AND NOT EXISTS (SELECT 1 FROM sales_invoices si
                       WHERE si.stock_entry_id = e.id AND si.status = 'cancelled')
  ),
  tra_von AS (
    -- (mig 192) Giá vốn hàng khách trả đã NHẬP LẠI KHO (phiếu nhập của phiếu trả
    --   đang hoàn thành; phiếu đã đảo mang đuôi "(đã đảo)" nên không khớp).
    SELECT COALESCE(SUM(
             ABS(COALESCE(l.qty_in_base_uom, COALESCE(l.quantity, 0) * COALESCE(l.conversion_factor_snapshot, 1)))
             * COALESCE(l.unit_cost, 0)
           ), 0) AS cogs
    FROM stock_entry_lines l
    JOIN stock_entries e ON e.id = l.entry_id
    JOIN returns r ON e.notes = 'Nhập lại từ phiếu trả ' || r.id::text AND r.status = 'completed'
    CROSS JOIN moc
    WHERE e.org_id = public.user_org_id()
      AND e.type = 'import'
      AND e.status = 'posted'
      AND e.posted_at >= moc.tu
      AND e.posted_at <  moc.den
  ),
  exp AS (
    -- Danh mục không có bucket thì rơi vào 'other', giống mã cũ.
    SELECT
      COALESCE(ec.bucket, 'other') AS bucket,
      SUM(COALESCE(x.amount, 0))   AS amt
    FROM expenses x
    LEFT JOIN expense_categories ec ON ec.id = x.category_id
    WHERE x.org_id = public.user_org_id()
      AND x.expense_date >= p_from
      AND x.expense_date <= p_to
    GROUP BY COALESCE(ec.bucket, 'other')
  )
  SELECT
    rev.revenue - tra.value,
    rev.order_count,
    cogs.cogs - tra_von.cogs,
    COALESCE((SELECT amt FROM exp WHERE bucket = 'cogs'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'operating'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'hr'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'financial'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'tax'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'other'), 0),
    COALESCE((SELECT SUM(amt) FROM exp), 0),
    rev.revenue,
    tra.value,
    tra_von.cogs
  FROM rev, tra, cogs, tra_von;
$fn$;
GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date) TO authenticated;

-- ====================================================================
-- 6. bao_cao_so_ban — giá vốn bình quân chỉ từ phiếu xuất BÁN (thân = bản mig 218, đổi CTE `xuat`)
-- ⚠ SECURITY INVOKER như mig 204 / 218 — không phải hàm nội bộ.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.bao_cao_so_ban(p_tu date, p_den date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  WITH
  hd AS (
    SELECT i.id, i.invoice_code, i.invoice_date, i.order_id, i.status, i.total, i.subtotal, i.vat,
           i.customer_id, i.sales_user_id, i.posted_by, i.payment_terms
      FROM sales_invoices i
     WHERE i.org_id = public.user_org_id()
       AND i.status = 'posted'
       AND i.invoice_date BETWEEN p_tu AND p_den
  ),
  tra AS (
    -- Như fetchReturnsRowsDu (mig 192): theo ngày trừ doanh số, không lọc trạng thái.
    SELECT r.id, r.status, r.customer_id, r.invoice_id, r.credit_note_amount, r.created_at,
           r.revenue_date, r.sales_user_id, r.reason, r.credit_with_invoice,
           -- Số phiếu TH- (mig 193): sổ chưa chạy 193 thì chỉ mất số, không vỡ hàm.
           to_jsonb(r) ->> 'return_code' AS ma
      FROM returns r
     WHERE r.org_id = public.user_org_id()
       AND r.revenue_date BETWEEN p_tu AND p_den
  ),
  xuat AS (
    SELECT e.id
      FROM stock_entries e
     WHERE e.org_id = public.user_org_id()
       AND e.status = 'posted'
       AND e.type = 'export'
       AND e.posted_at >= (p_tu::text || 'T00:00:00+07:00')::timestamptz
       AND e.posted_at <= (p_den::text || 'T23:59:59.999+07:00')::timestamptz
       -- (mig 228) Chỉ phiếu xuất của hàng THẬT SỰ BÁN: bỏ phiếu đảo của phiếu trả đã huỷ (giá 0 kéo bình
       --   quân xuống) và phiếu xuất của HĐ đã huỷ / tờ cũ của HĐ đã sửa — như finance_pnl.
       AND COALESCE(e.notes, '') NOT LIKE 'Đảo phiếu trả %'
       AND NOT EXISTS (SELECT 1 FROM sales_invoices si
                        WHERE si.stock_entry_id = e.id AND si.status = 'cancelled')
  ),
  gv AS (
    -- Như soLuongCoSoDongKho / giaTriDongKho: SL cơ sở ưu tiên qty_in_base_uom.
    SELECT l.product_id,
           sum(CASE WHEN l.qty_in_base_uom IS NOT NULL THEN abs(l.qty_in_base_uom)
                    ELSE abs(COALESCE(l.quantity, 0)) * CASE WHEN l.conversion_factor_snapshot > 0 THEN l.conversion_factor_snapshot ELSE 1 END
               END) AS sl,
           sum((CASE WHEN l.qty_in_base_uom IS NOT NULL THEN abs(l.qty_in_base_uom)
                     ELSE abs(COALESCE(l.quantity, 0)) * CASE WHEN l.conversion_factor_snapshot > 0 THEN l.conversion_factor_snapshot ELSE 1 END
                END) * COALESCE(l.unit_cost, 0)) AS tien
      FROM stock_entry_lines l
      JOIN xuat x ON x.id = l.entry_id
     GROUP BY l.product_id
  ),
  gv_tra AS (
    -- Như fetchReturnCosts: phiếu nhập "Nhập lại từ phiếu trả <id>" đã ghi sổ.
    SELECT t.id AS return_id, l.product_id,
           sum(abs(COALESCE(l.qty_in_base_uom, COALESCE(l.quantity, 0) * COALESCE(NULLIF(l.conversion_factor_snapshot, 0), 1)))
               * COALESCE(l.unit_cost, 0)) AS tien
      FROM tra t
      JOIN stock_entries e ON e.type = 'import' AND e.status = 'posted'
                          AND e.notes = 'Nhập lại từ phiếu trả ' || t.id::text
      JOIN stock_entry_lines l ON l.entry_id = e.id
     GROUP BY t.id, l.product_id
  )
  SELECT jsonb_build_object(
    'hd', COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM hd h), '[]'::jsonb),
    'dong_hd', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'invoice_id', l.invoice_id, 'product_id', l.product_id, 'unit_name', l.unit_name,
               'conversion_factor', l.conversion_factor, 'quantity', l.quantity, 'unit_price', l.unit_price,
               'line_total', l.line_total, 'is_exchange', l.is_exchange,
               -- (mig 218) giá niêm yết lúc bán: chiết khấu chụp trên dòng + dòng đơn gốc
               'line_discount', l.line_discount, 'order_line_id', l.order_line_id) ORDER BY l.id)
        FROM sales_invoice_lines l JOIN hd h ON h.id = l.invoice_id), '[]'::jsonb),
    -- (mig 218) Dòng của HOÁ ĐƠN GỐC mà phiếu trả trong kỳ gắn vào (có thể nằm ngoài kỳ) —
    --   để tính "chênh trả" theo giá niêm yết lúc bán.
    'dong_hd_goc', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'invoice_id', l.invoice_id, 'product_id', l.product_id, 'unit_name', l.unit_name,
               'conversion_factor', l.conversion_factor, 'quantity', l.quantity, 'unit_price', l.unit_price,
               'line_total', l.line_total, 'is_exchange', l.is_exchange,
               'line_discount', l.line_discount, 'order_line_id', l.order_line_id) ORDER BY l.id)
        FROM sales_invoice_lines l
       WHERE l.invoice_id IN (SELECT t.invoice_id FROM tra t WHERE t.invoice_id IS NOT NULL)
         AND NOT COALESCE(l.is_exchange, false)), '[]'::jsonb),
    -- (mig 218) Dòng ĐƠN gốc của các dòng hoá đơn trên — chiết khấu trên dòng hoá đơn là của CẢ
    --   dòng đơn (không chia theo SL xuất), nên giá niêm yết lấy từ dòng đơn.
    'dong_don', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'unit_name', s.unit_name, 'conversion_factor', s.conversion_factor,
               'quantity', s.quantity, 'unit_price', s.unit_price, 'line_discount', s.line_discount))
        FROM sales_order_lines s
       WHERE s.id IN (
         SELECT l.order_line_id FROM sales_invoice_lines l JOIN hd h ON h.id = l.invoice_id WHERE l.order_line_id IS NOT NULL
         UNION
         SELECT l.order_line_id FROM sales_invoice_lines l
          WHERE l.order_line_id IS NOT NULL
            AND l.invoice_id IN (SELECT t.invoice_id FROM tra t WHERE t.invoice_id IS NOT NULL))), '[]'::jsonb),
    'tra', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM tra t), '[]'::jsonb),
    'dong_tra', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'return_id', l.return_id, 'product_id', l.product_id, 'unit_name', l.unit_name,
               'quantity', l.quantity, 'line_total', l.line_total,
               'unit_price', l.unit_price) ORDER BY l.id)
        FROM return_lines l JOIN tra t ON t.id = l.return_id
       WHERE l.is_exchange = false), '[]'::jsonb),
    'gv', COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id', g.product_id, 'sl', g.sl, 'tien', g.tien)) FROM gv g), '[]'::jsonb),
    'gv_tra', COALESCE((SELECT jsonb_agg(jsonb_build_object('return_id', g.return_id, 'product_id', g.product_id, 'tien', g.tien)) FROM gv_tra g), '[]'::jsonb)
  )
$fn$;
REVOKE ALL ON FUNCTION public.bao_cao_so_ban(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bao_cao_so_ban(date, date) TO authenticated;

-- ====================================================================
-- 7. finance_cash_flow / finance_balance_sheet — mốc ngày giờ VN
--
-- ⚠ Cùng lỗi mốc với finance_pnl: `p_from::timestamptz` = 07:00 sáng giờ VN trên Supabase (phiên UTC) → tiền
--   thu lúc 00:30 sáng ngày T bị đếm vào ngày T−1, lệch bao_cao_cong_no (mốc +07:00). Giữ nguyên mọi phần
--   khác của bản mig 121.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.finance_cash_flow(p_from date, p_to date)
RETURNS TABLE(cash_from_customers numeric, cash_to_suppliers numeric, cash_to_expenses numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  WITH moc AS (
    -- (mig 228) Đầu ngày p_from và đầu ngày sau p_to theo giờ VN.
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')       AS tu,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')   AS den
  )
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(p.amount, 0))
      FROM payments p
      JOIN receivables r ON r.id = p.receivable_id
      CROSS JOIN moc
      WHERE r.org_id = public.user_org_id()
        AND p.collected_at >= moc.tu
        AND p.collected_at <  moc.den
        -- ⚠ Q13 — CẤN TRỪ KHÔNG PHẢI TIỀN VÀO KÉT (mig 121).
        AND COALESCE(p.method, '') NOT IN ('return_credit', 'credit_applied')
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(pp.amount, 0))
      FROM payable_payments pp
      JOIN payables pa ON pa.id = pp.payable_id
      CROSS JOIN moc
      WHERE pa.org_id = public.user_org_id()
        AND pp.paid_at >= moc.tu
        AND pp.paid_at <  moc.den
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(x.amount, 0))
      FROM expenses x
      CROSS JOIN moc
      WHERE x.org_id = public.user_org_id()
        AND x.is_paid = true
        AND x.paid_at >= moc.tu
        AND x.paid_at <  moc.den
    ), 0);
$fn$;
GRANT EXECUTE ON FUNCTION public.finance_cash_flow(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_balance_sheet(p_as_of date)
RETURNS TABLE(cash numeric, accounts_receivable numeric, inventory numeric, accounts_payable numeric, unpaid_expenses numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  WITH
  moc AS (
    -- (mig 228) Hết ngày p_as_of theo giờ VN.
    SELECT ((p_as_of + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS den
  ),
  cash_in AS (
    SELECT COALESCE(SUM(COALESCE(p.amount, 0)), 0) AS v
    FROM payments p
    JOIN receivables r ON r.id = p.receivable_id
    CROSS JOIN moc
    WHERE r.org_id = public.user_org_id()
      AND p.collected_at < moc.den
      -- ⚠ Q13 — CẤN TRỪ KHÔNG PHẢI TIỀN VÀO KÉT (mig 121).
      AND COALESCE(p.method, '') NOT IN ('return_credit', 'credit_applied')
  ),
  paid_payables AS (
    SELECT COALESCE(SUM(COALESCE(pp.amount, 0)), 0) AS v
    FROM payable_payments pp
    JOIN payables pa ON pa.id = pp.payable_id
    CROSS JOIN moc
    WHERE pa.org_id = public.user_org_id()
      AND pp.paid_at < moc.den
  ),
  exp AS (
    SELECT
      COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE is_paid), 0)     AS paid,
      COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE NOT is_paid), 0) AS unpaid
    FROM expenses
    WHERE org_id = public.user_org_id()
      AND expense_date <= p_as_of
  ),
  ar AS (
    /* ⚠ KHÔNG kẹp từng dòng về 0 (CLAUDE.md, mig 186): dòng âm là dư có của khách, trừ vào tổng phải thu. */
    SELECT COALESCE(SUM(COALESCE(amount, 0) - COALESCE(paid, 0)), 0) AS v
    FROM receivables
    WHERE org_id = public.user_org_id() AND status <> 'paid'
  ),
  inv AS (
    SELECT COALESCE(SUM(COALESCE(qty_on_hand, 0) * COALESCE(unit_cost, 0)), 0) AS v
    FROM batches
    WHERE org_id = public.user_org_id() AND COALESCE(qty_on_hand, 0) > 0
  ),
  ap AS (
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0))), 0) AS v
    FROM payables
    WHERE org_id = public.user_org_id() AND status <> 'paid'
  )
  SELECT
    cash_in.v - paid_payables.v - exp.paid,
    ar.v,
    inv.v,
    ap.v,
    exp.unpaid
  FROM cash_in, paid_payables, exp, ar, inv, ap;
$fn$;
GRANT EXECUTE ON FUNCTION public.finance_balance_sheet(date) TO authenticated;

-- ====================================================================
-- Tự kiểm
-- ====================================================================
DO $kiem$
DECLARE v_thieu text := ''; r record;
BEGIN
  -- (1) Cả 8 RPC kho / mua hàng của mig 166 phải còn cổng vai. Migration nào sau này CREATE OR REPLACE một
  --     trong 8 hàm mà quên chép khối "(mig 166)" thì chạy lại tệp này sẽ nổ ở đây.
  FOR r IN SELECT unnest(ARRAY[
      'cancel_stock_entry(uuid,text)', 'post_stock_export(uuid)', 'post_stock_issue(uuid)',
      'post_stock_transfer(uuid)', 'complete_purchase_invoice(uuid)', 'cancel_purchase_invoice(uuid,text)',
      'complete_supplier_return(uuid)', 'cancel_supplier_return(uuid,text)']) AS fn
  LOOP
    IF position('(mig 166)' in pg_get_functiondef(to_regprocedure('public.' || r.fn))) = 0
       OR position('FORBIDDEN' in pg_get_functiondef(to_regprocedure('public.' || r.fn))) = 0 THEN
      v_thieu := v_thieu || E'\n  · ' || r.fn || ' thiếu cổng vai (mig 166)';
    END IF;
  END LOOP;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.stock_entry_lines'::regclass AND attname = 'quantity') <> 'numeric' THEN
    v_thieu := v_thieu || E'\n  · stock_entry_lines.quantity chưa là numeric';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sales_orders'
              AND indexdef ~ 'UNIQUE' AND indexdef ~ '\(order_code\)') THEN
    v_thieu := v_thieu || E'\n  · sales_orders còn UNIQUE (order_code) toàn bảng';
  END IF;
  IF v_thieu <> '' THEN
    RAISE EXCEPTION '228: chưa sửa đủ:%', v_thieu USING ERRCODE = 'P0001';
  END IF;
END;
$kiem$;

-- ---------------------------------------------------------------------------------------------
-- Mã phiếu đặt mua NCC (po_code) — cùng lỗi với mã đơn: UNIQUE toàn bảng trong khi số chạy theo NPP.
-- ---------------------------------------------------------------------------------------------
DO $po$
BEGIN
  IF EXISTS (SELECT 1 FROM purchase_orders GROUP BY org_id, po_code HAVING count(*) > 1) THEN
    RAISE NOTICE 'mig 228: purchase_orders có po_code trùng trong cùng NPP — giữ ràng buộc cũ, cần dọn tay';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_org_po_code ON public.purchase_orders (org_id, po_code);
    ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_po_code_key;
  END IF;
END $po$;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 228: sửa lỗi kho & báo cáo' AS buoc,
       (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('cancel_stock_entry','post_stock_export','post_stock_issue','post_stock_transfer',
                             'complete_purchase_invoice','cancel_purchase_invoice','complete_supplier_return','cancel_supplier_return')
           AND p.prosrc LIKE '%(mig 166)%') AS rpc_kho_co_cong_vai_can_8,
       (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
         WHERE attrelid = 'public.stock_entry_lines'::regclass AND attname = 'quantity') AS kieu_sl_dong_kho,
       to_regclass('public.idx_sales_orders_code') IS NOT NULL AS ma_don_theo_npp,
       CASE WHEN position('Asia/Ho_Chi_Minh' IN pg_get_functiondef('public.finance_pnl(date, date)'::regprocedure)) > 0
             AND position('Asia/Ho_Chi_Minh' IN pg_get_functiondef('public.finance_cash_flow(date, date)'::regprocedure)) > 0
             AND position('Đảo phiếu trả' IN pg_get_functiondef('public.bao_cao_so_ban(date, date)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS bao_cao_gio_vn_va_gia_von;
