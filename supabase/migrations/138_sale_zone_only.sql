-- ====================================================================
-- 138_sale_zone_only
--
-- CHỦ NHÀ CHỐT 20/09/2026: "Hàng trong kho cận date không được bán."
--
-- VÌ SAO CẦN BẢN VÁ NÀY
--
-- Trước hôm nay hệ thống có BA câu trả lời khác nhau cho cùng câu hỏi
-- "hàng nào bán được":
--   · màn bán hàng      — cộng MỌI vùng kho (sale + date);
--   · get_invoiceable_lines (mig 125) — chỉ vùng 'sale';
--   · post_stock_export (mig 119)     — trừ FIFO qua MỌI vùng kho.
--
-- Hệ quả thật, chủ nhà đã gặp: nhân viên đặt được số lượng mà màn Xuất
-- hàng báo "Thiếu N đơn vị cơ sở, bấm Xuất hàng sẽ bị từ chối" — trong
-- khi phép trừ kho lại chấp nhận, vì nó lấy cả hàng cận date. Một tờ
-- giấy nói không, một phép tính nói có.
--
-- Bản vá này chốt MỘT câu trả lời: chỉ vùng 'sale'. `get_invoiceable_lines`
-- vốn đã đúng nên không đụng tới; màn bán hàng sửa ở phía trình duyệt.
--
-- ⚠ HÀNG CẬN DATE KHÔNG BỊ NHỐT. Migration 028 cho chuyển vùng lô hàng
--   bằng tay; muốn bán xả thì chuyển lô về vùng 'sale' rồi bán như
--   thường. Đó là cái cửa đã có sẵn, bản vá này không bịt.
--
-- ⚠ ẢNH HƯỞNG TỚI CẢ PHIẾU XUẤT KHO THỦ CÔNG (/inventory/entries), vì
--   `post_stock_export` là chỗ trừ kho DUY NHẤT cho mọi phiếu `export`.
--   Từ nay một phiếu xuất chạm vào hàng cận date sẽ bị từ chối kèm câu
--   nói rõ lý do và cách gỡ, chứ không âm thầm lấy hàng cận date ra.
--
-- CHÉP NGUYÊN VĂN bản hiện hành (mig 119), THÊM: lọc vùng ở hai câu đọc
-- `batches`, và một câu báo lỗi nói rõ khi hàng đang nằm ở kho cận date.
-- Không đổi gì khác trong hàm.
-- ====================================================================

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
  v_date_qty        numeric;
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
    WHERE org_id = v_org AND product_id = l.product_id AND qty_on_hand > 0
      AND COALESCE(warehouse_zone, 'sale') = 'sale';

    FOR b IN
      SELECT id, qty_on_hand, unit_cost, batch_code, expires_at
      FROM batches
      WHERE org_id = v_org
        AND product_id = l.product_id
        AND qty_on_hand > 0
        -- ⚠ CHỈ KHO BÁN. Xem đầu file bản vá 138.
        AND COALESCE(warehouse_zone, 'sale') = 'sale'
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

      -- 119 — DÒNG DUY NHẤT THÊM VÀO HÀM NÀY.
      -- Trước đây chỉ lô lấy NHIỀU NHẤT được ghi vào stock_entry_lines.batch_id,
      -- phần còn lại nằm trong notes dạng chữ. Hoàn kho khi sửa hoặc huỷ đơn
      -- đã xuất thì không dò ngược được đã lấy bao nhiêu từ lô nào. Ghi lại
      -- từng lần lấy để trả đúng chỗ.
      INSERT INTO stock_line_consumptions (line_id, batch_id, qty_in_base_uom, unit_cost)
      VALUES (l.id, b.id, v_take, COALESCE(b.unit_cost, 0));

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
        /*
          ⚠ NÓI RÕ KHI HÀNG ĐANG NẰM Ở KHO CẬN DATE. Không có vế này thì
          người dùng đọc "thiếu 20 đơn vị" trong khi màn tồn kho hiện
          rành rành 200 — và họ đi đếm lại kho thay vì đi chuyển vùng lô
          hàng, việc duy nhất gỡ được.
        */
        SELECT COALESCE(sum(qty_on_hand), 0) INTO v_date_qty
        FROM batches
        WHERE org_id = v_org AND product_id = l.product_id AND qty_on_hand > 0
          AND COALESCE(warehouse_zone, 'sale') = 'date';
        IF v_date_qty > 0 THEN
          RAISE EXCEPTION
            'INSUFFICIENT_STOCK: thiếu % đơn vị của "%" ở kho bán — còn % đơn vị nhưng đang nằm ở KHO CẬN DATE, không bán được. Chuyển vùng lô hàng nếu muốn bán.',
            v_remaining, COALESCE(v_prod_name, l.product_id::text), v_date_qty
            USING ERRCODE = 'P0001';
        END IF;
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

DO $$
DECLARE v_sale numeric; v_date numeric;
BEGIN
  SELECT COALESCE(sum(qty_on_hand),0) INTO v_sale FROM batches
   WHERE qty_on_hand > 0 AND COALESCE(warehouse_zone,'sale') = 'sale';
  SELECT COALESCE(sum(qty_on_hand),0) INTO v_date FROM batches
   WHERE qty_on_hand > 0 AND COALESCE(warehouse_zone,'sale') = 'date';
  RAISE NOTICE '--- 138: kho bán % đơn vị · kho cận date % đơn vị (từ nay KHÔNG bán được) ---', v_sale, v_date;
END $$;

NOTIFY pgrst, 'reload schema';
