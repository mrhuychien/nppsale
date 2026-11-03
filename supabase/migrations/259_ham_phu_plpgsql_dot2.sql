-- ====================================================================
-- HÀM PHỤ CỦA TẠO ĐƠN / XUẤT HÀNG / SỬA HĐ — ĐỢT 2: VIẾT LẠI BẰNG PLPGSQL (KẾT QUẢ Y HỆT)
--
-- VÌ SAO — chủ nhà 03/11/2026, sau mig 258 (Xuất hàng −27%, Sửa HĐ −25%, Tạo đơn −20% trên sổ thử cỡ thật), em đề nghị
--   "Còn 8 hàm phụ cùng kiểu trên đường Tạo đơn và Sửa hoá đơn, mỗi lệnh bớt được thêm khoảng 7%"; chủ nhà: "làm cả 2".
--   Đo lại đúng khối việc của mig 258 (40 Tạo đơn + 40 Xuất hàng + 20 Sửa HĐ, mỗi lệnh một giao dịch như PostgREST):
--   còn 11 hàm `LANGUAGE sql` có `SET search_path` được gọi — không mở (inline) được, lập kế hoạch lại thân hàm mỗi lần
--   một câu plpgsql gọi (luật CLAUDE.md §3, mig 258):
--     · `_quyen_giam_cua` (trigger giá / giảm giá dòng đơn, MỖI dòng): 0,17 ms / lần · `_giam_don_hien_tai` 0,35 ms
--     · mã chứng từ `_so_chung_tu` / `_order_code` / `_inv_code` / `_ma_phieu_tra` 0,06–0,16 ms
--     · `_thue_hop_le` (mỗi dòng đơn / HĐ), `_giam_gia_don`, `_wf2b_payment_terms_days`, `vn_today` 0,04–0,10 ms
--     · `_la_trinh_duyet` (mọi trigger khoá ghi thẳng, ~7 lần mỗi lệnh) 0,016 ms
--   Cộng lại ~1,1 ms mỗi lệnh trên sổ thử (sổ thật chậm ~70 lần → ~80 ms mỗi lệnh).
--
-- ⚠ KẾT QUẢ Y HỆT BẢN SQL (bộ thử: scripts/sql/thu-259-ham-phu-plpgsql-dot2.sql — dựng lại bản SQL đang chạy, tính kết quả
--   cũ trên kho mẫu, chạy tệp này hai lần, so từng kết quả kể cả LỖI báo ra; trigger đặt mã đơn / HĐ / phiếu trả chạy thật).
-- ⚠ KHÔNG đổi chữ ký, kiểu trả về, IMMUTABLE / STABLE, PARALLEL (giữ UNSAFE như cũ), STRICT, search_path từng hàm, quyền
--   (CREATE OR REPLACE giữ nguyên ACL). Không chỉ mục / ràng buộc / chính sách / view nào dùng các hàm này (đã soát); ba
--   cột mặc định `vn_today()` (sales_orders.order_date, sales_invoices.invoice_date, cash_receipts.receipt_date) trỏ theo
--   OID hàm — thay thân không phải dựng lại gì, không ghi lại dòng nào.
-- ====================================================================

-- 1. Quyền giảm giá của một người (trigger chốt giá / giảm giá dòng đơn, mig 185 / 226) — luôn đúng MỘT dòng.
CREATE OR REPLACE FUNCTION public._quyen_giam_cua(p_uid uuid)
RETURNS TABLE(toan_quyen boolean, duoc_giam boolean, loai_tran text, tran numeric)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  SELECT COALESCE(u.role IN ('owner', 'accountant'), true) OR p_uid IS NULL,
         COALESCE(u.allow_discount, false),
         COALESCE(u.discount_max_type, 'pct'),
         u.discount_max_value
  FROM (SELECT 1) x
  LEFT JOIN users u ON u.id = p_uid;
END;
$fn$;

