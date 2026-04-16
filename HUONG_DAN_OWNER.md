# Hướng dẫn cho Chủ sở hữu: Owner

> Bạn được cấp quyền **owner** - toàn quyền trên hệ thống. Đây là hướng dẫn đầy đủ cho công việc hàng ngày.

## 1. Trách nhiệm chính

- Cấu hình tổ chức, tạo và phân quyền tài khoản cho toàn bộ nhân viên (Quản lý, Kế toán, Sales, Kho, Tài xế).
- Thiết lập **chính sách hoa hồng** (commission policies) và phê duyệt ngân sách trả thưởng cho đội Sales.
- Phê duyệt các đơn hàng giá trị cao, phiếu **trả hàng** vượt thẩm quyền Quản lý, và xử lý ngoại lệ về công nợ.
- Theo dõi KPI tổng thể: doanh thu, lãi gộp, công nợ quá hạn, vòng quay hàng tồn kho.
- Đảm bảo dữ liệu sạch (master data: sản phẩm, khách hàng, kênh GT/MT/HORECA) và tuân thủ kế toán.

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Dashboard | Đọc | Xem 4 KPI tổng, top khách hàng, cảnh báo HSD/công nợ. |
| Đơn hàng | Đọc / Tạo / Sửa / Xóa / Duyệt | Toàn quyền trên mọi đơn của tổ chức. |
| Khách hàng | Đọc / Tạo / Sửa / Xóa | Quản lý danh mục cửa hàng, nhóm khách. |
| Sản phẩm | Đọc / Tạo / Sửa / Xóa | Tạo SKU, đơn vị, bảng giá. |
| Kho hàng | Đọc / Tạo / Sửa / Xóa | Nhập, xuất, kiểm kê, điều chỉnh tồn. |
| Giao hàng | Đọc / Tạo / Sửa / Xóa | Lập tuyến, phân tài xế, sửa POD. |
| Công nợ | Đọc / Tạo / Sửa / Xóa | Tạo điều chỉnh công nợ, xóa bút toán sai. |
| Khuyến mãi | Đọc / Tạo / Sửa / Xóa | Cấu hình chiết khấu, mua X tặng Y. |
| Hóa đơn | Đọc / Tạo / Sửa / Xóa | Phát hành, hủy hóa đơn VAT. |
| Trả hàng | Đọc / Tạo / Sửa / Xóa / Duyệt | Phê duyệt phiếu trả lớn. |
| Hoa hồng | Đọc / Tạo / Sửa / Xóa | Tạo & sửa chính sách, đóng kỳ ví hoa hồng. |
| Báo cáo | Đọc | Toàn bộ báo cáo doanh số, tồn kho, công nợ. |
| Cài đặt | Đọc / Tạo / Sửa / Xóa | Quản lý người dùng, thông tin tổ chức. |

## 3. Luồng công việc hàng ngày

```
   [Sáng - 8h00]              [Trong ngày]              [Cuối ngày - 17h00]
        │                          │                            │
        ▼                          ▼                            ▼
   /dashboard            Theo dõi cảnh báo                /reports
   Xem 4 KPI              - Đơn vượt hạn mức               Đối soát doanh thu
   Top KH yếu              - KH vượt nợ                     Kiểm tra hoa hồng
        │                  - Lô hàng cận HSD               Phê duyệt phiếu trả
        ▼                          │                            │
   Phê duyệt đơn lớn               ▼                            ▼
   /orders (filter draft)   Xử lý ngoại lệ               Đóng sổ ngày
                            (huỷ đơn / điều chỉnh)
```

**Mô tả từng bước**:
1. **8h00** - Vào `/dashboard` xem 4 thẻ KPI chính: *Doanh thu tháng*, *Đơn hôm nay*, *Công nợ mở*, *Tồn kho cảnh báo*. Click vào "Xem chi tiết" trên mỗi cảnh báo để vào trang xử lý.
2. **8h30** - Vào `/orders`, lọc *Trạng thái = Nháp*, duyệt các đơn lớn mà Quản lý đẩy lên.
3. **Trong ngày** - Bật thông báo (chuông trên Header), xử lý các yêu cầu vượt thẩm quyền: hủy đơn đã duyệt, điều chỉnh công nợ, phê duyệt trả hàng.
4. **17h00** - Vào `/reports` đối soát doanh thu - hoa hồng - công nợ - tồn kho. Đóng sổ ngày.

