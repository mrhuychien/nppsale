-- ====================================================================
-- TIỀN ĐÃ THU MÀ CÔNG NỢ CHƯA TRỪ — ĐỐI SOÁT VÀ VÁ SỔ
--
-- Rơi ra trong lúc rà soát toàn bộ workflow 22/09/2026.
--
-- ⚠ ĐÃ ĐO TRÊN POSTGRES 16 THẬT, đăng nhập bằng NVBH đúng người phụ
--   trách đơn, chạy đúng hai lệnh mà màn Thu tiền chạy:
--
--     [1] NVBH ghi phiếu thu 100.000 → ĐƯỢC
--     [2] trừ vào công nợ: UPDATE trả về 0 dòng, KHÔNG ném lỗi
--
--     phai_thu | da_thu | status | tien_da_ghi_phieu
--       800000 |      0 |  open  |            100000
--
--   Khách trả 100.000đ. Phiếu thu có. Công nợ vẫn nguyên. Màn hình báo
--   "Đã thu 100.000". Lần sau khách bị đòi lại đúng số đã trả.
--
-- ⚠ VÌ SAO LỌT: hai chính sách lệch nhau.
--     · `payments` INSERT: owner, accountant, sales, driver
--     · `receivables` UPDATE: owner, accountant
--   NVBH chèn được phiếu thu nhưng không sửa được công nợ. Mà RLS từ
--   chối là LỌC chứ không ném — 0 dòng, HTTP 200, `error` null. Màn
--   hình gác bằng `.throwOnError()`, thứ chỉ ném khi CÓ `error`.
--
-- ⚠ CHÚ THÍCH TRONG CHÍNH ĐOẠN MÃ ẤY ĐÃ ĐOÁN ĐÚNG HẬU QUẢ: "Payment đã
--   ghi ở trên. Nếu bước này hỏng mà bỏ qua thì tiền đã thu nhưng công
--   nợ vẫn nguyên → khách bị đòi lại số đã trả." Người viết thấy rủi
--   ro, chọn `.throwOnError()`, và `.throwOnError()` không làm việc ấy.
--
-- ĐƯỜNG ĐI TỚI ĐƯỢC: menu điện thoại của NVBH → Công nợ → Thu tiền;
-- và màn chi tiết công nợ. Trang Trợ giúp còn dặn NVBH làm đúng thế.
--
-- ĐÃ SỬA Ở GIAO DIỆN: hai màn ấy nay đi qua RPC `create_cash_receipt`
-- (`SECURITY DEFINER`, một giao dịch, gác bằng quyền `receivables.create`
-- mà NVBH có). Đo lại bằng chính NVBH: paid 0 → 200.000, trạng thái
-- `partial`, thu vượt số còn nợ bị chặn kèm câu đọc được.
--
-- ⚠ NHƯNG SỬA GIAO DIỆN KHÔNG VÁ ĐƯỢC SỔ ĐÃ SAI. Lỗi chạy bao lâu thì
--   sổ lệch bấy nhiêu, và không có gì đánh dấu. Migration này đi tìm.
--
-- ─── BẤT BIẾN DÙNG ĐỂ TÌM ───────────────────────────────────────────
--
--   receivables.paid  ==  tổng payments.amount của chính nó
--
-- ⚠ BẤT BIẾN NÀY ĐÚNG VÌ `void_cash_receipt` XOÁ HẲN DÒNG `payments`
--   rồi mới trừ `paid` — huỷ phiếu thu bỏ cả hai vế, không để lại dòng
--   mồ côi. Đã đo trên bản dựng đủ 163 migration: đúng 1 dòng lệch, và
--   đó là dòng tôi cố ý làm hỏng để dựng lại lỗi.
--
-- ⚠ CHỈ VÁ MỘT CHIỀU. `tổng phiếu thu > paid` là đúng dấu vết của lỗi
--   này: tiền đã cầm, sổ chưa ghi. Chiều ngược lại (`paid > tổng phiếu
--   thu`) KHÔNG phải dấu vết của nó — nó có nghĩa sổ đang ghi nhiều hơn
--   số phiếu thu, mà migration này không biết vì sao. Đoán bừa ở đó là
--   tự tay xoá tiền của ai đó. Báo ra, không đụng.
--
-- ⚠ KHÔNG KẸP `paid` THEO `amount`. Từ Q11 một khoản có thể thu dư và
--   phần dư thành số dư có của khách; kẹp lại là nuốt mất phần ấy.
--   Trạng thái tính lại bằng ĐÚNG khối CASE của `void_cash_receipt`,
--   chép nguyên để hai chỗ không thể lệch nhau.
--
-- ⚠ TRÌNH SOẠN SQL CỦA SUPABASE KHÔNG HIỆN `RAISE NOTICE`. Nó chỉ hiện
--   BẢNG KẾT QUẢ. Bản đầu của migration này báo cáo hoàn toàn bằng
--   NOTICE, nên chủ nhà chạy xong chỉ thấy "Success. No rows returned"
--   và không biết sổ vừa được vá bao nhiêu đồng — con số ấy đi vào hư
--   không, và chạy lại cũng không lấy lại được vì migration idempotent.
--   Lỗi của tôi. Nay tệp KẾT THÚC BẰNG MỘT CÂU SELECT trả về bảng tóm
--   tắt, còn NOTICE giữ nguyên cho người chạy bằng psql/CI.
--
-- ⚠ ĐÁNH SỐ 164. `main` giữ 158, 160, 162, 163; `newdesign` giữ 156,
--   157, 159, 161.
-- ====================================================================

