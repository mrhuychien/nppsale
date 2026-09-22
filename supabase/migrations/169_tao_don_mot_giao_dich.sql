-- ====================================================================
-- TẠO ĐƠN (ĐẦU ĐƠN + DÒNG HÀNG + PHIẾU TRẢ KÈM) TRONG MỘT GIAO DỊCH
--
-- Rơi ra từ đợt QA 22/09/2026.
--
-- ⚠ TRƯỚC ĐÂY `createOrderRecords` (src/lib/orders/create.ts) ghi ba
--   lệnh RỜI từ trình duyệt: `sales_orders` → `sales_order_lines` →
--   `returns` + `return_lines`. Đầu đơn đã commit rồi mới tới dòng hàng:
--     · mạng 3G rớt sau lệnh đầu ⇒ một ĐƠN MA: có tổng tiền, 0 dòng hàng,
--       nằm ở Phiếu tạm cho NPP thấy;
--     · màn /sell sinh `clientRequestId` MỚI mỗi cú bấm ⇒ bấm lại là đơn
--       THỨ HAI;
--     · hàng đợi ngoại tuyến thử lại với CÙNG mã ⇒ vấp 23505, và nhánh ấy
--       trả về "đã có đơn" mà KHÔNG xem đơn ấy có dòng nào không — đơn 0
--       dòng được báo là "Đã gửi đơn", hàng trả kèm mất luôn.
--
-- ⚠ SAU: `create_order_with_lines(p jsonb)` ghi cả ba trong MỘT giao
--   dịch — hỏng ở đâu cũng không còn gì nằm lại.
--
-- ⚠ SECURITY INVOKER, CỐ Ý. Hàm chạy DƯỚI QUYỀN NGƯỜI GỌI: mọi chính sách
--   RLS và trigger đang canh việc lập đơn (ai đứng tên đơn — mig 153,
--   phiếu trả — mig 160, cấp mã đơn — mig 130) áp y như khi trình duyệt
--   tự ghi. Migration này KHÔNG thêm, KHÔNG nới một quyền nào; nó chỉ gom
--   ba lệnh vào một giao dịch.
--
-- ⚠ ĐƠN MA CÓ SẴN THÌ VÁ KHI GẶP LẠI. Gọi lại với cùng
--   `client_request_id` mà đơn cũ 0 dòng hàng (dấu vết lỗi cũ) thì ghi bù
--   dòng hàng và phiếu trả từ tải trọng — đúng thứ lần đầu định ghi.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.create_order_with_lines(p jsonb)
RETURNS TABLE (order_id uuid, order_code text, already_existed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_crid     uuid := NULLIF(p->>'client_request_id', '')::uuid;
  o          jsonb := p->'order';
  v_order    uuid;
  v_code     text;
  v_existed  boolean := false;
  v_ret      uuid;
BEGIN
  IF v_crid IS NULL THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: thiếu client_request_id.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'lines') = 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: đơn cần ít nhất một dòng hàng.' USING ERRCODE = 'P0001';
  END IF;

  SELECT so.id, so.order_code INTO v_order, v_code
  FROM sales_orders so WHERE so.client_request_id = v_crid;

  IF FOUND THEN
    v_existed := true;
  ELSE
    BEGIN
      INSERT INTO sales_orders (
        org_id, sales_user_id, client_request_id, order_code, customer_id, payment_terms,
        expected_delivery, subtotal, vat, total, notes, status, approval_reason
      ) VALUES (
        public.user_org_id(),
        COALESCE(NULLIF(o->>'sales_user_id', '')::uuid, auth.uid()),
        v_crid,
        o->>'order_code',
        (o->>'customer_id')::uuid,
        COALESCE(NULLIF(o->>'payment_terms', ''), 'COD'),
        NULLIF(o->>'expected_delivery', '')::date,
        COALESCE((o->>'subtotal')::numeric, 0),
        COALESCE((o->>'vat')::numeric, 0),
        COALESCE((o->>'total')::numeric, 0),
        NULLIF(o->>'notes', ''),
        COALESCE(NULLIF(o->>'status', ''), 'draft'),
        NULLIF(o->>'approval_reason', '')
      )
      RETURNING id, sales_orders.order_code INTO v_order, v_code;
    EXCEPTION WHEN unique_violation THEN
      -- Hai lượt cùng mã chạy song song: lượt kia vừa ghi xong.
      SELECT so.id, so.order_code INTO v_order, v_code
      FROM sales_orders so WHERE so.client_request_id = v_crid;
      IF NOT FOUND THEN RAISE; END IF;
      v_existed := true;
    END;
  END IF;

  -- Đơn đã có ĐỦ dòng thì thôi — đây là lần thử lại bình thường.
  IF v_existed AND EXISTS (SELECT 1 FROM sales_order_lines WHERE sales_order_lines.order_id = v_order) THEN
    RETURN QUERY SELECT v_order, v_code, true;
    RETURN;
  END IF;

  INSERT INTO sales_order_lines (
    order_id, product_id, unit_name, quantity, unit_price, line_discount, line_total, conversion_factor, note
  )
  SELECT v_order,
         (l->>'product_id')::uuid,
         l->>'unit_name',
         (l->>'quantity')::numeric,
         COALESCE((l->>'unit_price')::numeric, 0),
         COALESCE((l->>'line_discount')::numeric, 0),
         COALESCE((l->>'line_total')::numeric, 0),
         COALESCE((l->>'conversion_factor')::numeric, 1),
         NULLIF(l->>'note', '')
  FROM jsonb_array_elements(p->'lines') AS l;

  IF p->'returns' IS NOT NULL AND jsonb_typeof(p->'returns') = 'object'
     AND jsonb_typeof(p->'return_lines') = 'array' AND jsonb_array_length(p->'return_lines') > 0
     AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.order_id = v_order AND r.status <> 'cancelled')
  THEN
    INSERT INTO returns (org_id, order_id, customer_id, requested_by, reason, notes, status)
    VALUES (public.user_org_id(), v_order, (o->>'customer_id')::uuid, auth.uid(),
            p->'returns'->>'reason', NULLIF(p->'returns'->>'notes', ''),
            -- Phiếu trả kèm đơn nằm chờ, chỉ thành phiếu thật khi đơn xuất hàng.
            'draft')
    RETURNING id INTO v_ret;

    INSERT INTO return_lines (
      return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange, note, reason
    )
    SELECT v_ret,
           (l->>'product_id')::uuid,
           l->>'unit_name',
           (l->>'quantity')::numeric,
           COALESCE((l->>'unit_price')::numeric, 0),
           COALESCE((l->>'vat_rate')::numeric, 0),
           COALESCE((l->>'line_total')::numeric, 0),
           COALESCE((l->>'is_exchange')::boolean, false),
           NULLIF(l->>'note', ''),
           NULLIF(l->>'reason', '')
    FROM jsonb_array_elements(p->'return_lines') AS l;
  END IF;

  RETURN QUERY SELECT v_order, v_code, v_existed;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order_with_lines(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_lines(jsonb) TO authenticated;

DO $kiem$
BEGIN
  IF to_regprocedure('public.create_order_with_lines(jsonb)') IS NULL THEN
    RAISE EXCEPTION '169: chưa dựng được create_order_with_lines' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.create_order_with_lines(jsonb)')) THEN
    RAISE EXCEPTION '169: create_order_with_lines phải là SECURITY INVOKER — RLS lập đơn phải áp như cũ'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 169: tạo đơn nay ghi đầu đơn + dòng + phiếu trả trong một giao dịch ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — thứ DUY NHẤT trình soạn SQL của Supabase hiện ra.
-- ĐƠN MA đã có (migration này không tự xoá — cần người xem từng đơn).
-- ---------------------------------------------------------------------
SELECT 'Đơn không có dòng hàng nào (đơn ma, chưa huỷ)' AS hang_muc,
       count(*)::text AS so_don,
       coalesce(string_agg(so.order_code || ' (' || so.status || ')', ', ' ORDER BY so.created_at DESC), '') AS ma_don
FROM sales_orders so
WHERE so.status NOT IN ('cancelled')
  AND NOT EXISTS (SELECT 1 FROM sales_order_lines l WHERE l.order_id = so.id);
