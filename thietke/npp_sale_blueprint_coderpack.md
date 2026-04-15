# 📘 BLUEPRINT: npp.sale — Mini ERP cho Nhà Phân Phối

## SaaS Application — Vibecode Kit v5.0

---

## 📋 PROJECT INFO

| Field | Value |
|-------|-------|
| Dự án | npp.sale |
| Loại | SaaS Application (Multi-tenant ERP) |
| Ngày | 07/04/2026 |
| Phiên bản tài liệu gốc | v1.1 — 31/03/2026 |
| Scope | 12 modules (Tầng 1 + Tầng 2) |
| Mobile | Web responsive |

---

## 🎯 MỤC TIÊU

**Primary Goal:** Thay thế Excel cho NPP hàng tiêu dùng Việt Nam — quản lý đơn hàng, kho, khách hàng, công nợ, hoa hồng trong một hệ thống duy nhất.

**Target Audience:** Chủ NPP, Quản lý bán hàng, Kế toán, NV Sales, NV Kho, Tài xế — tại các NPP FMCG quy mô 5–50 nhân sự.

**Triết lý:** Đơn giản, xuất sắc, thật sự hữu ích. Làm ít thứ nhưng làm cho thật tốt. Thay thế Excel, không thay thế DMS của nhã hàng.

---

## 💻 TECH STACK

| Layer | Technology | Lý do |
|-------|-----------|-------|
| Frontend | **Next.js 14 (App Router)** | SSR, routing, API routes tích hợp |
| Styling | **Tailwind CSS + shadcn/ui** | Nhanh, consistent, responsive sẵn |
| Database | **Supabase (PostgreSQL)** | Free tier 500MB, auth built-in, realtime, RLS |
| Auth | **Supabase Auth** | Email/password, role-based, RLS tích hợp |
| Hosting | **Vercel** | Free tier, auto-deploy từ Git |
| File Storage | **Supabase Storage** | Ảnh POD, chứng từ — free 1GB |
| Charts | **Recharts** | Lightweight, React-native |

**Free tier limits cần lưu ý:**
- Supabase: 500MB DB, 1GB storage, 50K auth users, 500K edge function invocations
- Vercel: 100GB bandwidth, serverless function 10s timeout
- Đủ cho 1–5 NPP giai đoạn đầu. Scale lên Supabase Pro ($25/mo) khi cần.

---

## 👥 HỆ THỐNG VAI TRÒ (6 roles)

| Role | Slug | Nền tảng | Quyền chính |
|------|------|----------|-------------|
| Chủ NPP | `owner` | Web + Mobile | Toàn quyền, cấu hình, duyệt đơn lớn |
| Quản lý bán hàng | `manager` | Web + Mobile | Báo cáo đội, duyệt đơn, quản lý tuyến |
| Kế toán | `accountant` | Web | Công nợ, HĐĐT, đối soát |
| NV bán hàng | `sales` | Mobile-first | Tạo đơn, xem KH của mình, thu tiền |
| NV kho | `warehouse` | Web + Tablet | Nhập/xuất kho, kiểm kê, picking |
| Tài xế | `driver` | Mobile-first | Nhận chuyến, xác nhận giao, POD |

---

## 📐 DATABASE SCHEMA

### Bảng chính (tổng quan)

```
organizations          -- Multi-tenant: mỗi NPP là 1 org
├── users              -- Tài khoản + role
├── customers          -- M2: Điểm bán (outlets)
│   └── customer_assignments  -- Phân công NV-KH (nhiều-nhiều)
├── customer_groups    -- Nhóm KH (VIP, Thường, Mới)
├── products           -- M6: SKU
│   ├── product_units  -- Đa ĐVT (thùng=24 chai)
│   └── price_lists    -- Đa bảng giá theo nhóm KH
├── batches            -- M3: Lô hàng (HSD, vị trí kho)
├── stock_entries      -- M3: Phiếu kho (nhập/xuất/chuyển/kiểm kê)
│   └── stock_entry_lines
├── sales_orders       -- M1: Đơn hàng
│   └── sales_order_lines
├── merged_orders      -- M1: Đơn gộp → link về đơn gốc
├── commission_policies -- M5: Chính sách hoa hồng
├── commission_wallets -- M5: Tủ thưởng NV
├── receivables        -- M7: Công nợ phải thu
├── payments           -- M7: Thu tiền
├── deliveries         -- M8: Chuyến giao hàng
│   └── delivery_lines
├── promotions         -- M9: Chương trình KM
├── invoices           -- M10: Hóa đơn điện tử
├── returns            -- M11: Trả hàng
│   └── return_lines
└── reports_config     -- M12: Cấu hình báo cáo
```

