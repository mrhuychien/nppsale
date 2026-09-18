-- ---------------------------------------------------------------------
-- 119 — Workflow đơn hàng v2: Nháp → Phiếu tạm → Hoàn thành / Đã hủy
-- ---------------------------------------------------------------------
--
-- TRƯỚC KHI SỬA
--   Đơn đi qua 6 trạng thái (draft → confirmed → picking → delivering →
--   delivered) với một lớp duyệt chồng lên. Nhà phân phối nhỏ không có
--   thủ kho riêng, không có tổ duyệt đơn: cùng một người nhận đơn, lấy
--   hàng, giao, thu tiền. Sáu bước ấy bắt họ bấm năm lần cho một việc.
--
--   Tệ hơn, mỗi bước là một lệnh UPDATE rời từ trình duyệt. Đơn nhảy
--   sang 'delivering' mà phiếu xuất vẫn nằm im ở nháp, kho không trừ,
--   công nợ không sinh — không có gì trong CSDL ràng hai chuyện đó lại
--   với nhau.
--
-- SAU KHI SỬA
--   4 trạng thái: 'draft' (nháp của NVBH) · 'submitted' (phiếu tạm, NPP
--   nhìn thấy) · 'completed' (đã xuất hàng) · 'cancelled'.
--   Hai bước đắt tiền — xuất hàng và huỷ đơn đã xuất — BẮT BUỘC đi qua
--   RPC (migration 120). Trigger ở đây chặn đường tắt: UPDATE thẳng từ
--   trình duyệt sẽ RAISE 'USE_RPC'.
--
-- ⚠ VÌ SAO PHẢI TẮT HAI TRIGGER KHI BACKFILL
--   trg_check_order_status (bản mig 059) cấm 'confirmed' → bất cứ đâu
--   ngoài 'picking'/'cancelled'. Chạy backfill mà không gỡ nó ra thì
--   lệnh UPDATE đầu tiên đã RAISE, migration chết giữa chừng.
--   trg_log_order_status thì ngược lại: nó chạy êm, và ghi vào
--   order_status_history một dòng cho MỖI đơn được backfill. Lịch sử
--   trạng thái của cả nhà phân phối sẽ có một ngày mà mọi đơn cùng đổi
--   trạng thái do 'migration' — đọc lại không hiểu chuyện gì đã xảy ra.
--   Tắt lúc backfill, bật lại ngay sau.
--
-- ⚠ CÁC RÀNG BUỘC CHECK Ở ĐÂY KHÔNG CÓ TÊN
--   sales_orders.status, returns.status, cash_receipts.source_type và
--   payments.method đều khai inline trong CREATE TABLE (mig 001), nên
--   Postgres tự đặt tên. Tên tự sinh KHÔNG xuất hiện trong repo, không
--   được đoán. Mỗi chỗ dùng một khối DO tra pg_constraint rồi DROP theo
--   tên thật — đúng khuôn mig 103 đã dùng cho notifications.
--
-- ⚠ ĐỔI Ý NGHĨA SỐ LIỆU — ĐỌC KỸ
--   is_revenue_status() từ 'không phải nháp và không phải huỷ' đổi thành
--   'đúng completed'. Đơn đang ở 'confirmed' hôm nay trở thành phiếu tạm
--   và RỜI KHỎI doanh thu cho tới khi ai đó bấm Xuất hàng. Lương, hoa
--   hồng và báo cáo các kỳ đã chốt sẽ tính lại thấp hơn phần đó. Chủ nhà
--   đã biết và đã chốt: bảng map giữ nguyên, không có ngoại lệ.
--
-- KHÔNG ĐỔI
--   Cột current_workflow_stage giữ lại (dữ liệu cũ, không ai đọc nữa).
--   Module giao hàng qua tài xế giữ nguyên bảng và mã, chỉ ẩn khỏi menu
--   ở phase sau — nên nhánh SELECT cho vai trò tài xế vẫn còn trong RLS.
-- ---------------------------------------------------------------------


-- =====================================================================
-- 1. Cột mới
-- =====================================================================

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS submitted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by  uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

