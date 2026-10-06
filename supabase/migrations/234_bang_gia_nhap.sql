-- ====================================================================
-- 234 — BẢNG GIÁ NHẬP HÀNG: LƯU GIÁ NHẬP, PHIẾU NHẬP HOÀN THÀNH THÌ TỰ CẬP NHẬT
--
-- VÌ SAO — chủ nhà 06/10/2026: "Làm thêm phần bảng giá nhập hàng -> lưu giá nhập load lại khi làm đơn, nếu giá có
--   thay đổi thì tự cập nhật thay đổi (vẫn được toàn quyền sửa giá trên đơn nhập)".
--   Trước đây ô giá của phiếu nhập chỉ gợi ý từ `products.cost_price` (một giá mỗi đơn vị cơ sở, gõ tay ở danh mục,
--   không ai cập nhật) — POS máy tính thì để trống. Mỗi lần nhập người ta phải dò lại hoá đơn NCC cũ.
--
-- CÁCH LÀM
--   1. Bảng `purchase_price_lists`: MỘT giá cho mỗi (mặt hàng, đơn vị tính) — giá của ĐÚNG đơn vị đó (thùng có giá
--      thùng riêng, như bảng giá bán / CLAUDE.md "giá phải là giá của đúng đơn vị"). Giá là ĐƠN GIÁ trên phiếu
--      (trước chiết khấu dòng, chưa VAT) — chiết khấu từng lần nhập không phải giá niêm yết của NCC.
--      `effective_date` = ngày phiếu nhập (hoặc ngày sửa tay); `source_invoice_id` = phiếu nhập đã đặt giá.
--   2. Trigger `trg_gia_nhap_tu_phieu` (AFTER phiếu nhập chuyển sang `completed`): mỗi (mặt hàng, đơn vị) trên phiếu
--      có đơn giá > 0 → ghi vào bảng giá. Hàng tặng (giá 0) không đè giá.
--      ⚠ KHÔNG ĐỂ PHIẾU CŨ ĐÈ GIÁ MỚI: chỉ ghi khi ngày phiếu ≥ ngày của giá đang lưu — sửa lại (huỷ → hoàn thành)
--        một phiếu tháng trước không kéo giá về giá cũ.
--      Giá trên phiếu vẫn sửa tự do — bảng giá chỉ là giá GỢI Ý khi thêm hàng vào phiếu.
--   3. RPC `luu_gia_nhap(p_dong jsonb)` — sửa tay ở màn Bảng giá nhập (vai ghi mua hàng: Chủ / Quản lý / Kế toán /
--      Thủ kho, như RLS phiếu nhập mig 163). `price` rỗng / null = bỏ giá của đơn vị đó.
--   4. Lấp sẵn từ lịch sử: phiếu nhập đã hoàn thành gần nhất của từng (mặt hàng, đơn vị).
--   RLS: chỉ ĐỌC cho vai mua hàng (giá nhập là giá vốn — nhân viên bán hàng không xem); không ghi thẳng được.
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.purchase_price_lists (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_name         text NOT NULL,
  price             numeric NOT NULL CHECK (price >= 0),
  effective_date    date NOT NULL DEFAULT CURRENT_DATE,
  source_invoice_id uuid REFERENCES purchase_invoices(id) ON DELETE SET NULL,
  updated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gia_nhap_hang_don_vi UNIQUE (product_id, unit_name)
);
CREATE INDEX IF NOT EXISTS idx_gia_nhap_org ON public.purchase_price_lists(org_id);

COMMENT ON TABLE public.purchase_price_lists IS
  'Bảng giá nhập (mig 234): một giá cho mỗi (mặt hàng, đơn vị) — tự cập nhật khi phiếu nhập hoàn thành; gợi ý giá khi lập phiếu.';

ALTER TABLE public.purchase_price_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gia_nhap_doc ON public.purchase_price_lists;
CREATE POLICY gia_nhap_doc ON public.purchase_price_lists
  FOR SELECT
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse'));
-- Không có chính sách ghi: chỉ trigger / RPC (definer) ghi được.

