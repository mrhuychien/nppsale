-- ====================================================================
-- MƯỜI BA BẢNG KHÔNG HỀ HỎI "THUỘC NPP NÀO"
--
-- Rơi ra trong lúc rà soát 22/09/2026 theo yêu cầu của chủ nhà ("rà
-- soát lại xem còn rule nào ngớ ngẩn như rule vừa rồi ko").
--
-- ⚠ ĐÃ ĐO TRÊN POSTGRES 16 THẬT. Dựng NPP thứ hai, một nhà cung cấp của
--   NPP ấy, rồi đăng nhập bằng QUẢN LÝ của NPP thứ nhất:
--
--     org người đăng nhập = a0000000-…-0001, vai = manager
--     sửa NCC của NPP KHÁC: 1 dòng
--     xoá NCC của NPP KHÁC: 1 dòng
--
--   Không phải suy đoán. Quản lý của nhà này sửa và xoá được dữ liệu
--   của nhà khác.
--
-- ⚠ VÌ SAO LỌT: chính sách chỉ hỏi VAI TRÒ, không hỏi NPP —
--   `USING (public.user_role() IN ('owner','manager','warehouse'))`.
--   `user_role()` đọc vai của người đang đăng nhập và không nói gì về
--   dòng đang bị đụng, nên nó đúng với MỌI dòng trong bảng.
--
-- ⚠ VÀ ĐÃ CÓ NGƯỜI THỬ VÁ RỒI, VÁ KHÔNG ĂN. `suppliers` có thêm
--   `Authenticated can view suppliers USING (org_id = user_org_id())`;
--   `payables`, `purchase_orders`, `purchase_invoices` cũng có một
--   chính sách "view" hỏi đúng org. Nhưng CHÍNH SÁCH PERMISSIVE CỘNG
--   VÀO NHAU BẰNG "HOẶC" — thêm một chính sách chặt hơn KHÔNG bao giờ
--   thu hẹp được cái đang rộng. Chừng nào chính sách FOR ALL kia còn
--   đó thì lỗ vẫn nguyên. Phải VIẾT LẠI chính sách rộng, không thêm
--   chính sách hẹp.
--
-- ⚠ BỐN BẢNG NHÂN SỰ CÒN ĐỂ NGỎ CẢ ĐƯỜNG ĐỌC: `hr_salary_config`,
--   `hr_monthly_bonus`, `hr_attendance` có chính sách đọc là
--   `USING (true)`. Bất kỳ ai đăng nhập đọc được cấu hình lương và bảng
--   chấm công của MỌI NPP. `hr_payroll` thì chủ/kế toán/quản lý đọc
--   được bảng lương của mọi NPP.
--
-- ⚠ HÔM NAY TRONG SỔ CHỈ CÓ MỘT NPP THÌ CHƯA RÒ RA ĐÂU CẢ. Ngày có NPP
--   thứ hai là rò ngay, và không có gì báo. Vá trước khi cần.
--
-- ⚠ QUÉT ĐẦU CỦA TÔI BỎ SÓT NĂM BẢNG, và lý do đáng ghi lại: tôi lọc
--   "bảng nào CÓ cột org_id mà chính sách không nhắc org_id". Năm bảng
--   CON (`purchase_invoice_lines`, `purchase_order_lines`,
--   `supplier_return_lines`, `payable_payments`, `merged_orders`) không
--   có cột ấy nên rơi khỏi lưới. Phép lọc tìm đúng thứ nó được bảo tìm
--   và im lặng về phần còn lại. Xem mục 4.
--
-- ⚠ SIẾT CHÍNH SÁCH CÓ THỂ LÀM DÒNG BIẾN MẤT — NÊN KIỂM TRƯỚC. Nếu một
--   bảng có dòng `org_id IS NULL` thì thêm vế `org_id = user_org_id()`
--   là giấu dòng ấy khỏi tất cả mọi người, âm thầm. Mục 1 dưới đây
--   DỪNG migration lại nếu gặp. (Đã đo: cả tám bảng có cột org_id đều
--   NOT NULL; năm bảng con hỏi qua bảng cha nên không có chuyện ấy.)
--
-- ⚠ KHÔNG ĐỤNG VAI TRÒ NÀO. Migration này chỉ THÊM vế "và phải cùng
--   NPP". Ai đang làm được gì thì vẫn làm được đúng thế, trong nhà mình.
--
-- ⚠ ĐÁNH SỐ 163. `main` giữ 158, 160, 162; `newdesign` giữ 156, 157,
--   159, 161.
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. Không bảng nào được có dòng mồ côi org_id
-- ---------------------------------------------------------------------
DO $kiem$
DECLARE r record; v_bao text := '';
BEGIN
  FOR r IN
    SELECT unnest(ARRAY['suppliers','payables','purchase_orders','purchase_invoices',
                        'hr_payroll','hr_attendance','hr_monthly_bonus','hr_salary_config']) AS t
  LOOP
    -- ⚠ Bảng chưa tồn tại thì bỏ qua chứ đừng nổ: một bản cài cũ có thể
    --   chưa chạy tới migration dựng bảng ấy.
    IF to_regclass('public.' || r.t) IS NULL THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = ('public.' || r.t)::regclass
        AND a.attname = 'org_id' AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attnotnull
    ) THEN
      DECLARE v_n bigint;
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id IS NULL', r.t) INTO v_n;
        IF v_n > 0 THEN
          v_bao := v_bao || format(E'\n  · %s: %s dòng', r.t, v_n);
        END IF;
      END;
    END IF;
  END LOOP;

  IF v_bao <> '' THEN
    RAISE EXCEPTION
      'ORG_NULL: có dòng không mang org_id. Siết chính sách bây giờ là GIẤU chúng khỏi mọi người. Điền org_id rồi chạy lại:%',
      v_bao
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE '163: tám bảng đều có org_id đầy đủ — siết được mà không giấu dòng nào.';
END;
$kiem$;

