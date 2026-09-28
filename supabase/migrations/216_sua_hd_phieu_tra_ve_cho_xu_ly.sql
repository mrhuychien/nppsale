-- ====================================================================
-- 216 — SỬA HĐ, CHỌN "HUỶ PHIẾU NHẬP": PHIẾU TRẢ VỀ CHỜ XỬ LÝ, KHÔNG TỰ NHẬP KHO LẠI
--
-- VÌ SAO — chủ nhà 28/09/2026: "sai logic — Khi sửa phiếu nhập kho bằng cách sửa hoá
--   đơn > Pos hỏi huỷ phiếu nhập kho -> ok huỷ, sửa phiếu nhập kho -> lập lại hoá đơn,
--   công nợ ghi nhận nhưng phiếu nhập kho mới lại ở trạng thái đã nhập kho? lẽ ra là
--   phiếu nhập kho mới ở trạng thái đang xử lý chứ ? Vì theo logic khi sửa hoá đơn hay
--   tạo hoá đơn -> phiếu nhập kho ở trạng thái đang xử lý".
--
-- Mig 210 nhánh 'lam_lai' huỷ phiếu nhập, rồi sau khi lập tờ mới GỌI `complete_return`
-- nhập kho lại luôn. Sai luật chung của phiếu tự sinh (mig 191): lập / sửa hóa đơn thì
-- công nợ trừ ngay, còn phiếu trả CHỈ TREO ở Chờ xử lý — nhập kho là việc của người
-- nhận hàng (chọn kho, chọn ngày nhập — mig 211).
--
-- CÁCH LÀM: bước sau-lập-lại chỉ còn gắn lại phiếu 'giu' (Không); phiếu 'lam_lai' (Có)
-- đã đi theo tờ mới ở Chờ xử lý qua đường phiếu chờ sẵn có — để yên ở đó.
-- ⚠ Hàm nội bộ SECURITY DEFINER — REVOKE (luật mig 166).
-- ====================================================================

CREATE OR REPLACE FUNCTION public._tra_da_nhap_sau_lap_lai(p_new_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_st  jsonb := NULLIF(current_setting('npp.tra_da_nhap_210', true), '')::jsonb;
  v_gan boolean := false;
  x     record;
BEGIN
  PERFORM set_config('npp.tra_da_nhap_210', '', true);
  PERFORM set_config('npp.giu_phieu_tu_lap', '', true); -- (mig 213)
  IF v_st IS NULL OR jsonb_array_length(v_st) = 0 THEN
    RETURN;
  END IF;

  FOR x IN SELECT * FROM jsonb_to_recordset(v_st) AS t(id uuid, lam text, zone text)
  LOOP
    IF x.lam = 'gan_lai' THEN
      UPDATE returns SET invoice_id = p_new_invoice_id WHERE id = x.id;
      v_gan := true;
    END IF;
    -- (mig 216) 'nhap_lai': KHÔNG nhập kho lại — phiếu nằm Chờ xử lý theo tờ mới.
  END LOOP;

  IF v_gan THEN
    PERFORM public._wf2b_recompute_receivable(p_new_invoice_id);
  END IF;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._tra_da_nhap_sau_lap_lai(uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 216: sửa HĐ chọn huỷ phiếu nhập → phiếu trả về Chờ xử lý' AS buoc,
       CASE WHEN position('complete_return' IN pg_get_functiondef('public._tra_da_nhap_sau_lap_lai(uuid)'::regprocedure)) = 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua;