### Chi tiết bảng quan trọng

#### `organizations`
```sql
id              uuid PK default gen_random_uuid()
name            text NOT NULL
slug            text UNIQUE NOT NULL  -- subdomain hoặc URL path
settings        jsonb DEFAULT '{}'    -- ngưỡng duyệt, cảnh báo HSD, etc.
created_at      timestamptz DEFAULT now()
```

#### `users`
```sql
id              uuid PK references auth.users
org_id          uuid FK → organizations
full_name       text NOT NULL
role            text CHECK (role IN ('owner','manager','accountant','sales','warehouse','driver'))
phone           text
is_active       boolean DEFAULT true
created_at      timestamptz DEFAULT now()
```

#### `customers` (M2)
```sql
id              uuid PK
org_id          uuid FK → organizations
store_name      text NOT NULL
owner_name      text NOT NULL
phone           text NOT NULL
address         text NOT NULL
province        text
district        text
ward            text
channel         text CHECK (channel IN ('GT','MT','HORECA'))
group_id        uuid FK → customer_groups
credit_limit    numeric DEFAULT 0
payment_terms   text DEFAULT 'COD'
status          text DEFAULT 'active' CHECK (status IN ('active','suspended','locked'))
gps_lat         numeric
gps_lng         numeric
created_at      timestamptz DEFAULT now()
-- UNIQUE(org_id, phone) để chống trùng
```

#### `customer_assignments` (M2 - Phân công)
```sql
id              uuid PK
customer_id     uuid FK → customers
user_id         uuid FK → users (NV Sales)
role            text CHECK (role IN ('primary','secondary'))
assigned_at     date DEFAULT CURRENT_DATE
status          text DEFAULT 'active'
```

#### `products` (M6)
```sql
id              uuid PK
org_id          uuid FK → organizations
sku             text NOT NULL
name            text NOT NULL
category        text
brand           text           -- nhã hàng
barcode         text
base_unit       text NOT NULL  -- chai, gói, hộp
vat_rate        numeric DEFAULT 0.1
shelf_life_days integer
status          text DEFAULT 'active'
UNIQUE(org_id, sku)
```

#### `product_units` (M6 - Đa ĐVT)
```sql
id              uuid PK
product_id      uuid FK → products
unit_name       text NOT NULL      -- Lốc, Thùng
conversion      integer NOT NULL   -- 1 Thùng = 24 (chai cơ bản)
```

#### `price_lists` (M6 - Đa bảng giá)
```sql
id              uuid PK
product_id      uuid FK → products
group_id        uuid FK → customer_groups
unit_name       text NOT NULL      -- theo ĐVT nào
price           numeric NOT NULL
effective_from  date
effective_to    date
```

#### `batches` (M3)
```sql
id              uuid PK
org_id          uuid FK
product_id      uuid FK → products
batch_code      text NOT NULL
manufactured_at date
expires_at      date NOT NULL
location        text              -- T2-K3-05
qty_initial     integer NOT NULL
qty_on_hand     integer NOT NULL
status          text DEFAULT 'available'
```

#### `sales_orders` (M1)
```sql
id              uuid PK
org_id          uuid FK
order_code      text UNIQUE NOT NULL  -- SO-YYYYMMDD-XXXX
customer_id     uuid FK → customers
sales_user_id   uuid FK → users       -- NV phụ trách (cổng vào NV)
order_date      date DEFAULT CURRENT_DATE
expected_delivery date
status          text DEFAULT 'draft'
                CHECK (status IN ('draft','confirmed','picking','delivering','delivered','cancelled'))
payment_terms   text
subtotal        numeric DEFAULT 0
discount        numeric DEFAULT 0
vat             numeric DEFAULT 0
total           numeric DEFAULT 0
merged_into     uuid FK → sales_orders  -- nếu đã bị gộp
notes           text
approved_by     uuid FK → users
approved_at     timestamptz
created_at      timestamptz DEFAULT now()
```

#### `sales_order_lines` (M1)
```sql
id              uuid PK
order_id        uuid FK → sales_orders
product_id      uuid FK → products
unit_name       text NOT NULL
quantity        numeric NOT NULL
unit_price      numeric NOT NULL
line_discount   numeric DEFAULT 0
line_total      numeric NOT NULL
batch_id        uuid FK → batches  -- gán khi xuất kho (FEFO)
```