COMMENT ON COLUMN sales_orders.completed_at IS
  'Mốc xuất hàng. NULL với đơn chưa xuất. Đơn huỷ SAU khi đã xuất vẫn giữ '
  'mốc này — đó là dấu để biết đơn huỷ nào còn hồ sơ kho, không được xoá.';

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS completed_edit_days int NOT NULL DEFAULT 1;

COMMENT ON COLUMN organizations.completed_edit_days IS
  'Số ngày còn được sửa/huỷ đơn đã Hoàn thành, tính từ ngày đặt. Mặc định 1.';


-- =====================================================================
-- 2. Gỡ giàn giáo của luồng cũ
-- =====================================================================
-- Giai đoạn workflow là cột dẫn xuất từ status theo bảng ánh xạ 6 giá
-- trị cũ. Bỏ trạng thái cũ thì bảng ánh xạ vô nghĩa: mọi status mới rơi
-- vào nhánh ELSE và cột giữ nguyên giá trị cũ — sai một cách im lặng.
DROP TRIGGER  IF EXISTS trg_sync_workflow_stage ON sales_orders;
DROP FUNCTION IF EXISTS sync_sales_order_workflow_stage();

ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS chk_sales_orders_workflow_stage;

-- Khoá dòng đã pick chỉ có nghĩa khi còn bước "đang lấy hàng". v2 không
-- có bước đó; khoá sửa đơn Hoàn thành nằm ở RPC (mig 120) chứ không ở
-- đây.
DROP TRIGGER  IF EXISTS trg_enforce_picked_line_lock ON sales_order_lines;
DROP FUNCTION IF EXISTS enforce_picked_line_lock();
DROP VIEW     IF EXISTS v_sales_order_line_picked;


-- =====================================================================
-- 3. Tắt hai trigger gác trạng thái để backfill
-- =====================================================================

DROP TRIGGER IF EXISTS trg_check_order_status ON sales_orders;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_log_order_status'
      AND tgrelid = 'sales_orders'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE sales_orders DISABLE TRIGGER trg_log_order_status';
  END IF;
END $$;


-- =====================================================================
-- 4. Backfill sales_orders
-- =====================================================================
-- Bảng map (Coder Pack mục 1), chạy đúng thứ tự này:
--   draft + lý do 'Lưu nháp — chưa gửi duyệt'  → draft   (giữ nguyên)
--   draft khác (kể cả lý do rỗng)              → submitted
--   confirmed                                   → submitted
--   picking | delivering | delivered            → completed
--   cancelled                                   → cancelled
--
-- ⚠ submitted_at KHÔNG được đoán. Đơn cũ không lưu mốc gửi, và
--   created_at là mốc TẠO chứ không phải mốc gửi. Để trống.

DO $$
DECLARE
  v_draft_keep int;
  v_draft_sub  int;
  v_confirmed  int;
  v_completed  int;
  v_cancelled  int;
BEGIN
  SELECT count(*) INTO v_draft_keep
  FROM sales_orders
  WHERE status = 'draft'
    AND COALESCE(approval_reason, '') = 'Lưu nháp — chưa gửi duyệt';

  -- draft đã gửi (lý do khác, hoặc rỗng) → phiếu tạm
  UPDATE sales_orders
  SET status = 'submitted'
  WHERE status = 'draft'
    AND COALESCE(approval_reason, '') <> 'Lưu nháp — chưa gửi duyệt';
  GET DIAGNOSTICS v_draft_sub = ROW_COUNT;

  UPDATE sales_orders
  SET status = 'submitted'
  WHERE status = 'confirmed';
  GET DIAGNOSTICS v_confirmed = ROW_COUNT;

  -- Đã xuất kho / đang giao / đã giao đều là "đã xuất hàng" trong v2.
  -- Mốc lấy từ phiếu xuất đã ghi sổ của chính đơn đó; không có phiếu
  -- (đơn trước mig 107, hoặc đơn giao qua tài xế) thì lấy now().
  UPDATE sales_orders so
  SET status = 'completed',
      completed_at = COALESCE(
        (SELECT max(se.posted_at)
           FROM stock_entries se
          WHERE se.type = 'export'
            AND se.status = 'posted'
            AND se.ref_order_ids @> jsonb_build_array(so.id::text)),
        now())
  WHERE so.status IN ('picking', 'delivering', 'delivered');
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  -- Đơn huỷ: completed_at để trống, TRỪ đơn đã từng xuất kho thật (giao
  -- thất bại, bàn giao lại). Đơn đó phải giữ hồ sơ, không được xoá.
  UPDATE sales_orders so
  SET completed_at = (
        SELECT max(se.posted_at)
          FROM stock_entries se
         WHERE se.type = 'export'
           AND se.status = 'posted'
           AND se.ref_order_ids @> jsonb_build_array(so.id::text))
  WHERE so.status = 'cancelled'
    AND so.completed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM stock_entries se
       WHERE se.type = 'export'
         AND se.status = 'posted'
         AND se.ref_order_ids @> jsonb_build_array(so.id::text));
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RAISE NOTICE '119 backfill sales_orders: % nháp giữ nguyên, % nháp→phiếu tạm, % đã duyệt→phiếu tạm, % →hoàn thành, % đơn huỷ được đóng dấu mốc xuất kho',
    v_draft_keep, v_draft_sub, v_confirmed, v_completed, v_cancelled;
