# Hướng dẫn cho Chủ sở hữu: Owner

> Bạn được cấp quyền **Owner**. Đây là hướng dẫn đầy đủ cho công việc hàng ngày của người đứng đầu nhà phân phối.

## 1. Trách nhiệm chính

- Quản trị toàn hệ thống: cấu hình tổ chức, tạo/khóa tài khoản nhân viên, phân vai trò
- Phê duyệt các quyết định lớn: đơn hàng giá trị cao, phiếu trả hàng, chính sách hoa hồng
- Theo dõi sức khỏe kinh doanh qua Dashboard và Báo cáo (doanh thu, công nợ, tồn kho)
- Ban hành chính sách hoa hồng, khuyến mãi, hạn mức công nợ cho từng nhóm khách hàng
- Là người duy nhất có quyền **xóa** dữ liệu ở mọi module - cần thận trọng khi thao tác

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Dashboard | Xem | Theo dõi 4 KPI, top KH, cảnh báo HSD và công nợ vượt hạn |
| Đơn hàng | Đọc / Tạo / Sửa / Xóa / Duyệt | Toàn quyền với mọi đơn của tổ chức |
| Khách hàng | Đọc / Tạo / Sửa / Xóa | Quản lý danh sách KH, phân nhóm, hạn mức tín dụng |
| Sản phẩm | Đọc / Tạo / Sửa / Xóa | Cấu hình SKU, đơn vị, bảng giá nhiều cấp |
| Kho hàng | Đọc / Tạo / Sửa / Xóa | Xem tồn, lô hàng, HSD, điều chỉnh khi cần |
| Giao hàng | Đọc / Tạo / Sửa / Xóa | Phân tuyến, gán tài xế |
| Công nợ | Đọc / Tạo / Sửa / Xóa | Theo dõi phải thu, ghi nhận thanh toán đặc biệt |
| Khuyến mãi | Đọc / Tạo / Sửa / Xóa | Ban hành chương trình chiết khấu, mua X tặng Y |
| Hóa đơn | Đọc / Tạo / Sửa / Xóa | Xuất hóa đơn VAT, hủy hóa đơn sai |
| Trả hàng | Đọc / Tạo / Sửa / Xóa / Duyệt | Phê duyệt phiếu trả hàng từ Sales |
| Hoa hồng | Đọc / Tạo / Sửa / Xóa | Xây dựng chính sách hoa hồng, kiểm tra ví của nhân viên |
| Báo cáo | Xem | Tất cả báo cáo doanh số, tồn kho, công nợ, hoa hồng |
| Cài đặt | Đọc / Tạo / Sửa / Xóa | Quản lý người dùng, cấu hình tổ chức |

## 3. Luồng công việc hàng ngày

```
   Sáng (8:00 - 9:30)              Trưa (13:00 - 14:00)        Cuối ngày (17:00 - 18:00)
        │                                  │                              │
        ▼                                  ▼                              ▼
   Mở Dashboard ─────► Duyệt đơn lớn ────► Kiểm tra ─────► Xem báo cáo ─► Xử lý
   Xem 4 KPI           > 20 triệu          công nợ          ngày           cảnh báo
        │              Phê duyệt trả       quá hạn          Hoa hồng        HSD/nợ
        ▼              hàng                                 đã chốt
   Xem cảnh báo
   HSD + nợ
```

**Mô tả các bước:**

1. **Sáng** - Đăng nhập, vào `/dashboard`, lướt 4 thẻ KPI và khu cảnh báo
2. **Duyệt đơn** - Vào `/orders` lọc trạng thái "Nháp" để duyệt các đơn vượt ngưỡng
3. **Trưa** - Mở `/receivables` để soát công nợ quá hạn, gọi nhắc khách hoặc giao Sales đôn đốc
4. **Cuối ngày** - Mở `/reports` xem doanh số ngày, vào `/commissions` chốt hoa hồng tháng nếu đến kỳ
5. **Cài đặt định kỳ** - Mỗi tuần xem `/settings/users` để rà soát quyền truy cập

## 4. Các thao tác thường gặp (step-by-step)

### 4.1 Tạo tài khoản nhân viên mới

**Khi nào**: Có nhân viên Sales, Kho, Tài xế, Kế toán mới gia nhập.

