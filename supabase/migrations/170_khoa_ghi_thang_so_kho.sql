-- ====================================================================
-- KHOÁ ĐƯỜNG GHI THẲNG VÀO SỔ KHO TỪ TRÌNH DUYỆT
--
-- Rơi ra từ đợt QA 22/09/2026. Cùng MỘT khuôn lỗi xuất hiện ở năm màn:
-- trình duyệt ghi thẳng vào `batches` / `stock_entries` / `stock_entry_lines`
-- một cách làm sổ kho và tồn thật lệch nhau mà không ai thấy. ĐÃ ĐO:
--
--   · Chủ NPP xoá phiếu nhập `posted` 50 → dòng thẻ kho mất (CASCADE),
--     lô vẫn 50.
--   · "Duyệt" phiếu chuyển kho nháp bằng UPDATE status = 'posted' → tồn
--     vùng sale 1000 → 1000, vùng date 0 → 0.
--   · Sửa lô: gõ lại `qty_on_hand` → vượt qua bước duyệt điều chỉnh (chỉ
--     chủ / quản lý), không có dòng thẻ kho, không ghi hao hụt.
--   · `/inventory/stocktake`, `/inventory/stocktake-check` (đã chặn ở giao
--     diện từ 22/09) chèn phiếu `posted` mà không đụng tồn lô.
--   · Quản lý huỷ phiếu kiểm kê nháp → RLS âm thầm từ chối (0 dòng),
--     màn báo "Đã hủy".
--
-- ⚠ MỌI ĐƯỜNG GHI HỢP LỆ ĐỀU ĐI QUA RPC SECURITY DEFINER. Đã tra
--   `pg_proc`: không hàm SECURITY INVOKER nào, không trigger nào, ghi vào
--   ba bảng này. Bên trong RPC SECURITY DEFINER thì `current_user` là
--   chủ hàm (postgres); lệnh GỬI THẲNG qua PostgREST thì `current_user`
--   là `authenticated`. Đã đo trên Postgres 16:
--       trực tiếp:  authenticated
--       trong RPC:  postgres
--   Nên trigger dưới đây CHỈ can thiệp khi lệnh tới thẳng từ API, và để
--   yên mọi RPC (nhập kho, xuất, chuyển kho, kiểm kê, hoá đơn, trả hàng).
--
-- ⚠ CÁI VẪN ĐƯỢC LÀM TỪ TRÌNH DUYỆT:
--     batches          : tạo lô RỖNG (qty = 0 — lối cho phiếu kiểm kê ghi
--                        phần thừa, xem mig 123); sửa mã lô, hạn, vị trí,
--                        vùng kho; sửa giá vốn của lô đang RỖNG; xoá lô RỖNG.
--     stock_entries    : lập phiếu NHÁP; sửa ghi chú; nháp → huỷ; xoá NHÁP.
--     stock_entry_lines: ghi dòng của phiếu còn NHÁP.
--
-- ⚠ MÃ LỖI P0001, KHÔNG PHẢI 42501. Đây là "đi sai đường", không phải
--   "thiếu quyền" — 42501 bị dịch thành "Bạn không có quyền" ở giao diện,
--   và chủ NPP đọc câu ấy sẽ đi tìm sai chỗ.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._trg_khoa_ghi_thang_lo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.qty_on_hand, 0) <> 0 OR COALESCE(NEW.qty_initial, 0) <> 0 THEN
      RAISE EXCEPTION 'SO_KHO_KHOA: lô có tồn phải vào kho qua phiếu Nhập kho hoặc phiếu kiểm kê — tạo lô ở đây chỉ được tạo lô rỗng (số lượng 0).'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.qty_on_hand IS DISTINCT FROM OLD.qty_on_hand
       OR NEW.qty_initial IS DISTINCT FROM OLD.qty_initial THEN
      RAISE EXCEPTION 'SO_KHO_KHOA: không sửa thẳng số tồn của lô — lập phiếu kiểm kê để điều chỉnh (có duyệt, có thẻ kho, có ghi hao hụt).'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost AND COALESCE(OLD.qty_on_hand, 0) <> 0 THEN
      RAISE EXCEPTION 'SO_KHO_KHOA: không sửa giá vốn của lô đang có tồn — giá vốn đã đi vào các phiếu xuất trước đó.'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'SO_KHO_KHOA: không đổi sản phẩm / đơn vị của một lô.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE
  IF COALESCE(OLD.qty_on_hand, 0) <> 0 THEN
    RAISE EXCEPTION 'SO_KHO_KHOA: lô còn % trong kho — không xoá được. Điều chỉnh về 0 qua phiếu kiểm kê trước.', OLD.qty_on_hand
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_lo ON batches;
CREATE TRIGGER trg_khoa_ghi_thang_lo
  BEFORE INSERT OR UPDATE OR DELETE ON batches
  FOR EACH ROW EXECUTE FUNCTION public._trg_khoa_ghi_thang_lo();


