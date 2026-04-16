# Hướng dẫn cho Kho: Warehouse

> Bạn được cấp quyền **Warehouse**. Đây là hướng dẫn đầy đủ cho công việc nhập / xuất / kiểm kê, quản lý lô hàng và hạn sử dụng (FIFO).

## 1. Trách nhiệm chính

- Nhập kho hàng từ nhà cung cấp, gán mã lô và hạn sử dụng (HSD)
- Soạn hàng (`picking`) cho các đơn `confirmed`, in phiếu xuất kho
- Kiểm kê định kỳ (tuần / tháng / quý), điều chỉnh chênh lệch
- Theo dõi và cảnh báo lô hàng sắp hết hạn (mặc định < 30 ngày)
- Tiếp nhận hàng trả về, kiểm tra chất lượng và quyết định nhập lại / hủy

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Dashboard | Xem | Theo dõi cảnh báo HSD, tồn kho thấp |
| Đơn hàng | Xem | Tra cứu đơn `confirmed` cần soạn |
| Sản phẩm | Xem | Tra cứu SKU, đơn vị quy đổi (thùng - lốc - chai) |
| Kho hàng | Đọc / Tạo / Sửa | Tạo phiếu nhập / xuất / chuyển / kiểm kê, quản lý lô hàng |
| Giao hàng | Đọc / Sửa | Cập nhật trạng thái khi tài xế lấy hàng đi |
| Trả hàng | Đọc / Sửa | Nhập lại hàng sau khi Manager duyệt phiếu trả |
| Báo cáo | Xem | Báo cáo tồn kho, vòng quay, hàng hết hạn |

> ❌ Bạn KHÔNG có quyền truy cập: Khách hàng, Công nợ, Khuyến mãi, Hóa đơn, Hoa hồng, Cài đặt.

## 3. Luồng công việc hàng ngày

```
   Sáng (7:00)                 Trong ngày                       Cuối ngày (17:00)
       │                            │                                  │
       ▼                            ▼                                  ▼
   Nhập kho hàng ──► Soạn đơn ──► In phiếu xuất ──► Giao tài xế ──► Kiểm kê tồn
   từ NCC            confirmed     theo FIFO          + ký giao kệ    cuối ngày
   /inventory/        /orders                                          /inventory
   stocktake         (filter        Cập nhật                            Cảnh báo
   gán lô + HSD      "Đã duyệt")    trạng thái                          HSD < 30 ngày
                                    "picking"                          /inventory/expiring
```

**Mô tả các bước:**

1. **Sáng** - Nhận hàng từ NCC, vào `/inventory/stocktake` chọn loại **Nhập kho** (`import`), nhập **mã lô**, **HSD**, **vị trí**
2. **Soạn đơn** - Vào `/orders` lọc `confirmed`, in phiếu xuất, lấy hàng theo nguyên tắc **FIFO** (lô vào trước - xuất trước)
3. **Bàn giao** - Khi tài xế đến, đối chiếu phiếu, ký nhận, đơn chuyển `picking` → `delivering`
4. **Cuối ngày** - Vào `/inventory/expiring` xem lô sắp hết hạn để báo Manager đẩy bán
5. **Định kỳ** - Mỗi tuần kiểm kê 1 nhóm hàng, mỗi tháng kiểm toàn kho

## 4. Các thao tác thường gặp (step-by-step)

### 4.1 Nhập kho hàng mới từ NCC

**Khi nào**: Có chuyến hàng từ nhà sản xuất / nhà cung cấp về kho.

**Bước thực hiện**:
1. Vào `/inventory/stocktake`
2. Chọn **Loại phiếu** = **Nhập kho** (`import`)
3. Chọn **Sản phẩm** từ dropdown (hiển thị SKU - Tên)
4. Nhập **Số lượng** (theo đơn vị cơ bản, VD: chai)
5. Nhập **Mã lô hàng** (VD: `LOT-2026-001`)
6. Nhập **Hạn sử dụng** (`expires_at`, kiểu date)
7. Nhập **Vị trí kho** (VD: `T2-K3-05` = Tầng 2, Kệ 3, Vị trí 05)
8. (Tùy chọn) Ghi chú thêm thông tin chứng từ
9. Nhấn **Tạo phiếu**