DO $doi_soat$
DECLARE
  r        record;
  v_vá     int := 0;
  v_tien   numeric := 0;
  v_nguoc  int := 0;
  v_bao    text := '';
BEGIN
  -- ── Chiều NGƯỢC: báo, không đụng ──────────────────────────────────
  FOR r IN
    SELECT rc.id, rc.amount, rc.paid, COALESCE(sum(p.amount), 0) AS tong
    FROM receivables rc
    LEFT JOIN payments p ON p.receivable_id = rc.id
    GROUP BY rc.id, rc.amount, rc.paid
    HAVING COALESCE(sum(p.amount), 0) < COALESCE(rc.paid, 0)
    ORDER BY rc.id
  LOOP
    v_nguoc := v_nguoc + 1;
    IF v_nguoc <= 20 THEN
      v_bao := v_bao || format(E'\n  · %s: sổ ghi đã thu %s nhưng phiếu thu chỉ có %s',
                               r.id, r.paid, r.tong);
    END IF;
  END LOOP;

  IF v_nguoc > 0 THEN
    RAISE WARNING
      '164: % khoản công nợ ghi ĐÃ THU NHIỀU HƠN tổng phiếu thu. Không phải dấu vết của lỗi này nên KHÔNG đụng tới — cần người xem:%',
      v_nguoc, v_bao;
  END IF;

  -- ── Chiều THUẬN: tiền đã cầm, sổ chưa ghi. Vá. ────────────────────
  FOR r IN
    SELECT rc.id, rc.amount, rc.paid, rc.due_date, COALESCE(sum(p.amount), 0) AS tong
    FROM receivables rc
    LEFT JOIN payments p ON p.receivable_id = rc.id
    GROUP BY rc.id, rc.amount, rc.paid, rc.due_date
    HAVING COALESCE(sum(p.amount), 0) > COALESCE(rc.paid, 0)
    ORDER BY rc.id
  LOOP
    UPDATE receivables
    SET paid = r.tong,
        status = CASE
                   WHEN r.tong >= COALESCE(r.amount, 0) THEN 'paid'
                   WHEN r.tong = 0
                     THEN CASE WHEN r.due_date IS NOT NULL AND r.due_date < current_date
                               THEN 'overdue' ELSE 'open' END
                   ELSE 'partial'
                 END
    WHERE id = r.id;

    v_vá   := v_vá + 1;
    v_tien := v_tien + (r.tong - COALESCE(r.paid, 0));
    RAISE NOTICE '164: công nợ % · đã thu % → % (thêm %)',
      r.id, r.paid, r.tong, r.tong - COALESCE(r.paid, 0);
  END LOOP;

  RAISE NOTICE
    '--- 164: đối soát tiền đã thu · vá % khoản, tổng % đồng khách đã trả mà sổ chưa ghi · % khoản lệch chiều ngược cần người xem ---',
    v_vá, v_tien, v_nguoc;