#### `receivables` (M7)
```sql
id              uuid PK
org_id          uuid FK
order_id        uuid FK → sales_orders
customer_id     uuid FK → customers
sales_user_id   uuid FK → users       -- NV chịu trách nhiệm thu
amount          numeric NOT NULL
paid            numeric DEFAULT 0
due_date        date
status          text DEFAULT 'open'
created_at      timestamptz DEFAULT now()
```

#### `payments` (M7)
```sql
id              uuid PK
receivable_id   uuid FK → receivables
collected_by    uuid FK → users
amount          numeric NOT NULL
method          text CHECK (method IN ('cash','transfer','ewallet'))
collected_at    timestamptz DEFAULT now()
verified_by     uuid FK → users       -- Kế toán đối soát
verified_at     timestamptz
```

#### `deliveries` (M8)
```sql
id              uuid PK
org_id          uuid FK
driver_id       uuid FK → users
vehicle         text
route_name      text
status          text DEFAULT 'pending'
started_at      timestamptz
completed_at    timestamptz
```

#### `delivery_lines` (M8)
```sql
id              uuid PK
delivery_id     uuid FK → deliveries
order_id        uuid FK → sales_orders
status          text DEFAULT 'pending'  -- pending/delivered/partial/failed
pod_photo_url   text
pod_signature   text                    -- base64 SVG
delivered_at    timestamptz
notes           text
```

#### `promotions` (M9)
```sql
id              uuid PK
org_id          uuid FK
name            text NOT NULL
type            text CHECK (type IN ('trade_discount','buy_x_get_y','payment_discount','cumulative','display'))
rules           jsonb NOT NULL         -- logic KM linh hoạt
priority        integer DEFAULT 0
target_groups   uuid[]                 -- nhóm KH áp dụng
starts_at       date
ends_at         date
is_active       boolean DEFAULT true
```

#### `returns` (M11)
```sql
id              uuid PK
org_id          uuid FK
order_id        uuid FK → sales_orders
customer_id     uuid FK → customers
requested_by    uuid FK → users
reason          text CHECK (reason IN ('damaged','wrong_item','near_expiry','expired','refused'))
status          text DEFAULT 'pending'
approved_by     uuid FK → users
credit_note_amount numeric
photo_url       text
created_at      timestamptz DEFAULT now()
```

#### `commission_policies` (M5)
```sql
id              uuid PK
org_id          uuid FK
name            text NOT NULL
type            text CHECK (type IN ('percentage','fixed','tiered'))
tiers           jsonb       -- [{from:0, to:50000000, rate:0.01}, ...]
applies_to      text        -- 'all' | 'group:xxx' | 'user:xxx'
effective_from  date
effective_to    date
```

#### `commission_wallets` (M5 - Tủ thưởng)
```sql
id              uuid PK
user_id         uuid FK → users
period          text NOT NULL  -- '2026-Q1'
earned          numeric DEFAULT 0
paid            numeric DEFAULT 0
balance         numeric GENERATED ALWAYS AS (earned - paid) STORED
```

---

## 📁 FILE STRUCTURE

