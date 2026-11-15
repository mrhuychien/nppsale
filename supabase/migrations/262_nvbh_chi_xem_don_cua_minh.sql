-- ====================================================================
-- 262 — NVBH CHỈ XEM ĐƠN HÀNG CỦA CHÍNH MÌNH
--
-- VÌ SAO — chủ nhà 15/11/2026: "Kiểm tra lại quyền xem, sao nhân viên này lại xem được đơn hàng của nhân viên kia".
--
-- Chính sách đọc đơn `sales_order_select` (mig 119, giữ nguyên ở mig 161, bọc (SELECT …) ở mig 250) cho NVBH thấy đơn khi:
--   · đơn đứng tên mình (`sales_user_id`) — đúng;
--   · HOẶC khách của đơn đang được phân công cho mình (`customer_assignments` active) — BẤT KỂ AI BÁN: khách làm chung (NV chính
--     + NV phụ, "Bàn giao khách · Làm chung" mig 246) là hai người thấy đơn của nhau; khách vừa đổi người phụ trách là người mới
--     thấy mọi đơn cũ của người trước; đơn chủ NPP tự bán cho khách của NV cũng hiện ở máy NV;
--   · HOẶC có quyền "Xem tất cả KH" (`customer.view_all` — quyền riêng từng người HOẶC bật cho cả vai ở màn Phân quyền): một ô
--     quyền về KHÁCH mà mở luôn đơn của cả NPP.
-- Các chứng từ khác của NVBH đã chỉ-của-mình từ trước: hoá đơn (mig 124), phiếu trả (mig 198), công nợ, phiếu thu. Đơn là chỗ lệch.
--
-- SỬA:
--   1. `sales_order_select`: NVBH chỉ đơn đứng tên mình. Văn phòng (chủ / quản lý / kế toán / kho), tài xế (đơn trong chuyến của
--      mình) và luật nháp riêng (mig 161: nháp chỉ người đứng tên thấy) GIỮ NGUYÊN. Dòng đơn (`sales_order_lines`) đọc theo đơn
--      nên tự theo. NVBH không lập được đơn đứng tên người khác (mig 153) nên luôn đọc lại được đơn mình vừa lập.
--   2. Nhật ký đơn (`order_activity_log`): trước chỉ lọc NPP — ai trong NPP gọi thẳng API là đọc được nhật ký mọi đơn (kể cả
--      "Đổi khách" tên cũ → mới). Nay theo quyền xem đơn.
--   3. `get_invoiceable_lines` (SECURITY DEFINER — bỏ qua RLS): trước chỉ kiểm cùng NPP, biết mã đơn là đọc được dòng hàng của đơn
--      người khác. Nay kiểm ĐÚNG biểu thức của chính sách mục 1; không xem được thì báo ORDER_NOT_FOUND (không lộ là đơn có tồn
--      tại). Vá CHUỖI bản đang chạy (như mig 210 / 247 / 261) — mỗi chỗ vá phải thấy đúng 1 lần, không thì dừng. Sửa chính sách
--      xem đơn về sau thì sửa cả chỗ này (bộ thử so hai bên trên mọi cặp người × đơn).
--
-- HỆ QUẢ (đã nói chủ nhà): khách làm chung / vừa bàn giao — NVBH chỉ thấy đơn MÌNH bán cho khách ấy (chi tiết khách, "hàng hay
--   mua" ở màn bán, Đặt lại). "Hàng khách đã lấy" (mig 246 — chỉ số lượng) không đổi. Quyền "Xem tất cả KH" chỉ còn mở KHÁCH;
--   ai cần xem đơn của mọi người thì đặt vai Quản lý.
--
-- Câu SELECT cuối báo: chính sách / nhật ký / hàm đã vá chưa + TRƯỚC KHI SỬA mỗi NVBH thấy bao nhiêu đơn của người khác, vì sao.
-- ====================================================================

-- 0) Ghi lại TRƯỚC KHI SỬA: mỗi NVBH đang làm việc thấy bao nhiêu đơn của người khác theo luật cũ (để báo ở câu tóm tắt) -----
CREATE TEMP TABLE IF NOT EXISTS _mig262_truoc (nv uuid, ten text, xem_het boolean, so_don int, vi_phan_cong int);
TRUNCATE _mig262_truoc;
INSERT INTO _mig262_truoc
SELECT u.id, u.full_name, x.xem_het,
       count(so.id)::int,
       count(so.id) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.customer_assignments ca
          WHERE ca.customer_id = so.customer_id AND ca.user_id = u.id AND ca.status = 'active'))::int
  FROM public.users u
  CROSS JOIN LATERAL (SELECT public.user_has_permission(u.id, 'customer.view_all') AS xem_het) x
  JOIN public.sales_orders so
    ON so.org_id = u.org_id
   AND so.status <> 'draft'
   AND so.sales_user_id IS DISTINCT FROM u.id
   AND (x.xem_het OR EXISTS (
         SELECT 1 FROM public.customer_assignments ca
          WHERE ca.customer_id = so.customer_id AND ca.user_id = u.id AND ca.status = 'active'))
 WHERE u.role = 'sales' AND COALESCE(u.is_active, true)
 GROUP BY u.id, u.full_name, x.xem_het;