END $$;


-- =====================================================================
-- 5. Ràng buộc CHECK mới cho sales_orders.status
-- =====================================================================
-- Ràng buộc cũ không tên: tra pg_constraint rồi DROP theo tên thật.
-- Lọc theo 'confirmed' vì đó là chuỗi CHỈ có trong ràng buộc status
-- (ràng buộc giai đoạn workflow đã bị DROP ở mục 2, và nó không chứa
-- chuỗi này).
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'sales_orders'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%confirmed%'
  LOOP
    EXECUTE format('ALTER TABLE sales_orders DROP CONSTRAINT %I', v_name);
    RAISE NOTICE '119: đã gỡ ràng buộc status cũ %', v_name;
  END LOOP;
END $$;

ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS chk_sales_orders_status_v2;
ALTER TABLE sales_orders
  ADD CONSTRAINT chk_sales_orders_status_v2
  CHECK (status IN ('draft', 'submitted', 'completed', 'cancelled'));


-- =====================================================================
-- 6. Bật lại trigger ghi lịch sử
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_log_order_status'
      AND tgrelid = 'sales_orders'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE sales_orders ENABLE TRIGGER trg_log_order_status';
  END IF;
END $$;


-- =====================================================================
-- 7. Đơn trả
-- =====================================================================

-- 7.1 Mốc ghi có: chỉ đóng dấu khi phiếu HOÀN THÀNH.
-- Bản mig 097 đóng dấu cả ở 'approved'. v2 không còn trạng thái đó, và
-- phiếu tạm thì chưa trừ công nợ của ai.
CREATE OR REPLACE FUNCTION public.sync_return_credited_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    -- Đóng dấu lần đầu. Đã có dấu thì giữ nguyên — sửa ghi chú không
    -- được đẩy khoản trừ sang kỳ khác.
    IF NEW.credited_at IS NULL THEN
      NEW.credited_at := now();
    END IF;
  ELSE
    -- Quay về phiếu tạm hoặc bị huỷ thì phiếu không còn đáng tính.
    NEW.credited_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 7.2 Cột mới
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS destination_zone   text,
  ADD COLUMN IF NOT EXISTS completed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS applied_receipt_id uuid REFERENCES cash_receipts(id);

ALTER TABLE returns DROP CONSTRAINT IF EXISTS chk_returns_destination_zone;
ALTER TABLE returns
  ADD CONSTRAINT chk_returns_destination_zone
  CHECK (destination_zone IS NULL OR destination_zone IN ('sale', 'date'));

COMMENT ON COLUMN returns.destination_zone IS
  'Kho nhận hàng trả khi hoàn thành phiếu: sale = kho bán, date = kho hàng cận date.';
COMMENT ON COLUMN returns.applied_receipt_id IS
  'Phiếu thu đã cấn trừ khoản có này. Chỉ dùng cho phiếu trả KHÔNG gắn đơn.';

