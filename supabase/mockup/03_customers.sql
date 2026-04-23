-- =====================================================================
-- Mockup Part 3: 12 khách hàng + customer_assignments
-- =====================================================================
-- Phân đều 3 tuyến (GT: 6, MT: 3, HORECA: 3). Mỗi KH:
--  - có GPS tương đối HCM
--  - channel = mã tuyến (phải nằm trong CHECK constraint GT/MT/HORECA)
--  - group: luân phiên VIP / Thường / Mới
--  - credit_limit khác nhau
--  - assigned cho user role=sales (nếu có), fallback owner

BEGIN;

DO $$
DECLARE
  target_org_id uuid;
  sales_user uuid;
  grp_vip uuid;
  grp_thuong uuid;
  grp_moi uuid;
BEGIN
  SELECT id INTO target_org_id FROM organizations ORDER BY created_at LIMIT 1;

  -- Chọn 1 user role=sales (hoặc owner nếu chưa có sales)
  SELECT id INTO sales_user FROM users
   WHERE org_id = target_org_id AND role = 'sales' AND is_active = true
   ORDER BY created_at LIMIT 1;
  IF sales_user IS NULL THEN
    SELECT id INTO sales_user FROM users WHERE org_id = target_org_id AND role = 'owner' LIMIT 1;
  END IF;

  SELECT id INTO grp_vip FROM customer_groups WHERE org_id = target_org_id AND name = 'VIP' LIMIT 1;
  SELECT id INTO grp_thuong FROM customer_groups WHERE org_id = target_org_id AND name = 'Thường' LIMIT 1;
  SELECT id INTO grp_moi FROM customer_groups WHERE org_id = target_org_id AND name = 'Mới' LIMIT 1;

  -- Xóa mock cũ (KH có phone bắt đầu '09DEMO')
  DELETE FROM customers WHERE org_id = target_org_id AND phone LIKE '09DEMO%';

  INSERT INTO customers (org_id, store_name, owner_name, phone, address, province, district, channel, group_id, credit_limit, payment_terms, gps_lat, gps_lng) VALUES
    -- GT
    (target_org_id, 'Tạp hoá Lan Anh', 'Chị Lan', '09DEMO00001', '123 Lê Lợi, Q.1', 'Hồ Chí Minh', 'Quận 1', 'GT', grp_vip,     50000000, 'NET30', 10.7769, 106.7009),
    (target_org_id, 'Tạp hoá Minh Khang', 'Anh Khang', '09DEMO00002', '45 Nguyễn Huệ, Q.1', 'Hồ Chí Minh', 'Quận 1', 'GT', grp_thuong, 20000000, 'NET15', 10.7746, 106.7038),
    (target_org_id, 'Tạp hoá Bà Năm', 'Bà Năm', '09DEMO00003', '67 Hai Bà Trưng, Q.3', 'Hồ Chí Minh', 'Quận 3', 'GT', grp_thuong, 15000000, 'COD', 10.7855, 106.6932),
    (target_org_id, 'Tạp hoá Thanh Tâm', 'Chị Tâm', '09DEMO00004', '89 Võ Thị Sáu, Q.3', 'Hồ Chí Minh', 'Quận 3', 'GT', grp_moi,     10000000, 'COD', 10.7866, 106.6925),
    (target_org_id, 'Tạp hoá Phương Nam', 'Anh Nam', '09DEMO00005', '12 CMT8, Q.10', 'Hồ Chí Minh', 'Quận 10', 'GT', grp_thuong, 18000000, 'NET15', 10.7712, 106.6665),
    (target_org_id, 'Tạp hoá Anh Thư', 'Chị Thư', '09DEMO00006', '78 3/2, Q.10', 'Hồ Chí Minh', 'Quận 10', 'GT', grp_moi,      8000000, 'COD', 10.7680, 106.6700),

    -- MT
    (target_org_id, 'Siêu thị Co.opmart Q.7', 'Mr. Phát', '09DEMO00007', '1058 Nguyễn Văn Linh, Q.7', 'Hồ Chí Minh', 'Quận 7', 'MT', grp_vip,   100000000, 'NET45', 10.7290, 106.7197),
    (target_org_id, 'Bách Hoá Xanh Q.8', 'Mr. Tuấn', '09DEMO00008', '222 Phạm Thế Hiển, Q.8', 'Hồ Chí Minh', 'Quận 8', 'MT', grp_vip,        80000000, 'NET30', 10.7450, 106.6880),
    (target_org_id, 'Winmart+ Q.Bình Thạnh', 'Ms. Hương', '09DEMO00009', '456 Điện Biên Phủ, Bình Thạnh', 'Hồ Chí Minh', 'Bình Thạnh', 'MT', grp_vip, 120000000, 'NET45', 10.8010, 106.7110),

    -- HORECA
    (target_org_id, 'Nhà hàng Quán Ụt Ụt', 'Chị Hà', '09DEMO00010', '28 Tôn Đức Thắng, Q.1', 'Hồ Chí Minh', 'Quận 1', 'HORECA', grp_vip,   35000000, 'NET15', 10.7795, 106.7053),
    (target_org_id, 'Quán Lẩu Dê Ba Toa', 'Anh Toa', '09DEMO00011', '88 Trần Hưng Đạo, Q.5', 'Hồ Chí Minh', 'Quận 5', 'HORECA', grp_thuong, 25000000, 'NET15', 10.7550, 106.6812),
    (target_org_id, 'Coffee Highlands Q.1', 'Mr. Dũng', '09DEMO00012', '7 Lê Duẩn, Q.1', 'Hồ Chí Minh', 'Quận 1', 'HORECA', grp_thuong,     30000000, 'NET30', 10.7820, 106.7040);

  -- Assign tất cả 12 KH cho sales_user (primary)
  INSERT INTO customer_assignments (customer_id, user_id, role)
  SELECT c.id, sales_user, 'primary'
    FROM customers c
   WHERE c.org_id = target_org_id AND c.phone LIKE '09DEMO%'
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Part 3 OK: 12 KH + assignments cho sales_user %', sales_user;
END $$;

COMMIT;

SELECT channel, count(*) FROM customers WHERE phone LIKE '09DEMO%' GROUP BY channel;