**Kết quả**: Hệ thống tạo `stock_entries` (mã VD: `WH-20260416-1234`) + `batches` mới với `qty_on_hand = qty_initial`. Tồn kho tự cộng vào.

**Lưu ý**: Phải nhập **đúng HSD** in trên bao bì - hệ thống dùng để cảnh báo và FIFO. Sai HSD sẽ làm xuất hàng sai thứ tự.

### 4.2 Xuất kho theo đơn (soạn hàng)

**Khi nào**: Có đơn `confirmed` cần chuẩn bị giao.

**Bước thực hiện**:
1. Vào `/orders`, lọc **Trạng thái = Đã duyệt**
2. Click vào đơn → in **Phiếu xuất kho**
3. Đi nhặt hàng theo **vị trí** ghi trên phiếu, ưu tiên **lô có HSD gần nhất** (FIFO)
4. Vào `/inventory/stocktake`, chọn **Loại** = **Xuất kho** (`export`)
5. Chọn sản phẩm, nhập **Số lượng** (hệ thống sẽ tự ghi âm: `quantity = -qty`)
6. Nhấn **Tạo phiếu**
7. Cập nhật trạng thái đơn từ `confirmed` → `picking`

**Kết quả**: Tồn kho giảm đúng số lượng, hàng sẵn sàng giao tài xế.

**Lưu ý**: Nếu hàng trong kho không đủ - **không tự sửa số lượng đơn**. Báo Manager để xử lý (có thể giao 1 phần hoặc hoãn).

### 4.3 Bàn giao hàng cho tài xế

**Khi nào**: Tài xế đến nhận hàng cho chuyến giao.

**Bước thực hiện**:
1. Vào `/deliveries`, mở chuyến của tài xế đó
2. Đối chiếu **danh sách đơn** trên chuyến với hàng đã soạn
3. Đếm thùng / lốc theo phiếu xuất
4. Tài xế ký nhận trên phiếu giấy + bấm **Bắt đầu chuyến** trên app
5. Hệ thống chuyển trạng thái đơn từ `picking` → `delivering`

**Kết quả**: Tài xế khởi hành, kho hết trách nhiệm với lô hàng đó.

**Lưu ý**: Nếu phát hiện thiếu hàng tại bước này - phải sửa phiếu xuất ngay, không để tài xế lên đường với hàng thiếu.

### 4.4 Kiểm kê (stocktake) định kỳ

**Khi nào**: Mỗi tuần (1 nhóm hàng) hoặc cuối tháng (toàn kho).

**Bước thực hiện**:
1. Vào `/inventory/stocktake`, chọn **Loại** = **Kiểm kê** (`stocktake`)
2. Chọn từng SKU, đếm số lượng thực tế trên kệ
3. Nhập **Số lượng đếm được**
4. Hệ thống so với `qty_on_hand` trong DB
5. Nếu lệch:
   - **Thừa** → tạo phiếu nhập điều chỉnh
   - **Thiếu** → tạo phiếu xuất điều chỉnh, kèm **Lý do** (mất / vỡ / sai số nhập)
6. Nhấn **Tạo phiếu**

**Kết quả**: Tồn kho khớp với thực tế, có audit trail rõ ràng cho Owner.

**Lưu ý**: Chênh lệch > 5% phải báo Owner làm biên bản, không được tự ghi điều chỉnh lớn.

### 4.5 Theo dõi và xử lý hàng sắp hết hạn

**Khi nào**: Hàng ngày kiểm tra trang `/inventory/expiring`.

**Bước thực hiện**:
1. Vào `/inventory`, tab **Lô hàng** hoặc trang `/inventory/expiring`
2. Lọc **HSD còn < 30 ngày** (mặc định cảnh báo)
3. Xuất danh sách → gửi Manager để chạy chương trình **đẩy bán** (xả tồn)
4. Khi Manager tạo CTKM `near_expiry`, lô đó được ưu tiên xuất trước
5. Nếu lô đã **hết hạn** - tạo phiếu **Xuất hủy** (loại `export`, lý do `expired`)