-- 7.3 Backfill (Coder Pack mục 1, bảng returns)
DO $$
DECLARE
  v_draft int; v_sub int; v_appr int; v_rej int;
BEGIN
  -- pending + đơn liên kết chưa hoàn thành → nháp (ẩn khỏi danh sách)
  UPDATE returns r
  SET status = 'draft'
  WHERE r.status = 'pending'
    AND r.order_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM sales_orders o
       WHERE o.id = r.order_id AND o.status <> 'completed');
  GET DIAGNOSTICS v_draft = ROW_COUNT;

  -- pending còn lại (đơn đã hoàn thành, hoặc phiếu không gắn đơn)
  UPDATE returns SET status = 'submitted' WHERE status = 'pending';
  GET DIAGNOSTICS v_sub = ROW_COUNT;

  UPDATE returns SET status = 'submitted' WHERE status = 'approved';
  GET DIAGNOSTICS v_appr = ROW_COUNT;

  UPDATE returns SET status = 'cancelled' WHERE status = 'rejected';
  GET DIAGNOSTICS v_rej = ROW_COUNT;

  RAISE NOTICE '119 backfill returns: % →nháp, % chờ→phiếu tạm, % đã duyệt→phiếu tạm, % bị từ chối→huỷ',
    v_draft, v_sub, v_appr, v_rej;
END $$;

DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'returns'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%rejected%'
  LOOP
    EXECUTE format('ALTER TABLE returns DROP CONSTRAINT %I', v_name);
    RAISE NOTICE '119: đã gỡ ràng buộc status cũ của returns: %', v_name;
  END LOOP;
END $$;

ALTER TABLE returns DROP CONSTRAINT IF EXISTS chk_returns_status_v2;
ALTER TABLE returns
  ADD CONSTRAINT chk_returns_status_v2
  CHECK (status IN ('draft', 'submitted', 'completed', 'cancelled'));

-- 7.4 Trần số lượng trả: không trả nhiều hơn đã bán
--
-- ⚠ return_lines KHÔNG có cột hệ số quy đổi (khác sales_order_lines).
--   Phải tra product_units — và cột ở bảng đó tên là `conversion`, KHÔNG
--   phải `conversion_factor`. Gõ nhầm là lỗi 42703 lúc chạy.
-- ⚠ Dòng đổi hàng không tính: hàng đổi không trừ công nợ, và số lượng
--   đổi không bị chặn bởi số đã bán.
CREATE OR REPLACE FUNCTION public.enforce_return_line_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order    uuid;
  v_conv     numeric;
  v_qty_base numeric;
  v_sold     numeric;
  v_returned numeric;
  v_name     text;
