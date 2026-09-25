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
UNION ALL
-- 17. Mig 177 — tìm không dấu ở máy chủ
SELECT 17, 'Mig 177 (tìm không dấu)',
  CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_tim_kd') = 3
            AND NOT EXISTS (SELECT 1 FROM products WHERE tim_kd IS NULL)
       THEN 'OK — gõ không dấu tìm được' ELSE 'CHƯA — gõ "banh" không ra "Bánh" trên danh sách' END, ''
UNION ALL
-- 18. Mig 178 — người tạo / người được gán
SELECT 18, 'Mig 178 (người tạo đơn + gán người phụ trách HĐ / phiếu trả)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_don_nguoi_tao')
            AND to_regprocedure('public.assign_doc_seller(text, uuid, uuid)') IS NOT NULL
       THEN 'OK — đã có' ELSE 'CHƯA — màn POS hiện "chưa rõ" người tạo đơn, gán lại HĐ / phiếu trả báo lỗi' END, ''
UNION ALL
-- 19. Mig 179 — số đã xuất quy đổi theo đơn vị
SELECT 19, 'Mig 179 (đã xuất quy đổi đơn vị — xuất khác đơn vị với đơn)',
  CASE WHEN to_regprocedure('public._da_xuat_cua_dong_don(uuid)') IS NOT NULL
       THEN 'OK — đã quy đổi' ELSE 'CHƯA — xuất 30 hộp cho dòng 2 thùng bị tính là 30 thùng' END, ''
