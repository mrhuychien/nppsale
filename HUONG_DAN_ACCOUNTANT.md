# Hướng dẫn cho Kế toán: Accountant

> Bạn được cấp quyền **Accountant**. Đây là hướng dẫn đầy đủ cho công việc xuất hóa đơn, theo dõi công nợ và chốt hoa hồng hàng ngày.

## 1. Trách nhiệm chính

- Xuất hóa đơn VAT cho các đơn đã `delivered` và đối chiếu với phiếu giao
- Theo dõi và đôn đốc công nợ phải thu (`receivables`), ghi nhận các khoản thu lớn từ ngân hàng
- Cập nhật và chốt sổ hoa hồng cho Sales theo kỳ
- Đối soát các phiếu trả hàng và điều chỉnh công nợ tương ứng
- Lập báo cáo tài chính nội bộ cho Owner / Manager

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Dashboard | Xem | Theo dõi KPI công nợ, tổng doanh thu |
| Đơn hàng | Xem | Tra cứu để đối chiếu khi xuất hóa đơn |
| Khách hàng | Xem | Tra cứu thông tin để xuất hóa đơn (MST, địa chỉ) |
| Sản phẩm | Xem | Tra cứu mã hàng, đơn vị, thuế suất |
| Kho hàng | Xem | Tra cứu lô hàng đã giao để khớp hóa đơn |
| Giao hàng | Xem | Tra cứu chuyến giao đối ứng với hóa đơn |
| Công nợ | Đọc / Tạo / Sửa | Tạo phiếu thu, ghi nhận thanh toán, sửa kỳ hạn |
| Khuyến mãi | Xem | Tra cứu CTKM áp dụng cho đơn để đối soát chiết khấu |
| Hóa đơn | Đọc / Tạo / Sửa | Xuất, chỉnh, hủy hóa đơn VAT |
| Trả hàng | Xem | Đối soát phiếu trả → giảm công nợ |
| Hoa hồng | Đọc / Sửa | Cập nhật trạng thái chi trả hoa hồng cho Sales |
| Báo cáo | Xem | Báo cáo công nợ, doanh thu, hoa hồng |
| Cài đặt | Xem | Xem cấu hình tổ chức (MST, địa chỉ phục vụ in hóa đơn) |

## 3. Luồng công việc hàng ngày

```
   Sáng                              Trong ngày                       Cuối tháng
       │                                  │                              │
       ▼                                  ▼                              ▼
   Mở /invoices ─► Lọc đơn ────► Xuất hóa đơn ──► Đối soát ──► Mở /commissions
   delivered      chưa có HĐ      VAT             /receivables  Chốt hoa hồng kỳ
       │                                          ghi nhận       Cập nhật trạng thái
       ▼                                          chuyển khoản   "Đã chi"
   Mở /receivables                                ngân hàng
   Xem nợ quá hạn → gọi nhắc / mail
```

**Mô tả các bước:**

1. **Sáng** - Vào `/invoices` lọc đơn `delivered` chưa có hóa đơn → xuất hàng loạt
2. **Đôn đốc** - Vào `/receivables` lọc trạng thái **Quá hạn** (`overdue`), gọi điện nhắc khách
3. **Trong ngày** - Theo dõi sao kê ngân hàng, vào `/receivables/collect` ghi nhận khoản chuyển khoản
4. **Cuối tháng** - Vào `/commissions` đối chiếu doanh thu Sales, chốt sổ hoa hồng và cập nhật trạng thái chi trả
5. **Báo cáo** - Lập file Excel công nợ + tuổi nợ gửi Owner mỗi thứ Hai

## 4. Các thao tác thường gặp (step-by-step)

### 4.1 Xuất hóa đơn VAT cho đơn đã giao

**Khi nào**: Sau khi tài xế xác nhận `delivered` và POD đầy đủ.