**Bước thực hiện**:
1. Vào sidebar nhấn **Cài đặt** → chọn **Người dùng** (`/settings/users`)
2. Nhấn nút **Thêm người dùng**
3. Nhập **Họ tên**, **Email**, **Số điện thoại**
4. Chọn **Vai trò** (Owner / Manager / Accountant / Sales / Warehouse / Driver)
5. Đặt **Mật khẩu tạm** rồi gửi cho nhân viên qua kênh bảo mật
6. Nhấn **Lưu**

**Kết quả**: Tài khoản được tạo và nhân viên có thể đăng nhập tại `/login`.

**Lưu ý**: Mật khẩu tạm cần được nhân viên đổi ngay sau lần đăng nhập đầu. Nếu nhân viên nghỉ việc, vào lại trang này để **Khóa tài khoản** thay vì xóa (giữ lịch sử dữ liệu).

### 4.2 Phê duyệt đơn hàng giá trị lớn

**Khi nào**: Đơn từ Sales có tổng tiền > 20.000.000 đ (ngưỡng `AUTO_APPROVE`) hoặc > 50.000.000 đ (ngưỡng `MANAGER_APPROVE`).

**Bước thực hiện**:
1. Vào `/orders`, lọc **Trạng thái = Nháp**
2. Click vào mã đơn để mở chi tiết
3. Kiểm tra: khách hàng, sản phẩm, giá, chiết khấu, hạn mức công nợ còn lại của khách
4. Nếu hợp lệ, nhấn **Duyệt đơn** - trạng thái chuyển từ `draft` → `confirmed`
5. Nếu cần điều chỉnh, nhấn **Yêu cầu sửa** và ghi chú để Sales sửa lại

**Kết quả**: Đơn vào hàng chờ Kho soạn hàng.

**Lưu ý**: Sau khi duyệt, đơn được "đóng băng". Muốn thay đổi phải hủy đơn hoặc tạo phiếu Trả hàng.

### 4.3 Ban hành chính sách hoa hồng mới

**Khi nào**: Đầu tháng / quý hoặc khi muốn thay đổi cơ chế thưởng cho Sales.

**Bước thực hiện**:
1. Vào `/commissions/policies` → nhấn **Tạo chính sách mới** (`/commissions/policies/new`)
2. Nhập **Tên chính sách**, chọn **Loại**: Phần trăm / Cố định / Bậc lũy kế
3. Định cấu hình bậc (nếu chọn Bậc lũy kế): VD `> 100tr → 3%`, `> 200tr → 5%`
4. Chọn phạm vi: áp dụng cho **toàn bộ Sales** hay **Sales cụ thể**
5. Đặt **Ngày hiệu lực** và **Ngày kết thúc** (để trống nếu vô hạn)
6. Nhấn **Lưu chính sách**

**Kết quả**: Hệ thống tự tính hoa hồng cho mỗi đơn `delivered` và cộng vào ví của Sales.

**Lưu ý**: Không sửa chính sách đã có dữ liệu hoa hồng phát sinh - hãy tạo chính sách mới với ngày hiệu lực trong tương lai để tránh sai số.

### 4.4 Đặt hạn mức tín dụng cho khách hàng

**Khi nào**: Có khách hàng mới hoặc cần điều chỉnh do lịch sử thanh toán.

**Bước thực hiện**:
1. Vào `/customers`, tìm khách bằng **tên cửa hàng** hoặc **SĐT**
2. Click vào dòng → mở chi tiết khách
3. Tab **Tài chính** → nhập **Hạn mức công nợ** (VD: 30.000.000 đ)
4. Chọn **Điều khoản thanh toán** (NET15, NET30, NET45, NET60)
5. Nhấn **Cập nhật**

**Kết quả**: Khi tổng công nợ vượt hạn mức, hệ thống sẽ chặn không cho Sales tạo đơn mới.

**Lưu ý**: Có thể tạm khóa khách (`status = locked`) nếu nợ xấu lâu ngày.

### 4.5 Xem báo cáo và xuất Excel

**Khi nào**: Họp tuần / tháng, gửi cho ngân hàng, đối tác.