**Kết quả**: Giảm thiểu hàng phải hủy, tăng vòng quay.

**Lưu ý**: Hàng `expired` phải xuất hủy ngay, không được trộn vào hàng bán - vi phạm an toàn thực phẩm.

### 4.6 Nhận hàng trả về từ tài xế / khách

**Khi nào**: Manager đã duyệt phiếu trả (`returns` trạng thái `approved`).

**Bước thực hiện**:
1. Vào `/returns`, lọc trạng thái **Đã duyệt**
2. Mở phiếu, kiểm tra **Lý do trả**:
   - `damaged` / `expired` → **không nhập lại kho bán**, chuyển khu vực hủy
   - `wrong_item` / `refused` → kiểm tra chất lượng, nhập lại lô gốc nếu còn nguyên vẹn
   - `near_expiry` → nhập lại nhưng đẩy bán ngay
3. Tạo phiếu nhập kho từ phiếu trả (link tự động)
4. Cập nhật trạng thái `returns` thành **Hoàn tất** (`completed`)

**Kết quả**: Tồn kho tăng đúng, hàng lỗi được tách riêng.

**Lưu ý**: Hàng trả phải kiểm tra **trong vòng 24h** kể từ khi nhận về - quá lâu khó truy lý do.

## 5. Mẹo & Best practices

- Áp dụng nghiêm ngặt **FIFO** (First In - First Out): luôn xuất lô có HSD gần nhất trước
- Đặt **vị trí kho** chuẩn (Tầng - Kệ - Ngăn) ngay từ đầu để soạn hàng nhanh
- In nhãn lô có **mã vạch / QR** dán trực tiếp lên thùng, scan để tránh nhầm
- Mỗi sáng dành 10 phút xem `/inventory/expiring` - phát hiện sớm để báo Manager
- Khi nhập kho, **đếm lại 2 lần** trước khi tạo phiếu - sửa phiếu sau rất khó
- Tách khu **hàng lỗi** / **hàng trả** / **hàng hết hạn** riêng biệt, có nhãn cảnh báo
- Mỗi cuối ca, đối chiếu **số phiếu xuất** đã tạo vs **số đơn picking** trên hệ thống - phải khớp

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Tạo phiếu xuất báo "Vượt tồn kho" | Số xuất > `qty_on_hand` của lô | Kiểm kê lại lô đó, tạo phiếu điều chỉnh thừa nếu cần |
| Quên nhập HSD khi nhập lô | Bỏ trống `expires_at` lúc tạo phiếu | Vào `/inventory/batches`, sửa lại lô (cần Owner duyệt) |
| Đơn `confirmed` không hiện trong danh sách soạn | Đơn đã được gắn vào chuyến giao trước đó | Kiểm tra `/deliveries` xem chuyến chứa đơn |
| Hệ thống báo "Hết hàng" nhưng thực tế còn | Lô hàng chưa được nhập vào hệ thống | Tạo phiếu nhập kho ngay với mã lô và HSD đúng |
| Hàng trả về không nhập được | Phiếu `returns` chưa được Manager duyệt | Báo Manager vào `/returns` duyệt trước khi nhập kho |

## 7. KPI bạn được đánh giá

- **Tỷ lệ chính xác kiểm kê** (chênh lệch < 1% / tổng tồn - mục tiêu > 99%)
- **Thời gian soạn đơn trung bình** (từ `confirmed` đến `picking` xong - mục tiêu < 2h)
- **Tỷ lệ hàng hết hạn phải hủy** (giữ < 0.5% / tổng nhập)
- **Tỷ lệ FIFO compliance** (% đơn xuất đúng lô gần HSD nhất - mục tiêu > 95%)
- **Số phiếu nhập / xuất sai phải sửa** (giữ < 2% / tổng phiếu)