## 4. Các thao tác thường gặp (step-by-step)

### 4.1 Thêm người dùng mới
**Khi nào**: Có nhân viên mới, hoặc cần đổi vai trò cho ai đó.
**Bước thực hiện**:
1. Vào **Cài đặt** → **Quản lý người dùng** (`/settings/users`).
2. Bấm nút **"Thêm người dùng"** (góc trên bên phải).
3. Điền: *Họ và tên*, *Email*, *Mật khẩu tạm*, *Vai trò* (chọn 1 trong 6: owner/manager/accountant/sales/warehouse/driver), *Số điện thoại*.
4. Bấm **"Lưu"**.
5. Gửi email/Zalo cho nhân viên với link `https://nppsale.vercel.app/login` và mật khẩu tạm.
**Kết quả**: Tài khoản được tạo, nhân viên đăng nhập sẽ tự động chuyển vào module mặc định theo vai trò.
**Lưu ý**: Mật khẩu phải tối thiểu 8 ký tự. Sau khi cấp tài khoản, nhắc nhân viên đổi mật khẩu lần đầu.

### 4.2 Cập nhật thông tin tổ chức
**Khi nào**: Thay đổi tên công ty, mã số thuế, địa chỉ trên hóa đơn.
**Bước thực hiện**:
1. Vào **Cài đặt** → **Tổ chức** (`/settings/org`).
2. Sửa các trường: *Tên tổ chức*, *Mã số thuế*, *Địa chỉ trụ sở*, *Số điện thoại*, *Logo*.
3. Bấm **"Lưu thay đổi"**.
**Kết quả**: Thông tin mới hiển thị trên mọi hóa đơn, phiếu giao xuất ra từ thời điểm này.
**Lưu ý**: Hóa đơn đã phát hành trước đó **không** được cập nhật lại - chúng dùng snapshot tại thời điểm xuất.

### 4.3 Tạo chính sách hoa hồng mới
**Khi nào**: Đầu quý/đầu tháng, hoặc khi tung sản phẩm mới cần đẩy doanh số.
**Bước thực hiện**:
1. Vào **Hoa hồng** → **Chính sách** (`/commissions/policies`).
2. Bấm **"Tạo chính sách"**.
3. Điền: *Tên chính sách* (vd: "HH Quý 2/2026 - Sữa"), *Loại* (theo doanh thu / theo sản phẩm / bậc thang), *Tỷ lệ %* hoặc *Số tiền cố định*, *Hiệu lực từ - đến*, *Áp dụng cho* (chọn Sales hoặc Toàn bộ).
4. Bấm **"Lưu"** - chính sách ở trạng thái *Nháp*.
5. Bấm **"Kích hoạt"** sau khi rà soát kỹ.
**Kết quả**: Hệ thống tự tính hoa hồng cho mỗi đơn được giao và đã thu tiền trong khoảng hiệu lực.
**Lưu ý**: Một Sales có thể nhận nhiều chính sách cộng dồn. Vào ví hoa hồng từng người để xem chi tiết.

### 4.4 Phê duyệt phiếu trả hàng giá trị lớn
**Khi nào**: Khách trả hàng lỗi, hết hạn, hoặc trả vì điều khoản đặc biệt.
**Bước thực hiện**:
1. Vào **Trả hàng** (`/returns`), lọc *Trạng thái = Chờ duyệt*.
2. Click vào phiếu cần xử lý để xem chi tiết: sản phẩm, số lượng, lý do, ảnh đính kèm.
3. Đối chiếu với đơn gốc (link "Xem đơn hàng").
4. Bấm **"Duyệt"** (xanh) hoặc **"Từ chối"** (đỏ) kèm ghi chú.
5. Nếu duyệt: hệ thống sinh phiếu **nhập kho hoàn trả** và **giảm công nợ** tự động.
**Kết quả**: Tồn kho cộng lại, công nợ khách giảm đúng giá trị phiếu trả.
**Lưu ý**: Phải check kỹ đơn gốc đã thanh toán hay chưa. Nếu đã thanh toán thì cần *hoàn tiền* (chuyển khoản) hoặc *gối đầu* đơn sau.

