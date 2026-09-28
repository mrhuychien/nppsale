-- ====================================================================
-- 211 — PHIẾU TRẢ TỰ SINH: CHỌN NGÀY NHẬP KHO LÚC HOÀN THÀNH
--
-- VÌ SAO — chủ nhà 28/09/2026: "Các phiếu trả tự sinh tao muốn sửa ngày lúc
-- nhập kho".
--
-- Phiếu tự sinh (credit_with_invoice) trừ công nợ và doanh số theo NGÀY HÓA ĐƠN
-- (mig 191/192). Hàng thì về kho sau, có khi vài hôm — hoàn thành hôm nay mà
-- hàng về từ hôm trước thì sổ kho lệch ngày.
--
-- CÁCH LÀM: thêm bản 3 tham số `complete_return(id, kho, ngày)`:
--   · gọi đúng bản 2 tham số (mọi luật kho / quyền / công nợ giữ nguyên);
--   · rồi dời mốc phiếu nhập (`stock_entries.posted_at`) và `returns.completed_at`
--     về ngày chọn — hôm nay thì giữ now(), ngày khác thì 12:00 giờ VN (cùng lối
--     `sync_return_credited_at`, mig 188).
--   · Chỉ phiếu TỰ SINH; không sau hôm nay; không trước ngày hóa đơn.
--   · KHÔNG đụng `return_date` / `revenue_date`: doanh số, công nợ của phiếu tự
--     sinh vẫn theo ngày hóa đơn.
-- ⚠ Bản 3 tham số KHÔNG có giá trị mặc định — để lời gọi 2 tham số không mơ hồ.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.complete_return(p_return_id uuid, p_zone text, p_ngay date)
RETURNS TABLE (entry_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r         record;
  v_hom_nay date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_ngay_hd date;
  v_entry   uuid;
  v_moc     timestamptz;
BEGIN
  IF p_ngay IS NULL THEN
    RETURN QUERY SELECT c.entry_id FROM public.complete_return(p_return_id, p_zone) c;
    RETURN;
  END IF;

  SELECT rt.id, rt.org_id, rt.invoice_id, COALESCE(rt.credit_with_invoice, false) AS tu_sinh INTO r
  FROM returns rt WHERE rt.id = p_return_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT r.tu_sinh THEN
    RAISE EXCEPTION 'NGAY_NHAP_CHI_TU_SINH: chỉ phiếu trả tự sinh theo hóa đơn mới chọn ngày nhập kho — phiếu tự lập dùng ngày chứng từ'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_ngay > v_hom_nay THEN
    RAISE EXCEPTION 'NGAY_NHAP_TUONG_LAI: ngày nhập kho % sau hôm nay', to_char(p_ngay, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  SELECT si.invoice_date INTO v_ngay_hd FROM sales_invoices si WHERE si.id = r.invoice_id;
  IF v_ngay_hd IS NOT NULL AND p_ngay < v_ngay_hd THEN
    RAISE EXCEPTION 'NGAY_NHAP_TRUOC_HOA_DON: ngày nhập kho % trước ngày hóa đơn %',
      to_char(p_ngay, 'DD/MM/YYYY'), to_char(v_ngay_hd, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;

  SELECT c.entry_id INTO v_entry FROM public.complete_return(p_return_id, p_zone) c;

  v_moc := CASE WHEN p_ngay = v_hom_nay THEN now()
                ELSE (p_ngay + time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh' END;
  UPDATE stock_entries SET posted_at = v_moc WHERE id = v_entry;
  UPDATE returns SET completed_at = v_moc WHERE id = p_return_id;

  RETURN QUERY SELECT v_entry;
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_return(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_return(uuid, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 211: chọn ngày nhập kho phiếu trả tự sinh' AS buoc,
       CASE WHEN to_regprocedure('public.complete_return(uuid, text, date)') IS NOT NULL
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua;
