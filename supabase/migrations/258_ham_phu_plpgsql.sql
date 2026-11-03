-- ====================================================================
-- HÀM PHỤ CỦA XUẤT HÀNG + KHOÁ TÌM: VIẾT LẠI BẰNG PLPGSQL (KẾT QUẢ Y HỆT, HẾT LẬP KẾ HOẠCH LẠI MỖI LẦN GỌI)
--
-- VÌ SAO — chủ nhà 03/11/2026 gửi bảng khám máy chủ (supabase/diagnostics/kham_cham_pos.sql) sau khi khách NPP báo
--   "Loát chậm quá" · "Mất 3 phút" lúc 18:07–18:25: Xuất hàng (`post_invoice`) trung bình 1.294 ms / 460 lần (chậm nhất
--   7,6 giây), Sửa HĐ (`reissue_invoice`) 1.094 ms, Tạo đơn (`create_order_with_lines`) 378 ms.
--   Dựng lại sổ thử CÙNG CỠ sổ thật (1.835 hàng, 1.210 lô, 598 khách, ~2.000 đơn / 2.700 HĐ tạo qua đúng các RPC) rồi đo
--   bên trong lệnh (pg_stat_statements track = all, track_functions = all): ~1/3 thời gian Xuất hàng nằm ở các hàm phụ
--   viết `LANGUAGE sql` có `SET search_path`. Kiểu hàm ấy Postgres (≤ 17) KHÔNG mở (inline) được, và khi được gọi từ
--   một câu trong plpgsql (trigger, RPC) thì thân hàm bị LẬP KẾ HOẠCH LẠI ở MỖI lần gọi:
--     · `khoa_tim_ds` — khoá tìm, trigger `tim_kd` của đơn / HĐ / phiếu kho / lô / phiếu trả / khách / hàng…: 1,45 ms
--       mỗi lần; lại gọi `khoa_tim` HAI lần cho mỗi giá trị (Postgres chép biểu thức của LATERAL vào cả WHERE lẫn SELECT).
--     · `_da_xuat_cua_dong_don` — trigger `sync_invoiced_qty`, MỖI dòng hoá đơn: 0,45 ms mỗi lần (câu tra chỉ 0,03 ms).
--     · `_chuan_he_so_dong_hoa_don(lines, hd_cu)` — đầu `post_invoice`: 1,7 ms mỗi lần.
--   plpgsql giữ kế hoạch câu lệnh cho cả phiên (kết nối PostgREST được dùng lại) — còn đúng phần chạy.
--
-- ⚠ KẾT QUẢ Y HỆT BẢN SQL (bộ thử: scripts/sql/thu-258-ham-phu-plpgsql.sql — dựng lại bản SQL của sổ thật, chạy tệp này
--   hai lần, so từng kết quả). Trên sổ thử cỡ thật: 18.253 giá trị (tên / mã / SĐT / địa chỉ + ca khó: chữ tách dấu NFD,
--   dấu cách lạ U+00A0 / U+2003 / U+FEFF, số 0 đầu, chuỗi rỗng / NULL) — 0 lệch; 9.441 dòng đơn — 0 lệch; 2.737 tải trọng
--   dòng HĐ (có / không tờ cũ, đơn vị ngoài danh mục, dòng không phải object, mã hàng hỏng — lỗi báo ra cũng y hệt) —
--   0 lệch cả jsonb lẫn chữ. Luật khoá tìm vẫn phải trùng `viValueKey` (src/lib/search.ts) từng ký tự.
-- ⚠ ĐO (sổ thử, A/B trên hai bản sao cùng khối việc, mỗi lệnh một giao dịch như PostgREST, 3 lượt × 40 / 40 / 20 lệnh):
--     Tạo đơn  12–15 ms → 10 ms · Xuất hàng 15–17,5 ms → 11–12 ms · Sửa HĐ 31–36 ms → 21–30 ms
--     khoá tìm một bảng 1.835 hàng: 4.716 ms → 147 ms
--   Máy chủ thật đang chậm ~70 lần sổ thử cho CÙNG lệnh (kể cả câu `set_config` rỗng việc của PostgREST: 3 ms thay vì
--   0,02 ms) — đó là chuyện cỡ máy, migration này không chữa được; nhưng bớt việc là bớt đúng theo tỉ lệ ấy.
-- ⚠ KHÔNG đổi chữ ký, kiểu trả về, IMMUTABLE / STABLE, PARALLEL SAFE, search_path, quyền. Không chỉ mục / cột / chính sách /
--   view nào dùng các hàm này trong biểu thức (đã soát pg_index, pg_attrdef, pg_policies, pg_views) — thay thân hàm không
--   phải dựng lại gì và KHÔNG ghi lại dòng nào. `_chuan_he_so_dong_hoa_don(jsonb)` (một tham số, mig 174) không còn ai gọi
--   — để nguyên.
-- ⚠ Hàm phụ mới gọi từ trigger / plpgsql: viết plpgsql, ĐỪNG `LANGUAGE sql` + `SET search_path` (CLAUDE.md §3).
-- ====================================================================