**Bước thực hiện**:
1. Vào `/invoices`, nhấn **Tạo hóa đơn**
2. Chọn **Đơn hàng** từ dropdown (chỉ hiện đơn `delivered` chưa có HĐ)
3. Hệ thống tự điền: thông tin khách (tên, MST, địa chỉ), dòng hàng, thuế suất
4. Kiểm tra lại **Mã số thuế khách hàng**, **Hình thức thanh toán**
5. Chọn **Số seri hóa đơn** (theo dải đã đăng ký với Tổng cục Thuế)
6. Nhấn **Xuất hóa đơn** → hệ thống gửi sang nhà cung cấp HĐĐT (e-invoice)
7. Tải PDF / gửi email cho khách

**Kết quả**: Hóa đơn được cấp số chính thức, công nợ được tạo (hoặc cập nhật) tương ứng.

**Lưu ý**: Nếu khách không có MST (KH cá nhân), để trống trường MST - hệ thống vẫn xuất hóa đơn cho khách lẻ.

### 4.2 Ghi nhận thanh toán chuyển khoản

**Khi nào**: Có biến động trong sao kê ngân hàng từ khách hàng.

**Bước thực hiện**:
1. Vào `/receivables/collect`
2. Chọn **Công nợ** từ dropdown (hiển thị "Tên cửa hàng - Còn nợ: XXX đ")
3. Chọn **Hình thức** = **Chuyển khoản** (`transfer`)
4. Nhập **Số tiền thu** đúng số ghi trên sao kê
5. Nhấn **Xác nhận thu tiền**

**Kết quả**: Hệ thống tạo bản ghi `payments`, cập nhật `paid` và `status` của công nợ (`partial` hoặc `paid`).

**Lưu ý**: Số tiền thu không được vượt quá số dư còn nợ - hệ thống sẽ chặn tự động (`max={remaining}`).

### 4.3 Cập nhật chính sách thanh toán hoa hồng

**Khi nào**: Cuối kỳ hoa hồng (tháng / quý), khi đã đối soát doanh thu xong.

**Bước thực hiện**:
1. Vào `/commissions`, chọn kỳ cần chốt (VD: Tháng 04/2026)
2. Hệ thống hiển thị bảng: **Sales** | **Doanh số đạt** | **Hoa hồng tính** | **Trạng thái**
3. Đối chiếu với báo cáo `/reports` → đánh dấu các dòng đúng
4. Click vào dòng cần đổi → cập nhật **Trạng thái** từ `pending` → `paid`
5. Nhập **Ngày chi trả**, **Mã giao dịch ngân hàng** (để lưu vết)
6. Nhấn **Lưu**

**Kết quả**: Ví hoa hồng của Sales được trừ tương ứng, lịch sử chi trả được ghi lại.

**Lưu ý**: Nếu phát hiện sai (đơn bị hủy / trả hàng sau khi tính hoa hồng), hãy tạo **bút toán điều chỉnh** thay vì xóa - đảm bảo audit trail.

### 4.4 Đối soát phiếu trả hàng

**Khi nào**: Manager đã duyệt phiếu trả hàng và Kho đã nhập lại.

**Bước thực hiện**:
1. Vào `/returns`, lọc trạng thái **Đã duyệt** chưa được giảm trừ công nợ
2. Mở phiếu, kiểm tra **Lý do**, **Đơn gốc**, **Sản phẩm và số lượng trả**
3. Đối chiếu giá trị trả với hóa đơn gốc
4. Vào `/receivables`, tìm công nợ tương ứng
5. Tạo **Bút toán giảm trừ** = giá trị hàng trả - phí xử lý (nếu có)
6. Nhấn **Lưu** → công nợ giảm tương ứng

**Kết quả**: Số dư công nợ chính xác, không bị tính trên hàng đã trả.

**Lưu ý**: Với hàng `expired` / `damaged`, cần kết hợp với Kho để hủy lô (không cho bán lại).

### 4.5 Lập báo cáo tuổi nợ (Aging Report)

**Khi nào**: Mỗi thứ Hai / cuối tháng / theo yêu cầu Owner.

