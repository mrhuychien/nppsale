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
  -- Mig 194 viết lại assign_doc_seller: phần "phiếu trả đi theo HĐ" nay do trigger trg_hoa_don_doi_nguoi.
  CASE WHEN position('(mig 182)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) > 0
            AND (position('(mig 182)' IN pg_get_functiondef('public.assign_doc_seller(text, uuid, uuid)'::regprocedure)) > 0
                 OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hoa_don_doi_nguoi'))
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
UNION ALL
-- 34. Mig 194 — công nợ theo nhân viên khớp doanh số
SELECT 34, 'Mig 194 + 195 (người đứng tên công nợ khớp doanh số, bỏ kẹp 0 ở Công nợ theo NV)',
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hoa_don_doi_nguoi')
            OR position('GREATEST(0, COALESCE(rc.amount' IN pg_get_functiondef('public.receivables_by_rep()'::regprocedure)) > 0
       THEN 'CHƯA — công nợ theo NV lệch doanh số NV (nợ kẹt người cũ, kẹp 0 dư có)'
       WHEN EXISTS (SELECT 1 FROM receivables rc JOIN sales_invoices si ON si.id = rc.invoice_id
                    WHERE rc.sales_user_id IS DISTINCT FROM si.sales_user_id)
       THEN 'LỆCH — còn dòng nợ khác người HĐ, chạy lại mig 194'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 35. Mig 196 — mục tiêu doanh số cho trang chủ NVBH
SELECT 35, 'Mig 196 (mục tiêu doanh số trên trang chủ NVBH)',
  CASE WHEN to_regprocedure('public.my_sales_target()') IS NULL
       THEN 'CHƯA — trang chủ NVBH không hiện % mục tiêu'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 36. Mig 197 — NVBH không đọc được lương / thưởng / chấm công
SELECT 36, 'Mig 197 (khoá bảng nhân sự với NVBH)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND cmd = 'SELECT'
                      AND tablename IN ('hr_salary_config', 'hr_monthly_bonus', 'hr_attendance')
                      AND position('user_role()' IN qual) = 0)
       THEN 'CHƯA — NVBH gọi API vẫn đọc được cấu hình lương / thưởng / chấm công'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 37. Mig 198 — NVBH đọc được phiếu trả thuộc về mình (trang chủ / báo cáo trừ hàng trả)
SELECT 37, 'Mig 198 (NVBH thấy phiếu trả tự sinh của HĐ mình)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = 'returns' AND policyname = 'Sales see own returns'
                      AND position('sales_user_id' IN qual) > 0)
       THEN 'OK — đã vá'
       ELSE 'CHƯA — doanh số NVBH (trang chủ, báo cáo) chưa trừ phiếu trả tự sinh' END, ''
UNION ALL
-- 38. Mig 199 — công nợ theo khách không kẹp 0 (khớp theo nhân viên)
SELECT 38, 'Mig 199 (Công nợ theo KH khớp Công nợ theo NV)',
  CASE WHEN position('GREATEST(0, COALESCE(rc.amount' IN pg_get_functiondef('public.receivables_by_customer()'::regprocedure)) > 0
       THEN 'CHƯA — tổng công nợ theo khách cao hơn theo nhân viên (dư có bị kẹp 0)'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 39. Mig 200 — phiếu trả hoàn thành phải gắn HĐ; phiếu cấn ở phiếu thu kiểu cũ không trừ hai lần
SELECT 39, 'Mig 200 (phiếu trả hoàn thành gắn HĐ; không trừ hai lần)',
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_phieu_tra_hoan_thanh_gan_hd')
            OR position('applied_receipt_id IS NULL' IN pg_get_functiondef('public._wf2b_recompute_receivable(uuid)'::regprocedure)) = 0
       THEN 'CHƯA — phiếu trả theo đơn chưa xuất HĐ vẫn hoàn thành được; phiếu cấn ở phiếu thu cũ bị trừ hai lần'
       WHEN EXISTS (SELECT 1 FROM returns WHERE status = 'completed' AND invoice_id IS NULL AND order_id IS NOT NULL)
       THEN 'LỆCH — còn phiếu hoàn thành theo đơn chưa gắn HĐ, xem nhóm 7 của kiem-phieu-tra.sql'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 40. Mig 201 — nhân viên xem phiếu lương của mình
