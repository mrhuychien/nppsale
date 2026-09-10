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
  -- ⚠⚠ CHỌN MỘT TRONG HAI, sửa ngay đây trước khi chạy:
  --
  --   true  — GIỮ 1 org + 1 owner (điền keep_email bên dưới).
  --           Bàn giao xong đăng nhập được ngay bằng tài khoản đó.
  --
  --   false — TRẮNG TINH: 0 org, 0 người dùng, 0 tài khoản đăng nhập.
  --           Người nhận tự tạo tài khoản ở Supabase Dashboard rồi chạy
  --           supabase/bootstrap_owner.sql để dựng NPP của họ.
  --           ⚠ Ở chế độ này KHÔNG còn đường đăng nhập nào cho tới khi
  --           chạy bootstrap — app sẽ đá về /login, vì user_org_id() trả
  --           NULL nên mọi policy RLS chặn hết. Đó là đúng ý đồ, không
  --           phải hỏng.
  keep_owner  boolean := true;

  -- Chỉ dùng khi keep_owner = true.
  keep_email  text := 'owner@nppsale.vn';

  -- ⚠ TẨY DANH TÍNH NPP CŨ. Chỉ có tác dụng khi keep_owner = true.
  --
  -- Giữ dòng `organizations` lại là giữ luôn TÊN CÔNG TY CŨ, và
  -- `settings` của nó chứa MÃ SỐ THUẾ, ĐỊA CHỈ, ĐIỆN THOẠI, EMAIL của
  -- nhà phân phối cũ. Bàn giao mà để nguyên thì người nhận mở app ra thấy
  -- tên và mã số thuế của người khác — và tệ hơn, hoá đơn/phiếu in ra
  -- mang thông tin đó.
  --
  -- Bật (true) thì: đổi tên org về chỗ trống, xoá sạch `settings` (kể cả
  -- cờ `setup_completed_at`, nên màn /setup hiện lại để chủ mới nhập
  -- thông tin của họ), và xoá tên/điện thoại/username của chủ cũ.
  -- Tài khoản đăng nhập (email + mật khẩu) GIỮ NGUYÊN — đó là thứ đang
  -- cần giữ để còn vào được app.
  --
  -- Tắt (false) khi đây là môi trường của chính bạn và bạn chỉ muốn dọn
  -- dữ liệu giao dịch, không muốn khai báo lại thông tin công ty.
  scrub_identity boolean := true;

  new_org_name  text := 'Nhà phân phối (chưa đặt tên)';
  new_org_slug  text := 'npp';
  new_owner_name text := 'Chủ nhà phân phối';

  keep_user   uuid;
  keep_org    uuid;
  wipe_list   text;
  wiped       int;
  files_left  bigint;
BEGIN
  ------------------------------------------------------------------
  -- 0. File trong Storage phải được dọn TRƯỚC, bằng Storage API.
  --
  -- ⚠ KHÔNG XOÁ ĐƯỢC BẰNG SQL. Supabase chặn thẳng:
  --     ERROR 42501: Direct deletion from storage tables is not allowed.
  --                  Use the Storage API instead.
  -- Trigger storage.protect_delete() dựng ra để tránh chuyện xoá dòng
  -- trong storage.objects mà file thật vẫn nằm lại trên S3 — hàng trong
  -- kho không ai biết, không ai dọn được nữa.
  --
  -- Chặn ở ĐÂY, trước mọi thao tác xoá, vì thứ tự ngược lại là cái bẫy:
  -- xoá sạch bảng trước rồi mới phát hiện không xoá được ảnh, thì lúc đó
  -- ảnh mặt tiền cửa hàng và chữ ký người nhận hàng của NPP cũ vẫn nằm
  -- nguyên trong Storage — và đường liên kết tới chúng thì vừa mất.
  ------------------------------------------------------------------
  SELECT count(*) INTO files_left FROM storage.objects;
  IF files_left > 0 THEN
    RAISE EXCEPTION
      'Storage còn % file. DỪNG, chưa xoá gì. Dọn Storage TRƯỚC bằng: '
      'SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/reset-storage.ts '
      '(chạy không tham số để xem trước, thêm --yes để xoá thật), rồi chạy lại file này.',
      files_left;
  END IF;

  ------------------------------------------------------------------
  -- 1. Xác định người được giữ. KHÔNG tìm thấy thì DỪNG, không xoá gì.
  ------------------------------------------------------------------
  IF keep_owner THEN
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
  ELSE
    -- keep_user / keep_org để NULL. Mọi phép so `<> keep_user` ở dưới sẽ
    -- ra NULL (không phải TRUE), tức là xoá nhầm ai cả — nên các lệnh
    -- xoá bên dưới phải viết riêng cho nhánh này, không dùng chung.
    RAISE NOTICE 'Chế độ TRẮNG TINH: xoá cả org và mọi tài khoản.';
  END IF;

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

  -- ⚠ `WHERE id <> keep_user` với keep_user = NULL cho ra NULL, KHÔNG phải
  -- TRUE — nghĩa là không xoá ai cả. Ở chế độ trắng tinh mà dùng chung
  -- câu đó thì lệnh chạy êm ru và người dùng cũ vẫn còn nguyên. Nên hai
  -- nhánh viết riêng.
  IF keep_owner THEN
    DELETE FROM public.users         WHERE id <> keep_user;
    DELETE FROM public.organizations WHERE id <> keep_org;
  ELSE
    DELETE FROM public.users;
    DELETE FROM public.organizations;
  END IF;

  ------------------------------------------------------------------
  -- 5. Tài khoản đăng nhập. Xoá identities trước rồi mới tới users —
  --    không phải bản Supabase nào cũng đặt ON DELETE CASCADE.
  ------------------------------------------------------------------
  IF keep_owner THEN
    DELETE FROM auth.identities WHERE user_id <> keep_user;
    DELETE FROM auth.users      WHERE id      <> keep_user;
  ELSE
    DELETE FROM auth.identities;
    DELETE FROM auth.users;
  END IF;

  ------------------------------------------------------------------
  -- 6. Tẩy danh tính NPP cũ khỏi hai dòng được giữ lại.
  --
  -- Xoá dữ liệu giao dịch mà để nguyên tên công ty, mã số thuế, địa chỉ
  -- thì chưa phải bàn giao — mọi phiếu in ra vẫn mang thông tin NPP cũ.
  ------------------------------------------------------------------
  IF keep_owner AND scrub_identity THEN
    UPDATE public.organizations
    SET name           = new_org_name,
        slug           = new_org_slug,
        -- Xoá cả `setup_completed_at` → banner hướng dẫn hiện lại, chủ
        -- mới được dẫn qua /setup để tự nhập thông tin công ty.
        settings       = '{}'::jsonb,
        allow_oversell = false
    WHERE id = keep_org;

    -- Email + mật khẩu ở auth.users KHÔNG đụng tới — đó là đường đăng
    -- nhập đang cần giữ. Chỉ xoá phần nhận dạng cá nhân ở hồ sơ.
    UPDATE public.users
    SET full_name = new_owner_name,
        phone     = NULL,
        username  = NULL
    WHERE id = keep_user;

    RAISE NOTICE 'Đã tẩy danh tính NPP cũ (tên, MST, địa chỉ, SĐT).';
  ELSIF keep_owner THEN
    RAISE NOTICE 'GIỮ NGUYÊN danh tính NPP cũ (scrub_identity = false).';
  END IF;
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