**Bước thực hiện**:
1. Vào `/reports` → tab **Công nợ**
2. Chọn loại **Aging report** (tuổi nợ)
3. Hệ thống nhóm thành 4 cột: 0-30 ngày | 31-60 | 61-90 | > 90 ngày
4. Lọc theo **Sales phụ trách** hoặc **Kênh** nếu cần phân tích sâu
5. Nhấn **Xuất Excel** để gửi Owner

**Kết quả**: File Excel kèm biểu đồ pie chart phân bố tuổi nợ.

**Lưu ý**: Nợ > 90 ngày cần có ghi chú lý do và phương án xử lý (gia hạn / xóa nợ / kiện).

### 4.6 Hủy hóa đơn sai

**Khi nào**: Sai MST, sai địa chỉ, sai số tiền - phải hủy và xuất lại.

**Bước thực hiện**:
1. Vào `/invoices`, tìm hóa đơn cần hủy
2. Nhấn **Chi tiết** → kiểm tra ngày xuất (chỉ hủy được trong tháng phát hành)
3. Nhấn **Hủy hóa đơn** → nhập **Lý do hủy**
4. Hệ thống gửi yêu cầu hủy sang phần mềm HĐĐT, công nợ tự đảo ngược
5. Tạo lại hóa đơn mới (xem 4.1)

**Kết quả**: Hóa đơn cũ được đánh dấu **Đã hủy**, hóa đơn mới có số mới được cấp.

**Lưu ý**: Hóa đơn của tháng trước phải làm **Biên bản điều chỉnh** thay vì hủy trực tiếp.

## 5. Mẹo & Best practices

- Xuất hóa đơn **trong vòng 24h** sau khi `delivered` để tránh tích lũy đơn chưa xuất
- Đặt **lịch nhắc** mỗi sáng kiểm tra sao kê ngân hàng → ghi nhận thanh toán ngay trong buổi sáng
- Với khách hàng VIP, cấu hình **email tự động** gửi hóa đơn ngay khi xuất
- Mỗi tháng dành 1 buổi đối soát giữa **doanh thu hệ thống** vs **doanh thu hóa đơn** - phải khớp 100%
- Sử dụng **Aging report** mỗi tuần để gọi nhắc nợ sớm, đừng đợi quá hạn mới gọi
- Khi cập nhật trạng thái hoa hồng `paid`, phải có **chứng từ chuyển khoản** kèm theo (upload PDF lên hệ thống nếu có)
- Lưu lại **lịch sử số seri hóa đơn** đã dùng theo tháng để báo cáo Tổng cục Thuế

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Không xuất được HĐ - báo "Đơn chưa delivered" | Tài xế chưa xác nhận POD | Liên hệ tài xế / vào `/deliveries/[id]` xác nhận |
| Số tiền hóa đơn lệch với đơn hàng | Đơn có khuyến mãi / chiết khấu áp sau khi tạo | Vào đơn hàng tra **chi tiết** dòng chiết khấu |
| Ghi nhận thanh toán xong vẫn báo "Quá hạn" | Số tiền thu < số nợ - chỉ chuyển sang `partial` | Đợi thu phần còn lại; status sẽ thành `paid` khi đủ |
| Hoa hồng tháng này thiếu 1 Sales | Sales đó chưa có đơn `delivered` trong kỳ | Kiểm tra `/reports` lọc theo Sales để xác nhận |
| Hủy hóa đơn báo lỗi | Hóa đơn không thuộc tháng phát hành | Tạo **Biên bản điều chỉnh** thay vì hủy |

## 7. KPI bạn được đánh giá

- **Tỷ lệ hóa đơn xuất trong 24h sau delivered** (mục tiêu > 95%)
- **Tỷ lệ thu hồi công nợ trong hạn** (paid trước due_date / tổng phải thu - mục tiêu > 85%)
- **Số ngày trung bình thu được tiền (DSO)** (Days Sales Outstanding - mục tiêu < 35 ngày)
- **Sai sót hóa đơn (phải hủy / điều chỉnh)** (giữ < 1% / tổng HĐ)
- **Đúng hạn chốt hoa hồng** (chốt sổ trước ngày 5 mỗi tháng cho kỳ trước)