```
npp-sale/
├── .env.local                    # NEXT_PUBLIC_SUPABASE_URL, ANON_KEY
├── next.config.js
├── tailwind.config.js
├── package.json
│
├── supabase/
│   └── migrations/
│       ├── 001_schema.sql        # Tất cả bảng
│       ├── 002_rls_policies.sql  # Row Level Security
│       └── 003_seed.sql          # Demo data
│
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout + auth provider
│   │   ├── page.tsx              # Landing / redirect
│   │   ├── login/page.tsx
│   │   │
│   │   └── (dashboard)/          # Route group — layout chung sidebar
│   │       ├── layout.tsx        # Sidebar + Header + role guard
│   │       ├── page.tsx          # Dashboard home (M12 overview)
│   │       │
│   │       ├── orders/           # M1 Đơn hàng
│   │       │   ├── page.tsx      # Danh sách + filter
│   │       │   ├── new/page.tsx  # Tạo đơn
│   │       │   └── [id]/page.tsx # Chi tiết + duyệt + gộp
│   │       │
│   │       ├── customers/        # M2 Khách hàng
│   │       │   ├── page.tsx
│   │       │   ├── new/page.tsx
│   │       │   └── [id]/page.tsx
│   │       │
│   │       ├── inventory/        # M3 Kho hàng
│   │       │   ├── page.tsx      # Tồn kho hiện tại
│   │       │   ├── batches/page.tsx
│   │       │   ├── entries/page.tsx
│   │       │   └── stocktake/page.tsx
│   │       │
│   │       ├── products/         # M6 Sản phẩm
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx
│   │       │
│   │       ├── commissions/      # M5 Hoa hồng
│   │       │   ├── page.tsx      # Tổng hợp + tủ thưởng
│   │       │   └── policies/page.tsx
│   │       │
│   │       ├── receivables/      # M7 Công nợ
│   │       │   ├── page.tsx      # Sổ công nợ
│   │       │   ├── aging/page.tsx
│   │       │   └── collect/page.tsx
│   │       │
│   │       ├── deliveries/       # M8 Giao hàng
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx
│   │       │
│   │       ├── promotions/       # M9 Khuyến mãi
│   │       │   ├── page.tsx
│   │       │   └── new/page.tsx
│   │       │
│   │       ├── invoices/         # M10 Hóa đơn
│   │       │   └── page.tsx
│   │       │
│   │       ├── returns/          # M11 Trả hàng
│   │       │   ├── page.tsx
│   │       │   └── new/page.tsx
│   │       │
│   │       ├── reports/          # M12 Báo cáo
│   │       │   ├── page.tsx
│   │       │   ├── sales/page.tsx
│   │       │   └── inventory/page.tsx
│   │       │
│   │       └── settings/         # M4 Phân quyền + cấu hình
│   │           ├── page.tsx
│   │           ├── users/page.tsx
│   │           └── org/page.tsx
│   │
│   ├── components/
│   │   ├── ui/                   # shadcn components
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   ├── header.tsx
│   │   │   └── mobile-nav.tsx
│   │   ├── orders/
│   │   │   ├── order-form.tsx
│   │   │   ├── order-table.tsx
│   │   │   ├── merge-dialog.tsx
│   │   │   └── approval-badge.tsx
│   │   ├── customers/
│   │   ├── inventory/
│   │   ├── products/
│   │   ├── commissions/
│   │   ├── receivables/
│   │   ├── deliveries/
│   │   ├── promotions/
│   │   └── reports/
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts         # Browser client
│   │   │   ├── server.ts         # Server client
│   │   │   └── middleware.ts     # Auth middleware
│   │   ├── utils.ts
│   │   ├── constants.ts          # Status enums, order code format
│   │   └── permissions.ts        # Role → allowed actions map
│   │
│   ├── hooks/
│   │   ├── use-auth.ts
│   │   ├── use-org.ts
│   │   └── use-role-guard.ts
│   │
│   └── types/
│       └── index.ts              # TypeScript types from DB schema
│
└── public/
    └── logo.svg
```

---

## 🎨 DESIGN SYSTEM

### Colors
| Token | Hex | Dùng cho |
|-------|-----|----------|
| Primary | `#2563EB` (Blue 600) | CTA, active states, links |
| Success | `#22C55E` (Green 500) | Xác nhận, tồn kho OK |
| Warning | `#F59E0B` (Amber 500) | Cảnh báo HSD, vượt hạn mức |
| Danger | `#EF4444` (Red 500) | Quá hạn, lỗi, hết hàng |
| Neutral | `#6B7280` (Gray 500) | Text phụ, borders |
| Background | `#F9FAFB` | Nền chính |

### Typography
- **Headings:** Inter (hoặc system font stack)
- **Body:** Inter — 14px base, 16px trên mobile
- **Monospace:** JetBrains Mono — mã đơn, mã lô

### Responsive breakpoints
- Mobile-first: `< 768px` — single column, bottom nav
- Tablet: `768–1024px` — collapsible sidebar
- Desktop: `> 1024px` — sidebar + full content

---

## 🔐 ROW LEVEL SECURITY (RLS) STRATEGY

Supabase RLS là cốt lõi phân quyền — mọi query đều bị filter tự động:

```
owner       → org_id = user.org_id (tất cả dữ liệu org)
manager     → org_id = user.org_id (tất cả dữ liệu org, giới hạn write)
accountant  → org_id = user.org_id (read all, write công nợ + hóa đơn)
sales       → chỉ thấy KH mình được gán + đơn mình tạo + công nợ mình
warehouse   → org_id match + chỉ write bảng kho
driver      → chỉ thấy chuyến giao được gán
```

---

## ⚡ LUỒNG NGHIỆP VỤ CHÍNH

