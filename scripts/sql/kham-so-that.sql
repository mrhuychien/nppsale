-- ====================================================================
-- PHIẾU KHÁM SỔ THẬT — chỉ ĐỌC, không sửa gì
--
-- ⚠ VÌ SAO CẦN. Preview (`newdesign`) và sản xuất (`main`) dùng CHUNG
--   một Supabase, mà hai nhánh có hai bộ migration khác nhau. Nên
--   không nhánh nào một mình nói được sổ thật đang ở trạng thái nào —
--   phải hỏi chính sổ.
--
-- ⚠ ĐỌC KẾT QUẢ: cột `ket_luan` là thứ cần nhìn. "OK" là đúng, còn lại
--   là việc cần làm. Chạy bao nhiêu lần cũng được.
-- ====================================================================
SELECT * FROM (

-- 1. Nháp có còn kín không — luật chủ nhà chốt, và là thứ hai bản 161
--    hỏng từng phá.
SELECT 1 AS stt,
  'Đơn nháp của NVBH có kín với NPP không' AS hang_muc,
  CASE
    WHEN qual IS NULL THEN 'KHÔNG CÓ chính sách đọc đơn — bất thường'
    WHEN position('status <> ''draft''::text) OR (sales_user_id = auth.uid())' in qual) > 0
      THEN 'OK — đúng luật mig 119 (nháp là sổ tay riêng của NVBH)'
    WHEN position('draft' in qual) = 0
      THEN 'LỆCH — chính sách không còn nhắc tới nháp, NPP nhiều khả năng thấy hết'
    ELSE 'LỆCH — mệnh đề nháp đã bị sửa, cần chạy mig 161 của newdesign'
  END AS ket_luan,
  coalesce(left(regexp_replace(qual, '\s+', ' ', 'g'), 200), '(không có)') AS chi_tiet
FROM (
  SELECT pg_get_expr(p.polqual, p.polrelid) AS qual
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relname = 'sales_orders' AND p.polname = 'sales_order_select'
) q

UNION ALL
-- 2. Dấu vết của hai bản 161 HỎNG (cột + trigger chúng dựng lên)
SELECT 2, 'Dấu vết của bản 161 hỏng (cột created_by trên sales_orders)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid='sales_orders'::regclass AND a.attname='created_by'
                      AND a.attnum>0 AND NOT a.attisdropped)
       THEN 'CÓ — sổ đã từng chạy một bản 161 cũ; cần mig 161 của newdesign để dọn'
       ELSE 'OK — chưa bao giờ chạy bản 161 hỏng' END, ''

UNION ALL
-- 3. Mig 159 đã chạy chưa (cột lý do từng dòng trả hàng)
SELECT 3, 'Cột return_lines.reason (mig 159, màn POS cần)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid='return_lines'::regclass AND a.attname='reason'
                      AND a.attnum>0 AND NOT a.attisdropped)
       THEN 'CÓ — mig 159 đã chạy' ELSE 'CHƯA — màn POS trả hàng sẽ lỗi khi ghi lý do từng dòng' END, ''

UNION ALL
-- 4. Mig 162 — huỷ hoá đơn có nhả móc nối về dòng đơn không
SELECT 4, 'Mig 162 (huỷ hoá đơn rồi sửa đơn được)',
  CASE WHEN position('SET order_line_id = NULL' in coalesce(src,'')) > 0
       THEN 'OK — đã vá' ELSE 'CHƯA — huỷ hoá đơn xong vẫn không bỏ được dòng khỏi đơn' END, ''
FROM (SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='cancel_invoice') f

UNION ALL
-- 5. Mig 131 — miếng vá phiếu trả kèm đơn còn sống trong cùng hàm ấy
SELECT 5, 'Mig 131 (phiếu trả kèm đơn chỉ gỡ liên kết, không huỷ oan)',
  CASE WHEN position('SET invoice_id = NULL' in coalesce(src,'')) > 0
       THEN 'OK — còn nguyên' ELSE 'MẤT — ai đó đã chép đè cancel_invoice bằng bản cũ' END, ''
