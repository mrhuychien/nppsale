-- =====================================================================
-- Migration 103: ảnh điểm bán (tối đa 3) + nhắc nhở cập nhật
-- =====================================================================
-- NVBH thường dựng danh sách điểm bán ở nhà cho nhanh, rồi đi tuyến mới
-- chụp ảnh và lấy toạ độ. Hệ thống phải chịu được trạng thái "có khách
-- nhưng chưa có ảnh / chưa có vị trí" và TỰ NHẮC, chứ không im lặng để
-- danh sách rỗng ảnh nằm đó nhiều tháng.

-- ---------------------------------------------------------------------
-- 1. Bảng ảnh
-- ---------------------------------------------------------------------
-- Bảng riêng chứ không phải 3 cột photo_1/2/3 trên `customers`: mỗi ảnh
-- mang theo THỜI GIAN và TOẠ ĐỘ lúc chụp — đó là bằng chứng "đã tới tận
-- nơi", nhồi vào cột phẳng thì thành 9 cột và không cách nào thêm ảnh
-- thứ tư sau này.
CREATE TABLE IF NOT EXISTS customer_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Ô ảnh 1..3. Trần "tối đa 3 ảnh" được ép bằng CHECK + chỉ mục duy
  -- nhất, KHÔNG bằng trigger đếm: đếm rồi chèn là hai bước, hai người
  -- bấm cùng lúc sẽ lọt ảnh thứ tư. Ràng buộc khai báo thì không lọt.
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),

  photo_url text NOT NULL,

  -- Thời điểm CHỤP, do máy của người chụp báo. Khác created_at (lúc ghi
  -- vào DB) — hai cái này lệch nhau khi máy mất mạng lúc ở điểm bán.
  taken_at timestamptz NOT NULL,

  -- Toạ độ lúc chụp. Cho phép NULL: máy từ chối quyền định vị thì vẫn
  -- phải lưu được ảnh, chỉ là ảnh đó không có giá trị làm bằng chứng vị
  -- trí. Để trống còn hơn ghi một toạ độ bịa.
  gps_lat numeric,
  gps_lng numeric,
  /** Sai số máy báo, mét. 5m và 500m là hai chất lượng khác hẳn nhau. */
  gps_accuracy numeric,

  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_photos_slot
  ON customer_photos (customer_id, slot);
CREATE INDEX IF NOT EXISTS idx_customer_photos_customer
  ON customer_photos (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_photos_org
  ON customer_photos (org_id);

-- ---------------------------------------------------------------------
-- 2. Mốc đã nhắc — để cron không nhắc lại mỗi ngày
-- ---------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS photo_reminder_sent_at timestamptz;

-- ---------------------------------------------------------------------
-- 3. RLS — bám đúng quyền đã có trên `customers`
-- ---------------------------------------------------------------------
ALTER TABLE customer_photos ENABLE ROW LEVEL SECURITY;

-- Nhìn thấy ảnh khi và chỉ khi nhìn thấy khách. Viết bằng EXISTS trên
-- `customers` thay vì chép lại luật vai trò: chép lại là hai bản sao, và
-- bản ở đây sẽ không được sửa cùng lúc khi luật kia đổi.
DROP POLICY IF EXISTS "View customer photos" ON customer_photos;
CREATE POLICY "View customer photos"
  ON customer_photos FOR SELECT
  USING (EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id));

DROP POLICY IF EXISTS "Manage customer photos" ON customer_photos;
CREATE POLICY "Manage customer photos"
  ON customer_photos FOR ALL
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
    AND EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id)
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'sales')
    AND EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id)
  );

-- ---------------------------------------------------------------------
-- 4. Loại thông báo mới
-- ---------------------------------------------------------------------
-- TRA TÊN RÀNG BUỘC trong pg_constraint, KHÔNG đoán. Tên do Postgres tự
-- sinh (notifications_type_check) chỉ đúng khi CHECK được khai báo inline
-- và chưa ai đổi tên; đoán sai thì lệnh DROP âm thầm không làm gì và
-- CHECK cũ vẫn chặn giá trị mới.
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT con.conname INTO v_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'notifications'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%order_pending_approval%'
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', v_name);
  END IF;

  ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order_pending_approval',
    'order_approved',
    'order_cancelled',
    'payment_received',
    'receivable_overdue',
    'visit_logged',
    'customer_photo_missing',
    'info'
  ));
EXCEPTION
  WHEN duplicate_object THEN
    -- Chạy lại lần hai: ràng buộc mới đã có tên đó rồi, không sao.
    NULL;
END $$;

-- ---------------------------------------------------------------------
-- 5. Kho ảnh điểm bán
-- ---------------------------------------------------------------------
-- Cùng khuôn với `visit-photos` (mig 014) và `pod-photos` (mig 101).
-- ĐÁNH ĐỔI ĐÃ BIẾT: bucket public, ai có URL đều xem được. Ảnh mặt tiền
-- cửa hàng không phải dữ liệu cá nhân nhạy cảm, và để public thì thẻ
-- khách render thẳng <img src> không cần ký URL tạm.
INSERT INTO storage.buckets (id, name, public)
VALUES ('customer-photos', 'customer-photos', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'customer_photos_insert'
  ) THEN
    CREATE POLICY "customer_photos_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'customer-photos'
        AND (split_part(name, '/', 1))::uuid = public.user_org_id()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'customer_photos_select'
  ) THEN
    CREATE POLICY "customer_photos_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'customer-photos');
  END IF;

  -- CÓ policy DELETE ở đây (khác pod-photos): ảnh điểm bán là dữ liệu
  -- vận hành, chụp mờ / chụp nhầm cửa hàng là chuyện thường và NVBH phải
  -- thay được. Ảnh POD thì không, vì nó là chứng từ giao hàng.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'customer_photos_delete'
  ) THEN
    CREATE POLICY "customer_photos_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'customer-photos'
        AND (split_part(name, '/', 1))::uuid = public.user_org_id()
      );
  END IF;
END $$;
