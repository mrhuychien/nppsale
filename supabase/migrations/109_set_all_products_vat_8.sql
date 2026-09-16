-- ====================================================================
-- 109 — Đổi TẤT CẢ sản phẩm đang có về thuế VAT 8%
-- ====================================================================
--
-- Mig 108 cố ý KHÔNG làm việc này: nó chỉ đổi mặc định cho dòng mới, vì
-- một sản phẩm đang để 10% có thể là do mặc định cũ (nên đổi) hoặc do
-- người ta cố ý khai (không được đổi), và hai trường hợp đó nhìn giống
-- hệt nhau trong cơ sở dữ liệu.
--
-- Chủ NPP đã nghe điều đó và quyết: đổi hết. Migration này ghi lại quyết
-- định ấy thành một bước có thể chạy lại và lần ra được, thay vì một câu
-- SQL gõ tay trong SQL Editor rồi không ai nhớ đã chạy chưa.
--
-- ⚠ ĐỔI HẾT NGHĨA LÀ ĐỔI CẢ HÀNG ĐANG ĐỂ 0%. Nếu trong danh mục có mặt
--   hàng không chịu thuế, nó cũng bị kéo lên 8%. Phần NOTICE dưới đây in
--   ra bảng phân bố TRƯỚC khi đổi, nên nhìn log là biết có bao nhiêu dòng
--   0% vừa bị động tới và đưa lại được.
--
-- CHỈ ĐỤNG BẢNG `products`. Đơn hàng, hoá đơn mua, phiếu trả đều ĐÓNG
-- thuế suất lên từng dòng lúc lập (order-form.tsx gọi `snapVat(...)`),
-- nên chứng từ cũ giữ nguyên con số của ngày lập — đúng như phải thế.
-- Thay đổi này chỉ ảnh hưởng chứng từ lập TỪ NAY.
-- ====================================================================

DO $$
DECLARE
  r       record;
  v_moved int;
BEGIN
  RAISE NOTICE '--- Thuế VAT TRƯỚC khi đổi ---';
  FOR r IN
    SELECT COALESCE(vat_rate::text, '(trống)') AS muc, count(*) AS so_dong
    FROM products
    GROUP BY vat_rate
    ORDER BY vat_rate NULLS FIRST
  LOOP
    RAISE NOTICE '  % → % sản phẩm', r.muc, r.so_dong;
  END LOOP;

  -- `IS DISTINCT FROM` chứ không phải `<> 0.08`.
  --
  -- ⚠ Sản phẩm có vat_rate RỖNG thì `vat_rate <> 0.08` trả về NULL, không
  -- phải TRUE — dòng đó bị bỏ qua, im lặng, và vẫn rỗng sau khi chạy.
  -- Cột này cho phép rỗng (mig 001 chỉ đặt DEFAULT, không NOT NULL), nên
  -- đây là ca có thật chứ không phải lo xa.
  UPDATE products SET vat_rate = 0.08
  WHERE vat_rate IS DISTINCT FROM 0.08;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RAISE NOTICE '--- Đã đổi % sản phẩm về 8%% ---', v_moved;

  -- Chốt chặn: sau khi chạy thì không được còn dòng nào khác 8%. Nếu còn,
  -- có thứ gì đó đang ghi đè (trigger, quy tắc) và phải biết ngay, chứ
  -- không phải phát hiện vào lúc xuất hoá đơn.
  IF EXISTS (SELECT 1 FROM products WHERE vat_rate IS DISTINCT FROM 0.08) THEN
    RAISE EXCEPTION 'Vẫn còn sản phẩm khác 8%% sau khi cập nhật — dừng, chưa ghi gì.';
  END IF;
END $$;