BEGIN
  IF NEW.is_exchange THEN
    RETURN NEW;
  END IF;

  SELECT r.order_id INTO v_order FROM returns r WHERE r.id = NEW.return_id;
  IF v_order IS NULL THEN
    -- Phiếu trả độc lập: không có đơn gốc để so, trần giá do UI gác.
    RETURN NEW;
  END IF;

  v_conv := COALESCE((
    SELECT pu.conversion FROM product_units pu
     WHERE pu.product_id = NEW.product_id AND pu.unit_name = NEW.unit_name), 1);
  v_qty_base := COALESCE(NEW.quantity, 0) * v_conv;

  SELECT COALESCE(sum(sol.quantity * COALESCE(sol.conversion_factor, 1)), 0)
    INTO v_sold
  FROM sales_order_lines sol
  WHERE sol.order_id = v_order
    AND sol.product_id = NEW.product_id;

  SELECT COALESCE(sum(rl.quantity * COALESCE((
            SELECT pu.conversion FROM product_units pu
             WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1)), 0)
    INTO v_returned
  FROM return_lines rl
  JOIN returns r2 ON r2.id = rl.return_id
  WHERE r2.order_id = v_order
    AND r2.status = 'completed'
    AND rl.is_exchange = false
    AND rl.product_id = NEW.product_id
    AND rl.id <> NEW.id;

  IF v_qty_base + v_returned > v_sold THEN
    SELECT name INTO v_name FROM products WHERE id = NEW.product_id;
    RAISE EXCEPTION
      'RETURN_QTY_EXCEEDS: "%" — đã bán %, đã trả %, dòng này thêm % là vượt',
      COALESCE(v_name, NEW.product_id::text), v_sold, v_returned, v_qty_base
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_lines_cap ON return_lines;
CREATE TRIGGER trg_return_lines_cap
  BEFORE INSERT OR UPDATE ON return_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_return_line_cap();


-- =====================================================================
-- 8. Ghi nhận đã lấy hàng từ lô nào
-- =====================================================================
-- VÌ SAO: post_stock_export trừ FIFO qua nhiều lô, nhưng
-- stock_entry_lines.batch_id là khoá đơn nên chỉ giữ được MỘT lô — lô
-- lấy nhiều nhất. Phần còn lại nằm trong notes dạng chữ ("Lô: A×3, B×2").
-- Sửa hoặc huỷ đơn đã xuất thì phải trả hàng về ĐÚNG lô đã lấy; đọc chữ
-- trong notes để làm việc đó là cách hỏng.

CREATE TABLE IF NOT EXISTS stock_line_consumptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id         uuid NOT NULL REFERENCES stock_entry_lines(id) ON DELETE CASCADE,
  batch_id        uuid NOT NULL REFERENCES batches(id),
  qty_in_base_uom numeric NOT NULL,
  unit_cost       numeric,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_line_consumptions_line
  ON stock_line_consumptions(line_id);
CREATE INDEX IF NOT EXISTS idx_stock_line_consumptions_batch
  ON stock_line_consumptions(batch_id);

COMMENT ON TABLE stock_line_consumptions IS
  'Mỗi lần FIFO lấy hàng từ một lô cho một dòng phiếu xuất. Dùng để hoàn '
  'kho về đúng lô khi sửa hoặc huỷ đơn đã xuất.';

ALTER TABLE stock_line_consumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view stock line consumptions" ON stock_line_consumptions;
CREATE POLICY "Org members can view stock line consumptions"
  ON stock_line_consumptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM stock_entry_lines sel
      JOIN stock_entries se ON se.id = sel.entry_id
      WHERE sel.id = line_id
        AND se.org_id = public.user_org_id()
    )
  );

-- Ghi là việc của post_stock_export và các RPC ở mig 120 — đều
-- SECURITY DEFINER nên không đi qua RLS. Không mở policy ghi cho client.

-- Chép nguyên văn bản hiện hành (mig 107), THÊM ĐÚNG MỘT lệnh INSERT
-- trong vòng lặp trừ lô. Không đổi gì khác trong hàm.
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


-- =====================================================================
-- 9. Phiếu thu, dòng phiếu thu, khoản chi trả
-- =====================================================================

-- 9.1 Phiếu thu lập tay không gắn chuyến giao nào
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'cash_receipts'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%delivery_settle%'
  LOOP
    EXECUTE format('ALTER TABLE cash_receipts DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE cash_receipts DROP CONSTRAINT IF EXISTS chk_cash_receipts_source_type_v2;
ALTER TABLE cash_receipts
  ADD CONSTRAINT chk_cash_receipts_source_type_v2
  CHECK (source_type IN ('delivery_settle', 'manual', 'standalone'));

ALTER TABLE cash_receipts
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason text;

-- 9.2 Dòng phiếu thu: tiền mặt hay cấn trừ đơn trả
ALTER TABLE cash_receipt_lines
  ADD COLUMN IF NOT EXISTS kind      text NOT NULL DEFAULT 'payment',
  ADD COLUMN IF NOT EXISTS return_id uuid REFERENCES returns(id);

ALTER TABLE cash_receipt_lines DROP CONSTRAINT IF EXISTS chk_cash_receipt_lines_kind;
ALTER TABLE cash_receipt_lines
  ADD CONSTRAINT chk_cash_receipt_lines_kind
  CHECK (kind IN ('payment', 'return_credit'));

COMMENT ON COLUMN cash_receipt_lines.kind IS
  'payment = khách trả tiền. return_credit = cấn trừ bằng đơn trả độc lập.';

-- 9.3 Khoản trả có thể là tiền, hoặc là khoản có từ đơn trả
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'payments'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%ewallet%'
  LOOP
    EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_method_v2;
ALTER TABLE payments
  ADD CONSTRAINT chk_payments_method_v2
  CHECK (method IS NULL OR method IN ('cash', 'transfer', 'ewallet', 'return_credit'));


-- =====================================================================
-- 10. Thông báo và nhật ký sửa dòng
-- =====================================================================

DO $$
DECLARE
  v_name text;
BEGIN
  SELECT con.conname INTO v_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'notifications'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%order_pending_approval%'
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order_pending_approval',
    'order_approved',
    'order_cancelled',
    'order_completed',
    'order_edited',
    'return_completed',
    'payment_received',
    'receivable_overdue',
    'visit_logged',
    'customer_photo_missing',
    'info'
  ));

DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'order_activity_log'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%add_line%'
  LOOP
    EXECUTE format('ALTER TABLE order_activity_log DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE order_activity_log DROP CONSTRAINT IF EXISTS chk_order_activity_log_action;
ALTER TABLE order_activity_log
  ADD CONSTRAINT chk_order_activity_log_action
  CHECK (action IN (
    'add_line', 'edit_line', 'remove_line',
    'edit_after_complete', 'cancel_after_complete'
  ));


-- =====================================================================
-- 11. Định nghĩa doanh thu
-- =====================================================================
-- ⚠ ĐỌC PHẦN "ĐỔI Ý NGHĨA SỐ LIỆU" Ở ĐẦU FILE trước khi đổi dòng này.
DROP FUNCTION IF EXISTS public.is_revenue_status(text);
CREATE FUNCTION public.is_revenue_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, '') = 'completed';
$$;

COMMENT ON FUNCTION public.is_revenue_status(text) IS
  'Đơn có được tính vào doanh thu không. v2: đúng đơn đã xuất hàng. '
  'Phiếu tạm chưa trừ kho, chưa sinh công nợ, nên chưa phải doanh thu.';

-- finance_pnl là hàm DUY NHẤT còn lọc doanh thu bằng giá trị trạng thái
-- viết thẳng. Mọi hàm lương/tổng quan khác đã gọi is_revenue_status từ
-- mig 094 nên tự đi theo.
-- DROP xoá sạch GRANT, nên phải cấp lại ngay bên dưới.
DROP FUNCTION IF EXISTS public.finance_pnl(date, date);
CREATE FUNCTION public.finance_pnl(p_from date, p_to date)
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
  total_expenses numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH rev AS (
    SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS revenue, COUNT(*) AS order_count
    FROM sales_orders
    WHERE org_id = public.user_org_id()
      AND public.is_revenue_status(status)
      AND order_date >= p_from
      AND order_date <= p_to
  ),
  cogs AS (
    SELECT COALESCE(SUM(ABS(COALESCE(l.quantity, 0)) * COALESCE(l.unit_cost, 0)), 0) AS cogs
    FROM stock_entry_lines l
    JOIN stock_entries e ON e.id = l.entry_id
    WHERE e.org_id = public.user_org_id()
      AND e.type = 'export'
      AND e.status = 'posted'
      AND e.posted_at >= p_from::timestamptz
      AND e.posted_at <  (p_to + 1)::timestamptz
  ),
  exp AS (
    SELECT
      -- Danh mục không có bucket thì rơi vào 'other', giống mã cũ.
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
    rev.revenue,
    rev.order_count,
    cogs.cogs,
    COALESCE((SELECT amt FROM exp WHERE bucket = 'cogs'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'operating'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'hr'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'financial'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'tax'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'other'), 0),
    COALESCE((SELECT SUM(amt) FROM exp), 0)
  FROM rev, cogs;
$$;

GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date) TO authenticated;


