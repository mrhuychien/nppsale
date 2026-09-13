-- ====================================================================
-- 107 — FIFO: MỘT sổ kho duy nhất, và trừ tồn lúc ghi sổ phiếu xuất
-- ====================================================================
--
-- TRẠNG THÁI TRƯỚC MIGRATION NÀY (đã đọc mã, đã đo)
--
-- 1. Có HAI sổ kho song song:
--      • `batches.qty_on_hand` — sổ thật. Mọi màn hình nhập, kiểm kê,
--        trả hàng, bàn giao đều ghi vào đây.
--      • `fifo_layers` — sổ thứ hai. Chỉ được ghi ở đúng một nhánh (nhận
--        hàng chưa dùng về từ tài xế, mig 047/051/057), và ba hàm gọi
--        nó trong mã ứng dụng (`createFifoLayer`, `consumeFifoLayers`,
--        `getStockValue`) KHÔNG có chỗ nào gọi tới — chỉ bộ test gọi.
--
--    Hai sổ thì sẽ lệch. Và view `v_stock_balance_by_zone` lại ưu tiên
--    đọc sổ thứ hai, nên đúng những sản phẩm từng đi qua nhánh bàn giao
--    sẽ báo giá trị tồn theo một cuốn sổ không ai cập nhật. Migration
--    098 đã vá phần ngọn (coi giá vốn 0 là "chưa biết"); đây là phần gốc.
--
-- 2. Tồn kho chỉ bị trừ ở ĐÚNG MỘT nút: "Tự giao hàng" (sổ lỗi NPP-01).
--    Đơn giao qua tài xế đạt trạng thái đã giao mà tồn kho giữ nguyên →
--    tồn cao hơn thật, giá vốn không được ghi, lãi gộp ra 100%.
--
-- QUYẾT ĐỊNH NGHIỆP VỤ (chủ NPP chốt)
--   • Thứ tự xuất: FIFO — lô nhập trước xuất trước.
--   • Trừ tồn: lúc GHI SỔ PHIẾU XUẤT. Hàng rời kho là trừ. Hàng tài xế
--     mang về được nhập lại bằng phiếu bàn giao — vòng khép kín, đúng
--     như RPC bàn giao vốn đã giả định.
--
-- ⚠ ĐÁNH ĐỔI ĐÃ BIẾT CỦA FIFO: lô cận hạn có thể nằm lại trong kho, vì
--   lô nhập sau đôi khi có hạn gần hơn lô nhập trước. RPC dưới đây đếm
--   số lần điều đó xảy ra và trả về (`near_expiry_skipped`) để màn hình
--   cảnh báo — không tự đổi thứ tự, vì thứ tự là việc của người quyết.
--
-- LÀM GÌ
--   1. Nới kiểu số lượng lô: integer → numeric. Đơn vị cơ bản có thể lẻ.
--   2. Thêm `batches.received_at` — thời điểm hàng VÀO kho. Đây là khoá
--      thứ tự của FIFO, và nó phải BẤT BIẾN.
--   3. RPC `post_stock_export()` — nguyên tử, chống trừ hai lần.
--   4. View giá trị tồn đọc thẳng `batches`, bỏ nhánh sổ thứ hai.
--   5. Bỏ `fifo_layers` / `fifo_consumptions` / `fifo_consume()`, và gỡ
--      lệnh ghi sổ thứ hai khỏi RPC bàn giao.
-- ====================================================================

-- --------------------------------------------------------------------
-- 0. Gỡ view trước khi đổi kiểu cột
-- --------------------------------------------------------------------
-- Postgres từ chối `ALTER COLUMN … TYPE` khi còn view đọc cột đó
-- ("cannot alter type of a column used by a view or rule"). View được
-- dựng lại ở mục 4 — cùng migration, nên không có khoảng nào nó biến mất
-- khỏi hệ thống.
DROP VIEW IF EXISTS v_stock_balance_by_zone;

-- --------------------------------------------------------------------
-- 1. Số lượng lô: integer → numeric
-- --------------------------------------------------------------------
-- `qty_on_hand integer` (mig 001) làm tròn mọi số lẻ khi ghi. Một thùng
-- 24 lon chia ra thì còn đếm được, nhưng 1,5 lít dầu hay 0,5 kg thì
-- không — và phép làm tròn đó KHÔNG báo lỗi. FIFO còn cắt lô làm đôi khi
-- một dòng xuất ăn hết lô này sang lô kia, nên phần dư càng phải giữ
-- đúng. `stock_entry_lines.qty_in_base_uom` đã là numeric(18,6) từ mig
-- 039; hai bên phải cùng kiểu thì cộng trừ mới khớp.
ALTER TABLE batches
  ALTER COLUMN qty_on_hand TYPE numeric(18, 6),
  ALTER COLUMN qty_initial TYPE numeric(18, 6);