UNION ALL
-- 20. Mig 180 — xuất hàng sửa được hàng trả kèm đơn
SELECT 20, 'Mig 180 (xuất hàng sửa được hàng trả kèm đơn)',
  CASE WHEN position('(mig 180)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) > 0
       THEN 'OK — đã nhận' ELSE 'CHƯA — sửa hàng trả lúc xuất hàng bị máy chủ bỏ qua' END, ''
UNION ALL
-- 21. Mig 181 — sửa hàng trả đổi được quy cách
SELECT 21, 'Mig 181 (sửa hàng trả đổi quy cách, giá theo hệ số)',
  CASE WHEN position('RETURN_UNIT_UNKNOWN' IN pg_get_functiondef('public._apply_return_edits(uuid, jsonb)'::regprocedure)) > 0
       THEN 'OK — đã nhận' ELSE 'CHƯA — đổi quy cách hàng trả / hàng đổi bị bỏ qua' END, ''
UNION ALL
-- 22. Mig 182 — người được gán của hóa đơn kéo theo phiếu trả, giữ qua lập lại
SELECT 22, 'Mig 182 (gán HĐ kéo theo phiếu trả; lập lại giữ người)',
  CASE WHEN position('(mig 182)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0
            AND position('(mig 182)' IN pg_get_functiondef('public.assign_doc_seller(text, uuid, uuid)'::regprocedure)) > 0
       THEN 'OK — đã vá' ELSE 'CHƯA — gán lại HĐ thì phiếu trả vẫn đứng tên người cũ' END, ''
UNION ALL
-- 23. Mig 183 — hóa đơn / phiếu trả bê đủ trường từ đơn
SELECT 23, 'Mig 183 (hóa đơn bê đủ: thuế dòng, giảm giá đơn, lý do dòng trả)',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'sales_order_lines' AND column_name = 'vat_rate')
            AND position('(mig 183)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) > 0
            AND position('(mig 183)' IN pg_get_functiondef('public._apply_return_adds(uuid, uuid, jsonb)'::regprocedure)) > 0
       THEN 'OK — đã vá' ELSE 'CHƯA — hóa đơn lấy thuế danh mục, mất giảm giá đơn; hàng trả thêm ở HĐ mất lý do dòng' END, ''
UNION ALL
-- 24. Mig 184 — sửa hóa đơn đã có tiền thu: phiếu thu chuyển sang tờ mới
SELECT 24, 'Mig 184 (sửa HĐ đã thu tiền: phiếu thu gắn sang HĐ mới)',
  CASE WHEN position('(mig 184)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0
            AND position('(mig 184)' IN pg_get_functiondef('public.cancel_invoice(uuid, text)'::regprocedure)) > 0
       THEN 'OK — đã vá' ELSE 'CHƯA — sửa HĐ đã có phiếu thu báo LOCKED_HAS_PAYMENT' END, ''
UNION ALL
-- 25. Mig 185 — quyền giảm giá theo từng nhân viên
SELECT 25, 'Mig 185 (quyền giảm giá theo nhân viên)',
  CASE WHEN (SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users'
               AND column_name IN ('allow_discount', 'discount_max_type', 'discount_max_value')) = 3
       THEN 'OK — đã có' ELSE 'CHƯA — NVBH không thấy ô giảm giá, màn cài đặt không lưu được quyền giảm giá' END, ''
UNION ALL
-- 26. Mig 186 — công nợ âm khi hàng trả nhiều hơn hàng xuất
SELECT 26, 'Mig 186 (công nợ âm khi hàng trả > hàng xuất)',
  CASE WHEN position('GREATEST(0' IN pg_get_functiondef('public._wf2b_recompute_receivable(uuid)'::regprocedure)) = 0
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cong_no_am_trang_thai')
       THEN 'OK — đã vá' ELSE 'CHƯA — hóa đơn có hàng trả lớn hơn hàng xuất ghi công nợ 0, mất phần khách được trừ' END, ''
UNION ALL
-- 27. Mig 187 — giá vốn ở báo cáo lãi/lỗ theo đơn vị cơ sở
SELECT 27, 'Mig 187 (giá vốn lãi/lỗ theo đơn vị cơ sở)',
  CASE WHEN position('qty_in_base_uom' IN pg_get_functiondef('public.finance_pnl(date, date)'::regprocedure)) > 0
       THEN 'OK — đã vá' ELSE 'CHƯA — xuất theo thùng thì giá vốn lãi/lỗ chỉ còn 1/hệ số' END, ''
UNION ALL
-- 28. Mig 188 — ngày chứng từ phiếu trả hàng (POS chọn ngày)
SELECT 28, 'Mig 188 (phiếu trả hàng chọn ngày)',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'returns' AND column_name = 'return_date')
            AND position('return_date' IN pg_get_functiondef('public.sync_return_credited_at()'::regprocedure)) > 0
       THEN 'OK — đã có' ELSE 'CHƯA — POS chọn ngày trả nhưng sổ không lưu; báo cáo gom theo ngày bấm Hoàn thành' END, ''
UNION ALL
-- 29. Mig 189 — hàng đổi / trả thêm lúc xuất hóa đơn không kẹt ở nháp
SELECT 29, 'Mig 189 (hàng trả thêm lúc xuất hóa đơn)',
  CASE WHEN position('(mig 189)' IN pg_get_functiondef('public._pending_return_for(uuid, uuid)'::regprocedure)) = 0
       THEN 'CHƯA — xuất hóa đơn kèm hàng trả thì phiếu kẹt nháp: công nợ không trừ, bản in mất hàng đổi/trả'
       WHEN EXISTS (SELECT 1 FROM returns ret JOIN sales_invoices si ON si.id = ret.invoice_id
                    WHERE si.status = 'posted' AND ret.status = 'draft' AND ret.created_at = si.created_at)
       THEN 'LỆCH — còn phiếu trả kẹt nháp, chạy lại mig 189'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 30. Mig 190 — phiếu trả POS một giao dịch; huỷ phiếu trả tính lại công nợ
SELECT 30, 'Mig 190 (phiếu trả POS + huỷ phiếu trả tính lại công nợ)',
  CASE WHEN to_regprocedure('public.save_pos_return(jsonb)') IS NULL
       THEN 'CHƯA — POS bấm Ghi nhận & nhập kho luôn lỗi; sửa phiếu đã nhập kho không đảo kho/công nợ'
       WHEN position('(mig 190)' IN pg_get_functiondef('public.cancel_return(uuid, text)'::regprocedure)) = 0
       THEN 'CHƯA — huỷ phiếu trả đi cùng hóa đơn đang chờ thì công nợ vẫn trừ'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 31. Mig 191 — luật phiếu trả tự sinh (theo HĐ) / tự lập
SELECT 31, 'Mig 191 (phiếu trả tự sinh chỉ huỷ; tự lập hoàn thành là trừ nợ ngay)',
  CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'receivables' AND column_name = 'return_id')
            OR position('RETURN_FOLLOWS_INVOICE' IN pg_get_functiondef('public.cancel_return(uuid, text)'::regprocedure)) = 0
       THEN 'CHƯA — phiếu trả tự lập không gắn HĐ hoàn thành mà không trừ nợ; huỷ được phiếu tự sinh đang chờ'
       WHEN EXISTS (SELECT 1 FROM returns WHERE status = 'submitted' AND NOT COALESCE(credit_with_invoice, false))
       THEN 'LỆCH — còn phiếu tự lập ở Chờ xử lý, chạy lại mig 191'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 32. Mig 192 — doanh số thuần = hàng đi − hàng trả (khớp công nợ)
SELECT 32, 'Mig 192 (doanh số trừ hàng trả, kể cả phiếu tự sinh Chờ xử lý)',
  CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'returns' AND column_name = 'revenue_date')
       THEN 'CHƯA — doanh thu vẫn là tổng hóa đơn gộp, lệch công nợ khi có hàng trả'
       WHEN EXISTS (SELECT 1 FROM returns r JOIN sales_invoices si ON si.id = r.invoice_id
                    WHERE r.credit_with_invoice AND r.status IN ('submitted', 'completed')
                      AND si.status = 'posted' AND r.revenue_date IS DISTINCT FROM si.invoice_date)
       THEN 'LỆCH — có phiếu tự sinh chưa có ngày trừ doanh số, chạy lại mig 192'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 33. Mig 193 — số phiếu trả TH-xxxx
SELECT 33, 'Mig 193 (phiếu trả có số TH-)',
  CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'returns' AND column_name = 'return_code')
       THEN 'CHƯA — phiếu trả chưa có số, ô tìm theo TH- báo lỗi'
       WHEN EXISTS (SELECT 1 FROM returns WHERE return_code IS NULL)
       THEN 'LỆCH — còn phiếu trả chưa có số, chạy lại mig 193'
       ELSE 'OK — đã vá' END, ''
) t ORDER BY stt;
