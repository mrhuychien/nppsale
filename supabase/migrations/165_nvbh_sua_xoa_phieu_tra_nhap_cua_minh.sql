-- ====================================================================
-- NVBH SỬA / XOÁ ĐƯỢC PHIẾU TRẢ NHÁP CỦA CHÍNH MÌNH
--
-- Rơi ra trong lúc rà soát 22/09/2026: đối chiếu từng phép ghi của giao
-- diện với chính sách RLS của đúng phép ấy.
--
-- ⚠ ĐÃ ĐO TRÊN POSTGRES 16 THẬT, đăng nhập bằng NVBH, đi đúng đường sửa
--   đơn kèm hàng trả của màn bán hàng:
--
--     [1] NVBH lập đơn nháp kèm phiếu trả nháp:  ĐƯỢC
--     [2] sửa lý do phiếu trả CỦA MÌNH:          0 dòng
--     [3] bỏ hết dòng trả:                        1 dòng
--     [4] xoá phiếu trả rỗng CỦA MÌNH:           0 dòng
--
--   Bước 3 ghi xong, bước 4 bị chặn. Kết quả: một PHIẾU TRẢ RỖNG nằm lại
--   trong sổ, và màn hình báo "Đã lưu đơn nhưng KHÔNG xoá được phiếu trả
--   cũ". Lý do trả sửa ở bước 2 thì không bao giờ xuống sổ.
--
-- ⚠ VÌ SAO LỌT: `returns` có chính sách TẠO cho NVBH ("Sales can create
--   returns") và SỬA chỉ cho chủ/quản lý ("Owner/Manager can approve
--   returns"), còn XOÁ thì KHÔNG có chính sách nào cả. `return_lines`
--   thì cho NVBH làm mọi thứ. Nên NVBH xoá được dòng nhưng không xoá
--   được đầu phiếu — đúng khuôn một lần ghi nửa chừng.
--
-- ⚠ LUẬT NÀY ĐÃ CÓ SẴN CHO ĐƠN HÀNG, CHỈ BỊ QUÊN CHO PHIẾU TRẢ.
--   `sales_orders` có "Sales can update own open orders" và "Sales can
--   delete own draft orders" từ mig 115/117. Phiếu trả kèm đơn là một
--   phần của CÙNG một đơn nháp, do CÙNG người lập, trong CÙNG một màn —
--   nên nó phải theo cùng một luật. Migration này chép đúng khuôn ấy,
--   không nới gì hơn.
--
-- ⚠ CHỈ PHIẾU NHÁP, VÀ CỔNG `WITH CHECK` CŨNG ĐÒI NHÁP. Phiếu trả kèm
--   đơn luôn được TẠO ở `draft` (`src/lib/orders/create.ts`) và chỉ rời
--   `draft` qua RPC `complete_return` (SECURITY DEFINER). Nên NVBH không
--   bao giờ cần tự đổi trạng thái. Đòi `status = 'draft'` ở cả hai cổng
--   là để NVBH KHÔNG tự đẩy phiếu sang `completed` rồi né phép hoàn kho
--   và ghi công nợ của RPC.
--
-- ⚠ VÀ `WITH CHECK` ĐÒI CHÍNH MÌNH. Không có vế ấy thì NVBH sửa được
--   `sales_user_id` sang tên đồng nghiệp — hoa hồng trừ hàng trả rơi vào
--   người khác. (Trigger `guard_return_sales_user` của mig 160 cũng canh
--   chuyện này; hai lớp là cố ý, cùng nếp mig 153 với đơn hàng.)
--
-- ⚠ ĐÁNH SỐ 165, TRÊN `newdesign` TRƯỚC. Chủ nhà chốt 22/09/2026: thử kỹ
--   ở nhánh ấy rồi mới đưa lên sản xuất. Lỗi này CÓ trên sản xuất; lúc
--   đưa lên thì mang nguyên tệp, cùng số, để hai nhánh không lệch nhau
--   thêm lần nữa.
-- ====================================================================

DROP POLICY IF EXISTS "Sales can update own draft returns" ON returns;
CREATE POLICY "Sales can update own draft returns"
  ON returns FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status = 'draft'
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "Sales can delete own draft returns" ON returns;
CREATE POLICY "Sales can delete own draft returns"
  ON returns FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status = 'draft'
  );

-- ---------------------------------------------------------------------
-- Tự kiểm — hai chính sách đứng đúng chỗ và đòi đủ bốn vế
-- ---------------------------------------------------------------------
DO $kiem$
DECLARE r record; v_thieu text := '';
BEGIN
  FOR r IN
    SELECT p.polname,
           coalesce(pg_get_expr(p.polqual, p.polrelid), '') AS u,
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS c,
           p.polcmd
    FROM pg_policy p
    WHERE p.polrelid = 'returns'::regclass
      AND p.polname IN ('Sales can update own draft returns', 'Sales can delete own draft returns')
  LOOP
    IF position('org_id' in r.u) = 0 OR position('auth.uid()' in r.u) = 0
       OR position('''draft''' in r.u) = 0 THEN
      v_thieu := v_thieu || format(E'\n  · "%s": USING thiếu vế org / chính mình / nháp', r.polname);
    END IF;
    IF r.polcmd = 'w' AND (position('auth.uid()' in r.c) = 0 OR position('''draft''' in r.c) = 0) THEN
      v_thieu := v_thieu || format(E'\n  · "%s": WITH CHECK thiếu vế chính mình / nháp', r.polname);
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'returns'::regclass
        AND polname IN ('Sales can update own draft returns', 'Sales can delete own draft returns')) <> 2 THEN
    v_thieu := v_thieu || E'\n  · không đủ hai chính sách';
  END IF;

  IF v_thieu <> '' THEN
    RAISE EXCEPTION '165: chính sách phiếu trả của NVBH dựng sai:%', v_thieu USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '--- 165: NVBH sửa / xoá được phiếu trả NHÁP của chính mình, không hơn ---';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — thứ DUY NHẤT trình soạn SQL của Supabase hiện ra
-- ---------------------------------------------------------------------
--
-- Mọi chính sách GHI trên `returns` sau migration này, và ai được làm
-- gì. Chạy lại bao nhiêu lần cũng được.
SELECT p.polname AS chinh_sach,
       CASE p.polcmd WHEN '*' THEN 'ALL' WHEN 'a' THEN 'INSERT'
                     WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END AS lenh,
       left(regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid),
                                    pg_get_expr(p.polwithcheck, p.polrelid)), '\s+', ' ', 'g'), 160) AS dieu_kien
FROM pg_policy p
WHERE p.polrelid = 'returns'::regclass AND p.polcmd IN ('*', 'a', 'w', 'd')
ORDER BY 2, 1;