-- --------------------------------------------------------------------
-- 2. `received_at` — khoá thứ tự FIFO
-- --------------------------------------------------------------------
-- VÌ SAO KHÔNG DÙNG `created_at`: phiếu tồn ĐẦU KỲ được ghi lùi ngày
-- (chốt sổ 31/12) nhưng dòng lô thì tạo ra hôm nay. Xếp theo `created_at`
-- thì hàng tồn đầu kỳ nằm SAU hàng nhập trong tuần — FIFO lấy ngược, và
-- hàng cũ nhất nằm lại trong kho mãi mãi.
--
-- Khoá thứ tự phải BẤT BIẾN: một lô đã vào sổ thì vị trí của nó trong
-- hàng đợi FIFO không được đổi về sau, kể cả khi có người sửa lại phiếu.
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

COMMENT ON COLUMN batches.received_at IS
  'Thời điểm hàng vào kho — khoá thứ tự FIFO. Lấy từ posted_at của phiếu '
  'nhập đã tạo ra lô (nên phiếu ghi lùi ngày xếp đúng chỗ), không phải '
  'lúc dòng được tạo.';

-- Bù cho dữ liệu cũ: lấy `posted_at` của phiếu nhập đã tạo ra lô. Không
-- tra ra phiếu nào thì lùi về `created_at` — chưa chắc đúng tuyệt đối,
-- nhưng đó là mốc duy nhất còn lại, và nó không tệ hơn thứ tự hiện tại.
UPDATE batches b
SET received_at = COALESCE(
  (
    SELECT MIN(se.posted_at)
    FROM stock_entry_lines sel
    JOIN stock_entries se ON se.id = sel.entry_id
    WHERE sel.batch_id = b.id
      AND se.type = 'import'
      AND se.status = 'posted'
  ),
  b.created_at,
  now()
)
WHERE b.received_at IS NULL;

ALTER TABLE batches
  ALTER COLUMN received_at SET DEFAULT now();

-- Lô mới mà quên truyền `received_at` thì DEFAULT now() lo. Nhưng dòng
-- cũ vừa bù xong có thể vẫn NULL nếu created_at cũng NULL — chặn hẳn,
-- vì một lô không có chỗ đứng trong hàng đợi FIFO sẽ bị bỏ qua vĩnh viễn
-- và nằm lại trong kho mà không ai hiểu vì sao.
UPDATE batches SET received_at = now() WHERE received_at IS NULL;
ALTER TABLE batches ALTER COLUMN received_at SET NOT NULL;

-- Chỉ mục phục vụ đúng câu FIFO ở RPC dưới.
CREATE INDEX IF NOT EXISTS idx_batches_fifo
  ON batches (org_id, product_id, received_at, created_at, id)
  WHERE qty_on_hand > 0;