END;
$doi_soat$;

-- ---------------------------------------------------------------------
-- Tự kiểm — sau khi vá, bất biến phải đúng ở chiều thuận
-- ---------------------------------------------------------------------
--
-- ⚠ KIỂM LẠI TRÊN DỮ LIỆU THẬT, ĐỪNG TIN VÒNG LẶP VỪA CHẠY. Một
--   trigger nào đó trên `receivables` có thể ghi đè lại giá trị vừa
--   đặt, và khi ấy migration báo "đã vá N khoản" trong khi sổ không đổi
--   một đồng — đúng loại im lặng mà migration này đang đi sửa.
DO $kiem$
DECLARE v_con int;
BEGIN
  SELECT count(*) INTO v_con FROM (
    SELECT rc.id
    FROM receivables rc
    LEFT JOIN payments p ON p.receivable_id = rc.id
    GROUP BY rc.id, rc.paid
    HAVING COALESCE(sum(p.amount), 0) > COALESCE(rc.paid, 0)
  ) x;

  IF v_con > 0 THEN
    RAISE EXCEPTION
      '164: vá xong mà vẫn còn % khoản có tiền đã thu chưa ghi vào sổ — có thứ gì đó ghi đè lại. Dừng để người xem.',
      v_con
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '164: không còn khoản nào có phiếu thu vượt số đã ghi trong sổ.';
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — thứ DUY NHẤT trình soạn SQL của Supabase hiện ra
-- ---------------------------------------------------------------------
--
-- ⚠ CHẠY LẠI TỆP NÀY LÚC NÀO CŨNG AN TOÀN, và chạy lại là cách đọc
--   được bảng này. Hai dòng đầu phải bằng 0 sau khi vá; dòng thứ ba là
--   TRẦN TRÊN của thiệt hại lỗi có thể đã gây ra — số tiền NVBH / tài
--   xế từng thu, tức đúng những lần mà bản cũ của màn Thu tiền sẽ ghi
--   phiếu nhưng không trừ được công nợ.
SELECT
  'Còn lệch chiều THUẬN (tiền đã thu mà sổ chưa ghi)'      AS hang_muc,
  count(*)::text                                           AS so_khoan,
  coalesce(sum(x.tong - x.paid), 0)::text                  AS so_tien
FROM (
  SELECT rc.id, coalesce(rc.paid, 0) AS paid, coalesce(sum(p.amount), 0) AS tong
  FROM receivables rc LEFT JOIN payments p ON p.receivable_id = rc.id
  GROUP BY rc.id, rc.paid
  HAVING coalesce(sum(p.amount), 0) > coalesce(rc.paid, 0)
) x
UNION ALL
SELECT
  'Còn lệch chiều NGƯỢC (sổ ghi nhiều hơn phiếu thu) — CẦN NGƯỜI XEM',
  count(*)::text,
  coalesce(sum(x.paid - x.tong), 0)::text
FROM (
  SELECT rc.id, coalesce(rc.paid, 0) AS paid, coalesce(sum(p.amount), 0) AS tong
  FROM receivables rc LEFT JOIN payments p ON p.receivable_id = rc.id
  GROUP BY rc.id, rc.paid
  HAVING coalesce(sum(p.amount), 0) < coalesce(rc.paid, 0)
) x
UNION ALL
SELECT
  'Phiếu thu do NVBH / tài xế thu — TRẦN TRÊN của thiệt hại đã có',
  count(DISTINCT p.receivable_id)::text,
  coalesce(sum(p.amount), 0)::text
FROM payments p JOIN users u ON u.id = p.collected_by
WHERE u.role IN ('sales', 'driver')
UNION ALL
SELECT 'Tổng phiếu thu trong sổ', count(*)::text, coalesce(sum(amount), 0)::text
FROM payments;