SELECT 40, 'Mig 201 (Phiếu lương của tôi)',
  CASE WHEN to_regprocedure('public.my_payslips()') IS NULL
       THEN 'CHƯA — màn Phiếu lương của tôi báo lỗi'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 41. Mig 202 — NVBH chỉ còn module bán hàng (tắt ô quyền cũ, bỏ lập phiếu thu)
SELECT 41, 'Mig 202 (NVBH chỉ còn bán hàng)',
  CASE WHEN EXISTS (SELECT 1 FROM role_permissions WHERE role = 'sales' AND allowed
                      AND module = 'receivables' AND action = 'create')
       THEN 'CHƯA — NVBH còn lập phiếu thu / ô quyền cũ'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 42. Mig 203 — tìm khách theo cả địa chỉ (tim_kd có địa chỉ)
SELECT 42, 'Mig 203 (Tìm khách theo địa chỉ)',
  -- So sau khi bỏ mọi thứ ngoài a-z0-9: đúng cho cả khoá kiểu mig 177/203 lẫn khoá mig 205.
  CASE WHEN EXISTS (SELECT 1 FROM customers WHERE COALESCE(address, '') <> ''
                      AND regexp_replace(COALESCE(tim_kd, ''), '[^a-z0-9]', '', 'g')
                          NOT LIKE '%' || regexp_replace(public.khong_dau(address), '[^a-z0-9]', '', 'g') || '%')
       THEN 'CHƯA — gõ địa chỉ không dấu không ra khách'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 43. Mig 204 — báo cáo tổng hợp đọc một lượt ở máy chủ
SELECT 43, 'Mig 204 (Báo cáo đọc một lượt)',
  CASE WHEN to_regprocedure('public.bao_cao_so_ban(date, date)') IS NULL
         OR to_regprocedure('public.bao_cao_cong_no(date, date)') IS NULL
         OR to_regprocedure('public.bao_cao_ton_kho(date, date)') IS NULL
       THEN 'CHƯA — báo cáo vẫn chạy nhưng đọc từng bảng (chậm)'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 44. Mig 205 — tìm kiếm chung: khoá tìm (mã viết liền, bỏ số 0 đầu), cột tính tim_kd
--     cho bảng chứng từ, chỉ mục trigram
SELECT 44, 'Mig 205 (Tìm kiếm chung: từng từ, không dấu, mã viết liền)',
  -- ⚠ Gọi hàm của mig 205 qua query_to_xml: sổ chưa chạy mig 205 thì gọi thẳng là cả
  --   phiếu khám báo lỗi "function does not exist" ngay lúc dịch câu.
  CASE WHEN to_regprocedure('public.khoa_tim(text)') IS NULL
            OR to_regprocedure('public.tim_kd(public.sales_orders)') IS NULL
       THEN 'CHƯA — gõ "dh0123" không ra DH-0123, tìm người lập không dấu không ra'
       WHEN (xpath('/row/k/text()', query_to_xml($q$SELECT public.khoa_tim('DH-0123') || '|' ||
              public.khoa_tim(U&'S\1eefa h\1ed9p \0110\00e0 N\1eb5ng') AS k$q$, false, true, '')))[1]::text
            <> 'dh 0123 dh0123 dh123|sua hop da nang suahopdanang'
       THEN 'LỆCH — khoa_tim() không còn trùng viValueKey (src/lib/search.ts)'
       WHEN (xpath('/row/n/text()', query_to_xml($q$SELECT count(*) AS n FROM products
              WHERE tim_kd IS DISTINCT FROM public.khoa_tim_ds(sku::text, name::text, barcode::text)$q$,
              false, true, '')))[1]::text <> '0'
       THEN 'LỆCH — còn hàng có tim_kd kiểu cũ, chạy lại mig 205'
       WHEN NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sales_orders_tim_kd_trgm')
       THEN 'CHƯA — thiếu chỉ mục trigram, ô tìm quét cả bảng'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 45. Mig 206 — PostgREST đếm theo nhóm (chip trạng thái đếm một lượt)