-- 2. Giảm giá cả đơn đang có = tiền hàng các dòng − tiền đơn (mig 226). Đơn không có → NULL.
CREATE OR REPLACE FUNCTION public._giam_don_hien_tai(p_order uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
BEGIN
  RETURN (
    WITH d AS (
      SELECT round(COALESCE(sum(l.quantity * l.unit_price), 0)) AS tien, count(*) AS n
      FROM sales_order_lines l WHERE l.order_id = p_order AND l.quantity > 0
    )
    SELECT CASE WHEN d.tien - round(COALESCE(so.subtotal, 0)) > GREATEST(1, d.n)
                THEN d.tien - round(COALESCE(so.subtotal, 0)) ELSE 0 END
    FROM sales_orders so, d
    WHERE so.id = p_order);
END;
$fn$;

-- 3. Thuế suất màn gửi lên — hợp lệ khi là số trong [0, 1], làm tròn 4 chữ số; không thì NULL (mig 183).
CREATE OR REPLACE FUNCTION public._thue_hop_le(v text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN CASE WHEN v ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' AND v::numeric BETWEEN 0 AND 1
              THEN round(v::numeric, 4) END;
END;
$fn$;

-- 4. Lệnh đang chạy bằng vai của trình duyệt? (mọi trigger khoá ghi thẳng, mig 214)
CREATE OR REPLACE FUNCTION public._la_trinh_duyet()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
BEGIN
  RETURN current_user IN ('authenticated', 'anon');
END;
$fn$;

-- 5. Giảm giá cả đơn của tải trọng, kẹp trong [0, tiền hàng] (mig 183).
CREATE OR REPLACE FUNCTION public._giam_gia_don(p jsonb, p_tien_hang numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN LEAST(
    GREATEST(COALESCE(CASE WHEN (p->>'discount') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                           THEN (p->>'discount')::numeric END, 0), 0),
    GREATEST(COALESCE(p_tien_hang, 0), 0)
  );
END;
$fn$;

-- 6. Số ngày nợ của điều khoản "NETn" (mig 125); khác → 0.
CREATE OR REPLACE FUNCTION public._wf2b_payment_terms_days(p_terms text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN COALESCE((substring(upper(COALESCE(p_terms, '')) FROM 'NET([0-9]+)'))::int, 0);
END;
$fn$;

-- 7–10. Mã chứng từ (mig 237): số thứ tự đệm tới 4 chữ số; đơn / HĐ thêm "-n" cho lần sửa / lập lại.
CREATE OR REPLACE FUNCTION public._so_chung_tu(p_n integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN lpad(COALESCE(p_n, 0)::text, GREATEST(4, length(COALESCE(p_n, 0)::text)), '0');
END;
$fn$;

CREATE OR REPLACE FUNCTION public._order_code(p_seq integer, p_edit integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN 'DH-' || public._so_chung_tu(p_seq)
         || CASE WHEN COALESCE(p_edit, 0) > 0
                 THEN '-' || p_edit::text ELSE '' END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._inv_code(p_seq integer, p_reissue integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN 'HD-' || public._so_chung_tu(p_seq)
         || CASE WHEN COALESCE(p_reissue, 0) > 0
                 THEN '-' || p_reissue::text ELSE '' END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._ma_phieu_tra(p_seq integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN 'PT-' || public._so_chung_tu(p_seq);
END;
$fn$;

-- 11. Hôm nay theo giờ Việt Nam (mig 140) — mặc định của ngày đơn / ngày HĐ / ngày phiếu thu.
CREATE OR REPLACE FUNCTION public.vn_today()
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
BEGIN
  RETURN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
END;
$fn$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Tóm tắt — chỉ đọc. Mong đợi: cả 11 hàm plpgsql; mẫu mã / thuế / điều khoản ra đúng như trước.
-- ---------------------------------------------------------------------
SELECT 'Hàm phụ còn LANGUAGE sql (mong đợi 0)' AS hang_muc,
       count(*) FILTER (WHERE l.lanname <> 'plpgsql')::text || ' / ' || count(*) AS gia_tri
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
 WHERE p.oid IN ('public._quyen_giam_cua(uuid)'::regprocedure, 'public._giam_don_hien_tai(uuid)'::regprocedure,
                 'public._thue_hop_le(text)'::regprocedure, 'public._la_trinh_duyet()'::regprocedure,
                 'public._giam_gia_don(jsonb, numeric)'::regprocedure, 'public._wf2b_payment_terms_days(text)'::regprocedure,
                 'public._so_chung_tu(integer)'::regprocedure, 'public._order_code(integer, integer)'::regprocedure,
                 'public._inv_code(integer, integer)'::regprocedure, 'public._ma_phieu_tra(integer)'::regprocedure,
                 'public.vn_today()'::regprocedure)
UNION ALL
SELECT 'Mẫu: DH-0007-2 · HD-12345 · PT-0001 · thuế 0.1 · NET30 · giảm 50.000 / 30.000',
       CASE WHEN public._order_code(7, 2) = 'DH-0007-2' AND public._inv_code(12345, 0) = 'HD-12345'
             AND public._ma_phieu_tra(1) = 'PT-0001' AND public._thue_hop_le(' 0.1 ') = 0.1000
             AND public._thue_hop_le('1.5') IS NULL AND public._wf2b_payment_terms_days('net30') = 30
             AND public._giam_gia_don('{"discount": "50000"}', 30000) = 30000
            THEN 'ĐÚNG' ELSE 'SAI — báo lại ngay' END;
