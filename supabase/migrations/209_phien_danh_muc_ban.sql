-- ====================================================================
-- SỐ PHIÊN DANH MỤC BÁN HÀNG — máy NVBH biết sản phẩm / giá vừa đổi
--
-- VÌ SAO — chủ nhà 28/09/2026: "Trên màn sell mobile NVBH khi sản phẩm cập nhật thì bao lâu
--   mới xuất hiện" → trước đây tới 30 phút (danh mục nhớ trên máy `CATALOG_FRESH_MS`), trong
--   lúc đó NVBH có thể lên đơn theo GIÁ CŨ. Chủ nhà: "Làm đi, thêm nút làm mới sản phẩm."
--   Bảng sản phẩm / bảng giá / đơn vị không có cột thời điểm sửa, và XOÁ một dòng giá cũng là
--   thay đổi — nên dùng một SỐ PHIÊN: trigger tăng số mỗi câu lệnh thêm / sửa / xoá. Máy NVBH
--   chỉ hỏi con số (một dòng, vài byte); khác số đang giữ thì mới tải lại cả danh mục.
--
-- LÀM GÌ
--   1. Bảng một dòng `danh_muc_ban_phien(phien, luc)` — ai đăng nhập cũng ĐỌC được (chỉ là một
--      con số, không lộ gì), không ai ghi thẳng được.
--   2. Trigger MỨC CÂU LỆNH (một lần mỗi câu, không phải mỗi dòng — nhập 1.700 sản phẩm là một
--      lần tăng) trên `products`, `price_lists`, `product_units`.
--
-- ⚠ Chỉ có một NPP dùng (chủ nhà 27/09/2026) nên một số chung cho cả hệ thống là đủ; nhiều NPP
--   thì NPP này đổi giá chỉ làm máy NPP kia tải lại thừa một lần — không sai số liệu.
-- ⚠ Idempotent: chạy lại không đổi gì thêm (số phiên giữ nguyên).
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.danh_muc_ban_phien (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  phien bigint NOT NULL DEFAULT 1,
  luc timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.danh_muc_ban_phien (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.danh_muc_ban_phien ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS danh_muc_ban_phien_doc ON public.danh_muc_ban_phien;
CREATE POLICY danh_muc_ban_phien_doc ON public.danh_muc_ban_phien
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.danh_muc_ban_phien FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.danh_muc_ban_phien TO authenticated;

CREATE OR REPLACE FUNCTION public._tang_phien_danh_muc_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.danh_muc_ban_phien SET phien = phien + 1, luc = now() WHERE id = 1;
  RETURN NULL;
END
$fn$;
-- Hàm trigger: không ai gọi thẳng qua /rpc (luật mig 166 / 207).
REVOKE EXECUTE ON FUNCTION public._tang_phien_danh_muc_ban() FROM PUBLIC, anon, authenticated;

DO $trg$
DECLARE
  b text;
BEGIN
  FOREACH b IN ARRAY ARRAY['products', 'price_lists', 'product_units'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_phien_danh_muc_ban ON public.%I', b);
    EXECUTE format(
      'CREATE TRIGGER trg_phien_danh_muc_ban AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public._tang_phien_danh_muc_ban()', b);
  END LOOP;
END
$trg$;

NOTIFY pgrst, 'reload schema';

SELECT 'Số phiên danh mục bán hàng' AS hang_muc,
       (SELECT phien FROM public.danh_muc_ban_phien WHERE id = 1) AS phien,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_phien_danh_muc_ban') AS so_trigger;