-- ---------------------------------------------------------------------
-- 2. Nhà cung cấp / mua hàng / công nợ phải trả
-- ---------------------------------------------------------------------
--
-- ⚠ VIẾT LẠI ĐÚNG CHÍNH SÁCH FOR ALL ĐANG RỘNG, không thêm cái mới.
--   Thêm là "hoặc", và "hoặc" với một vế luôn đúng thì vẫn luôn đúng.
--
-- ⚠ CÓ CẢ `WITH CHECK`. Thiếu nó thì `USING` được dùng lại cho lệnh
--   ghi, nhưng khi đã viết ra thì viết cả hai cho rõ: đọc/sửa/xoá phải
--   là dòng của nhà mình, và ghi vào cũng phải ghi cho nhà mình —
--   không ai chèn được một dòng mang `org_id` của NPP khác.

DROP POLICY IF EXISTS "Owner/Manager can manage suppliers" ON suppliers;
CREATE POLICY "Owner/Manager can manage suppliers"
  ON suppliers FOR ALL TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse')
  );

DROP POLICY IF EXISTS "Manage payables" ON payables;
CREATE POLICY "Manage payables"
  ON payables FOR ALL TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'accountant')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'accountant')
  );

DROP POLICY IF EXISTS "Manage POs" ON purchase_orders;
CREATE POLICY "Manage POs"
  ON purchase_orders FOR ALL TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'warehouse')
  );

DROP POLICY IF EXISTS "Manage purchase invoices" ON purchase_invoices;
CREATE POLICY "Manage purchase invoices"
  ON purchase_invoices FOR ALL TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
  );

-- ---------------------------------------------------------------------
-- 3. Bốn bảng nhân sự — cả đường ghi lẫn đường ĐỌC
-- ---------------------------------------------------------------------
--
-- ⚠ ĐƯỜNG ĐỌC MỚI LÀ CHỖ ĐAU. `USING (true)` nghĩa là bất kỳ ai đăng
--   nhập — kể cả NVBH của một NPP khác — đọc được cấu hình lương và
--   bảng chấm công. Tiền lương là thứ người ta không muốn đồng nghiệp
--   cùng nhà đọc, nói gì tới nhà khác.
--
-- ⚠ GIỮ NGUYÊN AI ĐỌC ĐƯỢC GÌ TRONG NHÀ. `hr_attendance` vẫn cho mọi
--   người trong nhà xem (lưới chấm công cần thế — xem mig 007);
--   `hr_payroll` vẫn là "phiếu của chính mình, hoặc chủ/kế toán/quản
--   lý". Chỉ thêm vế "và phải cùng NPP".

DROP POLICY IF EXISTS "View salary config" ON hr_salary_config;
CREATE POLICY "View salary config"
  ON hr_salary_config FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Manage salary config" ON hr_salary_config;
CREATE POLICY "Manage salary config"
  ON hr_salary_config FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() = 'owner')
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() = 'owner');

DROP POLICY IF EXISTS "View monthly bonus" ON hr_monthly_bonus;
CREATE POLICY "View monthly bonus"
  ON hr_monthly_bonus FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Manage monthly bonus" ON hr_monthly_bonus;
CREATE POLICY "Manage monthly bonus"
  ON hr_monthly_bonus FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() = 'owner')
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() = 'owner');

DROP POLICY IF EXISTS "View attendance" ON hr_attendance;
CREATE POLICY "View attendance"
  ON hr_attendance FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "Manage attendance" ON hr_attendance;
CREATE POLICY "Manage attendance"
  ON hr_attendance FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "View own payroll" ON hr_payroll;
