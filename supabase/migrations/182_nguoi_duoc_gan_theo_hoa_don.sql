-- ====================================================================
-- NGƯỜI ĐƯỢC GÁN CỦA HÓA ĐƠN KÉO THEO PHIẾU TRẢ, VÀ GIỮ QUA LẬP LẠI
--
-- Chủ nhà báo 23/09/2026: "Lúc đầu lập hoá đơn gán cho nv A, sau đó sửa sang
-- nv B thì phiếu trả vẫn ko cập nhật theo thành nv B mà vẫn ở nv A".
--
-- ⚠ HAI CHỖ HỞ, CÙNG MỘT GỐC:
--   1. `assign_doc_seller('invoice', …)` (mig 178) đổi hóa đơn + công nợ
--      nhưng KHÔNG đổi phiếu trả đang bám hóa đơn. Khoản trừ hàng trả là
--      một phần của CÙNG tờ ấy — doanh số / hoa hồng tính ròng theo người
--      đứng tên thì phiếu trả phải đi theo, nếu không B được cả tờ mà A
--      gánh phần khách trả.
--   2. `reissue_invoice` (sửa hóa đơn = huỷ + lập lại) gọi `post_invoice`,
--      và hàm ấy chép `sales_user_id` từ ĐƠN — tờ mới quay về người của đơn,
--      mất người vừa được gán. Nay tờ mới giữ người đứng tên của tờ cũ, kèm
--      công nợ và phiếu trả.
--
-- ⚠ BÍ DANH BẢNG TRONG `reissue_invoice` LÀ BẮT BUỘC. Hàm ấy `RETURNS TABLE(
--   invoice_id …)` — tên trần `invoice_id` trong câu chèn thêm là "column
--   reference is ambiguous" giữa giao dịch (cùng bài học mig 128, mục 6.2).
--
-- ⚠ ĐIỀN LẠI: phiếu trả KÈM hóa đơn (`credit_with_invoice`) còn hiệu lực
--   đang lệch người với hóa đơn nó bám → theo hóa đơn. Phiếu trả độc lập
--   (không kèm) có thể được gán riêng có chủ ý — chỉ ĐẾM, không sửa.
-- ====================================================================

-- 1. assign_doc_seller: hóa đơn kéo theo phiếu trả đang bám nó.
DO $patch$
DECLARE
  v_src text;
  v_neo text := E'    UPDATE receivables SET sales_user_id = p_user WHERE invoice_id = p_id;\n';
BEGIN
  v_src := pg_get_functiondef('public.assign_doc_seller(text, uuid, uuid)'::regprocedure);
  IF position('(mig 182)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 182: assign_doc_seller đã kéo phiếu trả, bỏ qua ---';
  ELSE
    IF (length(v_src) - length(replace(v_src, v_neo, ''))) / length(v_neo) <> 1 THEN
      RAISE EXCEPTION '182: không thấy đúng MỘT chỗ cập nhật công nợ trong assign_doc_seller' USING ERRCODE = 'P0001';
    END IF;
    v_src := replace(v_src, v_neo, v_neo
      || E'    -- (mig 182) Phiếu trả đang bám tờ này đi theo người đứng tên tờ.\n'
      || E'    UPDATE returns SET sales_user_id = p_user\n'
      || E'     WHERE invoice_id = p_id AND status <> ''cancelled'';\n');
    EXECUTE v_src;
  END IF;
END;
$patch$;

-- 2. reissue_invoice: tờ mới giữ người đứng tên của tờ cũ.
DO $patch2$
DECLARE
  v_src text;
  v_neo text := E'  UPDATE returns SET invoice_id = v_new.invoice_id WHERE id = ANY(v_rets);\n';
BEGIN
  v_src := pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure);
  IF position('(mig 182)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 182: reissue_invoice đã giữ người đứng tên, bỏ qua ---';
    RETURN;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_neo, ''))) / length(v_neo) <> 1 THEN
    RAISE EXCEPTION '182: không thấy đúng MỘT chỗ gắn lại phiếu trả trong reissue_invoice' USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_neo, v_neo
    || E'\n  -- (mig 182) Tờ mới GIỮ người đứng tên của tờ cũ — `post_invoice` chép\n'
    || E'  --   người của ĐƠN, nên người vừa được gán ở tờ cũ sẽ mất nếu không chép lại.\n'
    || E'  PERFORM set_config(''npp.via_rpc'', ''on'', true);\n'
    || E'  UPDATE sales_invoices si182 SET sales_user_id = (SELECT si.sales_user_id FROM sales_invoices si WHERE si.id = p_invoice_id)\n'
    || E'   WHERE si182.id = v_new.invoice_id;\n'
    || E'  UPDATE receivables rc182 SET sales_user_id = (SELECT si.sales_user_id FROM sales_invoices si WHERE si.id = p_invoice_id)\n'
    || E'   WHERE rc182.invoice_id = v_new.invoice_id;\n'
    || E'  UPDATE returns rt182 SET sales_user_id = (SELECT si.sales_user_id FROM sales_invoices si WHERE si.id = p_invoice_id)\n'
    || E'   WHERE rt182.invoice_id = v_new.invoice_id AND rt182.status <> ''cancelled'';\n');
  EXECUTE v_src;
END;
$patch2$;

DO $kiem$
BEGIN
  IF position('(mig 182)' IN pg_get_functiondef('public.assign_doc_seller(text, uuid, uuid)'::regprocedure)) = 0
     OR position('(mig 182)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '182: chưa vá đủ hai hàm' USING ERRCODE = 'P0001';
  END IF;
  -- Miếng vá cũ của reissue phải còn nguyên.
  IF position('_apply_return_edits' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '182: reissue_invoice mất miếng vá mig 149' USING ERRCODE = 'P0001';
  END IF;
END;
$kiem$;

-- 3. Điền lại phiếu trả KÈM hóa đơn đang lệch người.
DO $dien$
DECLARE v_n int;
BEGIN
  PERFORM set_config('npp.via_rpc', 'on', true);
  UPDATE returns r
     SET sales_user_id = si.sales_user_id
    FROM sales_invoices si
   WHERE si.id = r.invoice_id
     AND r.credit_with_invoice
     AND r.status <> 'cancelled'
     AND r.sales_user_id IS DISTINCT FROM si.sales_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('npp.via_rpc', '', true);
  RAISE NOTICE '--- 182: đưa % phiếu trả kèm hóa đơn về đúng người đứng tên ---', v_n;
END;
$dien$;

NOTIFY pgrst, 'reload schema';

SELECT 'Phiếu trả KÈM hóa đơn lệch người đứng tên (mong đợi 0)' AS hang_muc, count(*)::text AS so_luong
FROM returns r JOIN sales_invoices si ON si.id = r.invoice_id
WHERE r.credit_with_invoice AND r.status <> 'cancelled' AND r.sales_user_id IS DISTINCT FROM si.sales_user_id
UNION ALL
SELECT 'Phiếu trả ĐỘC LẬP lệch người với hóa đơn (chỉ đếm, không sửa)', count(*)::text
FROM returns r JOIN sales_invoices si ON si.id = r.invoice_id
WHERE NOT r.credit_with_invoice AND r.status <> 'cancelled' AND r.sales_user_id IS DISTINCT FROM si.sales_user_id;
