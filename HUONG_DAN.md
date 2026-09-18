# Hướng dẫn sử dụng npp.sale

> **Mini ERP cho Nhà Phân Phối FMCG** - Quản lý toàn bộ hoạt động từ đặt hàng, giao hàng, thu công nợ đến hoa hồng và báo cáo.

---

## Mục lục

1. [Giới thiệu hệ thống](#1-giới-thiệu-hệ-thống)
2. [Đăng nhập & 6 vai trò](#2-đăng-nhập--6-vai-trò)
3. [Tổng quan giao diện](#3-tổng-quan-giao-diện)
4. [Bắt đầu nhanh (3 phút)](#4-bắt-đầu-nhanh-3-phút)
5. [Sơ đồ luồng nghiệp vụ](#5-sơ-đồ-luồng-nghiệp-vụ)
6. [Tài liệu chi tiết](#6-tài-liệu-chi-tiết)

---

## 1. Giới thiệu hệ thống

**npp.sale** là hệ thống ERP nhỏ gọn được thiết kế riêng cho nhà phân phối hàng tiêu dùng (FMCG). Hệ thống bao gồm 12 module chính:

| Module | Chức năng | Đối tượng dùng chính |
| --- | --- | --- |
| 📊 Dashboard | Tổng quan KPI, top khách hàng | Tất cả |
| 🛒 Đơn hàng | Tạo đơn, gửi phiếu tạm, Xuất hàng | Nhà phân phối |
| 👥 Khách hàng | Quản lý cửa hàng, nhóm KH | Sales, Quản lý |
| 📦 Sản phẩm | SKU, đơn vị, bảng giá | Quản lý |
| 🏬 Kho hàng | Lô hàng, tồn kho, HSD | Kho |
| 🚚 Giao hàng | *(Ngưng dùng — chỉ tra cứu chứng từ cũ)* | — |
| 💰 Công nợ | Phải thu, thu tiền | Kế toán, Sales |
| 🎁 Khuyến mãi | Chiết khấu, mua X tặng Y | Quản lý |
| 📄 Hóa đơn | Xuất hóa đơn VAT | Kế toán |
| ↩️ Trả hàng | Lập phiếu trả, Hoàn thành (nhập lại kho) | Nhà phân phối |
| 💼 Hoa hồng | Chính sách & ví hoa hồng | Chủ sở hữu |
| 📈 Báo cáo | Doanh số, tồn kho, công nợ | Tất cả |

### Triết lý thiết kế

- **Đa người dùng theo vai trò**: Mỗi nhân viên chỉ thấy những gì cần thiết cho công việc của mình
- **Multi-tenant**: Mỗi tổ chức (nhà phân phối) có dữ liệu hoàn toàn tách biệt
- **Mobile-first cho field**: Sales dùng điện thoại khi đi tuyến; Quản lý dùng laptop
- **Bảo mật cấp dòng (RLS)**: Database tự động chặn truy cập trái phép

---

## 2. Đăng nhập & 6 vai trò

### Cách đăng nhập

1. Truy cập `https://nppsale.vercel.app/login`
2. Nhập **email** và **mật khẩu**
3. Nhấn **Đăng nhập**
4. Hệ thống tự động chuyển vào **Dashboard** (hoặc trang phù hợp với vai trò)

### Tài khoản demo

> Mật khẩu chung: `Demo@123456`

| Email | Vai trò | Có thể làm gì? |
| --- | --- | --- |
| `owner@demo.com` | **Chủ sở hữu** | Toàn quyền - xem mọi thứ, sửa mọi thứ |
| `manager@demo.com` | **Quản lý** | Xuất hàng, quản lý KH, sản phẩm, khuyến mãi |
| `accountant@demo.com` | **Kế toán** | Công nợ, hóa đơn, hoa hồng |
| `sales@demo.com` | **Nhân viên bán hàng** | Tạo đơn cho KH được giao |
| `warehouse@demo.com` | **Kho** | Nhập/xuất kho, lô hàng |

### Ma trận quyền (12 module × 5 vai trò)

✅ = Có quyền | ❌ = Không có quyền | 👁️ = Chỉ xem

| Module | Owner | Manager | Accountant | Sales | Warehouse |
| --- | :-: | :-: | :-: | :-: | :-: |
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Đơn hàng | ✅ | ✅ Xuất hàng | 👁️ | ✅ Tạo | 👁️ |
| Khách hàng | ✅ | ✅ | 👁️ | ✅ KH được giao | ❌ |
| Sản phẩm | ✅ | ✅ | 👁️ | 👁️ | 👁️ |
| Kho hàng | ✅ | 👁️ | 👁️ | 👁️ | ✅ |
| Giao hàng *(ngưng dùng)* | 👁️ | 👁️ | 👁️ | 👁️ | 👁️ |
| Công nợ | ✅ | 👁️ | ✅ | ✅ Tạo | ❌ |
| Khuyến mãi | ✅ | ✅ | 👁️ | 👁️ | ❌ |
| Hóa đơn | ✅ | 👁️ | ✅ | 👁️ | ❌ |
| Trả hàng | ✅ Hoàn thành | ✅ Hoàn thành | 👁️ | ✅ Tạo | 👁️ |
| Hoa hồng | ✅ | 👁️ | ✅ Cập nhật | 👁️ ví của mình | ❌ |
| Báo cáo | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cài đặt | ✅ | 👁️ | 👁️ | ❌ | ❌ |

---

## 3. Tổng quan giao diện

### Trên máy tính (Desktop)

```
┌───────────────────────────────────────────────────────────────┐
│  [Sidebar trái - 256px]    │   [Header sticky]                │
│  • Logo & tên               │   Tiêu đề trang   🔍 🔔  👤    │
│  • Nút "Tạo đơn mới"        ├──────────────────────────────────┤
│  • Menu 12 module           │                                  │
│  • Dashboard                │   [Nội dung trang]               │
│  • Đơn hàng (active)        │                                  │
│  • Khách hàng               │   - PageHeader (tiêu đề + CTA)   │
│  • ...                      │   - Bộ lọc (search + filter)     │
│  • Cài đặt                  │   - Bảng/Card dữ liệu            │
│  ┌────────────────┐         │                                  │
│  │ Hỗ trợ          │         │                                  │
│  │ Đăng xuất       │         │                                  │
│  └────────────────┘         │                                  │
└─────────────────────────────┴──────────────────────────────────┘
```

### Trên điện thoại (Mobile)

```
┌─────────────────────────┐
│ ☰  Quản lý đơn hàng  🔔│  ← Header (có nút menu)
├─────────────────────────┤
│                         │
│  [Nội dung scroll]      │
│                         │
│  - Card 1               │
│  - Card 2               │
│  - Card 3               │
│                         │
│                         │
├─────────────────────────┤
│  [Bottom nav glass]     │  ← Cố định dưới
│  📋 Đơn  👥 KH  📦 SP   │
│  🏬 Kho  ☰ Menu         │
└─────────────────────────┘
```

### Ý nghĩa các icon trạng thái

| Icon/Màu | Ý nghĩa |
| --- | --- |
| 🟦 Xanh dương | Bình thường, mặc định |
| 🟩 Xanh lá | Thành công, đã hoàn thành |
| 🟨 Vàng | Đang chờ, cảnh báo |
| 🟥 Đỏ | Lỗi, quá hạn, hủy |
| ⚪ Xám | Nháp, không hoạt động |
| 🔵 Chấm đỏ trên 🔔 | Có thông báo mới |

---

## 4. Bắt đầu nhanh (3 phút)

> Dành cho người dùng lần đầu - đăng nhập và làm quen với 1 luồng cơ bản.

### Bước 1 - Đăng nhập (30 giây)

1. Mở `https://nppsale.vercel.app`
2. Nhập `owner@demo.com` / `Demo@123456`
3. Nhấn **Đăng nhập**

### Bước 2 - Khám phá Dashboard (1 phút)

Sau khi đăng nhập bạn sẽ thấy:
- **4 thẻ KPI**: Doanh thu tháng, Đơn hàng hôm nay, Công nợ mở, Tồn kho cảnh báo
- **Top khách hàng**: 5 khách hàng có doanh thu cao nhất
- **Hoạt động gần đây**: 5 đơn hàng mới nhất
- **Cảnh báo**: Lô hàng sắp hết hạn, khách hàng vượt nợ

> 💡 Click vào "Xem chi tiết" trên từng cảnh báo để đi thẳng đến trang xử lý.

### Bước 3 - Tạo đơn hàng đầu tiên (1.5 phút)

1. Click nút **"Tạo đơn mới"** ở sidebar (nút xanh gradient)
2. **Chọn khách hàng** từ dropdown (vd: "Tạp hóa Bà Hai")
3. Click **"Thêm sản phẩm"** và chọn vài sản phẩm
4. Nhập **số lượng** cho mỗi dòng
5. Xem **Tổng tiền** tự động cập nhật (Subtotal + VAT)
6. Click **"Lưu đơn hàng"**

> ✅ Đơn được tạo với trạng thái **"Nháp"** — chỉ mình bạn thấy. Bấm
> **"Gửi đơn"** để nó thành **"Phiếu tạm"** (cả nhà phân phối thấy, vẫn
> sửa được), rồi bấm **"Xuất hàng"** để trừ kho, ghi công nợ và in phiếu
> giao — một nút, một lần.

---

## 5. Sơ đồ luồng nghiệp vụ

### Luồng cơ bản: Từ đặt hàng đến thu tiền

```
                        [Nhà phân phối]
                              │
                              │ 1. Tạo đơn hàng
                              │    (draft — "Nháp", chỉ người tạo thấy)
                              ▼
                              │ 2. Gửi đơn
                              │    (submitted — "Phiếu tạm", cả nhà
                              │     phân phối thấy, vẫn sửa được)
                              ▼
                              │ 3. Bấm "XUẤT HÀNG"   ◄── MỘT nút duy nhất
                              │    • trừ kho theo FIFO
                              │    • ghi công nợ phải thu
                              │    • in phiếu giao hàng
                              │    (completed — "Hoàn thành")
                              ▼
         [Hai chứng từ ĐỘC LẬP, cùng khép vào công nợ phải thu]
                  │                              │
                  │ 4a. Phiếu trả                │ 4b. Phiếu thu
                  │     Nháp → Phiếu tạm →       │     chọn khoản nợ cần
                  │     Hoàn thành               │     khép; cấn trừ được
                  │     ⚠ hàng chỉ VÀO KHO khi   │     phiếu trả độc lập
                  │       bấm "Hoàn thành"       │     và rút số dư có
                  └───────────────┬──────────────┘
                                  ▼
                            [Kế toán]
                                  │ 5. Xuất hóa đơn VAT (từ đơn Hoàn thành)
                                  ▼
                            [Hệ thống]
                                  │ 6. Tính hoa hồng cho Sales
```

⚠ **Không còn bước duyệt đơn, soạn hàng, lập chuyến giao hay bàn giao.**
Ba vai chuyền tay nhau ở bản cũ (Quản lý duyệt → Kho soạn → Tài xế giao)
nay gộp vào đúng một thao tác của nhà phân phối.

### 4 trạng thái đơn hàng

```
   Nháp ──► Phiếu tạm ──► Hoàn thành
   draft    submitted     completed
     │          │              │
     │          └── bấm "Xuất hàng": trừ kho + ghi công nợ + in phiếu giao
     │
     └──► Đã hủy (cancelled) - hủy được cả đơn ĐÃ hoàn thành (tồn và công
          nợ được hoàn lại), trừ khi đơn đã thu tiền
```

Phiếu trả hàng dùng **đúng bốn trạng thái này**.

### 4 trạng thái công nợ

> Công nợ phải thu sinh ra ngay lúc bấm **"Xuất hàng"**, trong cùng một
> giao dịch — không chờ giao xong, không chờ xuất hóa đơn. Nó được khép
> lại bằng **Phiếu thu** và **Phiếu trả**, hai chứng từ độc lập.
>
> ⚠ Số đã trả CÓ THỂ lớn hơn số phải thu: khách trả hàng sau khi đã
> thanh toán đủ thì phần chênh là **số dư có** của họ, rút ra dùng được
> ở màn lập phiếu thu.

```
   Mở ──► Một phần ──► Đã trả
   open   partial      paid
     │
     └──► Quá hạn (overdue) - khi quá due_date mà chưa trả đủ
```

---

## 6. Tài liệu chi tiết

> 📚 **Các tài liệu sẽ được bổ sung trong bước tiếp theo**

| Tài liệu | Mô tả | Trạng thái |
| --- | --- | --- |
| [`HUONG_DAN.md`](HUONG_DAN.md) (file này) | Tổng quan + vai trò + luồng cơ bản | ✅ |
| [`HUONG_DAN_OWNER.md`](HUONG_DAN_OWNER.md) | Hướng dẫn chi tiết cho Chủ sở hữu | ✅ |
| [`HUONG_DAN_MANAGER.md`](HUONG_DAN_MANAGER.md) | Hướng dẫn cho Quản lý | ✅ |
| [`HUONG_DAN_ACCOUNTANT.md`](HUONG_DAN_ACCOUNTANT.md) | Hướng dẫn cho Kế toán | ✅ |
| [`HUONG_DAN_SALES.md`](HUONG_DAN_SALES.md) | Hướng dẫn cho Sales | ✅ |
| [`HUONG_DAN_WAREHOUSE.md`](HUONG_DAN_WAREHOUSE.md) | Hướng dẫn cho Kho | ✅ |
| [`HUONG_DAN_MODULES.md`](HUONG_DAN_MODULES.md) | Chi tiết 12 module | ✅ |
| `/help` (in-app) | Trang trợ giúp trong ứng dụng | ✅ |
| [`DEPLOY.md`](DEPLOY.md) | Hướng dẫn cài đặt & deploy | ✅ |
| [`README.md`](README.md) | Tóm tắt project | ✅ |

---

## Câu hỏi thường gặp (FAQ)

### Q: Tôi quên mật khẩu phải làm sao?
> Liên hệ Chủ sở hữu để được cấp lại. (Tính năng "Quên mật khẩu" đang phát triển.)

### Q: Tại sao tôi không thấy menu "Khuyến mãi"?
> Bạn không có quyền với module này. Chỉ Chủ sở hữu, Quản lý mới truy cập được.

### Q: Một đơn đã "Xuất hàng" có thể chỉnh sửa không?
> Được, trong một số ngày do chủ NPP đặt, và chỉ khi đơn chưa vướng bốn
> khoá: đã thu tiền, đã phát hành hóa đơn, đã có phiếu trả hoàn thành,
> hoặc đã quá hạn sửa. Sửa xong hệ thống tự chỉnh lại tồn và công nợ.
> Vướng khoá thì đường đi là lập **Phiếu trả** rồi tạo đơn mới.
> Đơn còn ở **"Phiếu tạm"** thì sửa thoải mái.

### Q: Màn "Giao hàng" / "Xuất kho" đâu rồi?
> Quy trình mới bỏ các bước soạn hàng — lập chuyến — bàn giao. Nhà phân
> phối bấm **"Xuất hàng"** ngay trên đơn. Chứng từ cũ vẫn tra cứu được
> bằng đường dẫn trực tiếp, chỉ không lập thêm được nữa.

### Q: Tại sao Sales chỉ thấy 1 số khách hàng?
> Sales chỉ thấy khách hàng được **Quản lý phân công** (xem trang chi tiết KH → tab "Phân công").

### Q: Hệ thống có cảnh báo HSD không?
> Có. Trang Dashboard và Kho đều hiển thị lô hàng sắp hết hạn (mặc định 30 ngày).

### Q: Có chạy được trên điện thoại không?
> Có. Toàn bộ giao diện responsive. Sales thường dùng điện thoại tại hiện trường.

---

## Liên hệ hỗ trợ

- 🐛 **Báo lỗi**: Tạo issue tại GitHub repo
- 💬 **Góp ý**: Liên hệ admin hệ thống
- 📖 **Trang debug**: `/debug` (kiểm tra kết nối hệ thống)

---

**Phiên bản**: 1.0 - Cập nhật 2026-04-16