FROM (SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='cancel_invoice') f

UNION ALL
-- 6. Mig 156 + 157 — hoàn kho theo mọi kho, và KHÔNG dựng lô ảo
--
-- ⚠ HAI DẤU HIỆU RIÊNG, KHÔNG PHẢI MỘT CÂU NÓI NƯỚC ĐÔI:
--     · `v_untaken` — biến 157 dựng để nhớ phần bán âm không hoàn về
--       đâu được, thay cho việc ném NO_BATCH_TO_RESTOCK;
--     · `warehouse_zone` — nấc hoàn của 156, thôi ghim cứng kho bán.
SELECT 6,
  'Mig 156+157 (huỷ hoá đơn sau khi bán âm / hàng ở kho khác)',
  CASE
    WHEN src IS NULL THEN 'KHÔNG THẤY hàm _wf2_restock — bất thường'
    WHEN position('v_untaken' in src) > 0 AND position('warehouse_zone' in src) > 0
      THEN 'OK — cả 156 lẫn 157 đã chạy'
    WHEN position('warehouse_zone' in src) > 0
      THEN 'MỚI CÓ 156 — bán âm xong vẫn không huỷ được hoá đơn, chạy tiếp 157'
    ELSE 'CHƯA CÓ 156/157 — huỷ hoá đơn sẽ báo NO_BATCH_TO_RESTOCK'
  END,
  CASE WHEN position('NO_BATCH_TO_RESTOCK' in coalesce(src,'')) > 0
       THEN 'hàm còn ném NO_BATCH_TO_RESTOCK — 157 chưa chạy' ELSE '' END
FROM (SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='_wf2_restock') f

UNION ALL
-- 7. Mig 163 — còn chính sách GHI nào chỉ hỏi vai trò không
SELECT 7, 'Mig 163 (chính sách GHI còn quên hỏi org_id)',
  CASE WHEN count(*) = 0 THEN 'OK — không còn cái nào'
       ELSE count(*)::text || ' chính sách còn đúng với MỌI dòng — chạy lại mig 163' END,
  coalesce(string_agg(c.relname || '.' || p.polname, ', '), '')
FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND p.polcmd IN ('*','a','w','d')
  AND (coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
      !~ 'org_id|auth\.uid|user_id|EXISTS|false'

UNION ALL
-- 8. Mig 164 — sổ tiền còn lệch không
SELECT 8, 'Tiền đã thu mà công nợ chưa trừ',
  CASE WHEN count(*) = 0 THEN 'OK — không còn khoản nào'
       ELSE count(*)::text || ' khoản còn lệch — chạy lại mig 164' END, ''
FROM (
  SELECT rc.id FROM receivables rc LEFT JOIN payments p ON p.receivable_id = rc.id
  GROUP BY rc.id, rc.paid HAVING coalesce(sum(p.amount),0) > coalesce(rc.paid,0)
) x
UNION ALL
-- 9. Mig 165 — NVBH sửa / xoá được phiếu trả NHÁP của chính mình
SELECT 9, 'Mig 165 (NVBH sửa đơn kèm hàng trả không để lại phiếu trả rỗng)',
  CASE WHEN count(*) = 2 THEN 'OK — đủ hai chính sách'
       WHEN count(*) = 0 THEN 'CHƯA — NVBH sửa đơn kèm hàng trả sẽ để lại phiếu trả rỗng'
       ELSE 'THIẾU — chỉ có ' || count(*)::text || '/2 chính sách' END, ''
FROM pg_policy
WHERE polrelid = 'returns'::regclass
  AND polname IN ('Sales can update own draft returns', 'Sales can delete own draft returns')
UNION ALL
-- 10. Mig 166 — RPC kho có cổng vai, hàm nội bộ không gọi thẳng được
SELECT 10, 'Mig 166 (RPC kho kiểm vai, hàm nội bộ đã khoá)',
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.prosrc LIKE '%(mig 166)%') < 8
         THEN 'CHƯA — NVBH còn gọi thẳng được RPC huỷ / xuất kho'
       WHEN count(*) > 0
         THEN 'HỞ — ' || count(*)::text || ' hàm nội bộ anon/authenticated gọi thẳng được'
       ELSE 'OK — 8 RPC có cổng vai, 0 hàm nội bộ hở' END,
  coalesce(string_agg(p.proname, ', '), '')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE '\_%'
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
UNION ALL
-- 11. Mig 167–171 — tiền / kho / đơn / phiếu trả ghi trong một giao dịch
SELECT 11, 'Mig 167–171 (ghi một giao dịch + khoá ghi thẳng sổ kho)',
  CASE WHEN count(*) FILTER (WHERE f IS NULL) = 0 AND
            (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
               AND tgname IN ('trg_khoa_ghi_thang_lo','trg_khoa_ghi_thang_phieu_kho','trg_khoa_ghi_thang_dong_kho')) = 3
       THEN 'OK — đủ 6 hàm và 3 trigger'
       ELSE 'THIẾU — ' || coalesce(string_agg(ten, ', ') FILTER (WHERE f IS NULL), 'trigger khoá sổ kho') END,
  ''
