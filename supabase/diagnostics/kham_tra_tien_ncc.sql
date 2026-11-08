-- ====================================================================
-- KHÁM TIỀN TRẢ NCC — chủ nhà 08/11/2026: "kiểm tra xem phần tiền thanh toán cho ncc cũng chưa có trong công nợ".
--   Ba đường trả tiền NCC đều TRỪ vào công nợ (`payables.paid`) và hiện thành dòng ở Sổ chi tiết công nợ (chi tiết NCC ›
--   Công nợ): Phiếu chi › loại "Trả NCC" và nút "Chi trả NCC" (phiếu chi trả NCC, mig 242), nút "Ghi trả" trên một khoản nợ
--   (mig 167). Phiếu chi loại "Chi phí" KHÔNG trừ nợ NCC nào — trả tiền hàng mà lập nhầm loại ấy thì nợ NCC không giảm.
--   Câu này tìm những chỗ như vậy trên sổ thật.
--
-- CÁCH DÙNG: dán cả tệp vào Supabase → SQL Editor → Run. CHỈ ĐỌC. ⚠ MỘT câu duy nhất (SQL Editor chỉ hiện kết quả câu
--   cuối). Gửi lại cả bảng: nút "Export" → CSV hoặc JSON. Không có khoá / mật khẩu nào trong kết quả.
--   1. TỔNG THEO NCC — dư nợ hiện tại + tiền đã trả chia theo đường ghi.
--   2. ĐÃ TRẢ KHÔNG CÓ PHIẾU — khoản có số đã trả mà không có lần trả nào (nợ đầu kỳ nhập sẵn, dữ liệu cũ).
--   3. PHIẾU CHI "CHI PHÍ" NGHI LÀ TRẢ NCC — mô tả nhắc tên một NCC / "NCC" / "nhà cung cấp" / "tiền hàng" / "công nợ"…
--      (tối đa 200 phiếu, mới trước). Phiếu nào đúng là trả NCC: lập lại bằng loại "Trả NCC", xoá phiếu chi phí cũ.
--   4. PHIẾU CHI NCC LỆCH — tiền đã chia vào các khoản khác số tiền của phiếu (phải trống).
-- ====================================================================
WITH
tra AS (  -- tiền đã ghi theo từng khoản nợ (mọi lần trả: trả thẳng + phần của phiếu chi NCC)
  SELECT pp.payable_id,
         sum(pp.amount) AS co_phieu,
         coalesce(sum(pp.amount) FILTER (WHERE pp.supplier_payment_id IS NULL), 0) AS tra_thang
    FROM payable_payments pp
   GROUP BY pp.payable_id
),
no AS (
  SELECT p.id, p.supplier_id, p.invoice_number, p.notes, p.opening_balance, p.created_at, p.status,
         coalesce(p.amount, 0) AS amount, coalesce(p.paid, 0) AS paid,
         coalesce(t.co_phieu, 0) AS co_phieu, coalesce(t.tra_thang, 0) AS tra_thang,
         EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.prepay_payable_id = p.id) AS la_tra_truoc
    FROM payables p
    LEFT JOIN tra t ON t.payable_id = p.id
),
pc AS (
  SELECT sp.supplier_id, sum(sp.amount) AS tien, count(*) AS so
    FROM supplier_payments sp
   WHERE sp.status = 'posted'
   GROUP BY sp.supplier_id
),
c1 AS (
  SELECT '1. TỔNG THEO NCC'::text AS phan,
         row_number() OVER (ORDER BY coalesce(sum(n.amount - n.paid) FILTER (WHERE n.status <> 'paid'), 0) DESC) AS hang,
         coalesce(s.code || ' · ', '') || coalesce(s.name, '(không rõ NCC)') AS ncc,
         ''::text AS chung_tu,
         ''::text AS ngay,
         coalesce(sum(n.amount - n.paid) FILTER (WHERE n.status <> 'paid'), 0) AS so_tien,
         'dư nợ hiện tại · nợ ghi (sau trả hàng) ' || coalesce(sum(n.amount) FILTER (WHERE NOT n.la_tra_truoc), 0)
           || ' · phiếu chi NCC ' || coalesce(max(pc.tien), 0) || ' (' || coalesce(max(pc.so), 0) || ' phiếu)'
           || ' · ghi trả từng khoản ' || sum(n.tra_thang)
           || ' · đã trả không phiếu ' || sum(n.paid - n.co_phieu) AS ghi_chu
    FROM no n
    LEFT JOIN suppliers s ON s.id = n.supplier_id
    LEFT JOIN pc ON pc.supplier_id = n.supplier_id
   GROUP BY n.supplier_id, s.code, s.name
),
c2 AS (
  SELECT '2. ĐÃ TRẢ KHÔNG CÓ PHIẾU'::text AS phan,
         row_number() OVER (ORDER BY abs(n.paid - n.co_phieu) DESC, n.id) AS hang,
         coalesce(s.name, '(không rõ NCC)') AS ncc,
         coalesce(nullif(btrim(n.invoice_number), ''), CASE WHEN n.opening_balance THEN 'Nợ đầu kỳ' END, n.id::text) AS chung_tu,
         to_char(n.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') AS ngay,
         n.paid - n.co_phieu AS so_tien,
         'phải trả ' || n.amount || ' · đã trả ' || n.paid || ' · tiền có phiếu ' || n.co_phieu
           || CASE WHEN n.opening_balance THEN ' · nợ đầu kỳ' ELSE '' END AS ghi_chu
    FROM no n
    LEFT JOIN suppliers s ON s.id = n.supplier_id
   WHERE abs(n.paid - n.co_phieu) >= 1
),
c3 AS (
  SELECT '3. PHIẾU CHI "CHI PHÍ" NGHI LÀ TRẢ NCC'::text AS phan,
         row_number() OVER (ORDER BY e.expense_date DESC, e.created_at DESC, e.id) AS hang,
         coalesce((SELECT s.name FROM suppliers s
                    WHERE s.org_id = e.org_id AND length(btrim(s.name)) >= 4
                      AND coalesce(e.description, '') ILIKE '%' || btrim(s.name) || '%'
                    ORDER BY length(s.name) DESC LIMIT 1), '—') AS ncc,
         coalesce(e.reference_code, '') AS chung_tu,
         to_char(e.expense_date, 'DD/MM/YYYY') AS ngay,
         e.amount AS so_tien,
         coalesce(c.name, 'không danh mục') || ' · ' || left(coalesce(e.description, ''), 160) AS ghi_chu
    FROM expenses e
    LEFT JOIN expense_categories c ON c.id = e.category_id
   WHERE coalesce(e.description, '') || ' ' || coalesce(e.reference_code, '')
           ~* '(ncc|nhà cung cấp|nha cung cap|tiền hàng|tien hang|công nợ|cong no|trả nợ|tra no)'
      OR EXISTS (SELECT 1 FROM suppliers s
                  WHERE s.org_id = e.org_id AND length(btrim(s.name)) >= 4
                    AND coalesce(e.description, '') ILIKE '%' || btrim(s.name) || '%')
),
c4 AS (
  SELECT '4. PHIẾU CHI NCC LỆCH'::text AS phan,
         row_number() OVER (ORDER BY sp.paid_date DESC, sp.id) AS hang,
         coalesce(s.name, '(không rõ NCC)') AS ncc,
         sp.code AS chung_tu,
         to_char(sp.paid_date, 'DD/MM/YYYY') AS ngay,
         sp.amount - coalesce(x.tien, 0) AS so_tien,
         'số tiền phiếu ' || sp.amount || ' · đã chia vào các khoản ' || coalesce(x.tien, 0) AS ghi_chu
    FROM supplier_payments sp
    LEFT JOIN suppliers s ON s.id = sp.supplier_id
    LEFT JOIN (SELECT supplier_payment_id, sum(amount) AS tien FROM payable_payments
                WHERE supplier_payment_id IS NOT NULL GROUP BY supplier_payment_id) x ON x.supplier_payment_id = sp.id
   WHERE sp.status = 'posted' AND abs(sp.amount - coalesce(x.tien, 0)) >= 1
)
SELECT phan, hang, ncc, chung_tu, ngay, so_tien, ghi_chu
  FROM (
    SELECT * FROM c1
    UNION ALL SELECT * FROM c2
    UNION ALL SELECT * FROM c3 WHERE hang <= 200
    UNION ALL SELECT * FROM c4
  ) k
 ORDER BY split_part(phan, '.', 1)::int, hang;
