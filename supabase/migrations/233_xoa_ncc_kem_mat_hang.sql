-- ====================================================================
-- 233 — XOÁ NHÀ CUNG CẤP QUA RPC: CHỈ CHỦ NPP, HỎI XOÁ KÈM MẶT HÀNG
--
-- VÌ SAO — chủ nhà 05/10/2026 (trả lời câu hỏi về xoá NCC sau mig 232):
--   · NCC chưa có chứng từ nhưng còn mặt hàng gắn NCC chính: "Hỏi lại có muốn xoá mặt hàng kèm ncc không? Nếu có
--     xoá luôn cả mặt hàng. Nếu mặt hàng có trong các phiếu -> đổi về ngừng bán."
--   · "Chỉ NPP được xoá" — chỉ Chủ NPP (vai `owner`) xoá được nhà cung cấp. Quyền gộp NCC giữ nguyên.
--   Mig 232 chặn xoá ở trigger khi còn mặt hàng (`products.primary_supplier_id`), nên NCC chỉ còn mặt hàng là kẹt:
--   không xoá được mà cũng không có lối nào gỡ hàng ra trừ sửa từng mặt hàng. Và màn chi tiết xoá thẳng dòng
--   `suppliers` từ trình duyệt — RLS cho cả Quản lý / Thủ kho xoá.
--
-- CÁCH LÀM
--   1. `_mat_hang_co_chung_tu(id)` — mặt hàng đã nằm trong chứng từ: mọi khoá ngoại trỏ vào `products` trừ loại
--      CASCADE (dòng đơn / HĐ / phiếu nhập / phiếu trả / phiếu kho…, tự theo bảng thêm sau này), hoặc còn lô có tồn.
--      (Đơn vị tính / bảng giá / lô rỗng là CASCADE — là của chính mặt hàng, đi theo khi xoá.)
--   2. RPC `xoa_nha_cung_cap(p_id, p_xoa_hang)` — CHỈ Chủ NPP, MỘT giao dịch:
--      · NCC còn chứng từ (phiếu nhập / phiếu trả NCC / công nợ / đơn đặt / phiếu kho) → `NCC_CO_CHUNG_TU`, không đụng gì.
--      · p_xoa_hang = true: mặt hàng chưa có chứng từ → XOÁ; đã có (hoặc xoá vấp khoá ngoại) → Ngừng bán
--        (`status = 'inactive'`) và gỡ khỏi NCC.
--      · p_xoa_hang = false: giữ mặt hàng, chỉ gỡ khỏi NCC (`primary_supplier_id = NULL`).
--      · Rồi xoá NCC (trigger 232 cho qua vì không còn gì trỏ vào). Trả số đã xoá / ngừng bán / gỡ.
--   3. Trigger `trg_ncc_xoa_qua_rpc` (BEFORE DELETE, KHÔNG definer — đọc `current_user`): trình duyệt xoá thẳng
--      `suppliers` → `NCC_XOA_QUA_RPC`. RPC xoá và gộp NCC (definer) đi qua; xoá cả NPP (CASCADE) cũng cho qua.
-- ====================================================================

