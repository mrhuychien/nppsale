-- =====================================================================
-- Migration 101: bucket ảnh giao hàng (POD)
-- =====================================================================
-- KHÔNG thêm cột nào. `delivery_lines.pod_photo_url` và `.pod_signature`
-- đã có từ migration 001 và trang chi tiết đơn đã hiển thị ảnh POD — chỉ
-- chưa bao giờ có màn nào GHI vào. Migration này chỉ tạo chỗ chứa ảnh.
--
-- Chữ ký KHÔNG vào bucket: nó nằm trong cột `pod_signature` (text, data
-- URL PNG) và được RLS của `delivery_lines` bảo vệ theo org. Chữ ký là
-- thứ nhạy cảm hơn ảnh thùng hàng nên để nó trong DB là cố ý.
--
-- ĐÁNH ĐỔI ĐÃ BIẾT: bucket để `public = true`, giống hệt `visit-photos`
-- ở migration 014. Nghĩa là ai có URL đều xem được ảnh, không cần đăng
-- nhập. Chọn vậy vì trang /orders/[id] render thẳng
-- <img src={dl.pod_photo_url}> — chuyển sang bucket riêng tư thì phải ký
-- URL tạm và URL đã lưu trong DB sẽ hết hạn. Đường dẫn có org_id +
-- delivery_line_id (đều là uuid) nên không đoán được, nhưng đó là che
-- giấu chứ không phải kiểm soát truy cập. Muốn siết thì phải đổi cả
-- đường đọc, làm riêng.

INSERT INTO storage.buckets (id, name, public)
VALUES ('pod-photos', 'pod-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Ghi và xoá bị giới hạn trong thư mục org của người dùng; đọc thì mở
-- cho mọi tài khoản đã đăng nhập (bucket vốn đã public).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'pod_photos_insert'
  ) THEN
    CREATE POLICY "pod_photos_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'pod-photos'
        AND (split_part(name, '/', 1))::uuid = public.user_org_id()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'pod_photos_select'
  ) THEN
    CREATE POLICY "pod_photos_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'pod-photos');
  END IF;

  -- KHÔNG có policy DELETE. Ảnh POD là bằng chứng giao hàng: xoá được
  -- từ phía client thì lúc có tranh chấp với khách, bên xoá được là bên
  -- thắng. `visit-photos` có DELETE vì ảnh viếng thăm là ghi nhận nội
  -- bộ, không phải chứng từ.
END $$;
