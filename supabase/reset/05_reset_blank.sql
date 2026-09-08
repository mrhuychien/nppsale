-- =====================================================================
-- 05_reset_blank.sql — XOÁ SẠCH để bàn giao, giữ đúng 1 org + 1 owner
-- =====================================================================
-- ⚠ KHÔNG HOÀN TÁC ĐƯỢC. Bật PITR hoặc tạo snapshot thủ công trước khi
--   chạy (Supabase Dashboard → Database → Backups).
--
-- VÌ SAO CÓ FILE NÀY, TRONG KHI ĐÃ CÓ 01 + 02 + 04
--   Ba file kia liệt kê tên bảng BẰNG TAY. Đo được ngày 08/09/2026:
--   schema có 72 bảng, ba file kia chạm tới 40 — sót 32 bảng, trong đó
--   có toàn dữ liệu thật:
--
--     fifo_layers, fifo_consumptions      giá vốn từng lô
--     cash_receipts, cash_receipt_lines   phiếu thu
--     payroll_runs, payroll_run_items     bảng lương
--     driver_handovers + 2 bảng con       bàn giao tài xế
--     supplier_returns + bảng con         trả hàng NCC
--     misa_invoice_snapshots, einvoice_logs  hoá đơn điện tử
--     customer_photos                     ảnh điểm bán
--     qr_login_tokens                     mã đăng nhập của nhân viên
--     company_einvoice_config             TÀI KHOẢN MISA
--     order_activity_log, entity_locks, workflow_sessions, …
--
--   Không phải ai viết ẩu — danh sách viết tay thì cứ thêm một bảng mới
--   là nó lỗi thời thêm một chút, và không có gì báo. File này lật ngược
--   mặc định: XOÁ MỌI BẢNG, trừ danh sách giữ lại ghi rõ ở dưới. Bảng
--   thêm về sau tự động được xoá, không cần ai nhớ sửa file này.
--
-- GIỮ LẠI
--   • organizations  — đúng 1 dòng: org của owner bên dưới
--   • users          — đúng 1 dòng: chính owner đó
--   • auth.users     — dòng đăng nhập tương ứng
--   • storage.buckets — giữ 3 bucket (rỗng), vì migration tạo ra chúng
--   Vì sao không xoá nốt org + owner: màn /setup của app chỉ CẤU HÌNH một
--   org đã có, nó không tự dựng org từ số 0. Xoá sạch cả hai là khoá luôn
--   đường vào app, không còn cách nào đăng nhập để tạo lại.
--
-- XOÁ
--   • 70 bảng còn lại trong schema public
--   • mọi file trong storage (ảnh điểm bán, ảnh giao hàng, chữ ký)
--   • mọi tài khoản đăng nhập khác trong auth
--
-- SAU KHI CHẠY: chạy tiếp 03_reseed_defaults.sql để dựng lại tuyến bán
-- hàng / nhóm chi phí / hạn mức duyệt mặc định cho org còn lại.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  -- ⚠⚠ SỬA DÒNG NÀY trước khi chạy: email của tài khoản owner được giữ.
  keep_email  text := 'owner@nppsale.vn';

  keep_user   uuid;
  keep_org    uuid;
  wipe_list   text;
  wiped       int;