### 1. Tạo đơn hàng (M1)
```
NV Sales mở app → Chọn KH (chỉ thấy KH mình được gán)
→ Hệ thống auto-fill: NV phụ trách, bảng giá, điều khoản TT
→ Thêm SP + SL → Auto: giá, CK, VAT, check tồn kho + hạn mức
→ Gửi đơn → Workflow duyệt (< 20tr auto, 20-50tr Manager, > 50tr Owner)
→ Confirmed → Picking list cho NV kho
```

### 2. Gộp đơn (M1)
```
Manager xem đơn cùng KH trong ngày → Chọn nhiều đơn → Gộp
→ Tạo 1 đơn gộp, giữ nguyên NV gốc mỗi dòng
→ Xuất kho 1 lần, giao 1 chuyến
```

### 3. Xuất kho + Giao hàng (M3 → M8)
```
Đơn confirmed → Picking list (FEFO: lô gần hết hạn trước)
→ NV kho nhặt hàng theo vị trí (T2-K3-05)
→ Đóng gói → Gán chuyến xe + Tài xế
→ Tài xế giao → Chụp POD + Chữ ký
→ Xác nhận → Tạo receivable (M7)
```

### 4. Thu tiền + Công nợ (M7)
```
NV Sales thu tại điểm bán → Ghi: số tiền + hóa đơn + hình thức
→ Cuối ngày Kế toán đối soát
→ Aging report tự động: xanh/vàng/cam/đỏ
→ Quá 60 ngày → Khóa KH, báo Owner
```

---

## 📦 DELIVERABLES

| # | Item | Chi tiết |
|---|------|----------|
| 1 | Next.js app | 12 modules, responsive, role-based |
| 2 | Supabase migrations | Schema + RLS + seed data |
| 3 | Auth system | Login, role guard, org context |
| 4 | Dashboard | KPI cards, charts, alerts (M12) |
| 5 | CRUD đầy đủ | Tất cả entities với form validation |

## ⚠️ KHÔNG BAO GỒM (trong Coder Pack)

- Kết nối HĐĐT thực (VNPT/Viettel) — chỉ UI + mock
- Barcode scanner hardware — chỉ input field
- Offline mode — cần thêm service worker riêng
- Push notifications — cần thêm FCM
- Import Excel — build riêng sau

---

## ✅ CHECKPOINT

Chủ nhà xác nhận:
- [ ] Tech stack (Next.js + Supabase + Vercel) OK
- [ ] Database schema đủ cho 12 modules
- [ ] File structure hợp lý
- [ ] Luồng nghiệp vụ đúng với tài liệu v1.1
- [ ] Danh sách "không bao gồm" chấp nhận được

**Reply "APPROVED" để nhận CODER PACK.**

---
---

# ═══════════════════════════════════════════════════════════════
#                        🔧 CODER PACK
#                  npp.sale — Mini ERP cho NPP
# ═══════════════════════════════════════════════════════════════
#
#  📋 HƯỚNG DẪN:
#  1. Copy từ dòng này TRỞ XUỐNG → Paste vào Claude Code / Cursor
#  2. Trả lời nơi lưu project
#  3. Ngồi chờ code được tạo
#
# ═══════════════════════════════════════════════════════════════

## 🎭 VAI TRÒ

Bạn là THỢ XÂY trong hệ thống Vibecode Kit v5.0.

Kiến trúc sư và Chủ nhà đã THỐNG NHẤT bản vẽ dưới đây.

### QUY TẮC TUYỆT ĐỐI:
1. KHÔNG thay đổi kiến trúc / layout / database schema
2. KHÔNG thêm features không có trong Blueprint
3. KHÔNG đổi tech stack (Next.js 14 + Supabase + Vercel + Tailwind + shadcn/ui + Recharts)
4. Gặp conflict → BÁO CÁO, không tự quyết định

## 🚀 BẮT ĐẦU

Hỏi DUY NHẤT: "Bạn muốn lưu dự án ở đâu?"

Sau đó → TIẾN HÀNH NGAY theo thứ tự:

### Phase 1: Foundation
1. Init Next.js 14 (App Router) + Tailwind + shadcn/ui
2. Tạo `supabase/migrations/001_schema.sql` — toàn bộ bảng theo schema trong Blueprint
3. Tạo `supabase/migrations/002_rls_policies.sql` — RLS theo role matrix
4. Tạo `supabase/migrations/003_seed.sql` — demo data (1 org, 6 users mỗi role, 20 KH, 50 SP, 10 đơn)
5. Setup Supabase client (browser + server) + auth middleware
6. Tạo TypeScript types từ schema
7. Tạo `lib/permissions.ts` — role → action map

