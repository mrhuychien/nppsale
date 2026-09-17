-- ---------------------------------------------------------------------
-- 117 — NVBH xoá được đơn NHÁP của chính mình
-- ---------------------------------------------------------------------
--
-- Màn "Đơn tạm" có nút Xoá. Nhưng chính sách xoá duy nhất hiện nay (mig
-- 113) chỉ cho owner/manager, nên NVBH bấm Xoá sẽ rơi vào đúng cái bẫy đã
-- gặp hai lần trong dự án này: RLS từ chối thì Postgres xoá 0 dòng,
-- PostgREST trả HTTP 200 và `error` là null — màn hình báo "đã xoá", tải
-- lại trang thì đơn vẫn nằm đó.
--
-- ⚠ CHỈ `draft`, CHỈ ĐƠN CỦA MÌNH. Đơn đã duyệt thì kho có thể đang soạn
-- hàng; đơn của người khác thì không phải việc của mình. Hai vế đó khớp
-- đúng phạm vi SỬA mà migration 115 đã mở — xoá không được rộng hơn sửa.
--
-- KHÔNG đụng tới chính sách của owner/manager ở mig 113.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Sales can delete own draft orders" ON sales_orders;

CREATE POLICY "Sales can delete own draft orders"
  ON sales_orders FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status = 'draft'
  );

COMMENT ON POLICY "Sales can delete own draft orders" ON sales_orders IS
  'NVBH bỏ đơn nháp của chính mình (màn Đơn tạm). Hẹp hơn quyền sửa ở '
  'mig 115 đúng một bậc: sửa được cả draft lẫn confirmed, xoá thì chỉ draft.';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM sales_orders WHERE status = 'draft';
  RAISE NOTICE '--- Có % đơn nháp; NVBH phụ trách nay xoá được đơn của mình ---', v_n;
END $$;
