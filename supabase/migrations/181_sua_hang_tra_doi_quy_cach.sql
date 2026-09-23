-- ====================================================================
-- SỬA HÀNG TRẢ KÈM HÓA ĐƠN: ĐỔI ĐƯỢC QUY CÁCH (ĐƠN VỊ)
--
-- Chủ nhà báo 23/09/2026: "khi thay đổi hàng đổi, phần hàng đổi tự thêm
-- trên hoá đơn ko thay đổi cùng (sửa số lượng, sửa quy cách (hiện tại chưa
-- sửa được quy cách), xoá dòng…)".
--
-- ⚠ `_apply_return_edits` (mig 149) CHỈ NHẬN SỐ LƯỢNG. Nay nhận thêm
--   `unit_name`. Màn hóa đơn POS dựng dòng HÀNG ĐỔI trên hóa đơn từ chính
--   dòng phiếu trả (một nguồn — xem invoice-screen), nên đổi quy cách ở đây
--   là đổi luôn quy cách hàng xuất đổi.
--
-- ⚠ ĐƠN GIÁ MỚI DO MÁY CHỦ TÍNH, KHÔNG NHẬN TỪ TRÌNH DUYỆT. Dòng trả là
--   tiền trừ công nợ khách (`line_total` → `credit_note_amount`); nhận giá
--   gửi lên là mở một đường ghi tiền tuỳ ý — đúng lý do mig 149 không nhận
--   `line_total`. Giá đi theo HỆ SỐ (chủ nhà chốt 23/09/2026 cho dòng trả:
--   "giá đã chốt trên phiếu, đổi đơn vị thì đi theo hệ số" — cùng luật
--   `doiDonViDongTra` ở màn): giá mới = giá cũ × hệ số mới / hệ số cũ.
--   Đơn vị lạ (không phải cơ sở, không có trong `product_units`) thì TỪ
--   CHỐI — không đoán hệ số.
--
-- ⚠ CÙNG CHỮ KÝ, CHỈ ĐỔI THÂN. Hàm này chỉ có thân ở mig 149 (mig 166 chỉ
--   thu quyền); `CREATE OR REPLACE` giữ nguyên quyền đã thu.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._apply_return_edits(
  p_invoice_id uuid,
  p_edits      jsonb
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  e        jsonb;
  v_line   record;
  v_qty    numeric;
  v_unit   text;
  v_hs_cu  numeric;
  v_hs_moi numeric;
  v_gia    numeric;
  v_count  int := 0;
BEGIN
  IF p_edits IS NULL OR jsonb_typeof(p_edits) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(p_edits)
  LOOP
    SELECT rl.id, rl.product_id, rl.unit_name, rl.unit_price, rl.vat_rate, p.base_unit
      INTO v_line
    FROM return_lines rl
    JOIN returns r ON r.id = rl.return_id
    JOIN products p ON p.id = rl.product_id
    WHERE rl.id = (e->>'line_id')::uuid
      AND r.invoice_id = p_invoice_id
      AND r.status IN ('draft', 'submitted');

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_qty := COALESCE((e->>'quantity')::numeric, 0);

    IF v_qty <= 0 THEN
      DELETE FROM return_lines WHERE id = v_line.id;
      v_count := v_count + 1;
      CONTINUE;
    END IF;

    v_unit := NULLIF(btrim(COALESCE(e->>'unit_name', '')), '');
    v_gia  := COALESCE(v_line.unit_price, 0);

    IF v_unit IS NOT NULL AND v_unit IS DISTINCT FROM v_line.unit_name THEN
      v_hs_cu := CASE WHEN v_line.unit_name = v_line.base_unit THEN 1
                      ELSE (SELECT pu.conversion FROM product_units pu
                            WHERE pu.product_id = v_line.product_id AND pu.unit_name = v_line.unit_name) END;
      v_hs_moi := CASE WHEN v_unit = v_line.base_unit THEN 1
                       ELSE (SELECT pu.conversion FROM product_units pu
                             WHERE pu.product_id = v_line.product_id AND pu.unit_name = v_unit) END;
      IF v_hs_moi IS NULL OR v_hs_moi <= 0 THEN
        RAISE EXCEPTION 'RETURN_UNIT_UNKNOWN: đơn vị "%" không có trong danh mục của mặt hàng', v_unit
          USING ERRCODE = 'P0001';
      END IF;
      -- Đơn vị cũ đã bị gỡ khỏi danh mục thì không quy được giá — giữ giá, báo rõ.
      IF v_hs_cu IS NULL OR v_hs_cu <= 0 THEN
        RAISE EXCEPTION 'RETURN_UNIT_UNKNOWN: đơn vị cũ "%" không còn trong danh mục — không quy được giá', v_line.unit_name
          USING ERRCODE = 'P0001';
      END IF;
      v_gia := round(v_gia * v_hs_moi / v_hs_cu, 2);
    ELSE
      v_unit := v_line.unit_name;
    END IF;

    UPDATE return_lines
    SET quantity   = v_qty,
        unit_name  = v_unit,
        unit_price = v_gia,
        line_total = round(v_qty * v_gia * (1 + COALESCE(vat_rate, 0)))
    WHERE id = v_line.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public._apply_return_edits(uuid, jsonb) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Sửa hàng trả nhận đổi quy cách (_apply_return_edits)' AS hang_muc,
       CASE WHEN position('RETURN_UNIT_UNKNOWN' IN pg_get_functiondef('public._apply_return_edits(uuid, jsonb)'::regprocedure)) > 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai;
