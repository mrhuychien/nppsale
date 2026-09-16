-- ====================================================================
-- 111 — Đổi TẤT CẢ sản phẩm đang có về thuế VAT 0%
-- ====================================================================
--
-- Cùng khuôn mẫu với mig 109, chỉ khác con số đích.
--
-- VÌ SAO CÓ CẢ 109 LẪN 111
--   109 đặt toàn bộ danh mục về 8%; ngay sau đó chủ NPP chốt lại là hàng
--   ở đây xuất KHÔNG kèm VAT, nên phải về 0%. Không sửa 109 và cũng không
--   xoá nó: migration là LỊCH SỬ, và hai máy đã chạy 109 rồi thì sửa file
--   cũ chỉ tạo ra lệch trạng thái. Chạy 109 xong rồi 111 hơi thừa một
--   nhịp nhưng ra đúng kết quả, và đọc lại là hiểu chuyện gì đã xảy ra.
--
-- ⚠ CÁI NÀY XOÁ THÔNG TIN. Sau khi chạy, không còn cách nào biết sản phẩm
--   nào từng ở 5% hay 10% — mig 109 đã gộp hết về 8% trước đó rồi. Đây là
--   quyết định của chủ NPP, ghi lại để khỏi ai tưởng là tai nạn.
--
-- CHỈ ĐỤNG BẢNG `products`. Đơn hàng, hoá đơn mua, phiếu trả đều ĐÓNG
-- thuế suất lên từng dòng lúc lập (order-form gọi `snapVat`), nên chứng
-- từ cũ giữ nguyên con số của ngày lập. Thay đổi này chỉ ảnh hưởng chứng
-- từ lập TỪ NAY.
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

  -- `IS DISTINCT FROM` chứ không phải `<> 0`.
  --
  -- ⚠ Sản phẩm có vat_rate RỖNG thì `vat_rate <> 0` trả về NULL, không
  -- phải TRUE — dòng đó bị bỏ qua, im lặng, và vẫn rỗng sau khi chạy. Cột
  -- này cho phép rỗng (mig 001 chỉ đặt DEFAULT, không NOT NULL) nên đây
  -- là ca có thật. Và rỗng KHÁC 0: rỗng là "chưa khai", 0 là "khai rằng
  -- không chịu thuế" — hai thứ đó không được lẫn vào nhau.
  UPDATE products SET vat_rate = 0
  WHERE vat_rate IS DISTINCT FROM 0;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RAISE NOTICE '--- Đã đổi % sản phẩm về 0%% ---', v_moved;

  -- Chốt chặn: sau khi chạy không được còn dòng nào khác 0. Còn sót nghĩa
  -- là có thứ gì đó ghi đè (trigger, quy tắc) và phải biết ngay, chứ
  -- không phải phát hiện vào lúc xuất hoá đơn cho khách.
  IF EXISTS (SELECT 1 FROM products WHERE vat_rate IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'Vẫn còn sản phẩm khác 0%% sau khi cập nhật — dừng, chưa ghi gì.';
  END IF;
END $$;