-- ── Ngày hôm nay theo giờ Việt Nam ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._hom_nay_vn()
RETURNS date
LANGUAGE sql
STABLE
AS $fn$ SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date $fn$;

-- ── Ghi giá từ một phiếu nhập ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ghi_gia_nhap_tu_phieu(p_invoice_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_inv purchase_invoices%ROWTYPE;
  v_ngay date;
  v_so integer := 0;
BEGIN
  SELECT * INTO v_inv FROM purchase_invoices WHERE id = p_invoice_id;
  IF NOT FOUND OR v_inv.status IS DISTINCT FROM 'completed' THEN
    RETURN 0;
  END IF;
  v_ngay := COALESCE(v_inv.invoice_date, public._hom_nay_vn());

  WITH moi AS (
    -- Hai dòng cùng (mặt hàng, đơn vị) trên một phiếu → lấy dòng dưới cùng.
    SELECT DISTINCT ON (l.product_id, l.unit_name)
           l.product_id, l.unit_name, l.unit_price
    FROM purchase_invoice_lines l
    JOIN products p ON p.id = l.product_id AND p.org_id = v_inv.org_id
    WHERE l.invoice_id = p_invoice_id
      AND l.product_id IS NOT NULL
      AND COALESCE(btrim(l.unit_name), '') <> ''
      AND COALESCE(l.unit_price, 0) > 0
    ORDER BY l.product_id, l.unit_name, l.sort_order DESC NULLS LAST, l.id DESC
  ), ghi AS (
    INSERT INTO purchase_price_lists AS g
      (org_id, product_id, unit_name, price, effective_date, source_invoice_id, updated_by, updated_at)
    SELECT v_inv.org_id, m.product_id, m.unit_name, m.unit_price, v_ngay, p_invoice_id, auth.uid(), now()
    FROM moi m
    ON CONFLICT (product_id, unit_name) DO UPDATE
      SET price = EXCLUDED.price,
          effective_date = EXCLUDED.effective_date,
          source_invoice_id = EXCLUDED.source_invoice_id,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      -- Phiếu cũ hơn giá đang lưu thì không đè.
      WHERE g.effective_date <= EXCLUDED.effective_date
    RETURNING 1
  )
  SELECT count(*) INTO v_so FROM ghi;
  RETURN v_so;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._ghi_gia_nhap_tu_phieu(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._trg_gia_nhap_tu_phieu()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM public._ghi_gia_nhap_tu_phieu(NEW.id);
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._trg_gia_nhap_tu_phieu() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gia_nhap_tu_phieu ON purchase_invoices;
CREATE TRIGGER trg_gia_nhap_tu_phieu
  AFTER INSERT OR UPDATE OF status ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public._trg_gia_nhap_tu_phieu();

-- ── RPC: sửa tay ở màn Bảng giá nhập ──────────────────────────────────────────────────────────────
-- p_dong: [{ "product_id": uuid, "unit_name": text, "price": number | null }]; price null / "" = bỏ giá.
CREATE OR REPLACE FUNCTION public.luu_gia_nhap(p_dong jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  d jsonb;
  v_sp uuid;
  v_dv text;
  v_gia_txt text;
  v_gia numeric;
  v_luu int := 0;
  v_bo int := 0;
BEGIN
  IF v_org IS NULL OR public.user_role() IS NULL
     OR public.user_role() NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN_GIA_NHAP: vai này không sửa được bảng giá nhập' USING ERRCODE = 'P0001';
  END IF;
  IF p_dong IS NULL OR jsonb_typeof(p_dong) <> 'array' THEN
    RAISE EXCEPTION 'GIA_NHAP_SAI: cần danh sách dòng giá' USING ERRCODE = 'P0001';
  END IF;

  FOR d IN SELECT * FROM jsonb_array_elements(p_dong) LOOP
    v_sp := NULLIF(d->>'product_id', '')::uuid;
    v_dv := btrim(COALESCE(d->>'unit_name', ''));
    v_gia_txt := btrim(COALESCE(d->>'price', ''));
    IF v_sp IS NULL OR v_dv = '' THEN
      RAISE EXCEPTION 'GIA_NHAP_SAI: thiếu mặt hàng / đơn vị' USING ERRCODE = 'P0001';
    END IF;
    -- Mặt hàng của chính NPP, đơn vị là đơn vị cơ sở hoặc đơn vị quy đổi đã khai.
    IF NOT EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = v_sp AND p.org_id = v_org
        AND (p.base_unit = v_dv OR EXISTS (SELECT 1 FROM product_units u WHERE u.product_id = p.id AND u.unit_name = v_dv))
    ) THEN
      RAISE EXCEPTION 'GIA_NHAP_SAI: mặt hàng / đơn vị "%" không có trong danh mục', v_dv USING ERRCODE = 'P0001';
    END IF;

    IF v_gia_txt = '' OR d->'price' = 'null'::jsonb THEN
      DELETE FROM purchase_price_lists WHERE product_id = v_sp AND unit_name = v_dv AND org_id = v_org;
      v_bo := v_bo + 1;
      CONTINUE;
    END IF;
    BEGIN
      v_gia := v_gia_txt::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'GIA_NHAP_SAI: giá "%" không phải số', v_gia_txt USING ERRCODE = 'P0001';
    END;
    IF v_gia < 0 THEN
      RAISE EXCEPTION 'GIA_NHAP_AM: giá nhập không được âm' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO purchase_price_lists AS g
      (org_id, product_id, unit_name, price, effective_date, source_invoice_id, updated_by, updated_at)
    VALUES (v_org, v_sp, v_dv, round(v_gia), public._hom_nay_vn(), NULL, auth.uid(), now())
    ON CONFLICT (product_id, unit_name) DO UPDATE
      SET price = EXCLUDED.price,
          -- Sửa tay là giá mới nhất: phiếu nhập đề ngày trước hôm nay không đè lại.
          effective_date = GREATEST(g.effective_date, EXCLUDED.effective_date),
          source_invoice_id = NULL,
          updated_by = EXCLUDED.updated_by,
          updated_at = now();
    v_luu := v_luu + 1;
  END LOOP;

  RETURN jsonb_build_object('luu', v_luu, 'bo', v_bo);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.luu_gia_nhap(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.luu_gia_nhap(jsonb) TO authenticated;

-- ── Lấp sẵn từ lịch sử: phiếu nhập hoàn thành gần nhất của từng (mặt hàng, đơn vị) ──────────────
INSERT INTO purchase_price_lists (org_id, product_id, unit_name, price, effective_date, source_invoice_id, updated_at)
SELECT DISTINCT ON (l.product_id, l.unit_name)
       i.org_id, l.product_id, l.unit_name, l.unit_price,
       COALESCE(i.invoice_date, (i.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, CURRENT_DATE), i.id, now()
FROM purchase_invoice_lines l
JOIN purchase_invoices i ON i.id = l.invoice_id AND i.status = 'completed'
JOIN products p ON p.id = l.product_id AND p.org_id = i.org_id
WHERE l.product_id IS NOT NULL
  AND COALESCE(btrim(l.unit_name), '') <> ''
  AND COALESCE(l.unit_price, 0) > 0
ORDER BY l.product_id, l.unit_name, i.invoice_date DESC NULLS LAST, i.completed_at DESC NULLS LAST,
         l.sort_order DESC NULLS LAST, l.id DESC
ON CONFLICT (product_id, unit_name) DO NOTHING;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 234: bảng giá nhập · tự cập nhật khi phiếu nhập hoàn thành' AS buoc,
       CASE WHEN to_regclass('public.purchase_price_lists') IS NOT NULL
             AND to_regprocedure('public.luu_gia_nhap(jsonb)') IS NOT NULL
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gia_nhap_tu_phieu')
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM purchase_price_lists) AS so_gia_da_lap;
