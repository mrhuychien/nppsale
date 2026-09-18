# Hướng dẫn cho Chủ sở hữu: Owner

> Bạn được cấp quyền **Owner**. Đây là hướng dẫn đầy đủ cho công việc hàng ngày của người đứng đầu nhà phân phối.

## 1. Trách nhiệm chính

- Quản trị toàn hệ thống: cấu hình tổ chức, tạo/khóa tài khoản nhân viên, phân vai trò
- Xuất hàng cho các đơn đã chốt, hoàn thành phiếu trả hàng, ban hành chính sách hoa hồng
- Theo dõi sức khỏe kinh doanh qua Dashboard và Báo cáo (doanh thu, công nợ, tồn kho)
- Ban hành chính sách hoa hồng, khuyến mãi, hạn mức công nợ cho từng nhóm khách hàng
- Là người duy nhất có quyền **xóa** dữ liệu ở mọi module - cần thận trọng khi thao tác

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Dashboard | Xem | Theo dõi 4 KPI, top KH, cảnh báo HSD và công nợ vượt hạn |
| Đơn hàng | Đọc / Tạo / Sửa / Xóa / Xuất hàng | Toàn quyền với mọi đơn của tổ chức |
| Khách hàng | Đọc / Tạo / Sửa / Xóa | Quản lý danh sách KH, phân nhóm, hạn mức tín dụng |
| Sản phẩm | Đọc / Tạo / Sửa / Xóa | Cấu hình SKU, đơn vị, bảng giá nhiều cấp |
| Kho hàng | Đọc / Tạo / Sửa / Xóa | Xem tồn, lô hàng, HSD, điều chỉnh khi cần |
| Giao hàng *(ngưng dùng)* | Xem | Tra cứu chuyến giao cũ. Quy trình mới in phiếu giao ngay khi Xuất hàng |
| Công nợ | Đọc / Tạo / Sửa / Xóa | Theo dõi phải thu, ghi nhận thanh toán đặc biệt |
| Khuyến mãi | Đọc / Tạo / Sửa / Xóa | Ban hành chương trình chiết khấu, mua X tặng Y |
| Hóa đơn | Đọc / Tạo / Sửa / Xóa | Xuất hóa đơn VAT, hủy hóa đơn sai |
| Trả hàng | Đọc / Tạo / Sửa / Xóa / Hoàn thành | Bấm Hoàn thành thì hàng mới vào kho và công nợ mới giảm |
| Hoa hồng | Đọc / Tạo / Sửa / Xóa | Xây dựng chính sách hoa hồng, kiểm tra ví của nhân viên |
| Báo cáo | Xem | Tất cả báo cáo doanh số, tồn kho, công nợ, hoa hồng |
| Cài đặt | Đọc / Tạo / Sửa / Xóa | Quản lý người dùng, cấu hình tổ chức |

## 3. Luồng công việc hàng ngày

```
   Sáng (8:00 - 9:30)              Trưa (13:00 - 14:00)        Cuối ngày (17:00 - 18:00)
        │                                  │                              │
        ▼                                  ▼                              ▼
   Mở Dashboard ─────► Xuất hàng ───────► Kiểm tra ─────► Xem báo cáo ─► Xử lý
   Xem 4 KPI           các đơn            công nợ          ngày           cảnh báo
        │              Phiếu tạm          quá hạn          Hoa hồng        HSD/nợ
        ▼              Hoàn thành                          đã chốt
                       phiếu trả
   Xem cảnh báo
   HSD + nợ
```

**Mô tả các bước:**

1. **Sáng** - Đăng nhập, vào `/dashboard`, lướt 4 thẻ KPI và khu cảnh báo
2. **Xuất hàng** - Vào `/orders` lọc trạng thái "Phiếu tạm", soát lại rồi bấm **Xuất hàng**
3. **Trưa** - Mở `/receivables` để soát công nợ quá hạn, gọi nhắc khách hoặc giao Sales đôn đốc
4. **Cuối ngày** - Mở `/reports` xem doanh số ngày, vào `/commissions` chốt hoa hồng tháng nếu đến kỳ
5. **Cài đặt định kỳ** - Mỗi tuần xem `/settings/users` để rà soát quyền truy cập

## 4. Các thao tác thường gặp (step-by-step)

### 4.1 Tạo tài khoản nhân viên mới

**Khi nào**: Có nhân viên Sales, Kho, Kế toán mới gia nhập.

**Bước thực hiện**:
1. Vào sidebar nhấn **Cài đặt** → chọn **Người dùng** (`/settings/users`)
2. Nhấn nút **Thêm người dùng**
3. Nhập **Họ tên**, **Email**, **Số điện thoại**
4. Chọn **Vai trò** (Owner / Manager / Accountant / Sales / Warehouse)
   ⚠ Vai **Tài xế** đã ngưng dùng — quy trình mới không có bước lập chuyến
   giao, và hệ thống từ chối gán vai đó.