-- ── Mặt hàng đã nằm trong chứng từ chưa ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._mat_hang_co_chung_tu(p_product_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c record;
  v_co boolean;
BEGIN
  FOR c IN
    SELECT k.conrelid::regclass::text AS bang, a.attname::text AS cot
    FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    JOIN pg_class t ON t.oid = k.conrelid
    WHERE k.contype = 'f' AND k.confdeltype <> 'c'
      AND k.confrelid = 'public.products'::regclass
      AND t.relnamespace = 'public'::regnamespace
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', c.bang, c.cot) INTO v_co USING p_product_id;
    IF v_co THEN
      RETURN true;
    END IF;
  END LOOP;
  -- Lô còn tồn (kể cả âm): xoá mặt hàng là CASCADE mất luôn số tồn — coi như đã dùng.
  RETURN EXISTS (SELECT 1 FROM batches WHERE product_id = p_product_id AND COALESCE(qty_on_hand, 0) <> 0);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._mat_hang_co_chung_tu(uuid) FROM PUBLIC, anon, authenticated;

-- ── RPC: xoá NCC (Chủ NPP) ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.xoa_nha_cung_cap(p_id uuid, p_xoa_hang boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  v_ncc suppliers%ROWTYPE;
  v jsonb;
  v_mo_ta text;
  r record;
  v_xoa int := 0;
  v_ngung int := 0;
  v_go int := 0;
BEGIN
  IF v_org IS NULL OR public.user_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN_XOA_NCC: chỉ Chủ NPP được xoá nhà cung cấp' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_ncc FROM suppliers WHERE id = p_id AND org_id = v_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'KHONG_TIM_THAY_NCC: nhà cung cấp không còn / không thuộc NPP' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Còn chứng từ (ngoài mặt hàng) → không xoá; mời ngừng hợp tác / gộp như mig 232.
  v := public._ncc_dem_chung_tu(p_id);
  SELECT string_agg((e->>'so') || ' ' || (e->>'nhan'), ', ') INTO v_mo_ta
  FROM jsonb_array_elements(v->'chi_tiet') e
  WHERE e->>'bang' <> 'products';
  IF v_mo_ta IS NOT NULL THEN
    RAISE EXCEPTION 'NCC_CO_CHUNG_TU: không xoá được nhà cung cấp "%" — đã có %. Dùng "Ngừng hợp tác" hoặc "Gộp vào NCC khác".',
      v_ncc.name, v_mo_ta USING ERRCODE = 'P0001';
  END IF;

  -- 2. Mặt hàng gắn NCC chính.
  FOR r IN
    SELECT p.id, p.org_id FROM products p WHERE p.primary_supplier_id = p_id ORDER BY p.id FOR UPDATE
  LOOP
    IF NOT p_xoa_hang OR r.org_id IS DISTINCT FROM v_org THEN
      UPDATE products SET primary_supplier_id = NULL WHERE id = r.id;
      v_go := v_go + 1;
    ELSIF public._mat_hang_co_chung_tu(r.id) THEN
      UPDATE products SET status = 'inactive', primary_supplier_id = NULL WHERE id = r.id;
      v_ngung := v_ngung + 1;
    ELSE
      BEGIN
        DELETE FROM products WHERE id = r.id;
        v_xoa := v_xoa + 1;
      EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
        -- Bảng con của mặt hàng (đơn vị / bảng giá / lô) đang bị chứng từ trỏ vào → giữ, ngừng bán.
        UPDATE products SET status = 'inactive', primary_supplier_id = NULL WHERE id = r.id;
        v_ngung := v_ngung + 1;
      END;
    END IF;
  END LOOP;

  -- 3. Xoá NCC (phân công nhân viên `user_suppliers` CASCADE theo).
  DELETE FROM suppliers WHERE id = p_id;

  RETURN jsonb_build_object(
    'ten', v_ncc.name, 'ma', v_ncc.code,
    'mat_hang_da_xoa', v_xoa, 'mat_hang_ngung_ban', v_ngung, 'mat_hang_go', v_go);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.xoa_nha_cung_cap(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.xoa_nha_cung_cap(uuid, boolean) TO authenticated;

-- ── Trình duyệt không xoá thẳng `suppliers` ────────────────────────────────────────────────────────
-- ⚠ KHÔNG SECURITY DEFINER: `_la_trinh_duyet()` đọc `current_user` — hàm definer thì luôn ra chủ hàm.
CREATE OR REPLACE FUNCTION public._ncc_xoa_qua_rpc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF public._la_trinh_duyet() AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN
    RAISE EXCEPTION 'NCC_XOA_QUA_RPC: xoá nhà cung cấp ở màn chi tiết NCC (chỉ Chủ NPP).' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._ncc_xoa_qua_rpc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ncc_xoa_qua_rpc ON suppliers;
CREATE TRIGGER trg_ncc_xoa_qua_rpc
  BEFORE DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION public._ncc_xoa_qua_rpc();

NOTIFY pgrst, 'reload schema';

SELECT 'mig 233: xoá NCC qua RPC (Chủ NPP) · hỏi xoá kèm mặt hàng' AS buoc,
       CASE WHEN to_regprocedure('public.xoa_nha_cung_cap(uuid,boolean)') IS NOT NULL
             AND to_regprocedure('public._mat_hang_co_chung_tu(uuid)') IS NOT NULL
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ncc_xoa_qua_rpc')
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM suppliers s
         WHERE (public._ncc_dem_chung_tu(s.id)->>'tong')::bigint > 0
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public._ncc_dem_chung_tu(s.id)->'chi_tiet') e
                           WHERE e->>'bang' <> 'products')) AS ncc_chi_con_mat_hang;
