-- ================================================================
-- npp.sale — DỮ LIỆU DEMO (tự sinh từ 003_seed.sql)
-- 6 tài khoản *@demo.com với mật khẩu công khai Demo@123456.
-- CHỈ chạy trên môi trường thử nghiệm. KHÔNG chạy trên production.
-- ================================================================

-- npp.sale Seed Data
-- Demo: 1 org, 6 users, 20 customers, 50 products
-- Safe to re-run: cleans up old demo data first

-- ==========================================
-- CLEANUP (xoa du lieu cu neu co)
-- Xoa org se CASCADE xoa tat ca bang con (users, customers, products, ...)
-- Sau do xoa auth users rieng vi khong lien ket voi org
-- ==========================================
DELETE FROM organizations WHERE id = 'a0000000-0000-0000-0000-000000000001';
DELETE FROM auth.identities WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN ('owner@demo.com','manager@demo.com','accountant@demo.com','sales@demo.com','warehouse@demo.com','driver@demo.com')
);
DELETE FROM auth.users WHERE email IN ('owner@demo.com','manager@demo.com','accountant@demo.com','sales@demo.com','warehouse@demo.com','driver@demo.com');

-- ==========================================
-- SEED DATA
-- ==========================================

-- Organization
INSERT INTO organizations (id, name, slug, settings) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'NPP Phuc Thinh', 'phuc-thinh', '{"approval_threshold_auto": 20000000, "approval_threshold_manager": 50000000, "expiry_warning_days": 30}');

-- Demo Auth Users (password: Demo@123456)
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, is_sso_user,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner@demo.com', crypt('Demo@123456', gen_salt('bf')),
   now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Nguyen Van An"}',
   false, false, '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'manager@demo.com', crypt('Demo@123456', gen_salt('bf')),
   now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Tran Thi Bich"}',
   false, false, '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'accountant@demo.com', crypt('Demo@123456', gen_salt('bf')),
   now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Le Van Cuong"}',
   false, false, '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'sales@demo.com', crypt('Demo@123456', gen_salt('bf')),
   now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Pham Thi Dung"}',
   false, false, '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'warehouse@demo.com', crypt('Demo@123456', gen_salt('bf')),
   now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Hoang Van Em"}',
   false, false, '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'driver@demo.com', crypt('Demo@123456', gen_salt('bf')),
   now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Vo Van Phuc"}',
   false, false, '', '', '', '', now(), now());

-- Auth Identities (required for email login)
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000001', 'owner@demo.com', jsonb_build_object('sub', 'e0000000-0000-0000-0000-000000000001', 'email', 'owner@demo.com', 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now()),
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000002', 'manager@demo.com', jsonb_build_object('sub', 'e0000000-0000-0000-0000-000000000002', 'email', 'manager@demo.com', 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now()),
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000003', 'accountant@demo.com', jsonb_build_object('sub', 'e0000000-0000-0000-0000-000000000003', 'email', 'accountant@demo.com', 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now()),
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000004', 'sales@demo.com', jsonb_build_object('sub', 'e0000000-0000-0000-0000-000000000004', 'email', 'sales@demo.com', 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now()),
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000005', 'warehouse@demo.com', jsonb_build_object('sub', 'e0000000-0000-0000-0000-000000000005', 'email', 'warehouse@demo.com', 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now()),
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000006', 'driver@demo.com', jsonb_build_object('sub', 'e0000000-0000-0000-0000-000000000006', 'email', 'driver@demo.com', 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now());

-- Public Users (linked to auth users above)
INSERT INTO users (id, org_id, full_name, role, phone) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Nguyen Van An', 'owner', '0900000001'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Tran Thi Bich', 'manager', '0900000002'),
  ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Le Van Cuong', 'accountant', '0900000003'),
  ('e0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Pham Thi Dung', 'sales', '0900000004'),
  ('e0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Hoang Van Em', 'warehouse', '0900000005'),
  ('e0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Vo Van Phuc', 'driver', '0900000006');

-- Customer Groups
INSERT INTO customer_groups (id, org_id, name, description) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'VIP', 'Khach hang VIP - mua thuong xuyen'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Thuong', 'Khach hang thuong'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Moi', 'Khach hang moi');