-- =====================================================================
-- 12. Máy trạng thái mới
-- =====================================================================
-- Bỏ toàn bộ ngưỡng duyệt 20tr/50tr: v2 không có bước duyệt. NPP mở
-- từng phiếu tạm ra xem rồi mới bấm Xuất hàng.
--
-- ⚠ HAI BƯỚC PHẢI ĐI QUA RPC
--   'submitted' → 'completed' trừ kho và sinh công nợ.
--   'completed' → 'cancelled' hoàn kho và xoá công nợ.
--   Làm hai việc đó bằng vài lệnh UPDATE rời từ trình duyệt là cách cũ
--   đã cho ra đơn 'đang giao' mà kho không trừ. RPC ở mig 120 đặt cờ
--   npp.via_rpc rồi mới đổi trạng thái; không có cờ thì chặn tại đây.
CREATE OR REPLACE FUNCTION public.check_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status NOT IN ('submitted', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ nháp sang %', NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'submitted' AND NEW.status NOT IN ('completed', 'cancelled', 'draft') THEN
    RAISE EXCEPTION 'Không thể chuyển từ phiếu tạm sang %', NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'completed' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Đơn đã hoàn thành, chỉ có thể huỷ'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Đơn đã huỷ, không đổi trạng thái được nữa'
      USING ERRCODE = 'P0001';
  END IF;

  IF (OLD.status = 'submitted' AND NEW.status = 'completed')
     OR (OLD.status = 'completed' AND NEW.status = 'cancelled') THEN
    IF COALESCE(current_setting('npp.via_rpc', true), '') <> 'on' THEN
      RAISE EXCEPTION 'USE_RPC: dùng nút Xuất hàng / Hủy đơn'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
    NEW.submitted_at := now();
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_order_status ON sales_orders;
CREATE TRIGGER trg_check_order_status
  BEFORE UPDATE OF status ON sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_order_status_transition();


-- =====================================================================
-- 13. Phân quyền hàng
-- =====================================================================
--
-- ⚠ RLS KHÔNG BÁO LỖI KHI TỪ CHỐI. Lệnh UPDATE không khớp policy nào thì
--   Postgres sửa 0 dòng, PostgREST trả HTTP 200, error = null. Sai ở đây
--   là hỏng im lặng — màn hình báo "Đã lưu" cho một lệnh chưa chạy.
--
-- ⚠ NHÁNH TÀI XẾ ĐƯỢC GIỮ. Coder Pack nói giữ policy "Driver sees
--   delivery orders", nhưng policy đó đã bị mig 042 gộp vào
--   sales_order_select từ lâu. Giữ đúng phần việc của nó: nhánh cuối
--   trong policy SELECT dưới đây.

DROP POLICY IF EXISTS "Admin roles can view all orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales see own orders" ON sales_orders;
DROP POLICY IF EXISTS "Driver sees delivery orders" ON sales_orders;
DROP POLICY IF EXISTS sales_order_select ON sales_orders;
DROP POLICY IF EXISTS "Owner/Manager can update orders" ON sales_orders;
DROP POLICY IF EXISTS "Admin roles can update orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales can update own draft orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales can update own open orders" ON sales_orders;
DROP POLICY IF EXISTS "Owner/Manager can delete draft or cancelled orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales can delete own draft orders" ON sales_orders;

-- Nháp là sổ tay riêng của NVBH: chưa gửi thì NPP không nhìn thấy.
CREATE POLICY sales_order_select ON sales_orders
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (status <> 'draft' OR sales_user_id = auth.uid())
    AND (
      public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
      OR public.user_has_permission(auth.uid(), 'customer.view_all')
      OR sales_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM customer_assignments ca
        WHERE ca.customer_id = sales_orders.customer_id
          AND ca.user_id = auth.uid()
          AND ca.status = 'active'
      )
      OR (
        public.user_role() = 'driver'
        AND id IN (
          SELECT dl.order_id FROM delivery_lines dl
          JOIN deliveries d ON d.id = dl.delivery_id
          WHERE d.driver_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Admin roles can update orders" ON sales_orders
  FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse')
  )
  WITH CHECK (org_id = public.user_org_id());

-- NVBH sửa đơn của mình khi còn nháp hoặc còn là phiếu tạm; được phép
-- tự huỷ (WITH CHECK có 'cancelled') nhưng không kéo ngược đơn đã xuất.
CREATE POLICY "Sales can update own open orders" ON sales_orders
  FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status IN ('draft', 'submitted')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND sales_user_id = auth.uid()
    AND status IN ('draft', 'submitted', 'cancelled')
  );

COMMENT ON POLICY "Sales can update own open orders" ON sales_orders IS
  'Phải khớp SALES_EDITABLE_STATUSES trong src/lib/orders/edit-permission.ts.';

-- Đơn từng xuất kho thì không xoá, kể cả khi đã huỷ: hồ sơ kho còn đó.
CREATE POLICY "Owner/Manager can delete draft or cancelled orders"
  ON sales_orders FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
    AND status IN ('draft', 'cancelled')
    AND completed_at IS NULL
  );

