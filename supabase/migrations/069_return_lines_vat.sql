-- ====================================================================
-- return_lines.vat_rate — cho phép NV chọn thuế VAT cho mỗi dòng hàng
-- trả lại (giống dòng bán). Mặc định 0 (rows cũ + handover auto = 0%).
--
-- Quy ước: vat_rate lưu dạng phân số (0, 0.05, 0.08, 0.10 — chuẩn VN).
-- line_total = qty × unit_price × (1 + vat_rate) — gross, đã gồm VAT.
-- Trigger sync_return_credit_amount (mig 035) tổng line_total nên
-- credit_note_amount sẽ tự gồm VAT mà không cần đổi trigger.
-- ====================================================================

ALTER TABLE return_lines
  ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN return_lines.vat_rate IS
  'Thuế VAT của dòng hàng trả (phân số 0-1, vd 0.10 = 10%). line_total đã gồm VAT.';