-- 1) Đọc đơn: NVBH chỉ đơn đứng tên mình -------------------------------------------------------------------------------------
-- ⚠ ALTER, không DROP + CREATE: đổi biểu thức tại chỗ, không có lúc nào bảng đơn thiếu chính sách đọc (thiếu = không ai thấy đơn).
ALTER POLICY sales_order_select ON public.sales_orders USING (
  org_id = (SELECT public.user_org_id())
  -- Nháp là sổ tay riêng: chỉ người đứng tên đơn thấy, áp cho MỌI vai — kể cả chủ NPP (mig 119 / 161, giữ nguyên).
  AND (status <> 'draft' OR sales_user_id = (SELECT auth.uid()))
  AND (
    (SELECT public.user_role()) IN ('owner', 'manager', 'accountant', 'warehouse')
    OR sales_user_id = (SELECT auth.uid())
    OR (
      (SELECT public.user_role()) = 'driver'
      AND id IN (
        SELECT dl.order_id FROM public.delivery_lines dl
        JOIN public.deliveries d ON d.id = dl.delivery_id
        WHERE d.driver_id = (SELECT auth.uid())
      )
    )
  )
);

COMMENT ON POLICY sales_order_select ON public.sales_orders IS
  'NVBH chỉ xem đơn đứng tên mình (chủ nhà 15/11/2026, mig 262 — bỏ nhánh khách phân công + Xem tất cả KH). Nháp chỉ người '
  'đứng tên đơn thấy, kể cả chủ NPP (mig 119 / 161) — giao diện không cho lưu nháp đơn đứng tên người khác. Văn phòng (chủ / '
  'quản lý / kế toán / kho) thấy mọi đơn đã gửi; tài xế đơn trong chuyến của mình.';

-- 2) Nhật ký đơn theo quyền xem đơn (EXISTS trên `sales_orders` chạy dưới RLS của người hỏi) ---------------------------------
ALTER POLICY org_iso_oal ON public.order_activity_log USING (
  org_id = (SELECT public.user_org_id())
  AND EXISTS (SELECT 1 FROM public.sales_orders so WHERE so.id = order_activity_log.order_id)
);

-- 3) get_invoiceable_lines: cùng luật xem đơn — vá chuỗi bản đang chạy ----------------------------------------------------------
-- ⚠ KHỚP BẰNG BIỂU THỨC CHÍNH QUY, khoảng trắng / xuống dòng tuỳ ý (`\s`). Bản đầu khớp NGUYÊN VĂN '…''P0001'';\n  END IF;'
--   và hỏng trên sổ thật (chủ nhà chạy 15/11/2026: "chỗ vá 1/1/0 — cần 1/1/1"): thân hàm ở đó lưu xuống dòng kiểu Windows
--   (\r\n) — chỗ vá nằm gọn một dòng thì khớp, chỗ vắt qua dòng thì trượt. Lệch nữa thì câu lỗi in kèm đoạn quanh ORG_MISMATCH.
DO $va$
DECLARE
  v_def text := pg_get_functiondef('public.get_invoiceable_lines(uuid)'::regprocedure);
  re1 text := 'DECLARE\s+v_org\s+uuid\s*;';
  b1 text := 'DECLARE v_org uuid; v_nv uuid; v_tt text; v_toi uuid := auth.uid();';
  re2 text := 'SELECT\s+org_id\s+INTO\s+v_org\s+FROM\s+sales_orders\s+WHERE\s+id\s*=\s*p_order_id\s*;';
  b2 text := 'SELECT org_id, sales_user_id, status INTO v_org, v_nv, v_tt FROM sales_orders WHERE id = p_order_id;';
  re3 text := '(RAISE\s+EXCEPTION\s+''ORG_MISMATCH''\s+USING\s+ERRCODE\s*=\s*''P0001''\s*;\s*END\s+IF\s*;)';
  -- \1 = nguyên đoạn ORG_MISMATCH … END IF; của bản đang chạy (giữ nguyên xuống dòng của nó), khối mới chèn ngay sau.
  b3 text := '\1' || $s$
  -- (mig 262) ĐÚNG BIỂU THỨC của chính sách xem đơn `sales_order_select` (chủ nhà 15/11/2026): nháp chỉ người đứng tên;
  --   NVBH chỉ đơn của mình; tài xế đơn trong chuyến của mình. COALESCE(…, false) = RLS coi NULL là không thấy (tài khoản
  --   bị khoá: user_org_id() NULL). Hàm SECURITY DEFINER: RLS không tự chặn. Không xem được thì như không có đơn — không
  --   lộ là đơn có tồn tại. Không có phiên đăng nhập (máy chủ / service_role) thì để nguyên như cũ.
  IF v_toi IS NOT NULL AND NOT COALESCE(
       v_org = public.user_org_id()
       AND (v_tt <> 'draft' OR v_nv = v_toi)
       AND (public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
            OR v_nv = v_toi
            OR (public.user_role() = 'driver' AND p_order_id IN (
                  SELECT dl.order_id FROM delivery_lines dl
                  JOIN deliveries d ON d.id = dl.delivery_id
                  WHERE d.driver_id = v_toi))),
       false) THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;$s$;
  n1 int; n2 int; n3 int;
