-- =====================================================================
-- Migration 102: công nợ ĐẦU KỲ cho khách hàng và nhà cung cấp
-- =====================================================================
-- Trước đây `receivables` chỉ sinh ra từ đơn đã giao, `payables` từ phiếu
-- nhập. Số dư mang sang từ sổ cũ không có chỗ đứng, nên NPP mới lên hệ
-- thống hoặc phải bịa đơn hàng giả (bẩn tồn kho + doanh số), hoặc bỏ hẳn
-- công nợ cũ ra ngoài phần mềm.
--
-- KHÔNG tạo bảng mới. Công nợ đầu kỳ VẪN LÀ công nợ: mọi báo cáo tuổi nợ,
-- màn thu tiền, tổng nợ theo khách đều đã đọc hai bảng này. Tách sang
-- bảng riêng là buộc phải sửa lại từng chỗ đó, và chỗ nào quên sẽ báo
-- thiếu tiền mà không ai biết.
--
-- Chỉ thêm một CỜ để phân biệt và một chỉ mục để mỗi đối tượng có đúng
-- MỘT dòng đầu kỳ — nhờ đó nhập lại file là cập nhật, không nhân bản.

-- ---------------------------------------------------------------------
-- 1. Cột
-- ---------------------------------------------------------------------
ALTER TABLE receivables
  ADD COLUMN IF NOT EXISTS opening_balance boolean NOT NULL DEFAULT false,
  -- receivables chưa hề có cột ghi chú. Dòng đầu kỳ cần nói rõ "chốt sổ
  -- ngày nào", nếu không thì sang năm không ai giải thích được con số.
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE payables
  ADD COLUMN IF NOT EXISTS opening_balance boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- 2. Mỗi đối tượng đúng MỘT dòng đầu kỳ
-- ---------------------------------------------------------------------
-- Chỉ mục BỘ PHẬN (chỉ áp lên dòng đầu kỳ): công nợ thường thì một khách
-- có bao nhiêu dòng cũng được, ràng buộc này không được đụng tới chúng.
CREATE UNIQUE INDEX IF NOT EXISTS uq_receivables_opening
  ON receivables (org_id, customer_id)
  WHERE opening_balance;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payables_opening
  ON payables (org_id, supplier_id)
  WHERE opening_balance;

-- ---------------------------------------------------------------------
-- 3. Tra cứu nhanh khi màn nhập liệu nạp danh sách đang có
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_receivables_opening
  ON receivables (org_id) WHERE opening_balance;
CREATE INDEX IF NOT EXISTS idx_payables_opening
  ON payables (org_id) WHERE opening_balance;

-- ---------------------------------------------------------------------
-- 4. RLS: NVBH không được tạo công nợ đầu kỳ
-- ---------------------------------------------------------------------
-- Policy cũ cho 'sales' chèn receivables (đúng — màn tạo đơn cần thế).
-- Nhưng công nợ đầu kỳ là việc chốt sổ của kế toán: mở cho NVBH nghĩa là
-- một người bán hàng có thể tự ghi cho khách của mình một khoản nợ đầu
-- kỳ. Siết lại đúng một vế, phần còn lại giữ nguyên hành vi cũ (đơn hàng
-- sinh receivable với opening_balance = false nên vẫn qua).
DROP POLICY IF EXISTS "Authorized roles can create receivables" ON receivables;
CREATE POLICY "Authorized roles can create receivables"
  ON receivables FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'accountant')
      OR (public.user_role() = 'sales' AND opening_balance = false)
    )
  );

-- Xoá: trước đây KHÔNG có policy DELETE trên receivables, nghĩa là không
-- ai xoá được dòng nào qua RLS. Màn nhập cần xoá được dòng ĐẦU KỲ (điền
-- số 0) — mở đúng phạm vi đó, không mở cho công nợ sinh từ đơn hàng.
DROP POLICY IF EXISTS "Accountant can delete opening receivables" ON receivables;
CREATE POLICY "Accountant can delete opening receivables"
  ON receivables FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'accountant')
    AND opening_balance
  );

-- payables đã có policy "Manage payables" FOR ALL cho owner/accountant —
-- đủ cho cả tạo, sửa lẫn xoá dòng đầu kỳ. Không đụng vào.