SELECT 45, 'Mig 206 (Đếm theo nhóm — bớt log Supabase)',
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                         WHERE r.rolname = 'authenticator'
                           AND 'pgrst.db_aggregates_enabled=true' = ANY (s.setconfig))
       THEN 'CHƯA — chip trạng thái vẫn đếm từng lượt (nhiều log)'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 46. Mig 207 — dọn cảnh báo bảo mật (anon không gọi được hàm SECURITY DEFINER, search_path, kho ảnh)
SELECT 46, 'Mig 207 (Dọn cảnh báo bảo mật Supabase)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND p.prosecdef AND p.proname <> 'lookup_email_by_identifier'
                       AND has_function_privilege('anon', p.oid, 'EXECUTE'))
       THEN 'CHƯA — còn hàm SECURITY DEFINER gọi được khi chưa đăng nhập'
       WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
                     AND policyname IN ('customer_photos_select', 'pod_photos_select', 'visit_photos_select'))
       THEN 'CHƯA — kho ảnh công khai còn liệt kê được mọi file'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 47. Mig 208 — NVBH được xem trả hàng (mẫu quyền, chủ nhà 27/09/2026)
SELECT 47, 'Mig 208 (NVBH xem trả hàng)',
  CASE WHEN EXISTS (SELECT 1 FROM organizations o
                     WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp
                                        WHERE rp.org_id = o.id AND rp.role = 'sales'
                                          AND rp.module = 'returns' AND rp.action = 'read' AND rp.allowed))
       THEN 'CHƯA — NVBH chưa vào được màn Trả hàng của tôi'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 48. Mig 209 — số phiên danh mục bán hàng (máy NVBH thấy sản phẩm / giá mới trong ~2 phút)