### 4.5 Xóa/hủy đơn hàng đã duyệt
**Khi nào**: Khách hủy đột xuất, hoặc tạo nhầm.
**Bước thực hiện**:
1. Vào `/orders`, tìm mã đơn cần hủy.
2. Click vào đơn → bấm nút **"Hủy đơn"** (chỉ Owner thấy).
3. Nhập *lý do hủy* (bắt buộc).
4. Xác nhận.
**Kết quả**: Đơn chuyển trạng thái *cancelled*, tồn kho được trả lại, công nợ liên quan bị xóa.
**Lưu ý**: Không hủy được đơn đã *delivered* - phải dùng Trả hàng. Mọi thao tác hủy được ghi log.

### 4.6 Đóng sổ kỳ hoa hồng
**Khi nào**: Cuối tháng/cuối quý.
**Bước thực hiện**:
1. Vào `/commissions`, chọn kỳ (vd: Tháng 04/2026).
2. Bấm **"Tính lại hoa hồng"** để hệ thống chạy lại từ payment đã thu.
3. Rà soát từng ví Sales: số đơn, tổng doanh thu, hoa hồng dự kiến.
4. Bấm **"Đóng kỳ"** - sau khi đóng không sửa được.
5. Xuất file Excel gửi Kế toán chi trả.
**Kết quả**: Sales có thể xem ví của mình ở `/commissions` (chỉ xem).
**Lưu ý**: Phải đảm bảo tất cả công nợ trong kỳ đã đối soát xong trước khi đóng kỳ.

## 5. Mẹo & Best practices

- Đặt **mã sản phẩm (SKU)** theo quy tắc nhất quán: `<Nhóm>-<Tên>-<Dung tích>`, ví dụ `SUA-VINAMILK-180ML`. Sau này lọc rất nhanh.
- Mỗi đầu tháng, vào `/reports` xuất báo cáo *Top khách hàng vượt nợ* để gọi đòi sớm.
- Bật thông báo (chuông) trên Header để không bỏ sót đơn cần duyệt.
- Đặt hạn mức tín dụng (`credit_limit`) cho từng KH ngay khi tạo - hệ thống sẽ tự cảnh báo khi Sales bán vượt hạn mức.
- Mỗi tháng review một lần `/settings/users` để khóa tài khoản nhân viên đã nghỉ việc.
- Backup dữ liệu định kỳ qua trang `/debug` (nếu có) hoặc tải báo cáo Excel.
- Trước khi chạy chương trình khuyến mãi mới, test trên 1 đơn nháp để chắc chắn công thức tính đúng.

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Không thấy tài khoản vừa tạo | Cache trình duyệt | F5 lại trang `/settings/users`, hoặc đăng xuất rồi vào lại. |
| Hoa hồng tính sai | Chính sách trùng kỳ hoặc tỷ lệ sai | Vào `/commissions/policies`, vô hiệu chính sách cũ rồi bấm **Tính lại hoa hồng**. |
| Không hủy được đơn | Đơn đã *delivered* | Tạo phiếu **Trả hàng** thay vì hủy. |
| Báo "Permission denied" khi sửa thiết lập | Vào nhầm tài khoản role thấp hơn | Đăng xuất rồi vào lại bằng tài khoản owner. |
| Hóa đơn xuất sai mã số thuế | Sửa MST sau khi đã phát hành | Hủy hóa đơn, sửa `/settings/org`, phát hành lại. |

## 7. KPI bạn được đánh giá

- **Doanh thu tháng** so với mục tiêu (xem `/dashboard` thẻ đầu tiên).
- **Tỷ lệ công nợ quá hạn** dưới 10% tổng phải thu.
- **Vòng quay tồn kho** (Inventory turnover) - mục tiêu > 6 lần/năm.
- **Tỷ lệ đơn duyệt đúng giờ** (trong vòng 4 giờ kể từ khi Sales tạo).
- **Lãi gộp** (Gross margin) - mục tiêu theo ngành (FMCG: 8-15%).