BEGIN
  IF position('(mig 262)' IN v_def) > 0 THEN
    RETURN;  -- đã vá
  END IF;
  n1 := (SELECT count(*) FROM regexp_matches(v_def, re1, 'g'));
  n2 := (SELECT count(*) FROM regexp_matches(v_def, re2, 'g'));
  n3 := (SELECT count(*) FROM regexp_matches(v_def, re3, 'g'));
  IF n1 <> 1 OR n2 <> 1 OR n3 <> 1 THEN
    RAISE EXCEPTION '262: get_invoiceable_lines bản đang chạy khác dự kiến (chỗ vá %/%/% — cần 1/1/1; có \r: %), không vá. Đoạn quanh ORG_MISMATCH: %',
      n1, n2, n3, position(E'\r' IN v_def) > 0,
      replace(replace(substring(v_def FROM greatest(position('ORG_MISMATCH' IN v_def) - 120, 1) FOR 260), E'\r', '\r'), E'\n', '\n');
  END IF;
  EXECUTE regexp_replace(regexp_replace(regexp_replace(v_def, re1, b1), re2, b2), re3, b3);
END
$va$;

NOTIFY pgrst, 'reload schema';

SELECT hang_muc, ket_qua FROM (
  SELECT 1 AS stt, 'Đọc đơn: NVBH chỉ đơn của chính mình' AS hang_muc,
         CASE WHEN q IS NULL THEN 'CHƯA — không thấy chính sách sales_order_select'
              WHEN position('customer_assignments' IN q) > 0 OR position('customer.view_all' IN q) > 0
                THEN 'CHƯA — còn nhánh khách phân công / Xem tất cả KH'
              ELSE 'OK' END AS ket_qua
    FROM (SELECT (SELECT qual FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'sales_orders' AND policyname = 'sales_order_select') AS q) p
  UNION ALL
  SELECT 2, 'Nhật ký đơn theo quyền xem đơn',
         CASE WHEN position('sales_orders' IN coalesce((SELECT qual FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'order_activity_log' AND policyname = 'org_iso_oal'), '')) > 0
              THEN 'OK' ELSE 'CHƯA' END
  UNION ALL
  SELECT 3, 'get_invoiceable_lines kiểm quyền xem đơn',
         CASE WHEN position('(mig 262)' IN pg_get_functiondef('public.get_invoiceable_lines(uuid)'::regprocedure)) > 0
              THEN 'OK' ELSE 'CHƯA' END
  UNION ALL
  SELECT 4, 'Trước khi sửa: NVBH thấy đơn của người khác',
         CASE WHEN count(*) = 0 THEN 'không NVBH nào'
              ELSE count(*) || ' NVBH · ' || sum(so_don) || ' đơn của người khác (vì khách được phân công: ' || sum(vi_phan_cong)
                   || ' đơn · vì quyền Xem tất cả KH: ' || count(*) FILTER (WHERE xem_het) || ' NVBH)' END
    FROM _mig262_truoc
  UNION ALL
  SELECT 5, '· ' || coalesce(ten, nv::text),
         so_don || ' đơn của người khác' || CASE WHEN xem_het THEN ' — đang có quyền Xem tất cả KH' ELSE '' END
    FROM _mig262_truoc
) t
ORDER BY stt, hang_muc;