CREATE OR REPLACE FUNCTION public._trg_khoa_ghi_thang_phieu_kho()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- ⚠ Cột `status` mặc định 'posted' (mig 016) — nên chèn mà quên ghi
    --   trạng thái là chèn một phiếu ĐÃ GHI SỔ không đụng kho.
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'SO_KHO_KHOA: phiếu kho lập từ màn hình phải là phiếu NHÁP — ghi sổ đi qua nút Duyệt / Hoàn thành.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'draft' AND NEW.status = 'cancelled') THEN
      RAISE EXCEPTION 'SO_KHO_KHOA: không đổi thẳng trạng thái phiếu kho (% → %) — ghi sổ / huỷ đi qua nút Duyệt / Huỷ phiếu để kho đổi theo.',
        OLD.status, NEW.status USING ERRCODE = 'P0001';
    END IF;
    IF NEW.type IS DISTINCT FROM OLD.type OR NEW.org_id IS DISTINCT FROM OLD.org_id
       OR (OLD.status <> 'draft' AND (
             NEW.posted_at IS DISTINCT FROM OLD.posted_at
          OR NEW.warehouse_zone IS DISTINCT FROM OLD.warehouse_zone
          OR NEW.dest_warehouse_zone IS DISTINCT FROM OLD.dest_warehouse_zone)) THEN
      RAISE EXCEPTION 'SO_KHO_KHOA: phiếu đã ghi sổ chỉ sửa được ghi chú.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE
  IF OLD.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'SO_KHO_KHOA: chỉ xoá được phiếu NHÁP. Phiếu % đã %, dùng Huỷ phiếu để hàng về lại kho.',
      OLD.entry_code, CASE OLD.status WHEN 'posted' THEN 'ghi sổ' ELSE 'huỷ' END
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_phieu_kho ON stock_entries;
CREATE TRIGGER trg_khoa_ghi_thang_phieu_kho
  BEFORE INSERT OR UPDATE OR DELETE ON stock_entries
  FOR EACH ROW EXECUTE FUNCTION public._trg_khoa_ghi_thang_phieu_kho();


CREATE OR REPLACE FUNCTION public._trg_khoa_ghi_thang_dong_kho()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_st text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT status INTO v_st FROM stock_entries WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  -- Không thấy phiếu (đang bị xoá cùng lúc — CASCADE từ phiếu NHÁP) thì để
  -- yên: trigger của `stock_entries` đã chỉ cho xoá phiếu nháp.
  IF v_st IS NOT NULL AND v_st <> 'draft' THEN
    RAISE EXCEPTION 'SO_KHO_KHOA: phiếu đã % — không sửa dòng hàng được nữa.',
      CASE v_st WHEN 'posted' THEN 'ghi sổ' ELSE 'huỷ' END USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_dong_kho ON stock_entry_lines;
CREATE TRIGGER trg_khoa_ghi_thang_dong_kho
  BEFORE INSERT OR UPDATE OR DELETE ON stock_entry_lines
  FOR EACH ROW EXECUTE FUNCTION public._trg_khoa_ghi_thang_dong_kho();