CREATE POLICY "View own payroll"
  ON hr_payroll FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      user_id = (SELECT auth.uid())
      OR public.user_role() IN ('owner', 'accountant', 'manager')
    )
  );

DROP POLICY IF EXISTS "Manage payroll" ON hr_payroll;
CREATE POLICY "Manage payroll"
  ON hr_payroll FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'));

-- ---------------------------------------------------------------------
-- 4. Năm bảng CON — không có cột org_id, phải hỏi qua bảng cha
-- ---------------------------------------------------------------------
--
-- ⚠ QUÉT ĐẦU CỦA TÔI BỎ SÓT ĐÚNG NĂM BẢNG NÀY, và vì một lý do đáng ghi
--   lại: tôi lọc "bảng nào CÓ cột org_id mà chính sách không nhắc tới
--   org_id". Năm bảng dưới đây KHÔNG có cột ấy — chúng là bảng con —
--   nên chúng rơi khỏi lưới. Phép lọc tìm đúng thứ nó được bảo tìm, và
--   im lặng về phần còn lại. Quét lại bằng câu hỏi đúng ("chính sách
--   GHI nào không hề nhắc org, auth.uid, user_id hay EXISTS") thì cả
--   năm hiện ra.
--
-- ⚠ HỎI THẲNG `org_id` CỦA BẢNG CHA, đừng dựa vào việc "RLS của bảng
--   cha sẽ tự lọc trong câu con". Nó có lọc thật, nhưng khi ấy sự an
--   toàn của bảng con phụ thuộc vào chính sách của bảng cha đứng yên —
--   một ràng buộc không ai đọc ra được khi sửa bảng cha. Viết thẳng.
--
-- ⚠ HÌNH DẠNG CHÉP TỪ CHÍNH CHÍNH SÁCH ĐỌC CỦA MỖI BẢNG, thứ đã làm
--   đúng sẵn. Chỗ sai chỉ nằm ở chính sách GHI.

DROP POLICY IF EXISTS "Manage pinv lines" ON purchase_invoice_lines;
CREATE POLICY "Manage pinv lines"
  ON purchase_invoice_lines FOR ALL TO authenticated
  USING (
    public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
    AND EXISTS (SELECT 1 FROM purchase_invoices pi
                WHERE pi.id = purchase_invoice_lines.invoice_id
                  AND pi.org_id = public.user_org_id())
  )
  WITH CHECK (
    public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
    AND EXISTS (SELECT 1 FROM purchase_invoices pi
                WHERE pi.id = purchase_invoice_lines.invoice_id
                  AND pi.org_id = public.user_org_id())
  );

DROP POLICY IF EXISTS "Manage PO lines" ON purchase_order_lines;
CREATE POLICY "Manage PO lines"
  ON purchase_order_lines FOR ALL TO authenticated
  USING (
    public.user_role() IN ('owner', 'manager', 'warehouse')
    AND EXISTS (SELECT 1 FROM purchase_orders po
                WHERE po.id = purchase_order_lines.po_id
                  AND po.org_id = public.user_org_id())
  )
  WITH CHECK (
    public.user_role() IN ('owner', 'manager', 'warehouse')
    AND EXISTS (SELECT 1 FROM purchase_orders po
                WHERE po.id = purchase_order_lines.po_id
                  AND po.org_id = public.user_org_id())
  );

DROP POLICY IF EXISTS "Manage supplier return lines" ON supplier_return_lines;
CREATE POLICY "Manage supplier return lines"
  ON supplier_return_lines FOR ALL TO authenticated
  USING (
    public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
    AND EXISTS (SELECT 1 FROM supplier_returns r
                WHERE r.id = supplier_return_lines.return_id
                  AND r.org_id = public.user_org_id())
  )
  WITH CHECK (
    public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
    AND EXISTS (SELECT 1 FROM supplier_returns r
                WHERE r.id = supplier_return_lines.return_id
                  AND r.org_id = public.user_org_id())
  );

DROP POLICY IF EXISTS "Manage payable payments" ON payable_payments;
CREATE POLICY "Manage payable payments"
  ON payable_payments FOR ALL TO authenticated
  USING (
    public.user_role() IN ('owner', 'accountant')
    AND EXISTS (SELECT 1 FROM payables p
                WHERE p.id = payable_payments.payable_id
                  AND p.org_id = public.user_org_id())
  )
  WITH CHECK (
    public.user_role() IN ('owner', 'accountant')
    AND EXISTS (SELECT 1 FROM payables p
                WHERE p.id = payable_payments.payable_id
                  AND p.org_id = public.user_org_id())
  );

-- ⚠ `merged_orders` KIỂM CẢ HAI ĐẦU. Chính sách đọc chỉ hỏi đơn ĐÍCH
--   (`merged_order_id`); với đường ghi mà chỉ hỏi một đầu thì gộp được
--   đơn của NPP KHÁC vào đơn của mình — hàng và tiền của nhà người ta
--   chạy sang sổ nhà mình.
DROP POLICY IF EXISTS "Owner/Manager can manage merged orders" ON merged_orders;
CREATE POLICY "Owner/Manager can manage merged orders"
  ON merged_orders FOR ALL TO authenticated
  USING (
    public.user_role() IN ('owner', 'manager')
    AND EXISTS (SELECT 1 FROM sales_orders so
                WHERE so.id = merged_orders.merged_order_id
                  AND so.org_id = public.user_org_id())
    AND EXISTS (SELECT 1 FROM sales_orders so
                WHERE so.id = merged_orders.source_order_id
                  AND so.org_id = public.user_org_id())
  )
  WITH CHECK (
    public.user_role() IN ('owner', 'manager')
    AND EXISTS (SELECT 1 FROM sales_orders so
                WHERE so.id = merged_orders.merged_order_id
                  AND so.org_id = public.user_org_id())
    AND EXISTS (SELECT 1 FROM sales_orders so
                WHERE so.id = merged_orders.source_order_id
                  AND so.org_id = public.user_org_id())
  );

-- ---------------------------------------------------------------------
-- 5. Tự kiểm — không còn chính sách nào quên hỏi NPP
-- ---------------------------------------------------------------------
--
-- ⚠ KIỂM TRÊN BẢN ĐANG CHẠY, KHÔNG KIỂM TRÊN TỆP. Chính sách là thứ
--   migration sau ghi đè migration trước; đọc lại `pg_policy` mới biết
--   thứ đang thật sự canh cửa là gì. Và một chính sách rộng SÓT LẠI thì
--   không có gì báo — nó chỉ lặng lẽ cho qua.
DO $soi$
DECLARE r record; v_bao text := ''; v_khac text := ''; v_n int := 0;
BEGIN
  -- 5a. MƯỜI BA BẢNG MIGRATION NÀY ĐỤNG — sót một cái là ném.
  FOR r IN
    SELECT c.relname AS bang, p.polname AS ten
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('suppliers','payables','purchase_orders','purchase_invoices',
                        'hr_payroll','hr_attendance','hr_monthly_bonus','hr_salary_config',
                        'purchase_invoice_lines','purchase_order_lines','supplier_return_lines',
                        'payable_payments','merged_orders')
      AND coalesce(pg_get_expr(p.polqual, p.polrelid), '')
        || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%org_id%'
    ORDER BY 1, 2
  LOOP
    v_bao := v_bao || format(E'\n  · %s → "%s"', r.bang, r.ten);
  END LOOP;

  IF v_bao <> '' THEN
    RAISE EXCEPTION
      '163: còn chính sách KHÔNG hỏi org_id. Chính sách permissive cộng bằng "hoặc" nên một cái sót là lỗ vẫn mở:%',
      v_bao
      USING ERRCODE = 'P0001';
  END IF;

  -- 5b. QUÉT RỘNG CẢ SCHEMA — chỉ BÁO, không ném.
  --
  -- ⚠ ĐÂY LÀ CHÍNH PHÉP LỌC ĐÃ TÌM RA NĂM BẢNG CON, giữ lại làm cái
  --   đèn. Một chính sách GHI không hề nhắc tới org, tới `auth.uid()`,
  --   tới `user_id`, và cũng không đi qua `EXISTS` nào thì nó đúng với
  --   MỌI dòng trong bảng — vai trò là thứ duy nhất nó hỏi.
  --
  -- ⚠ BÁO CHỨ KHÔNG NÉM. Ném là migration của người ta gãy vì một bảng
  --   migration này không hứa gì; mà im lặng thì lần sau lại phải có ai
  --   đó tình cờ đi tìm mới thấy.
  FOR r IN
    SELECT c.relname AS bang, p.polname AS ten
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND p.polcmd IN ('*', 'a', 'w', 'd')
      AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
        || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
          !~ 'org_id|auth\.uid|user_id|EXISTS|false'
    ORDER BY 1, 2
  LOOP
    v_n := v_n + 1;
    v_khac := v_khac || format(E'\n  · %s → "%s"', r.bang, r.ten);
  END LOOP;

  IF v_n > 0 THEN
    RAISE WARNING
      '163: còn % chính sách GHI chỉ hỏi vai trò, không hỏi dòng thuộc NPP nào (migration này không đụng tới chúng):%',
      v_n, v_khac;
  END IF;

  RAISE NOTICE '--- 163: khoá theo NPP · 13 bảng đều hỏi org_id · quét rộng còn % chính sách cần xem ---', v_n;
END;
$soi$;

NOTIFY pgrst, 'reload schema';