-- Products (50 products)
INSERT INTO products (id, org_id, sku, name, category, brand, base_unit, vat_rate, shelf_life_days, status) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'SNP-001', 'Nuoc ngot Coca Cola 330ml', 'Nuoc giai khat', 'Coca Cola', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'SNP-002', 'Nuoc ngot Pepsi 330ml', 'Nuoc giai khat', 'PepsiCo', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'SNP-003', 'Nuoc suoi Aquafina 500ml', 'Nuoc uong', 'PepsiCo', 'chai', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'SNP-004', 'Bia Tiger 330ml', 'Bia', 'Heineken VN', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'SNP-005', 'Bia Saigon Special 330ml', 'Bia', 'Sabeco', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'SNP-006', 'Mi Hao Hao tom chua cay', 'Mi an lien', 'Acecook', 'goi', 0.1, 180, 'active'),
  ('c0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'SNP-007', 'Mi 3 Mien tom chua cay', 'Mi an lien', 'Uniben', 'goi', 0.1, 180, 'active'),
  ('c0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'SNP-008', 'Dau an Neptune 1L', 'Dau an', 'Calofic', 'chai', 0.1, 540, 'active'),
  ('c0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'SNP-009', 'Nuoc mam Chin Su 500ml', 'Gia vi', 'Masan', 'chai', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'SNP-010', 'Nuoc tuong Maggi 700ml', 'Gia vi', 'Nestle', 'chai', 0.1, 540, 'active'),
  ('c0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'SNP-011', 'Sua tuoi Vinamilk 1L', 'Sua', 'Vinamilk', 'hop', 0.05, 180, 'active'),
  ('c0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'SNP-012', 'Sua dac Ong Tho 380g', 'Sua', 'Vinamilk', 'lon', 0.05, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'SNP-013', 'Ca phe G7 3in1', 'Ca phe', 'Trung Nguyen', 'goi', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', 'SNP-014', 'Tra xanh Khong Do 500ml', 'Nuoc giai khat', 'Tan Hiep Phat', 'chai', 0.1, 270, 'active'),
  ('c0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'SNP-015', 'Nuoc tang luc Sting 330ml', 'Nuoc giai khat', 'PepsiCo', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000001', 'SNP-016', 'Bot giat Omo 3kg', 'Hoa chat', 'Unilever', 'goi', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000017', 'a0000000-0000-0000-0000-000000000001', 'SNP-017', 'Nuoc rua chen Sunlight 750ml', 'Hoa chat', 'Unilever', 'chai', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000001', 'SNP-018', 'Kem danh rang P/S 180g', 'Cham soc ca nhan', 'Unilever', 'tuyp', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000019', 'a0000000-0000-0000-0000-000000000001', 'SNP-019', 'Dau goi Clear 650ml', 'Cham soc ca nhan', 'Unilever', 'chai', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000001', 'SNP-020', 'Xa bong Lifebuoy 500ml', 'Cham soc ca nhan', 'Unilever', 'chai', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000001', 'SNP-021', 'Banh Oreo 137g', 'Banh keo', 'Mondelez', 'goi', 0.1, 270, 'active'),
  ('c0000000-0000-0000-0000-000000000022', 'a0000000-0000-0000-0000-000000000001', 'SNP-022', 'Keo Alpenliebe', 'Banh keo', 'Perfetti', 'goi', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000023', 'a0000000-0000-0000-0000-000000000001', 'SNP-023', 'Snack Lay''s 95g', 'Banh keo', 'PepsiCo', 'goi', 0.1, 180, 'active'),
  ('c0000000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-000000000001', 'SNP-024', 'Nuoc ep Teppy 327ml', 'Nuoc giai khat', 'Coca Cola', 'lon', 0.1, 270, 'active'),
  ('c0000000-0000-0000-0000-000000000025', 'a0000000-0000-0000-0000-000000000001', 'SNP-025', 'Sua chua Vinamilk 100g', 'Sua', 'Vinamilk', 'hop', 0.05, 45, 'active'),
  ('c0000000-0000-0000-0000-000000000026', 'a0000000-0000-0000-0000-000000000001', 'SNP-026', 'Bia Heineken 330ml', 'Bia', 'Heineken VN', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000027', 'a0000000-0000-0000-0000-000000000001', 'SNP-027', 'Nuoc tang luc Red Bull 250ml', 'Nuoc giai khat', 'TCP', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000028', 'a0000000-0000-0000-0000-000000000001', 'SNP-028', 'Pho bo Vifon', 'Mi an lien', 'Vifon', 'goi', 0.1, 180, 'active'),
  ('c0000000-0000-0000-0000-000000000029', 'a0000000-0000-0000-0000-000000000001', 'SNP-029', 'Bot canh Knorr 400g', 'Gia vi', 'Unilever', 'goi', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000001', 'SNP-030', 'Duong Bien Hoa 1kg', 'Thuc pham', 'Thanh Thanh Cong', 'goi', 0.05, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000001', 'SNP-031', 'Gao ST25 5kg', 'Thuc pham', 'Noi dia', 'tui', 0.05, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000001', 'SNP-032', 'Trung ga CP 10 qua', 'Thuc pham', 'CP Group', 'vi', 0.05, 30, 'active'),
  ('c0000000-0000-0000-0000-000000000033', 'a0000000-0000-0000-0000-000000000001', 'SNP-033', 'Xuc xich Vissan 175g', 'Thuc pham', 'Vissan', 'goi', 0.1, 90, 'active'),
  ('c0000000-0000-0000-0000-000000000034', 'a0000000-0000-0000-0000-000000000001', 'SNP-034', 'Nuoc mam Nam Ngu 500ml', 'Gia vi', 'Masan', 'chai', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-000000000001', 'SNP-035', 'Tuong ot Chin Su 250ml', 'Gia vi', 'Masan', 'chai', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000036', 'a0000000-0000-0000-0000-000000000001', 'SNP-036', 'Bia 333 330ml', 'Bia', 'Sabeco', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000037', 'a0000000-0000-0000-0000-000000000001', 'SNP-037', 'Nuoc khoang Lavie 500ml', 'Nuoc uong', 'Nestle', 'chai', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000038', 'a0000000-0000-0000-0000-000000000001', 'SNP-038', 'Sua TH True Milk 1L', 'Sua', 'TH Group', 'hop', 0.05, 180, 'active'),
  ('c0000000-0000-0000-0000-000000000039', 'a0000000-0000-0000-0000-000000000001', 'SNP-039', 'Mi Omachi xot Spaghetti', 'Mi an lien', 'Masan', 'goi', 0.1, 180, 'active'),
  ('c0000000-0000-0000-0000-000000000040', 'a0000000-0000-0000-0000-000000000001', 'SNP-040', 'Nuoc ngot Fanta cam 330ml', 'Nuoc giai khat', 'Coca Cola', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-000000000001', 'SNP-041', 'Nuoc ngot Sprite 330ml', 'Nuoc giai khat', 'Coca Cola', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000042', 'a0000000-0000-0000-0000-000000000001', 'SNP-042', 'Nuoc ngot 7Up 330ml', 'Nuoc giai khat', 'PepsiCo', 'lon', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000043', 'a0000000-0000-0000-0000-000000000001', 'SNP-043', 'Kem Wall Magnum 90ml', 'Kem', 'Unilever', 'cay', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000044', 'a0000000-0000-0000-0000-000000000001', 'SNP-044', 'Banh Cosy 576g', 'Banh keo', 'Kinh Do', 'hop', 0.1, 270, 'active'),
  ('c0000000-0000-0000-0000-000000000045', 'a0000000-0000-0000-0000-000000000001', 'SNP-045', 'Giay ve sinh Pulppy', 'Giay', 'Sai Gon Paper', 'loc', 0.1, 1095, 'active'),
  ('c0000000-0000-0000-0000-000000000046', 'a0000000-0000-0000-0000-000000000001', 'SNP-046', 'Khan uot Bobby 100 to', 'Cham soc ca nhan', 'Unicharm', 'goi', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000047', 'a0000000-0000-0000-0000-000000000001', 'SNP-047', 'Nuoc giat Ariel 3.25kg', 'Hoa chat', 'P&G', 'tui', 0.1, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000048', 'a0000000-0000-0000-0000-000000000001', 'SNP-048', 'Sua Ensure Gold 850g', 'Sua', 'Abbott', 'lon', 0.05, 730, 'active'),
  ('c0000000-0000-0000-0000-000000000049', 'a0000000-0000-0000-0000-000000000001', 'SNP-049', 'Ca phe Nescafe 3in1', 'Ca phe', 'Nestle', 'goi', 0.1, 365, 'active'),
  ('c0000000-0000-0000-0000-000000000050', 'a0000000-0000-0000-0000-000000000001', 'SNP-050', 'Nuoc ep cam Twister 350ml', 'Nuoc giai khat', 'PepsiCo', 'chai', 0.1, 270, 'active');

-- Product Units (multi-unit for some products)
INSERT INTO product_units (product_id, unit_name, conversion) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Loc 6', 6),
  ('c0000000-0000-0000-0000-000000000001', 'Thung 24', 24),
  ('c0000000-0000-0000-0000-000000000002', 'Loc 6', 6),
  ('c0000000-0000-0000-0000-000000000002', 'Thung 24', 24),
  ('c0000000-0000-0000-0000-000000000003', 'Loc 6', 6),
  ('c0000000-0000-0000-0000-000000000003', 'Thung 24', 24),
  ('c0000000-0000-0000-0000-000000000004', 'Loc 6', 6),
  ('c0000000-0000-0000-0000-000000000004', 'Thung 24', 24),
  ('c0000000-0000-0000-0000-000000000006', 'Thung 30', 30),
  ('c0000000-0000-0000-0000-000000000007', 'Thung 30', 30),
  ('c0000000-0000-0000-0000-000000000011', 'Thung 12', 12),
  ('c0000000-0000-0000-0000-000000000012', 'Thung 48', 48),
  ('c0000000-0000-0000-0000-000000000013', 'Hop 20', 20),
  ('c0000000-0000-0000-0000-000000000025', 'Vi 4', 4),
  ('c0000000-0000-0000-0000-000000000025', 'Thung 48', 48),
  ('c0000000-0000-0000-0000-000000000026', 'Loc 6', 6),
  ('c0000000-0000-0000-0000-000000000026', 'Thung 24', 24);

-- Price Lists (default prices for different customer groups)
INSERT INTO price_lists (product_id, group_id, unit_name, price, effective_from) VALUES
  -- Coca Cola 330ml
  ('c0000000-0000-0000-0000-000000000001', NULL, 'lon', 10000, '2026-01-01'),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'lon', 9500, '2026-01-01'),
  ('c0000000-0000-0000-0000-000000000001', NULL, 'Thung 24', 228000, '2026-01-01'),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Thung 24', 216000, '2026-01-01'),
  -- Pepsi 330ml
  ('c0000000-0000-0000-0000-000000000002', NULL, 'lon', 9500, '2026-01-01'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'lon', 9000, '2026-01-01'),
  -- Aquafina 500ml
  ('c0000000-0000-0000-0000-000000000003', NULL, 'chai', 5000, '2026-01-01'),
  ('c0000000-0000-0000-0000-000000000003', NULL, 'Thung 24', 108000, '2026-01-01'),
  -- Tiger 330ml
  ('c0000000-0000-0000-0000-000000000004', NULL, 'lon', 15000, '2026-01-01'),
  ('c0000000-0000-0000-0000-000000000004', NULL, 'Thung 24', 340000, '2026-01-01'),
  -- Saigon Special
  ('c0000000-0000-0000-0000-000000000005', NULL, 'lon', 14000, '2026-01-01'),
  -- Hao Hao
  ('c0000000-0000-0000-0000-000000000006', NULL, 'goi', 4500, '2026-01-01'),
  ('c0000000-0000-0000-0000-000000000006', NULL, 'Thung 30', 128000, '2026-01-01'),
  -- 3 Mien
  ('c0000000-0000-0000-0000-000000000007', NULL, 'goi', 4200, '2026-01-01'),
  -- Dau an Neptune
  ('c0000000-0000-0000-0000-000000000008', NULL, 'chai', 52000, '2026-01-01'),
  -- Chin Su
  ('c0000000-0000-0000-0000-000000000009', NULL, 'chai', 28000, '2026-01-01'),
  -- Maggi
  ('c0000000-0000-0000-0000-000000000010', NULL, 'chai', 22000, '2026-01-01'),
  -- Vinamilk 1L
  ('c0000000-0000-0000-0000-000000000011', NULL, 'hop', 32000, '2026-01-01'),
  ('c0000000-0000-0000-0000-000000000011', NULL, 'Thung 12', 372000, '2026-01-01'),
  -- Ong Tho
  ('c0000000-0000-0000-0000-000000000012', NULL, 'lon', 26000, '2026-01-01'),
  -- G7
  ('c0000000-0000-0000-0000-000000000013', NULL, 'goi', 3500, '2026-01-01'),
  ('c0000000-0000-0000-0000-000000000013', NULL, 'Hop 20', 65000, '2026-01-01'),
  -- Tra Xanh KD
  ('c0000000-0000-0000-0000-000000000014', NULL, 'chai', 10000, '2026-01-01'),
  -- Sting
  ('c0000000-0000-0000-0000-000000000015', NULL, 'lon', 10000, '2026-01-01'),
  -- Omo
  ('c0000000-0000-0000-0000-000000000016', NULL, 'goi', 115000, '2026-01-01'),
  -- Sunlight
  ('c0000000-0000-0000-0000-000000000017', NULL, 'chai', 28000, '2026-01-01'),
  -- PS
  ('c0000000-0000-0000-0000-000000000018', NULL, 'tuyp', 32000, '2026-01-01'),
  -- Clear
  ('c0000000-0000-0000-0000-000000000019', NULL, 'chai', 98000, '2026-01-01'),
  -- Lifebuoy
  ('c0000000-0000-0000-0000-000000000020', NULL, 'chai', 55000, '2026-01-01'),
  -- Heineken
  ('c0000000-0000-0000-0000-000000000026', NULL, 'lon', 18000, '2026-01-01'),
  ('c0000000-0000-0000-0000-000000000026', NULL, 'Thung 24', 415000, '2026-01-01');

-- Customers (20 customers)
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, province, district, ward, channel, group_id, credit_limit, payment_terms, status) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Tap hoa Ba Hai', 'Nguyen Thi Hai', '0901000001', '12 Nguyen Trai, P.Ben Thanh', 'TP HCM', 'Quan 1', 'P.Ben Thanh', 'GT', 'b0000000-0000-0000-0000-000000000001', 50000000, 'NET30', 'active'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Sieu thi Mini Thanh Tam', 'Le Van Tam', '0901000002', '45 Le Loi, P.Ben Nghe', 'TP HCM', 'Quan 1', 'P.Ben Nghe', 'MT', 'b0000000-0000-0000-0000-000000000001', 100000000, 'NET30', 'active'),
  ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Tap hoa Co Lan', 'Tran Thi Lan', '0901000003', '78 Hai Ba Trung, P.Tan Dinh', 'TP HCM', 'Quan 1', 'P.Tan Dinh', 'GT', 'b0000000-0000-0000-0000-000000000002', 30000000, 'NET15', 'active'),
  ('d0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Quan An Ngon', 'Pham Van Ngon', '0901000004', '138 Nam Ky Khoi Nghia', 'TP HCM', 'Quan 3', 'P.6', 'HORECA', 'b0000000-0000-0000-0000-000000000001', 80000000, 'NET30', 'active'),
  ('d0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Tap hoa Anh Tuan', 'Vo Anh Tuan', '0901000005', '23 Vo Van Tan, P.5', 'TP HCM', 'Quan 3', 'P.5', 'GT', 'b0000000-0000-0000-0000-000000000002', 20000000, 'NET15', 'active'),
  ('d0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Cua hang Binh An', 'Hoang Thi An', '0901000006', '56 Cach Mang Thang 8', 'TP HCM', 'Quan 10', 'P.12', 'GT', 'b0000000-0000-0000-0000-000000000002', 25000000, 'NET15', 'active'),
  ('d0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'Quan Nhau Hai San', 'Bui Van Hai', '0901000007', '90 Truong Chinh', 'TP HCM', 'Tan Phu', 'P.Tan Son Nhi', 'HORECA', 'b0000000-0000-0000-0000-000000000002', 40000000, 'NET30', 'active'),
  ('d0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'Minimart Gia Dinh', 'Do Thi Mai', '0901000008', '34 Phan Xich Long', 'TP HCM', 'Phu Nhuan', 'P.2', 'MT', 'b0000000-0000-0000-0000-000000000001', 70000000, 'NET30', 'active'),
  ('d0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'Tap hoa Chi Nga', 'Ly Thi Nga', '0901000009', '67 Huynh Tan Phat', 'TP HCM', 'Quan 7', 'P.Tan Thuan Dong', 'GT', 'b0000000-0000-0000-0000-000000000003', 15000000, 'COD', 'active'),
  ('d0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'Cafe Milano', 'Nguyen Duc Minh', '0901000010', '120 Nguyen Hue', 'TP HCM', 'Quan 1', 'P.Ben Nghe', 'HORECA', 'b0000000-0000-0000-0000-000000000001', 60000000, 'NET30', 'active'),
  ('d0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'Tap hoa Thanh Thanh', 'Phan Thi Thanh', '0901000011', '234 Le Van Sy', 'TP HCM', 'Quan 3', 'P.14', 'GT', 'b0000000-0000-0000-0000-000000000003', 10000000, 'COD', 'active'),
  ('d0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'Sieu thi Co.op Food', 'Tran Van Hung', '0901000012', '456 Nguyen Kiem', 'TP HCM', 'Go Vap', 'P.3', 'MT', 'b0000000-0000-0000-0000-000000000001', 150000000, 'NET45', 'active'),
  ('d0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'Tap hoa Chu Hoa', 'Mai Van Hoa', '0901000013', '89 To Hien Thanh', 'TP HCM', 'Quan 10', 'P.15', 'GT', 'b0000000-0000-0000-0000-000000000002', 20000000, 'NET15', 'active'),
  ('d0000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', 'Nha hang Pho Xua', 'Duong Thi Huong', '0901000014', '12 Ton That Tung', 'TP HCM', 'Quan 1', 'P.Pham Ngu Lao', 'HORECA', 'b0000000-0000-0000-0000-000000000002', 35000000, 'NET30', 'active'),
  ('d0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'Tap hoa Thu Huong', 'Vu Thi Huong', '0901000015', '78 Au Co', 'TP HCM', 'Tan Binh', 'P.9', 'GT', 'b0000000-0000-0000-0000-000000000003', 10000000, 'COD', 'active'),
  ('d0000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000001', 'Cua hang tien ich 24h', 'Ngo Van Son', '0901000016', '345 Quang Trung', 'TP HCM', 'Go Vap', 'P.10', 'MT', 'b0000000-0000-0000-0000-000000000002', 45000000, 'NET30', 'active'),
  ('d0000000-0000-0000-0000-000000000017', 'a0000000-0000-0000-0000-000000000001', 'Tap hoa Ba Muoi', 'Ha Thi Muoi', '0901000017', '56 Lac Long Quan', 'TP HCM', 'Quan 11', 'P.1', 'GT', 'b0000000-0000-0000-0000-000000000002', 18000000, 'NET15', 'active'),
  ('d0000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000001', 'Quan Bia Tuoi', 'Truong Van Binh', '0901000018', '123 Cong Hoa', 'TP HCM', 'Tan Binh', 'P.4', 'HORECA', 'b0000000-0000-0000-0000-000000000001', 90000000, 'NET30', 'active'),
  ('d0000000-0000-0000-0000-000000000019', 'a0000000-0000-0000-0000-000000000001', 'Tap hoa Co Ut', 'Dang Thi Ut', '0901000019', '99 Ba Thang Hai', 'TP HCM', 'Quan 10', 'P.14', 'GT', 'b0000000-0000-0000-0000-000000000003', 12000000, 'COD', 'active'),
  ('d0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000001', 'Dai ly Phuong Nam', 'Le Phuong Nam', '0901000020', '567 Kinh Duong Vuong', 'TP HCM', 'Binh Tan', 'P.An Lac', 'GT', 'b0000000-0000-0000-0000-000000000001', 80000000, 'NET30', 'active');

-- Customer Assignments (assign sales user to customers)
INSERT INTO customer_assignments (customer_id, user_id, status) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', 'active'),
  ('d0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000004', 'active'),
  ('d0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000004', 'active'),
  ('d0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000004', 'active'),
  ('d0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000004', 'active');