BEGIN
  ------------------------------------------------------------------
  -- 1. Xác định người được giữ. KHÔNG tìm thấy thì DỪNG, không xoá gì.
  ------------------------------------------------------------------
  -- Email nằm ở auth.users, KHÔNG ở public.users — bảng đó chỉ có
  -- `username`. (04_reset_auth_profile.sql cũ tra `users.email` nên hỏng
  -- ngay khi chạy; đo được trên bản dựng lại từ migration.)
  -- Hai bảng dùng CHUNG id, nên nối thẳng theo id.
  SELECT u.id, u.org_id INTO keep_user, keep_org
  FROM public.users u
  JOIN auth.users a ON a.id = u.id
  WHERE lower(a.email) = lower(keep_email);

  IF keep_user IS NULL THEN
    RAISE EXCEPTION
      'Không thấy tài khoản "%". DỪNG, chưa xoá gì. Chạy câu này để lấy '
      'đúng email: SELECT a.email, u.role, u.full_name FROM public.users u '
      'JOIN auth.users a ON a.id = u.id ORDER BY u.role;',
      keep_email;
  END IF;

  IF keep_org IS NULL THEN
    RAISE EXCEPTION
      'Tài khoản "%" không thuộc org nào (org_id NULL). DỪNG, chưa xoá gì. '
      'Sửa org_id cho tài khoản này trước đã, nếu không sau khi xoá sẽ '
      'không đăng nhập vào đâu được.',
      keep_email;
  END IF;

  RAISE NOTICE 'Giữ lại: user=% org=%', keep_user, keep_org;

  ------------------------------------------------------------------
  -- 2. Dựng danh sách bảng cần xoá TỪ CHÍNH SCHEMA, không viết tay.
  ------------------------------------------------------------------
  SELECT string_agg(format('public.%I', c.relname), ', ' ORDER BY c.relname),
         count(*)
  INTO wipe_list, wiped
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname NOT IN ('users', 'organizations');

  IF wipe_list IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy bảng nào trong schema public — schema chưa cài?';
  END IF;

  ------------------------------------------------------------------
  -- 3. Xoá.
  --
  -- CỐ Ý KHÔNG DÙNG `CASCADE`. Có CASCADE thì một khoá ngoại đi từ bảng
  -- ĐƯỢC GIỮ sang bảng bị xoá sẽ kéo luôn bảng được giữ đi theo — im
  -- lặng, và đúng thứ mình đang cố bảo vệ. Không CASCADE thì trường hợp
  -- đó báo lỗi và nêu tên bảng, để người chạy tự quyết.
  ------------------------------------------------------------------
  EXECUTE 'TRUNCATE TABLE ' || wipe_list || ' RESTART IDENTITY';
  RAISE NOTICE 'Đã xoá sạch % bảng.', wiped;

  DELETE FROM public.users        WHERE id <> keep_user;
  DELETE FROM public.organizations WHERE id <> keep_org;

  ------------------------------------------------------------------
  -- 4. File trong storage. Bảng SQL sạch mà ảnh còn nằm đó thì chưa
  --    gọi là bàn giao sạch — ảnh điểm bán có mặt tiền cửa hàng, ảnh
  --    giao hàng có chữ ký người nhận.
  --    Giữ lại bucket (rỗng): migration 101/103 tạo ra chúng.
  ------------------------------------------------------------------
  DELETE FROM storage.objects;

  ------------------------------------------------------------------
  -- 5. Tài khoản đăng nhập. Xoá identities trước rồi mới tới users —
  --    không phải bản Supabase nào cũng đặt ON DELETE CASCADE.
  ------------------------------------------------------------------
  DELETE FROM auth.identities WHERE user_id <> keep_user;
  DELETE FROM auth.users      WHERE id      <> keep_user;
END $$;

COMMIT;

-- =====================================================================
-- KIỂM LẠI — bảng nào còn dòng thì hiện ở đây. Đúng thì chỉ còn
-- organizations = 1 và users = 1.
--
-- ⚠ ĐẾM CHÍNH XÁC. Cột số-dòng-ước-lượng của pg_stat_user_tables chỉ
-- được cập nhật sau ANALYZE, nên chạy ngay sau reset thì nó vẫn đọc ra
-- số CŨ. Bản đầu của file này dùng cột đó và báo "7 bảng còn dòng" trong
-- khi cả 7 đã sạch: một câu kiểm lại mà nói sai còn tệ hơn không kiểm, vì
-- nó làm người chạy tưởng lệnh xoá hỏng.
-- (Test tests/handover.test.ts cấm nhắc tên cột đó trong file này.)
-- =====================================================================
SELECT bang, so_dong
FROM (
  SELECT
    c.relname AS bang,
    (xpath(
      '/row/c/text()',
      query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')
    ))[1]::text::bigint AS so_dong
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
) t
WHERE so_dong > 0
ORDER BY so_dong DESC, bang;