-- 1. Bỏ dấu — tiện ích unaccent tra schema lúc chạy như mig 177 (Supabase: `extensions`).
DO $kd$
DECLARE v_sch text;
BEGIN
  SELECT n.nspname INTO v_sch
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'unaccent';

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.khong_dau(p text)
    RETURNS text
    LANGUAGE plpgsql
    IMMUTABLE
    PARALLEL SAFE
    SET search_path = public
    AS $b$
    BEGIN
      RETURN btrim(regexp_replace(lower(
        %1$I.unaccent('%1$I.unaccent'::regdictionary,
          replace(replace(normalize(COALESCE(p, ''), NFC), 'đ', 'd'), 'Đ', 'D'))
      ), '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'));
    END;
    $b$
  $f$, v_sch);
END;
$kd$;
GRANT EXECUTE ON FUNCTION public.khong_dau(text) TO authenticated;

-- 2. Khoá tìm của một giá trị — đúng luật mig 205: từ, bản viết liền, bản bỏ số 0 đầu.
CREATE OR REPLACE FUNCTION public.khoa_tim(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
DECLARE
  tu    text[];
  x     text;
  lien  text;
  lien0 text := '';
BEGIN
  tu := array_remove(regexp_split_to_array(public.khong_dau(p), '[^a-z0-9]+'), '');
  IF cardinality(tu) = 0 THEN
    RETURN '';
  END IF;
  lien := array_to_string(tu, '');
  FOREACH x IN ARRAY tu LOOP
    lien0 := lien0 || regexp_replace(x, '(^|[a-z])0+(?=[0-9])', '\1', 'g');
  END LOOP;
  RETURN array_to_string(tu, ' ')
    || CASE WHEN cardinality(tu) > 1 THEN ' ' || lien ELSE '' END
    || CASE WHEN lien0 <> lien THEN ' ' || lien0 ELSE '' END;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.khoa_tim(text) TO authenticated;

-- 3. Khoá của nhiều giá trị — các khoá khác rỗng, đúng thứ tự, cách nhau một dấu cách. MỖI giá trị tính MỘT lần.
CREATE OR REPLACE FUNCTION public.khoa_tim_ds(VARIADIC p text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
DECLARE
  v  text;
  k  text;
  kq text[] := '{}';
BEGIN
  IF p IS NULL THEN
    RETURN '';
  END IF;
  FOREACH v IN ARRAY p LOOP
    k := public.khoa_tim(v);
    IF k <> '' THEN
      kq := kq || k;
    END IF;
  END LOOP;
  RETURN array_to_string(kq, ' ');
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.khoa_tim_ds(text[]) TO authenticated;

-- 4. Số đã xuất của một dòng đơn (đơn vị của dòng đơn) — trigger sync_invoiced_qty gọi cho MỖI dòng hoá đơn (mig 179).
CREATE OR REPLACE FUNCTION public._da_xuat_cua_dong_don(p_order_line_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
BEGIN
  RETURN (
    SELECT COALESCE(
      sum(sil.quantity * COALESCE(NULLIF(sil.conversion_factor, 0), 1))
        / COALESCE(NULLIF(max(sol.conversion_factor), 0), 1),
      0)
    FROM sales_invoice_lines sil
    JOIN sales_invoices si ON si.id = sil.invoice_id AND si.status = 'posted'
    JOIN sales_order_lines sol ON sol.id = sil.order_line_id
    WHERE sil.order_line_id = p_order_line_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public._da_xuat_cua_dong_don(uuid) FROM PUBLIC, anon, authenticated;

-- 5. Hệ số quy đổi của dòng hoá đơn do MÁY CHỦ tra (mig 174), Sửa HĐ giữ hệ số chụp trên tờ cũ (mig 247). Thứ tự luật
--    giữ nguyên: đơn vị cơ sở → 1; hệ số tờ cũ (cùng hàng + đơn vị) → hệ số ấy; danh mục → hệ số danh mục; không thì số
--    gửi lên (thiếu → 1). Dòng không phải object / thiếu mã hàng: giữ nguyên. Từng dòng một câu tra nhỏ, đi chỉ mục.
CREATE OR REPLACE FUNCTION public._chuan_he_so_dong_hoa_don(p_lines jsonb, p_hd_cu uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  l      jsonb;
  kq     jsonb := '[]'::jsonb;
  v_pid  uuid;
  v_dv   text;
  v_base text;
  v_qd   numeric;
  v_cu   numeric;
BEGIN
  FOR l IN
    SELECT e.l FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS e(l, i) ORDER BY e.i
  LOOP
    IF jsonb_typeof(l) = 'object' AND NULLIF(l->>'product_id', '') IS NOT NULL THEN
      v_pid  := (l->>'product_id')::uuid;
      v_dv   := l->>'unit_name';
      v_base := NULL;
      v_qd   := NULL;
      v_cu   := NULL;
      SELECT p.base_unit INTO v_base FROM products p WHERE p.id = v_pid;
      IF FOUND THEN
        SELECT pu.conversion::numeric INTO v_qd
          FROM product_units pu WHERE pu.product_id = v_pid AND pu.unit_name = v_dv;
        IF p_hd_cu IS NOT NULL THEN
          SELECT max(sil.conversion_factor) INTO v_cu
            FROM sales_invoice_lines sil
           WHERE sil.invoice_id = p_hd_cu
             AND sil.product_id = v_pid
             AND sil.unit_name = v_dv
             AND sil.conversion_factor > 0;
        END IF;
      END IF;
      kq := kq || jsonb_build_array(l || jsonb_build_object('conversion_factor',
        CASE
          WHEN v_dv = v_base THEN 1::numeric
          WHEN v_cu IS NOT NULL THEN v_cu
          WHEN v_qd IS NOT NULL THEN v_qd
          ELSE COALESCE((l->>'conversion_factor')::numeric, 1)
        END));
    ELSE
      kq := kq || jsonb_build_array(l);
    END IF;
  END LOOP;
  RETURN kq;
END;
$fn$;
REVOKE ALL ON FUNCTION public._chuan_he_so_dong_hoa_don(jsonb, uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Tóm tắt — chỉ đọc. Mong đợi: cả năm hàm plpgsql, giữ tính chất cũ; ba mẫu khoá tìm đúng như mig 205.
-- ---------------------------------------------------------------------
SELECT p.oid::regprocedure::text AS ham,
       l.lanname AS ngon_ngu,
       CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END AS tinh_chat,
       array_to_string(p.proconfig, ', ') AS cai_dat
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
 WHERE p.oid IN ('public.khong_dau(text)'::regprocedure, 'public.khoa_tim(text)'::regprocedure,
                 'public.khoa_tim_ds(text[])'::regprocedure, 'public._da_xuat_cua_dong_don(uuid)'::regprocedure,
                 'public._chuan_he_so_dong_hoa_don(jsonb, uuid)'::regprocedure)
UNION ALL
SELECT 'mẫu khoá tìm', 'DH-0123 · 0912 345 678 · Bánh Đậu Xanh',
       CASE WHEN public.khoa_tim('DH-0123') = 'dh 0123 dh0123 dh123'
             AND public.khoa_tim('0912 345 678') = '0912 345 678 0912345678 912345678'
             AND public.khoa_tim_ds('Bánh Đậu Xanh', NULL, '') = 'banh dau xanh banhdauxanh'
            THEN 'ĐÚNG' ELSE 'SAI — báo lại ngay' END,
       ''
ORDER BY 1;