SELECT 48, 'Mig 209 (Số phiên danh mục bán hàng)',
  CASE WHEN to_regclass('public.danh_muc_ban_phien') IS NULL
       THEN 'CHƯA — NVBH thấy sản phẩm / giá mới chậm tới 30 phút'
       WHEN (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_phien_danh_muc_ban') < 3
       THEN 'LỆCH — thiếu trigger trên products / price_lists / product_units, chạy lại mig 209'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 49. Mig 210 — sửa hóa đơn có phiếu trả đã nhập kho (hỏi huỷ phiếu nhập / giữ nguyên)
SELECT 49, 'Mig 210 (Sửa HĐ có phiếu trả đã nhập kho)',
  CASE WHEN to_regprocedure('public._tra_da_nhap_truoc_lap_lai(uuid, jsonb)') IS NULL
         OR position('(mig 210)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) = 0
       THEN 'CHƯA — hóa đơn có phiếu trả đã nhập kho không sửa được (LOCKED_RETURN_DONE)'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 50. Mig 211 — chọn ngày nhập kho phiếu trả tự sinh
SELECT 50, 'Mig 211 (Ngày nhập kho phiếu trả tự sinh)',
  CASE WHEN to_regprocedure('public.complete_return(uuid, text, date)') IS NULL
       THEN 'CHƯA — phiếu trả tự sinh chưa chọn được ngày nhập kho'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 51. Mig 212 — nhóm sai tiền (dư có, huỷ phiếu thu, dòng âm, khách khác, hàng đổi)
SELECT 51, 'Mig 212 (Sửa nhóm sai tiền)',
  CASE WHEN position('(mig 212)' IN pg_get_functiondef('public.void_cash_receipt(uuid, text)'::regprocedure)) = 0
         OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_phieu_tra_dung_khach_hoa_don')
       THEN 'CHƯA — dư có bị giấu khỏi tổng nợ, huỷ phiếu thu có thể mất tiền'
       WHEN EXISTS (SELECT 1 FROM receivables WHERE status = 'paid' AND abs(COALESCE(paid, 0) - COALESCE(amount, 0)) >= 0.01)
       THEN 'LỆCH — còn dòng công nợ ''đã trả'' mà số chưa khớp, chạy lại mig 212'
       WHEN EXISTS (SELECT 1 FROM returns r JOIN sales_invoices si ON si.id = r.invoice_id
                     WHERE r.status <> 'cancelled' AND r.customer_id IS DISTINCT FROM si.customer_id)
       THEN 'LỆCH — có phiếu trả gắn hoá đơn của khách khác, phải xem tay'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 52. Mig 213 — sửa HĐ giữ ngày / giảm giá; phiếu trả tự lập không bị biến thành tự sinh
SELECT 52, 'Mig 213 (Sửa HĐ giữ ngày, giảm giá; phiếu tự lập)',
  CASE WHEN position('(mig 213)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) = 0
         OR position('(mig 213)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) = 0
       THEN 'CHƯA — sửa HĐ có thể mất giảm giá đơn / dời ngày; phiếu tự lập bị biến thành tự sinh'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 53. Mig 214 — khoá ghi thẳng tiền / phiếu trả / số đã xuất từ trình duyệt
SELECT 53, 'Mig 214 (Khoá ghi thẳng tiền, phiếu trả)',
  CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN (
              'trg_khoa_ghi_thang_cong_no', 'trg_khoa_ghi_thang_payments', 'trg_khoa_ghi_thang_dong_phieu_thu',
              'trg_khoa_ghi_thang_phieu_thu', 'trg_khoa_ghi_thang_phieu_tra', 'trg_khoa_ghi_thang_dong_tra',
              'trg_khoa_ghi_thang_da_xuat')) < 7
       THEN 'CHƯA — trình duyệt còn sửa thẳng được công nợ / phiếu thu / phiếu trả'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 54. Mig 215 — đơn đã đóng sửa HĐ được; phiếu thu chống gửi trùng; quyền QL / thủ kho
SELECT 54, 'Mig 215 (Đơn đã đóng, phiếu thu trùng, quyền)',
  CASE WHEN position('(mig 215)' IN pg_get_functiondef('public.create_cash_receipt(jsonb)'::regprocedure)) = 0
         OR position('(mig 215)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) = 0
       THEN 'CHƯA — bấm Lưu phiếu thu hai lần ra hai phiếu; không sửa được HĐ của đơn đã đóng'
       WHEN EXISTS (SELECT 1 FROM organizations o WHERE NOT EXISTS (
              SELECT 1 FROM role_permissions rp WHERE rp.org_id = o.id AND rp.role = 'warehouse'
                AND rp.module = 'returns' AND rp.action = 'approve' AND rp.allowed))
       THEN 'LỆCH — thủ kho chưa có quyền nhập kho phiếu trả, chạy lại mig 215'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 55. Mig 216 — sửa HĐ chọn "huỷ phiếu nhập": phiếu trả về Chờ xử lý, không tự nhập kho lại
SELECT 55, 'Mig 216 (Sửa HĐ: phiếu trả về Chờ xử lý)',
  CASE WHEN position('complete_return' IN pg_get_functiondef('public._tra_da_nhap_sau_lap_lai(uuid)'::regprocedure)) > 0
       THEN 'CHƯA — sửa HĐ chọn huỷ phiếu nhập vẫn tự nhập kho lại'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 56. Mig 217 — huỷ HĐ = huỷ đơn; một đơn một HĐ; bỏ xuất một phần / đóng đơn
SELECT 56, 'Mig 217 (Huỷ HĐ = huỷ đơn, một đơn một HĐ)',
  CASE WHEN position('(mig 217)' IN pg_get_functiondef('public.cancel_invoice(uuid, text)'::regprocedure)) = 0
       THEN 'CHƯA — huỷ HĐ vẫn đưa đơn về Phiếu tạm, phiếu trả về Nháp'
       WHEN EXISTS (SELECT 1 FROM sales_orders WHERE status IN ('partially_invoiced', 'closed'))
       THEN 'LỖI — còn ' || (SELECT count(*) FROM sales_orders WHERE status IN ('partially_invoiced', 'closed')) || ' đơn Xuất một phần / Đã đóng'
       WHEN NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_sales_invoices_mot_don_mot_hd')
       THEN 'LỖI — có đơn nhiều HĐ ghi sổ, chưa dựng được chỉ mục một-đơn-một-HĐ'
       ELSE 'OK — đã vá' END,
  'Trước khi chạy mig: đơn nhiều HĐ = ' || (SELECT count(*) FROM (SELECT order_id FROM sales_invoices WHERE status = 'posted' AND order_id IS NOT NULL
     GROUP BY order_id HAVING count(*) > 1) x)
UNION ALL
-- 57. Mig 218 — chênh lệch theo giá lúc bán + chênh trả (báo cáo bán theo nhân viên)
SELECT 57, 'Mig 218 (Chênh lệch giá lúc bán, chênh trả)',
  CASE WHEN position('dong_hd_goc' IN pg_get_functiondef('public.bao_cao_so_ban(date, date)'::regprocedure)) = 0
       THEN 'CHƯA — chênh lệch báo cáo nhân viên lùi về bảng giá chung hiện tại, chưa có chênh trả'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 58. Mig 219 — nhập kho chọn kho nhận (kho bán / kho date)
SELECT 58, 'Mig 219 (Nhập kho chọn Kho bán / Kho date)',
  CASE WHEN position('v_zone' IN pg_get_functiondef('public.post_stock_import(jsonb)'::regprocedure)) = 0
       THEN 'CHƯA — phiếu nhập kho luôn vào kho bán dù chọn Kho date'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 59. Mig 220 — giờ sửa cuối của đơn / hoá đơn / phiếu trả (mẫu in)
SELECT 59, 'Mig 220 (Giờ sửa cuối trên mẫu in)',
  CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'updated_at'
               AND table_name IN ('sales_orders', 'sales_invoices', 'returns')) < 3
         OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_zzz_sua_luc') < 6
       THEN 'CHƯA — tờ in vẫn mang giờ tạo lần đầu'
       ELSE 'OK — đã vá' END, ''
UNION ALL
-- 60. Mig 221 — nhắc khách chưa gán tuyến (loại thông báo + cột hạ nhiệt)
SELECT 60, 'Mig 221 (Nhắc khách chưa gán tuyến)',
  CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                          AND table_name = 'customers' AND column_name = 'route_reminder_sent_at')
         OR position('customer_route_missing' IN coalesce((SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                          WHERE c.conname = 'notifications_type_check'), '')) = 0
       THEN 'CHƯA — cron không ghi được thông báo khách chưa gán tuyến'
       ELSE 'OK — đã vá' END,
  'Khách đang bán chưa có tuyến: ' || (SELECT count(*) FROM customers WHERE status = 'active' AND coalesce(trim(channel), '') = '')
UNION ALL
-- 61. Mig 222 — bật "cho bán vượt tồn" thì trả NCC / phiếu xuất kho cũng xuất âm được
SELECT 61, 'Mig 222 (Xuất âm: trả NCC, phiếu xuất kho)',
  CASE WHEN position('v_cho_am' IN pg_get_functiondef('public.complete_supplier_return(uuid)'::regprocedure)) = 0
         OR position('v_cho_am' IN pg_get_functiondef('public.post_stock_issue(uuid)'::regprocedure)) = 0
       THEN 'CHƯA — trả NCC / phiếu xuất kho vẫn chặn tồn âm dù đã bật cho bán vượt tồn'
       ELSE 'OK — đã vá' END,
  CASE WHEN (SELECT bool_or(allow_oversell) FROM organizations) THEN 'Đang bật cho bán vượt tồn' ELSE 'Đang tắt cho bán vượt tồn' END
UNION ALL
-- 62. Mig 223 — nhân viên nghỉ việc: bàn giao khách + công nợ về NPP
SELECT 62, 'Mig 223 (Nhân viên nghỉ việc, nợ về NPP)',
  CASE WHEN to_regprocedure('public.cho_nhan_vien_nghi(uuid)') IS NULL
         OR to_regprocedure('public.giao_cong_no_npp(uuid,uuid)') IS NULL
         OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cong_no_giu_ve_npp')
       THEN 'CHƯA — xoá nhân viên đã có chứng từ báo lỗi, chưa có Cho nghỉ việc'
       ELSE 'OK — đã vá' END,
  CASE WHEN to_regprocedure('public.cho_nhan_vien_nghi(uuid)') IS NULL THEN ''
       ELSE 'Nợ NPP đang giữ (chưa phân lại): ' || (SELECT count(*) FROM receivables
              WHERE status <> 'paid' AND (to_jsonb(receivables) ->> 've_npp_luc') IS NOT NULL) END
UNION ALL
-- 63. Mig 224 — đánh dấu hoá đơn đã soạn hàng
SELECT 63, 'Mig 224 (Đánh dấu đã soạn hàng)',
  CASE WHEN to_regprocedure('public.danh_dau_soan_hang(uuid[],boolean)') IS NULL
       THEN 'CHƯA — màn Soạn hàng không lọc / đánh dấu được hoá đơn đã soạn'
       ELSE 'OK — đã vá' END,
  ''
UNION ALL
-- 64. Mig 225 — lượt soạn hàng (nhặt tổng → chia rổ → hoàn tất), dùng chung máy tính + điện thoại
SELECT 64, 'Mig 225 (Lượt soạn hàng)',
  CASE WHEN to_regclass('public.luot_soan') IS NULL OR to_regprocedure('public.hoan_tat_luot_soan(uuid)') IS NULL
       THEN 'CHƯA — màn Soạn hàng không lưu được lượt nhặt / chia rổ'
       ELSE 'OK — đã vá' END,
  CASE WHEN to_regclass('public.luot_soan') IS NULL THEN ''
       ELSE 'Lượt đang soạn: ' || (SELECT count(*) FROM luot_soan WHERE trang_thai = 'dang_soan') END
UNION ALL
-- 65. Mig 226 — sửa lỗi bán hàng: quyền giảm giá chốt ở máy chủ, ngày đơn giờ VN, mốc gửi thẳng, SL > 0
SELECT 65, 'Mig 226 (Quyền giảm giá ở máy chủ, ngày đơn giờ VN)',
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_quyen_gia_dong_don')
         OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_quyen_giam_don')
         OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_don_moi_moc_gui')
         OR (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
             JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
             WHERE d.adrelid = 'public.sales_orders'::regclass AND a.attname = 'order_date') NOT ILIKE '%vn_today%'
       THEN 'CHƯA — NVBH ghi được giảm giá vượt quyền qua RPC; đơn 0h–7h mang ngày hôm qua'
       ELSE 'OK — đã vá' END,
  'Dòng đơn SL ≤ 0 / giá âm: ' || (SELECT count(*) FROM sales_order_lines WHERE quantity <= 0 OR unit_price < 0 OR line_discount < 0)
    || ' · NV bật giảm giá: ' || (SELECT count(*) FROM users WHERE role NOT IN ('owner', 'accountant') AND allow_discount)
UNION ALL
-- 66. Mig 227 — ngày VN cho HĐ / phiếu thu, khoá ghi thẳng công nợ NCC + credited_at, phiếu trả giá / thuế âm,
--     huỷ riêng phiếu kho của chứng từ đã đảo, Sửa HĐ giữ người giữ nợ
SELECT 66, 'Mig 227 (HĐ / trả hàng / công nợ / NCC — lỗi đội test 04/10)',
  CASE WHEN position('(mig 227)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) = 0
         OR position('(mig 227)' IN pg_get_functiondef('public.create_cash_receipt(jsonb)'::regprocedure)) = 0
         OR position('(mig 227)' IN pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure)) = 0
         OR position('(mig 227)' IN pg_get_functiondef('public.cancel_stock_entry(uuid, text)'::regprocedure)) = 0
         OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_khoa_ghi_thang_no_ncc')
       THEN 'CHƯA — HĐ / phiếu thu 0h–7h mang ngày hôm qua, công nợ NCC ghi thẳng được, huỷ riêng được phiếu kho của HĐ đã huỷ'
       ELSE 'OK — đã vá' END,
  'NCC paid ≠ Σ phiếu chi: ' || (SELECT count(*) FROM payables p
      WHERE abs(COALESCE(p.paid, 0) - COALESCE((SELECT sum(pp.amount) FROM payable_payments pp WHERE pp.payable_id = p.id), 0)) >= 0.01)
  || ' · dòng trả giá / thuế âm: ' || (SELECT count(*) FROM return_lines WHERE unit_price < 0 OR vat_rate < 0 OR vat_rate > 1)
  || ' · phiếu kho của chứng từ đã đảo bị huỷ riêng: ' || (SELECT count(*) FROM stock_entries se WHERE se.status = 'cancelled'
      AND (se.notes LIKE 'Hoàn kho do huỷ hóa đơn %' OR se.notes LIKE 'Nhập lại từ phiếu trả %'
           OR EXISTS (SELECT 1 FROM sales_invoices si WHERE si.stock_entry_id = se.id AND si.status <> 'posted')))
  || ' · nợ HĐ bị đẩy về NPP lúc Sửa HĐ: ' || (SELECT count(*) FROM receivables r JOIN sales_invoices si ON si.id = r.invoice_id
      WHERE si.replaced_from IS NOT NULL AND r.ve_npp_luc = si.created_at)
UNION ALL
-- 67. Mig 228 — cổng vai 166, thẻ kho theo kho, kiểm kê số lẻ, mã đơn / mã PO theo NPP, giá vốn + mốc ngày giờ VN,
--     phải thu trên bảng cân đối trừ dư có
SELECT 67, 'Mig 228 (Sửa lỗi kho & báo cáo)',
  CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc LIKE '%(mig 166)%'
               AND proname IN ('post_stock_issue', 'complete_supplier_return', 'cancel_supplier_return')) < 3
         OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
               WHERE attrelid = 'public.stock_entry_lines'::regclass AND attname = 'quantity') <> 'numeric'
         OR to_regclass('public.idx_sales_orders_code') IS NULL
         OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_orders_order_code_key')
         OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_po_code_key')
         OR position('Asia/Ho_Chi_Minh' IN pg_get_functiondef('public.finance_pnl(date,date)'::regprocedure)) = 0
         OR position('Asia/Ho_Chi_Minh' IN pg_get_functiondef('public.finance_cash_flow(date,date)'::regprocedure)) = 0
         OR position('Đảo phiếu trả' IN pg_get_functiondef('public.bao_cao_so_ban(date,date)'::regprocedure)) = 0
         OR position(':dich' IN pg_get_viewdef('public.v_stock_movements'::regclass)) = 0
       THEN 'CHƯA — NVBH ghi sổ được phiếu xuất kho / trả NCC; thẻ kho theo kho sai khi chuyển kho; kiểm kê số lẻ không lưu; NPP thứ hai trùng mã đơn; giá vốn P&L gồm HĐ huỷ, lệch ngày UTC'
       ELSE 'OK — đã vá' END,
  'Thẻ kho ≠ tồn lô theo kho: ' || (
    SELECT count(*) FROM (
      SELECT b.org_id, b.product_id, b.warehouse_zone, sum(b.qty_on_hand) AS ton
        FROM batches b GROUP BY 1, 2, 3) t
     WHERE abs(t.ton - COALESCE((SELECT sum(m.signed_qty_in_base_uom) FROM v_stock_movements m
                                  WHERE m.org_id = t.org_id AND m.product_id = t.product_id
                                    AND m.warehouse_zone = t.warehouse_zone AND m.entry_status = 'posted'), 0)) > 0.0001)
    || ' mặt hàng-kho (dữ liệu cũ / lô đổi kho tự động có thể lệch)'
UNION ALL
-- 68. Mig 229 — giá trần chốt ở máy chủ (chủ nhà 04/10/2026: "có")
SELECT 68, 'Mig 229 (Giá trần ở máy chủ)',
  CASE WHEN position('PRICE_OVER_CEILING' IN pg_get_functiondef('public._chot_gia_dong_don()'::regprocedure)) = 0
       THEN 'CHƯA — NVBH gọi thẳng RPC / ghi thẳng dòng đơn thì nâng giá bao nhiêu cũng được'
       ELSE 'OK — đã vá' END,
  'NVBH được sửa giá: ' || (SELECT count(*) FROM users WHERE role = 'sales' AND allow_price_edit)
) t ORDER BY stt;