### Phase 2: Layout & Auth
8. Login page (email/password qua Supabase Auth)
9. Dashboard layout: sidebar (desktop) + bottom nav (mobile) + header
10. Role guard: redirect nếu không có quyền
11. Org context provider

### Phase 3: Tầng 1 MVP (6 modules)
12. **M6 Sản phẩm** — CRUD, đa ĐVT, đa bảng giá (build trước vì các module khác phụ thuộc)
13. **M2 Khách hàng** — CRUD, chống trùng SĐT/địa chỉ, phân công NV, nhóm KH
14. **M1 Đơn hàng** — Tạo đơn (auto NV, auto giá, check tồn + hạn mức), workflow duyệt, gộp đơn
15. **M3 Kho hàng** — Lô hàng, nhập/xuất (FEFO), cảnh báo HSD (1/3 vàng, 30 ngày đỏ), kiểm kê
16. **M4 Phân quyền** — UI quản lý users, gán role (RLS đã setup ở Phase 1)
17. **M5 Hoa hồng** — Chính sách (%, cố định, bậc lũy kế), tủ thưởng, bảng xếp hạng NV

### Phase 4: Tầng 2 Mở rộng (6 modules)
18. **M7 Công nợ** — Sổ công nợ, aging report (xanh/vàng/cam/đỏ), công nợ theo NV, thu tiền tại hiện trường
19. **M8 Giao hàng** — Picking list (FEFO + vị trí), phân chuyến, POD (ảnh + chữ ký), giao một phần
20. **M9 Khuyến mãi** — 5 loại KM, ưu tiên, chồng chéo (chọn tốt nhất), thời hạn + phạm vi
21. **M10 Hóa đơn điện tử** — UI tạo HĐĐT từ đơn đã giao (mock API, không kết nối thật)
22. **M11 Trả hàng** — Yêu cầu trả (lý do + ảnh), duyệt, nhập kho/hủy, credit note
23. **M12 Báo cáo** — Dashboard KPI, charts doanh số, top SP, cảnh báo công nợ + HSD, báo cáo nhã hàng

### Phase 5: Polish
24. Responsive test tất cả trang ở 375px / 768px / 1280px
25. Loading states + error handling mọi form
26. Empty states cho danh sách trống
27. Breadcrumb navigation

---

## 📘 BLUEPRINT CHI TIẾT

[Toàn bộ nội dung Blueprint ở trên — bao gồm: Database Schema, File Structure, Design System, RLS Strategy, Luồng nghiệp vụ]

---

## 🛠️ QUY TẮC CODE

### Supabase
- Dùng `createServerClient` trong Server Components / API routes
- Dùng `createBrowserClient` trong Client Components
- Mọi query PHẢI qua RLS — không dùng service_role key ở frontend
- Dùng Supabase realtime cho tồn kho (subscribe changes)

### Next.js
- App Router only (không Pages Router)
- Server Components mặc định, `"use client"` chỉ khi cần interactivity
- API routes cho business logic phức tạp (duyệt đơn, gộp đơn, tính hoa hồng)
- Dùng `next/navigation` cho redirect

### UI
- shadcn/ui cho tất cả components (Button, Input, Table, Dialog, Sheet, Select, Badge, Card, Tabs)
- Tailwind utility classes — không viết CSS riêng
- Mobile-first: thiết kế cho 375px trước, scale lên
- Vietnamese UI text — tất cả labels, placeholders, messages bằng tiếng Việt

### Conventions
- File name: kebab-case (`order-form.tsx`)
- Component name: PascalCase (`OrderForm`)
- Database: snake_case (`sales_orders`)
- Mã đơn format: `SO-YYYYMMDD-XXXX` (auto-increment trong ngày)
- Tiền tệ: VND, không decimal, format `xxx.xxx.xxxđ`
- Ngày tháng: `DD/MM/YYYY` hiển thị, ISO 8601 lưu DB

---

## ✅ SAU KHI HOÀN THÀNH

```
✅ Đã tạo xong [số] files
📁 Location: [path]

Để chạy:
1. cd [path]
2. cp .env.example .env.local  (điền Supabase URL + anon key)
3. npm install
4. npx supabase start  (hoặc dùng Supabase cloud)
5. npx supabase db push  (chạy migrations)
6. npm run dev
7. Mở http://localhost:3000
```

---
# END OF CODER PACK