CREATE POLICY "Sales can delete own draft orders"
  ON sales_orders FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status = 'draft'
  );

-- Dòng hàng của đơn đã hoàn thành chỉ đổi được qua RPC sửa đơn.
DROP POLICY IF EXISTS "Admin roles can manage order lines" ON sales_order_lines;
CREATE POLICY "Admin roles can manage order lines" ON sales_order_lines
  FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager', 'warehouse')
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id
        AND so.org_id = public.user_org_id()
        AND (
          so.status <> 'completed'
          OR COALESCE(current_setting('npp.via_rpc', true), '') = 'on'
        )
    )
  );

DROP POLICY IF EXISTS "Sales can manage lines of own open orders" ON sales_order_lines;
CREATE POLICY "Sales can manage lines of own open orders" ON sales_order_lines
  FOR ALL
  USING (
    public.user_role() = 'sales'
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id
        AND so.org_id = public.user_org_id()
        AND so.sales_user_id = auth.uid()
        AND so.status IN ('draft', 'submitted')
    )
  )
  WITH CHECK (
    public.user_role() = 'sales'
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id
        AND so.org_id = public.user_org_id()
        AND so.sales_user_id = auth.uid()
        AND so.status IN ('draft', 'submitted')
    )
  );


-- =====================================================================
-- 14. Quyền thực thi
-- =====================================================================
-- Hàm trigger không cấp cho ai gọi thẳng.
REVOKE ALL ON FUNCTION public.enforce_return_line_cap()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_order_status_transition()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_return_credited_at()        FROM PUBLIC;

GRANT SELECT ON stock_line_consumptions TO authenticated;


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- 15. Đếm lại sau khi backfill
-- =====================================================================

DO $$
DECLARE
  r record;
  v_no_export int;
BEGIN
  FOR r IN
    SELECT status, count(*) AS n FROM sales_orders GROUP BY status ORDER BY status
  LOOP
    RAISE NOTICE '119 đơn hàng — %: %', r.status, r.n;
  END LOOP;

  FOR r IN
    SELECT status, count(*) AS n FROM returns GROUP BY status ORDER BY status
  LOOP
    RAISE NOTICE '119 đơn trả — %: %', r.status, r.n;
  END LOOP;

  -- Coder Pack mục 1: đơn đang ở Hoàn thành mà chưa từng có phiếu xuất
  -- ghi sổ. Đây là đơn có trước mig 107 — tồn kho chưa bao giờ bị trừ
  -- cho chúng. Chỉ liệt kê cho chủ NPP kiểm tay, KHÔNG tự xử.
  SELECT count(*) INTO v_no_export
  FROM sales_orders so
  WHERE so.status = 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM stock_entries se
       WHERE se.type = 'export'
         AND se.status = 'posted'
         AND se.ref_order_ids @> jsonb_build_array(so.id::text));

  IF v_no_export > 0 THEN
    RAISE NOTICE '119 ⚠ % đơn Hoàn thành KHÔNG có phiếu xuất đã ghi sổ — tồn kho chưa từng bị trừ cho các đơn này:', v_no_export;
    FOR r IN
      SELECT so.order_code
      FROM sales_orders so
      WHERE so.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM stock_entries se
           WHERE se.type = 'export'
             AND se.status = 'posted'
             AND se.ref_order_ids @> jsonb_build_array(so.id::text))
      ORDER BY so.order_date DESC, so.order_code
    LOOP
      RAISE NOTICE '119    %', r.order_code;
    END LOOP;
  END IF;
END $$;