**Bước thực hiện**:
1. Vào `/reports`
2. Chọn loại: **Doanh số**, **Tồn kho**, **Công nợ**, **Hoa hồng**
3. Chọn khoảng thời gian (tuần / tháng / quý / tùy chỉnh)
4. Nhấn **Xem báo cáo** - dữ liệu hiển thị dạng bảng + biểu đồ
5. Nhấn **Xuất Excel** ở góc phải

**Kết quả**: File `.xlsx` được tải về máy.

**Lưu ý**: Báo cáo công nợ luôn lấy số liệu real-time, không phải snapshot.

### 4.6 Cấu hình thông tin tổ chức

**Khi nào**: Lần đầu cài đặt, hoặc khi đổi địa chỉ / mã số thuế / logo.

**Bước thực hiện**:
1. Vào **Cài đặt** → **Tổ chức** (`/settings/org`)
2. Cập nhật **Tên doanh nghiệp**, **Mã số thuế**, **Địa chỉ trụ sở**
3. Tải lên **Logo** (dùng cho hóa đơn in, header)
4. Cấu hình **Số tiền tối thiểu auto-duyệt** và **ngưỡng cần Manager duyệt**
5. Nhấn **Lưu**

**Kết quả**: Thông tin được áp dụng cho tất cả tài liệu in (hóa đơn, phiếu giao).

**Lưu ý**: Thay đổi MST sẽ ảnh hưởng các hóa đơn xuất sau thời điểm cập nhật.

## 5. Mẹo & Best practices

- Bật thông báo (icon chuông góc phải header) để nhận cảnh báo realtime về đơn lớn, công nợ vượt hạn
- Mỗi cuối tuần dành 15 phút xem `/reports` chi tiết hoa hồng để phát hiện sai số sớm
- Đặt **mật khẩu mạnh** (>12 ký tự, có chữ hoa, số, ký tự đặc biệt) vì Owner có quyền xóa toàn hệ thống
- Đừng dùng tài khoản Owner để tạo đơn hàng - sẽ làm sai dữ liệu hoa hồng. Hãy tạo tài khoản Sales riêng nếu cần test
- Định kỳ 6 tháng rà soát lại danh sách người dùng `/settings/users`, khóa tài khoản nhân viên đã nghỉ
- Trước khi xóa khách hàng / sản phẩm, hãy kiểm tra lịch sử giao dịch - nên dùng "Khóa" / "Ngừng kinh doanh" thay vì xóa
- Nắm rõ ngưỡng `APPROVAL_THRESHOLDS`: dưới 20tr tự duyệt, 20-50tr cần Manager, trên 50tr cần Owner

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Không thấy đơn cần duyệt dù Sales báo đã tạo | Sales tạo nhưng chưa nhấn **Gửi duyệt** (vẫn ở Nháp riêng) | Yêu cầu Sales mở lại đơn và nhấn **Gửi duyệt** |
| Hoa hồng tính sai cho 1 nhân viên | Áp 2 chính sách chồng nhau cùng kỳ hiệu lực | Vào `/commissions/policies`, tắt chính sách cũ trước khi áp chính sách mới |
| Không xóa được sản phẩm | Sản phẩm đã có giao dịch trong đơn hàng | Đổi sang trạng thái **Ngừng kinh doanh** thay vì xóa |
| Báo cáo doanh thu lệch so với kế toán | Có đơn `delivered` nhưng chưa xuất hóa đơn | Vào `/invoices` lọc đơn chưa có hóa đơn để Kế toán xử lý |
| Tài khoản mới tạo không đăng nhập được | Chưa kích hoạt hoặc sai vai trò | Vào `/settings/users`, mở lại tài khoản, đặt lại mật khẩu, kiểm tra trường `status = active` |

## 7. KPI bạn được đánh giá

- **Tăng trưởng doanh thu tháng** (so với tháng trước, chỉ tiêu tối thiểu +5%)
- **Tỷ lệ công nợ quá hạn / tổng công nợ** (giữ dưới 10%)
- **Vòng quay tồn kho** (số ngày trung bình hàng nằm kho - mục tiêu < 45 ngày)
- **Tỷ lệ đơn giao đúng hạn** (`delivered` đúng `delivery_date` - mục tiêu > 95%)
- **Lợi nhuận gộp** sau khi trừ chiết khấu, hoa hồng, chi phí vận chuyển