-- ---------------------------------------------------------------------
-- Từ chối (huỷ) phiếu kiểm kê NHÁP — cho đúng người được DUYỆT nó
-- ---------------------------------------------------------------------
-- ⚠ Người duyệt được thì phải từ chối được. `post_stock_adjustment` cho
--   ai có `inventory.approve` (chủ + quản lý, mig 123), nhưng nút "Huỷ" ở
--   màn Điều chỉnh ghi thẳng, và RLS `stock_entries` chỉ cho chủ + thủ
--   kho — quản lý bấm Huỷ là 0 dòng, màn báo "Đã hủy". Đã đo.
CREATE OR REPLACE FUNCTION public.reject_stock_adjustment(p_entry_id uuid, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_org uuid; v_st text; v_type text;
BEGIN
  SELECT org_id, status, type INTO v_org, v_st, v_type
  FROM stock_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND: không tìm thấy phiếu kiểm kê.' USING ERRCODE = 'P0001';
  END IF;
  IF v_org IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH: phiếu không thuộc đơn vị của bạn.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'inventory.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền duyệt / từ chối điều chỉnh kho.' USING ERRCODE = '42501';
  END IF;
  IF v_type <> 'stocktake' THEN
    RAISE EXCEPTION 'BAD_TYPE: đây không phải phiếu kiểm kê.' USING ERRCODE = 'P0001';
  END IF;
  IF v_st = 'cancelled' THEN RETURN false; END IF;
  IF v_st <> 'draft' THEN
    RAISE EXCEPTION 'ALREADY_POSTED: phiếu đã duyệt — không từ chối được nữa.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE stock_entries
  SET status = 'cancelled',
      notes  = COALESCE(notes || E'\n', '') || 'Từ chối: ' || COALESCE(NULLIF(p_reason, ''), '(không ghi lý do)')
  WHERE id = p_entry_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_stock_adjustment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_stock_adjustment(uuid, text) TO authenticated;


DO $kiem$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN ('trg_khoa_ghi_thang_lo', 'trg_khoa_ghi_thang_phieu_kho', 'trg_khoa_ghi_thang_dong_kho');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '170: chỉ có %/3 trigger khoá sổ kho', v_n USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('_trg_khoa_ghi_thang_lo', '_trg_khoa_ghi_thang_phieu_kho', '_trg_khoa_ghi_thang_dong_kho') AND prosecdef) THEN
    RAISE EXCEPTION '170: trigger khoá sổ kho KHÔNG được là SECURITY DEFINER — nó phải thấy đúng người gọi' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 170: trình duyệt không còn ghi thẳng được vào sổ kho; RPC để nguyên ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — thứ DUY NHẤT trình soạn SQL của Supabase hiện ra.
-- Dấu vết của các đường ghi thẳng cũ (migration này KHÔNG sửa — cần
-- người xem): phiếu ghi sổ mà có dòng không gắn lô.
-- ---------------------------------------------------------------------
SELECT 'Trigger khoá sổ kho (cần 3)' AS hang_muc,
       count(*)::text AS ket_qua, '' AS chi_tiet
FROM pg_trigger
WHERE NOT tgisinternal AND tgname IN ('trg_khoa_ghi_thang_lo', 'trg_khoa_ghi_thang_phieu_kho', 'trg_khoa_ghi_thang_dong_kho')
UNION ALL
SELECT 'Phiếu nhập / kiểm kê đã ghi sổ mà có dòng KHÔNG gắn lô (tồn không đổi theo)',
       count(DISTINCT se.id)::text,
       coalesce(string_agg(DISTINCT se.entry_code, ', '), '')
FROM stock_entries se JOIN stock_entry_lines l ON l.entry_id = se.id
WHERE se.status = 'posted' AND se.type IN ('import', 'stocktake') AND l.batch_id IS NULL;
