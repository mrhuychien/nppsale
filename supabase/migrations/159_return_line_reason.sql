-- ====================================================================
-- LÝ DO TRẢ HÀNG THEO TỪNG DÒNG
--
-- Chủ nhà chốt 22/09/2026: "tôn trọng tuyệt đối thiết kế tao đưa".
-- Bản thiết kế vẽ khối "Hàng đổi trả kèm đơn" với một cột "Lý do" và
-- một ô chọn riêng TRÊN TỪNG DÒNG.
--
-- VÌ SAO PHẢI THÊM CỘT
--
--   Sổ hiện tại chỉ có lý do cho CẢ PHIẾU: `returns.reason` (mig 001,
--   kèm CHECK năm giá trị). `return_lines` không có cột nào cho việc
--   này. Vẽ một ô chọn trên mỗi dòng rồi lưu tất cả vào một ô duy nhất
--   là màn hình nói dối: người dùng đặt "hàng hư hỏng" cho dòng 1 và
--   "gần hết hạn" cho dòng 2, lưu xong mở lại thấy cả hai thành một.
--
--   Đây là một mâu thuẫn THẬT giữa bản vẽ và sổ, không phải chuyện
--   trình bày. Hai đường đi: bỏ cột Lý do khỏi bản vẽ, hoặc cho sổ chỗ
--   để ghi. Chủ nhà đã chốt bám bản vẽ, nên chọn đường thứ hai.
--
-- ⚠ CÙNG BỘ GIÁ TRỊ VỚI `returns.reason`, CÙNG MỘT CHECK. Hai cột cùng
--   nghĩa mà khác tập giá trị là chỗ để dữ liệu lệch nhau âm thầm; màn
--   hình đọc `RETURN_REASONS` trong `src/lib/constants.ts`, và năm giá
--   trị dưới đây phải khớp đúng danh sách ấy.
--
-- ⚠ CHO PHÉP RỖNG, KHÔNG ĐẶT MẶC ĐỊNH. Mọi dòng đang có trong sổ được
--   lập khi màn hình chưa hỏi lý do từng dòng — gán đại một giá trị cho
--   chúng là bịa ra một lý do chưa ai nói. Rỗng đọc đúng là "chưa ghi",
--   và màn hình hiện lý do của cả phiếu khi dòng chưa có lý do riêng.
--
-- ⚠ KHÔNG ĐỤNG `returns.reason`. Nó vẫn là lý do của cả phiếu, vẫn là
--   thứ `complete_return` và các báo cáo đang đọc. Bản vá này chỉ THÊM
--   một tầng chi tiết hơn bên dưới nó.
--
-- ⚠ ĐÁNH SỐ 159. Nhánh này đang giữ 156 và 157; nhánh `main` vừa lấy
--   158. Trùng số là hai tệp cùng số sau khi gộp, và
--   `scripts/build-combined-migration.sh` hết cơ sở để xếp thứ tự.
-- ====================================================================

ALTER TABLE return_lines
  ADD COLUMN IF NOT EXISTS reason text;

-- ⚠ `DROP … IF EXISTS` TRƯỚC `ADD` — chạy lại lần hai không được nổ.
ALTER TABLE return_lines
  DROP CONSTRAINT IF EXISTS return_lines_reason_check;
ALTER TABLE return_lines
  ADD CONSTRAINT return_lines_reason_check
  CHECK (reason IS NULL OR reason IN ('damaged','wrong_item','near_expiry','expired','refused'));

COMMENT ON COLUMN return_lines.reason IS
  'Lý do trả của RIÊNG dòng này. Rỗng = chưa ghi, màn hình rơi về '
  'returns.reason của cả phiếu. Cùng bộ giá trị với returns.reason.';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM return_lines WHERE reason IS NULL;
  RAISE NOTICE '--- 159: lý do trả theo dòng · % dòng cũ chưa có lý do riêng, đọc theo lý do của phiếu ---', v_n;
END $$;

NOTIFY pgrst, 'reload schema';
