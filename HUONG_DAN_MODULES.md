# Hướng dẫn chi tiết 12 Module

> Tham chiếu nhanh cho từng module. Đọc cùng với hướng dẫn theo vai trò ([HUONG_DAN_OWNER.md](HUONG_DAN_OWNER.md), [HUONG_DAN_SALES.md](HUONG_DAN_SALES.md), v.v.).

## Mục lục

1. [Dashboard](#1-dashboard) `/dashboard`
2. [Đơn hàng](#2-đơn-hàng) `/orders`
3. [Khách hàng](#3-khách-hàng) `/customers`
4. [Sản phẩm](#4-sản-phẩm) `/products`
5. [Kho hàng](#5-kho-hàng) `/inventory`
6. [Giao hàng](#6-giao-hàng) `/deliveries`
7. [Công nợ](#7-công-nợ) `/receivables`
8. [Khuyến mãi](#8-khuyến-mãi) `/promotions`
9. [Hóa đơn](#9-hóa-đơn) `/invoices`
10. [Trả hàng](#10-trả-hàng) `/returns`
11. [Hoa hồng](#11-hoa-hồng) `/commissions`
12. [Báo cáo](#12-báo-cáo) `/reports`

---

## 1. Dashboard

**URL**: `/dashboard` | **Quyền**: Tất cả trừ Tài xế

### Cấu trúc trang

| Khu vực | Nội dung |
| --- | --- |
| 4 thẻ KPI | Doanh thu tháng, Đơn hôm nay, Công nợ mở, Tồn kho cảnh báo |
| Hiệu suất tài chính | Biểu đồ minh họa (sẽ kết nối dữ liệu thực) |
| Top khách hàng | 5 KH có doanh thu cao nhất tháng + thanh tỷ lệ |
| Cảnh báo quan trọng | Lô hết hạn, vượt nợ, tồn kho thấp |
| Hoạt động gần đây | 5 đơn mới nhất |

### Mẹo
- Click nút "Xem chi tiết" trên cảnh báo → đi thẳng đến trang xử lý
- Cập nhật ngày được hiển thị ở header trang

---

## 2. Đơn hàng

**URL**: `/orders` | **Tạo**: `/orders/new` | **Chi tiết**: `/orders/[id]`

### 6 trạng thái

| Mã | Tên | Mô tả |
| --- | --- | --- |
| `draft` | Nháp | Vừa tạo, chờ duyệt |
| `confirmed` | Đã duyệt | Quản lý OK, sẵn sàng giao |
| `picking` | Đang lấy | Kho đang soạn hàng |
| `delivering` | Đang giao | Đã rời kho |
| `delivered` | Đã giao | Đến tay khách |
| `cancelled` | Đã hủy | Hủy bỏ |

### Tạo đơn (form `/orders/new`)

```
1. Chọn Khách hàng → tự load thông tin (group, payment_terms)
2. Thêm Sản phẩm → tự lấy giá theo group khách
3. Chỉnh số lượng / chiết khấu dòng nếu cần
4. Xem tự động: Subtotal + VAT (theo vat_rate từng SP) + Total
5. Nhập Ghi chú (tùy chọn)
6. Nhấn "Lưu đơn hàng" → trạng thái 'draft'
```

### Ngưỡng phê duyệt
- ≤ 20 triệu: tự động duyệt (Sales tạo là OK)
- 20-50 triệu: cần Quản lý duyệt
- > 50 triệu: cần Chủ sở hữu duyệt

### Ai làm gì?
- **Sales** tạo, theo dõi đơn của mình
- **Quản lý / Owner** duyệt
- **Kho** chuyển trạng thái `picking`
- **Tài xế** chuyển `delivering` → `delivered`

---

## 3. Khách hàng

**URL**: `/customers` | **Tạo**: `/customers/new` | **Chi tiết**: `/customers/[id]`

### Phân loại
- **Nhóm**: VIP / Thường / Mới (định giá khác nhau)
- **Kênh**: GT (tạp hóa) / MT (siêu thị mini) / HORECA (nhà hàng)
- **Hạn mức**: Số tiền nợ tối đa cho phép
- **Điều khoản TT**: COD / NET15 / NET30 / NET45

### Phân công Sales
Trang chi tiết KH → tab **Phân công**:
- Sales `primary`: chính
- Sales `secondary`: phụ (backup)

> ⚠️ Sales chỉ thấy KH có `customer_assignments.user_id = mình` AND `status = 'active'`

### Nhập KH mới (Sales hoặc Quản lý)
1. Vào `/customers/new`
2. Bắt buộc: Tên cửa hàng, Tên chủ, SĐT, Địa chỉ
3. Tùy chọn: Tỉnh/Quận/Phường, Kênh, Nhóm, Hạn mức
4. Lưu → tự gắn `org_id` của user

---

## 4. Sản phẩm

**URL**: `/products` | **Chi tiết**: `/products/[id]`

### 3 tab trong chi tiết SP
1. **Thông tin chung**: SKU, tên, danh mục, brand, VAT, HSD ngày
2. **Đơn vị**: Multi-unit (vd: lon → lốc 6 → thùng 24)
3. **Bảng giá**: Theo nhóm KH + đơn vị + thời gian hiệu lực

### Cấu trúc đơn vị
- `base_unit`: Đơn vị cơ bản (lon, chai, gói...)
- `product_units.unit_name`: Đơn vị bán (Lốc 6, Thùng 24...)
- `product_units.conversion`: Số đơn vị cơ bản trong 1 đơn vị bán

### Giá theo nhóm
Mỗi SP × đơn vị có thể có nhiều dòng giá:
- `group_id = NULL` → giá mặc định
- `group_id = VIP` → giá cho nhóm VIP
- Ngày hiệu lực `effective_from` / `effective_to`

---

## 5. Kho hàng

**URL**: `/inventory` (tổng) | `/inventory/batches` (lô) | `/inventory/entries` (giao dịch) | `/inventory/stocktake` (tạo phiếu)

### Lô hàng (`batches`)
| Trường | Ý nghĩa |
| --- | --- |
| `batch_code` | Mã lô (do nhà SX in) |
| `manufactured_at` | Ngày sản xuất |
| `expires_at` | Hạn sử dụng |
| `location` | Vị trí trong kho (vd: "Kho A - Kệ 3") |
| `qty_initial` | SL ban đầu |
| `qty_on_hand` | SL còn lại |

### 4 loại phiếu nhập/xuất
- `import` - Nhập kho từ NCC
- `export` - Xuất kho (ngoài đơn hàng)
- `transfer` - Chuyển kho
- `stocktake` - Kiểm kê (điều chỉnh)

### Cảnh báo HSD
- 🟢 OK: Còn > 30 ngày
- 🟡 Cảnh báo: 30 ngày trở xuống
- 🔴 Nguy hiểm: Còn < 1/3 hạn sử dụng (theo `shelf_life_days`)

---

## 6. Giao hàng

**URL**: `/deliveries` | **Tạo**: `/deliveries/new` | **Chi tiết**: `/deliveries/[id]`

### Tạo phiếu giao
1. Chọn **tài xế** (role = driver)
2. Nhập **xe** + **tuyến đường**
3. Tick các đơn `confirmed` để gộp vào chuyến
4. Lưu → trạng thái `pending`

### Trang chi tiết (cho tài xế)
- Hiển thị danh sách `delivery_lines`
- Mỗi dòng có nút: ✅ Giao thành công / ❌ Giao thất bại
- Chụp ảnh POD (`pod_photo_url`) + chữ ký (`pod_signature`)

### Trạng thái phiếu giao
- `pending` → `in_transit` → `completed`
- Hoặc `cancelled`

---

## 7. Công nợ

**URL**: `/receivables` | **Tuổi nợ**: `/receivables/aging` | **Thu tiền**: `/receivables/collect`

### Vòng đời 1 khoản phải thu
```
Đơn 'delivered' → tự sinh receivable (status='open')
   ↓
Khách trả 1 phần → status='partial', paid tăng lên
   ↓
Khách trả đủ → status='paid'
   ↓
Quá due_date mà chưa đủ → status='overdue'
```

### 4 buckets tuổi nợ
- 0-30 ngày: Hiện tại
- 31-60 ngày: Cảnh báo
- 61-90 ngày: Quá hạn
- > 90 ngày: Khẩn cấp

### Thu tiền (`/receivables/collect`)
1. Chọn khoản phải thu
2. Nhập số tiền + phương thức (cash / transfer / ewallet)
3. Lưu → tạo `payment` với `verified_at = NULL`
4. Kế toán vào /receivables xác minh (cập nhật `verified_by` + `verified_at`)

---

## 8. Khuyến mãi

**URL**: `/promotions` | **Tạo**: `/promotions/new`

### 5 loại khuyến mãi

| Type | Mô tả | Cấu trúc rules JSON |
| --- | --- | --- |
| `trade_discount` | Chiết khấu thương mại % | `{"discount_percent": 5}` |
| `buy_x_get_y` | Mua X tặng Y | `{"buy_qty": 10, "get_qty": 1}` |
| `payment_discount` | Giảm khi thanh toán đúng hạn | `{"discount_percent": 2}` |
| `cumulative` | Tích lũy đạt mức được thưởng | `{"threshold": 10000000, "bonus": 500000}` |
| `display` | Trưng bày (chỉ ghi nhận) | `{"description": "..."}` |

### Cấu hình
- `priority`: Số càng cao càng ưu tiên áp dụng (mặc định 0)
- `target_groups`: Mảng UUID nhóm khách áp dụng (NULL = tất cả)
- `starts_at` / `ends_at`: Thời gian hiệu lực
- `is_active`: Bật/tắt nhanh

---

## 9. Hóa đơn

**URL**: `/invoices` | **Tạo**: `/invoices/new`

### Tạo hóa đơn
1. Chọn **đơn hàng đã giao** (status = `delivered`)
2. Tự load: tên KH, địa chỉ, subtotal, VAT, total
3. Chỉnh sửa nếu cần (mã số thuế, địa chỉ xuất HĐ)
4. Số HĐ tự sinh: `INV-YYYYMMDD-XXXX` (có thể chỉnh)
5. Lưu → trạng thái `draft`

### 3 trạng thái
- `draft`: Nháp, chưa phát hành
- `issued`: Đã phát hành (gửi cho khách)
- `cancelled`: Đã hủy

> 💡 Module này có thể tích hợp với hệ thống e-Invoice (VNPT, Misa) trong tương lai.

---

## 10. Trả hàng

**URL**: `/returns` | **Tạo**: `/returns/new`

### Quy trình
```
Sales tạo yêu cầu (pending)
   ↓
Quản lý duyệt (approved) hoặc từ chối (rejected)
   ↓
Kho nhận hàng + Kế toán tạo credit note
   ↓
Hoàn tất (completed)
```

### 5 lý do trả
- `damaged` - Hàng hỏng
- `wrong_item` - Giao nhầm sản phẩm
- `near_expiry` - Sắp hết hạn
- `expired` - Đã hết hạn
- `refused` - Khách từ chối nhận

### Quy tắc thời gian
- Trả trong 48h đầu sau giao: tự động duyệt
- Sau 48h: cần Quản lý duyệt thủ công

---

## 11. Hoa hồng

**URL**: `/commissions` (ví) | `/commissions/policies` (chính sách) | `/commissions/policies/new` (tạo)

### Chính sách (commission_policies)
3 loại tính:
- `percentage`: Phần trăm doanh thu (vd: 3% trên total)
- `fixed`: Số tiền cố định/đơn (vd: 50,000đ/đơn)
- `tiered`: Bậc thang (vd: <10tr=2%, 10-50tr=3%, >50tr=5%)

### Ví hoa hồng (commission_wallets)
- Mỗi user có 1 ví/kỳ (period dạng "2026-04")
- `earned`: Tổng hoa hồng kỳ này
- `paid`: Đã trả
- `balance`: Còn lại (`earned - paid`, generated column)

### Quyền xem
- Sales: Xem ví của chính mình
- Owner / Accountant: Xem ví của tất cả nhân viên trong org

---

## 12. Báo cáo

**URL**: `/reports` (hub) | `/reports/sales` | `/reports/inventory` | `/receivables/aging`

### Báo cáo doanh số (`/reports/sales`)
- Tổng doanh thu kỳ
- Số đơn hàng
- Trung bình giá trị đơn
- Top sản phẩm bán chạy
- Đơn hàng gần đây

### Báo cáo tồn kho (`/reports/inventory`)
- Tổng SKU
- Tổng giá trị tồn (theo giá vốn)
- Lô sắp hết hạn
- Ton kho thấp

### Báo cáo tuổi nợ (`/receivables/aging`)
- Phân bổ công nợ theo 4 bucket
- Tổng quá hạn
- Drilldown theo khách hàng

---

## Phụ lục: Bảng từ điển tiếng Anh

| Thuật ngữ EN | Nghĩa VN |
| --- | --- |
| Order | Đơn hàng |
| Customer | Khách hàng |
| Product / SKU | Sản phẩm |
| Batch / Lot | Lô hàng |
| Stock entry | Phiếu nhập/xuất kho |
| Stocktake | Kiểm kê |
| Delivery | Giao hàng |
| POD (Proof of Delivery) | Chứng từ giao hàng |
| Receivable | Công nợ phải thu |
| Aging | Tuổi nợ |
| Invoice | Hóa đơn |
| Return | Trả hàng |
| Commission | Hoa hồng |
| FIFO | Nhập trước xuất trước |
| RLS | Bảo mật cấp dòng (Row Level Security) |
| GT / MT / HORECA | Tạp hóa truyền thống / Siêu thị / Nhà hàng-quán ăn |

---

**Phiên bản**: 1.0 - Cập nhật 2026-04-16