-- --------------------------------------------------------------------
-- 3. RPC ghi sổ phiếu xuất
-- --------------------------------------------------------------------
-- VÌ SAO LÀ RPC CHỨ KHÔNG PHẢI VÒNG LẶP Ở TRÌNH DUYỆT
--   Mã cũ trừ tồn bằng nhiều lệnh update rời từ trình duyệt. Bấm hai lần,
--   hoặc mạng chập rồi bấm lại, là trừ HAI LẦN — và trừ hai lần thì
--   không có cách nào dò ngược ra được. Ở đây cả việc khoá phiếu, trừ
--   tồn, đóng giá vốn và đổi trạng thái nằm trong MỘT giao dịch; phiếu
--   đã ghi sổ thì lần gọi sau không làm gì cả.
CREATE OR REPLACE FUNCTION post_stock_export(p_entry_id uuid)
RETURNS TABLE (
  posted boolean,
  total_cost numeric,
  short_qty numeric,
  near_expiry_skipped int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org             uuid;
  v_status          text;
  v_type            text;
  v_allow_oversell  boolean;
  v_total_cost      numeric := 0;
  v_short           numeric := 0;
  v_near            int     := 0;
  l                 record;
  b                 record;
  v_remaining       numeric;
  v_take            numeric;
  v_cost_sum        numeric;
  v_qty_taken       numeric;
  v_best_id         uuid;
  v_best_qty        numeric;
  v_detail          text;
  v_lots            int;
  v_min_expiry      date;
  v_prod_name       text;
BEGIN
  -- Khoá phiếu TRƯỚC khi đọc trạng thái. Đọc rồi mới khoá thì hai lượt
  -- chạy song song đều thấy 'draft' và cùng đi tiếp.
  SELECT org_id, status, type
    INTO v_org, v_status, v_type
  FROM stock_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_type <> 'export' THEN
    RAISE EXCEPTION 'NOT_AN_EXPORT: phiếu % không phải phiếu xuất', v_type
      USING ERRCODE = 'P0001';
  END IF;

  -- Đã ghi sổ rồi thì KHÔNG làm gì. Đây là lá chắn chống trừ hai lần:
  -- trả về posted = false để nơi gọi biết là không có gì xảy ra, chứ
  -- không phải báo lỗi — bấm lại lần nữa là chuyện bình thường.
  IF v_status <> 'draft' THEN
    RETURN QUERY SELECT false, 0::numeric, 0::numeric, 0;
    RETURN;
  END IF;

  SELECT COALESCE(allow_oversell, false) INTO v_allow_oversell
  FROM organizations WHERE id = v_org;

  FOR l IN
    SELECT sel.id,
           sel.product_id,
           sel.notes,
           COALESCE(sel.qty_in_base_uom, sel.quantity, 0)::numeric AS need
    FROM stock_entry_lines sel
    WHERE sel.entry_id = p_entry_id
    ORDER BY sel.id
  LOOP
    CONTINUE WHEN l.need <= 0;

    v_remaining := l.need;
    v_cost_sum  := 0;
    v_qty_taken := 0;
    v_best_id   := NULL;
    v_best_qty  := 0;
    v_detail    := '';
    v_lots      := 0;

    -- Hạn gần nhất đang có, đo TRƯỚC khi trừ. Dùng để biết FIFO có bỏ
    -- qua lô cận hạn hơn không.
    SELECT MIN(expires_at) INTO v_min_expiry
    FROM batches
    WHERE org_id = v_org AND product_id = l.product_id AND qty_on_hand > 0;

    FOR b IN
      SELECT id, qty_on_hand, unit_cost, batch_code, expires_at
      FROM batches
      WHERE org_id = v_org
        AND product_id = l.product_id
        AND qty_on_hand > 0
      -- FIFO: hàng vào kho trước đi trước. `created_at` và `id` chỉ để
      -- hai lô cùng mốc vẫn có thứ tự cố định — không có chúng thì thứ
      -- tự do Postgres tự chọn, và mỗi lần chạy lại một khác.
      ORDER BY received_at ASC, created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_take := LEAST(b.qty_on_hand, v_remaining);

      UPDATE batches
      SET qty_on_hand = qty_on_hand - v_take
      WHERE id = b.id;

      v_cost_sum  := v_cost_sum + v_take * COALESCE(b.unit_cost, 0);
      v_qty_taken := v_qty_taken + v_take;
      v_remaining := v_remaining - v_take;
      v_lots      := v_lots + 1;

      IF v_take > v_best_qty THEN
        v_best_qty := v_take;
        v_best_id  := b.id;
      END IF;

      v_detail := v_detail
        || CASE WHEN v_detail = '' THEN '' ELSE ', ' END
        || COALESCE(b.batch_code, left(b.id::text, 8)) || '×' || v_take::text;

      -- Lấy một lô có hạn XA HƠN lô gần hạn nhất đang nằm trong kho:
      -- đúng cái giá phải trả của FIFO. Đếm lại để màn hình nói ra.
      IF v_min_expiry IS NOT NULL AND b.expires_at > v_min_expiry THEN
        v_near := v_near + 1;
      END IF;
    END LOOP;

    IF v_remaining > 0 THEN
      IF NOT v_allow_oversell THEN
        SELECT name INTO v_prod_name FROM products WHERE id = l.product_id;
        RAISE EXCEPTION
          'INSUFFICIENT_STOCK: thiếu % đơn vị của "%" — ghi sổ phiếu xuất sẽ làm tồn kho âm',
          v_remaining, COALESCE(v_prod_name, l.product_id::text)
          USING ERRCODE = 'P0001';
      END IF;
      -- Cho phép bán âm thì vẫn ghi sổ, nhưng cộng dồn để trả về. Im
      -- lặng ở đây là để người ta phát hiện ra vào lúc kiểm kê.
      v_short := v_short + v_remaining;
    END IF;

    -- Đóng giá vốn lên dòng. `batch_id` là khoá đơn nên chỉ giữ được MỘT
    -- lô — ghi lô lấy nhiều nhất, và ghi đủ danh sách vào notes để còn
    -- truy ngược được hạn dùng của hàng đã bán (hàng FMCG cần điều đó).
    UPDATE stock_entry_lines
    SET unit_cost = CASE WHEN v_qty_taken > 0
                         THEN v_cost_sum / v_qty_taken
                         ELSE unit_cost END,
        batch_id  = COALESCE(v_best_id, batch_id),
        notes     = CASE
                      WHEN v_lots > 1
                      THEN trim(both ' •' from COALESCE(l.notes, '')) ||
                           CASE WHEN COALESCE(l.notes, '') = '' THEN '' ELSE ' • ' END ||
                           'Lô: ' || v_detail
                      ELSE notes
                    END
    WHERE id = l.id;

    v_total_cost := v_total_cost + v_cost_sum;
  END LOOP;

  UPDATE stock_entries
  SET status = 'posted',
      posted_at = COALESCE(posted_at, now())
  WHERE id = p_entry_id;

  RETURN QUERY SELECT true, v_total_cost, v_short, v_near;
END;
$$;

COMMENT ON FUNCTION post_stock_export(uuid) IS
  'Ghi sổ phiếu xuất: trừ tồn theo FIFO (received_at), đóng giá vốn lên '
  'từng dòng, đổi trạng thái sang posted. Nguyên tử và chống trừ hai lần '
  '— phiếu đã ghi sổ thì trả về posted = false và không làm gì.';

REVOKE EXECUTE ON FUNCTION post_stock_export(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_stock_export(uuid) TO authenticated;

-- --------------------------------------------------------------------
-- 4. View giá trị tồn đọc thẳng `batches`
-- --------------------------------------------------------------------
-- Bỏ hẳn nhánh đọc `fifo_layers`. Mig 098 phải thêm `NULLIF(…, 0)` chỉ
-- vì nhánh đó tồn tại; bỏ nguồn thứ hai đi thì mẹo ấy cũng không cần
-- nữa, và con số chỉ còn MỘT chỗ để sai.
DROP VIEW IF EXISTS v_stock_balance_by_zone;

CREATE VIEW v_stock_balance_by_zone AS
SELECT
  b.org_id,
  b.product_id,
  COALESCE(b.warehouse_zone, 'sale') AS warehouse_zone,
  SUM(b.qty_on_hand)::numeric AS qty_in_base_uom,
  SUM(b.qty_on_hand * COALESCE(b.unit_cost, 0))::numeric AS value
FROM batches b
WHERE b.qty_on_hand > 0
GROUP BY b.org_id, b.product_id, COALESCE(b.warehouse_zone, 'sale');

-- Mig 092 bật security_invoker để RLS vẫn áp dụng. DROP + CREATE làm mất
-- thuộc tính đó — bỏ quên là mở toàn bộ số liệu tồn kho cho mọi vai trò
-- mà không có lỗi nào báo ra.
ALTER VIEW v_stock_balance_by_zone SET (security_invoker = true);

COMMENT ON VIEW v_stock_balance_by_zone IS
  'Số lượng và giá trị tồn theo (sản phẩm, khu kho). Đọc thẳng batches — '
  'từ mig 107 batches là sổ kho DUY NHẤT.';

GRANT SELECT ON v_stock_balance_by_zone TO authenticated;

-- --------------------------------------------------------------------
-- 5. Gỡ sổ thứ hai
-- --------------------------------------------------------------------
-- RPC bàn giao đã cộng thẳng `batches.qty_on_hand` ngay phía trên lệnh
-- ghi `fifo_layers`, nên bỏ lệnh đó đi không mất số liệu nào — chỉ bỏ
-- một bản sao. Chép lại nguyên văn mig 057, trừ đúng khối ấy.
CREATE OR REPLACE FUNCTION confirm_driver_handover(p_handover_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_org       uuid;
  v_delivery  uuid;
  v_status    text;
  v_entry_id  uuid;
  v_line_id   uuid;
  r           record;
  v_batch_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT org_id, delivery_id, status
    INTO v_org, v_delivery, v_status
  FROM driver_handovers
  WHERE id = p_handover_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HANDOVER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'confirmed' THEN
    RETURN;
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  UPDATE sales_orders so
  SET status = 'cancelled',
      current_workflow_stage = 'delivery_failed'
  FROM driver_handover_failed_orders dhfo
  WHERE dhfo.handover_id = p_handover_id
    AND dhfo.order_id    = so.id;

  IF EXISTS (SELECT 1 FROM driver_handover_items WHERE handover_id = p_handover_id) THEN
    INSERT INTO stock_entries (
      org_id, entry_code, type, status, posted_at, created_by, notes, ref_order_ids
    ) VALUES (
      v_org,
      'BG-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
      'import',
      'posted',
      now(),
      v_uid,
      'Bàn giao lại từ chuyến giao ' || v_delivery::text,
      COALESCE(
        (SELECT jsonb_agg(DISTINCT order_id)
           FROM driver_handover_failed_orders
          WHERE handover_id = p_handover_id),
        '[]'::jsonb
      )
    )
    RETURNING id INTO v_entry_id;

    FOR r IN
      SELECT dhi.*, p.base_unit
      FROM driver_handover_items dhi
      JOIN products p ON p.id = dhi.product_id
      WHERE dhi.handover_id = p_handover_id
    LOOP
      SELECT id INTO v_batch_id
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND COALESCE(warehouse_zone, 'sale') = r.destination_zone
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_batch_id IS NULL THEN
        INSERT INTO batches (
          org_id, product_id, batch_code, expires_at, warehouse_zone,
          qty_initial, qty_on_hand, unit_cost, received_at
        ) VALUES (
          v_org, r.product_id,
          'BG-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS')
            || '-' || left(r.product_id::text, 4),
          '2099-12-31',
          r.destination_zone,
          0, 0, COALESCE(r.unit_cost, 0),
          -- Hàng quay lại kho: mốc FIFO là LÚC NÀY, không phải lúc nhập
          -- lần đầu. Nó vừa đi một vòng, nên xếp cuối hàng đợi là đúng.
          now()
        )
        RETURNING id INTO v_batch_id;
      END IF;

      INSERT INTO stock_entry_lines (
        entry_id, product_id, batch_id, unit_name,
        quantity, qty_in_base_uom, qty_in_transaction_uom,
        transaction_uom, conversion_factor_snapshot, unit_cost
      ) VALUES (
        v_entry_id,
        r.product_id,
        v_batch_id,
        r.unit_name,
        r.qty_in_base_uom,
        r.qty_in_base_uom,
        r.qty,
        r.unit_name,
        r.conversion_factor,
        COALESCE(r.unit_cost, 0)
      )
      RETURNING id INTO v_line_id;

      UPDATE batches
      SET qty_on_hand = qty_on_hand + r.qty_in_base_uom,
          qty_initial = qty_initial + r.qty_in_base_uom
      WHERE id = v_batch_id;

      -- [107] Ở đây từng có thêm một lệnh ghi `fifo_layers`. Đã bỏ:
      -- `batches` ngay phía trên đã là sổ kho, bản sao thứ hai chỉ tạo
      -- chỗ cho hai con số lệch nhau.

      IF r.source_type = 'unused_swap_stock' AND r.swap_movement_id IS NOT NULL THEN
        UPDATE swap_stock_movements
        SET qty_returned_in_base_uom = qty_returned_in_base_uom + r.qty_in_base_uom
        WHERE id = r.swap_movement_id;
      END IF;
    END LOOP;
  END IF;

  UPDATE driver_handovers
  SET status = 'confirmed',
      confirmed_at = now()
  WHERE id = p_handover_id;

  UPDATE deliveries
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now())
  WHERE id = v_delivery;
END;
$$;

REVOKE EXECUTE ON FUNCTION confirm_driver_handover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_driver_handover(uuid) TO authenticated;

-- Giờ mới bỏ được: không còn ai đọc, không còn ai ghi.
DROP FUNCTION IF EXISTS fifo_consume(uuid, uuid, text, numeric, uuid);
DROP TABLE IF EXISTS fifo_consumptions;
DROP TABLE IF EXISTS fifo_layers;