FROM (VALUES
  ('record_payable_payment(uuid,numeric,text,text)'),
  ('post_stock_import(jsonb)'),
  ('create_order_with_lines(jsonb)'),
  ('reject_stock_adjustment(uuid,text)'),
  ('create_return_with_lines(jsonb,jsonb)'),
  ('user_has_permission(uuid,text)')
) v(ten)
LEFT JOIN LATERAL (SELECT to_regprocedure('public.' || v.ten) AS f) x ON true
UNION ALL
-- 12. Mig 172 — đơn đã huỷ không thêm / sửa dòng được nữa
SELECT 12, 'Mig 172 (đơn đã huỷ khoá dòng hàng)',
  CASE WHEN position('ORDER_CANCELLED' in pg_get_functiondef('public.guard_order_lines_locked()'::regprocedure)) > 0
       THEN 'OK — đã khoá' ELSE 'CHƯA — sửa dòng đơn đã huỷ vẫn ghi được' END, ''
UNION ALL
-- 13. Mig 173 — kế toán làm được bảng lương, lương thực nhận do máy chủ tính
SELECT 13, 'Mig 173 (bảng lương: kế toán + lương thực nhận tính ở máy chủ)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tinh_luong_thuc_nhan')
            AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payroll_runs' AND policyname = 'org_iso_pr'
                        AND qual LIKE '%accountant%')
       THEN 'OK — đã vá' ELSE 'CHƯA — kế toán không đọc được kỳ lương / lương thực nhận tính ở trình duyệt' END, ''
UNION ALL
-- 14. Mig 174 — xuất hóa đơn tự tra hệ số quy đổi, không tin trình duyệt
SELECT 14, 'Mig 174 (hóa đơn tự tra hệ số quy đổi)',
  CASE WHEN position('_chuan_he_so_dong_hoa_don' in pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) > 0
       THEN 'OK — máy chủ tự tra' ELSE 'CHƯA — màn gửi sai hệ số là kho trừ sai' END, ''
UNION ALL
-- 15. Mig 175 — dòng hàng không được có đơn vị rỗng
SELECT 15, 'Mig 175 (đơn vị rỗng thành đơn vị cơ sở)',
  CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_don_vi_rong_la_co_so') = 3
       THEN 'OK — đã chặn' ELSE 'CHƯA — màn gửi đơn vị rỗng vẫn ghi ô trống vào đơn / hóa đơn' END, ''
UNION ALL
-- 16. Mig 176 — mặt hàng bắt buộc có đơn vị cơ sở
SELECT 16, 'Mig 176 (mặt hàng bắt buộc có đơn vị cơ sở)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_base_unit_khong_rong')
       THEN 'OK — đã chặn' ELSE 'CHƯA — lưu được mặt hàng không có đơn vị, đơn tạo ra sẽ trống đơn vị' END, ''
) t ORDER BY stt;