5. Đặt **Mật khẩu tạm** rồi gửi cho nhân viên qua kênh bảo mật
6. Nhấn **Lưu**

**Kết quả**: Tài khoản được tạo và nhân viên có thể đăng nhập tại `/login`.

**Lưu ý**: Mật khẩu tạm cần được nhân viên đổi ngay sau lần đăng nhập đầu. Nếu nhân viên nghỉ việc, vào lại trang này để **Khóa tài khoản** thay vì xóa (giữ lịch sử dữ liệu).

### 4.2 Xuất hàng cho một đơn

**Khi nào**: Đơn đã ở **Phiếu tạm** và hàng sẵn sàng rời kho.

**Bước thực hiện**:
1. Vào `/orders`, lọc **Trạng thái = Phiếu tạm**
2. Click vào mã đơn để mở chi tiết
3. Kiểm tra: khách hàng, sản phẩm, giá, chiết khấu, hạn mức công nợ còn lại
4. Nhấn **Xuất hàng**

**Kết quả**: Trong MỘT giao dịch, hệ thống trừ kho theo FIFO, ghi công nợ
phải thu, đổi đơn sang `completed` và mở hộp in phiếu giao.

**Lưu ý**:
- ⚠ **Đọc kỹ thông báo sau khi bấm.** Nếu tổ chức bật `allow_oversell`,
  đơn vẫn xuất được khi thiếu tồn và hệ thống báo riêng "xuất thiếu
  hàng" kèm số thiếu. Bỏ qua dòng đó là kho đóng hàng theo phiếu rồi tới
  nơi mới biết thiếu.
- Đơn đã xuất vẫn sửa được trong số ngày đặt ở Cài đặt → Tổ chức, trừ
  khi vướng một trong bốn khoá: đã thu tiền, đã phát hành hóa đơn, đã có
  phiếu trả hoàn thành, hoặc quá hạn sửa.

### 4.3 Ban hành chính sách hoa hồng mới

**Khi nào**: Đầu tháng / quý hoặc khi muốn thay đổi cơ chế thưởng cho Sales.

**Bước thực hiện**:
1. Vào `/commissions/policies` → nhấn **Tạo chính sách mới** (`/commissions/policies/new`)
2. Nhập **Tên chính sách**, chọn **Loại**: Phần trăm / Cố định / Bậc lũy kế
3. Định cấu hình bậc (nếu chọn Bậc lũy kế): VD `> 100tr → 3%`, `> 200tr → 5%`
4. Chọn phạm vi: áp dụng cho **toàn bộ Sales** hay **Sales cụ thể**
5. Đặt **Ngày hiệu lực** và **Ngày kết thúc** (để trống nếu vô hạn)
6. Nhấn **Lưu chính sách**

**Kết quả**: Hệ thống tự tính hoa hồng cho mỗi đơn `completed` và cộng vào ví của Sales.

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
4. Cấu hình **Số ngày còn sửa được đơn đã xuất hàng** (`completed_edit_days`)
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
- Đặt `completed_edit_days` cho vừa: để 0 là khoá cứng mọi đơn đã xuất, để quá dài là mở đường sửa lùi vào kỳ đã chốt sổ

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Không thấy đơn dù Sales báo đã tạo | Đơn còn ở **Nháp** — chỉ người tạo thấy | Yêu cầu Sales mở lại đơn và nhấn **Gửi đơn** để nó thành **Phiếu tạm** |
| Hoa hồng tính sai cho 1 nhân viên | Áp 2 chính sách chồng nhau cùng kỳ hiệu lực | Vào `/commissions/policies`, tắt chính sách cũ trước khi áp chính sách mới |
| Không xóa được sản phẩm | Sản phẩm đã có giao dịch trong đơn hàng | Đổi sang trạng thái **Ngừng kinh doanh** thay vì xóa |
| Báo cáo doanh thu lệch so với kế toán | Có đơn `completed` nhưng chưa xuất hóa đơn | Vào `/invoices` lọc đơn chưa có hóa đơn để Kế toán xử lý |
| Tài khoản mới tạo không đăng nhập được | Chưa kích hoạt hoặc sai vai trò | Vào `/settings/users`, mở lại tài khoản, đặt lại mật khẩu, kiểm tra trường `status = active` |

## 7. KPI bạn được đánh giá

- **Tăng trưởng doanh thu tháng** (so với tháng trước, chỉ tiêu tối thiểu +5%)
- **Tỷ lệ công nợ quá hạn / tổng công nợ** (giữ dưới 10%)
- **Vòng quay tồn kho** (số ngày trung bình hàng nằm kho - mục tiêu < 45 ngày)
- **Tỷ lệ đơn xuất hàng đúng hạn** (`completed_at` trong hạn `expected_delivery` - mục tiêu > 95%)
- **Lợi nhuận gộp** sau khi trừ chiết khấu, hoa hồng, chi phí vận chuyển
