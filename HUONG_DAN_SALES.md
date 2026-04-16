# Hướng dẫn cho Nhân viên bán hàng: Sales

> Bạn được cấp quyền **Sales**. Đây là hướng dẫn đầy đủ cho công việc tạo đơn, chăm sóc khách hàng được giao và đôn đốc công nợ ngay tại hiện trường (chủ yếu trên điện thoại).

## 1. Trách nhiệm chính

- Đi thị trường, ghé thăm các khách hàng được Manager phân công
- Tạo đơn hàng tại điểm bán (mobile), giới thiệu sản phẩm và khuyến mãi
- Thêm khách hàng mới khi mở rộng tuyến và cập nhật thông tin liên hệ
- Đôn đốc thu nợ tại điểm (cùng tài xế nếu có lịch giao)
- Tạo phiếu trả hàng khi khách phản hồi hàng lỗi / hết hạn

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Dashboard | Xem | Theo dõi doanh số cá nhân, hoa hồng |
| Đơn hàng | Đọc / Tạo | Tạo đơn cho KH được giao, xem trạng thái |
| Khách hàng | Đọc / Tạo / Sửa | Quản lý KH được giao, thêm KH mới (chờ Manager duyệt phân công) |
| Sản phẩm | Xem | Tra cứu giá, mô tả, hình ảnh để giới thiệu |
| Kho hàng | Xem | Xem **tồn khả dụng** trước khi chốt đơn lớn |
| Giao hàng | Xem | Theo dõi đơn của KH mình đã được giao chưa |
| Công nợ | Đọc / Tạo | Xem nợ KH, tạo phiếu thu khi khách trả tiền tại quầy |
| Khuyến mãi | Xem | Tra cứu CTKM hiện hành để giới thiệu |
| Hóa đơn | Xem | Tra cứu hóa đơn của KH (không xuất được) |
| Trả hàng | Đọc / Tạo | Tạo phiếu trả khi khách báo hàng lỗi |
| Hoa hồng | Xem (ví của mình) | Xem hoa hồng tích lũy, lịch sử chi trả |
| Báo cáo | Xem | Báo cáo doanh số cá nhân |

## 3. Luồng công việc hàng ngày

```
   Sáng (8:00)                Trên thị trường              Cuối ngày (17:00)
       │                          │                              │
       ▼                          ▼                              ▼
   Mở app điện thoại ──► Vào /customers ──► Ghé từng KH ──► Tạo đơn ──► Tổng kết
   Xem dashboard            (KH được giao)    + giới thiệu  /orders/new   /commissions
   Xem hoa hồng             Lọc theo tuyến    SP / KM       trên mobile   xem hoa hồng
   Xem đơn hôm qua          hôm nay           Thu nợ                       được tích
                                              Chụp đơn cũ                  ngày đó
```

**Mô tả các bước:**

1. **Sáng** - Mở app trên điện thoại (`https://nppsale.vercel.app`), đăng nhập, xem dashboard cá nhân
2. **Lập tuyến** - Vào `/customers`, lọc khách hàng theo khu vực hôm nay đi
3. **Tại điểm bán** - Mỗi cửa hàng: chào hỏi → kiểm hàng tồn → giới thiệu SP/KM → chốt đơn
4. **Tạo đơn** - Bấm nút **Tạo đơn mới** ở sidebar (gradient xanh), chọn KH, thêm SP, lưu
5. **Thu nợ** - Nếu KH có nợ và muốn trả tiền mặt → vào `/receivables/collect`
6. **Cuối ngày** - Vào `/dashboard` xem hoa hồng tích lũy ngày, kiểm tra đơn `confirmed`

## 4. Các thao tác thường gặp (step-by-step)

### 4.1 Tạo đơn hàng mới (mobile)

**Khi nào**: Khách hàng quyết định đặt hàng tại quầy.

**Bước thực hiện**:
1. Mở menu (icon **☰** góc trái), nhấn nút **"Tạo đơn mới"** (nút xanh gradient ở sidebar)
2. Hệ thống mở `/orders/new`
3. Chọn **Khách hàng** từ dropdown (chỉ hiện KH bạn được giao)
4. Nhấn **Thêm sản phẩm**, chọn SKU, nhập **Số lượng**
5. Hệ thống tự áp giá theo **bảng giá khách hàng** + **khuyến mãi** đang chạy
6. Xem **Subtotal** + **VAT** = **Tổng tiền** ở dưới
7. Có thể nhập **Ghi chú** (VD: "Giao trước 10h sáng mai")
8. Nhấn **Lưu đơn hàng** → đơn ở trạng thái **Nháp**
9. Nhấn **Gửi duyệt** → Manager nhận để duyệt

**Kết quả**: Đơn `draft` → chờ Manager `confirmed`.

**Lưu ý**: Nếu KH vượt **hạn mức công nợ**, hệ thống sẽ chặn tạo đơn - bạn cần thu nợ trước hoặc nhờ Manager duyệt ngoại lệ.

### 4.2 Thêm khách hàng mới khi mở rộng tuyến

**Khi nào**: Phát hiện cửa hàng tiềm năng chưa có trong hệ thống.

**Bước thực hiện**:
1. Vào `/customers`, nhấn **Thêm KH** (`/customers/new`)
2. Nhập **Tên cửa hàng** (VD: "Tạp hóa Bà Năm")
3. Nhập **Họ tên chủ**, **Số điện thoại**, **Địa chỉ chi tiết**
4. Chọn **Kênh**: GT / MT / HORECA
5. (Tùy chọn) Chụp ảnh mặt tiền cửa hàng đính kèm
6. Nhấn **Lưu**

**Kết quả**: KH được tạo với trạng thái **Hoạt động**, chờ Manager phân công cho bạn.

**Lưu ý**: KH mới chưa có **hạn mức công nợ** - đơn đầu tiên nên thu tiền mặt (`cash`) cho an toàn.

### 4.3 Thu tiền mặt tại điểm bán

**Khi nào**: Khách hàng có công nợ và trả tiền mặt khi bạn ghé thăm.

**Bước thực hiện**:
1. Vào `/receivables/collect`
2. Chọn **Công nợ** từ dropdown - dòng hiển thị tên KH + số còn nợ
3. Chọn **Hình thức** = **Tiền mặt** (`cash`)
4. Nhập **Số tiền thu** (KH có thể trả 1 phần)
5. Nhấn **Xác nhận thu tiền**
6. Đưa biên nhận in / chụp màn hình cho khách

**Kết quả**: Công nợ giảm tương ứng, trạng thái có thể chuyển từ `open` → `partial` → `paid`.

**Lưu ý**: Số tiền thu phải nộp về Kế toán cùng ngày - không được giữ qua đêm.

### 4.4 Tạo phiếu trả hàng

**Khi nào**: Khách phát hiện hàng hư hỏng, sai SKU, gần / hết hạn, hoặc từ chối nhận.

**Bước thực hiện**:
1. Vào `/returns`, nhấn **Tạo phiếu trả**
2. Chọn **Khách hàng** và **Đơn liên quan** (đơn gốc giao hàng)
3. Chọn **Sản phẩm trả**, nhập **Số lượng trả**
4. Chọn **Lý do**: `damaged` / `wrong_item` / `near_expiry` / `expired` / `refused`
5. Chụp ảnh hàng lỗi đính kèm (nếu có)
6. Nhấn **Lưu** → phiếu ở trạng thái **Chờ duyệt**

**Kết quả**: Manager nhận thông báo, sau khi duyệt thì Kho nhập lại hàng và Kế toán giảm trừ công nợ.

**Lưu ý**: Phải làm phiếu trong vòng **48h** kể từ khi giao - quá hạn sẽ khó xử lý.

### 4.5 Tra cứu khuyến mãi để giới thiệu

**Khi nào**: Đầu mỗi cuộc gặp khách hàng - chốt thêm doanh số.

**Bước thực hiện**:
1. Vào `/promotions`
2. Lọc trạng thái **Đang hoạt động**
3. Đọc kỹ **Điều kiện áp dụng**: kênh, nhóm KH, SKU, số lượng tối thiểu
4. Mở chi tiết để xem cơ chế (VD: "Mua 10 thùng tặng 1 thùng cùng loại")
5. Giới thiệu trực tiếp cho KH

**Kết quả**: KH biết và đặt thêm hàng để hưởng KM.

**Lưu ý**: Khi tạo đơn, hệ thống tự áp KM nếu thỏa điều kiện - không cần nhập tay.

### 4.6 Theo dõi đơn của khách hàng

**Khi nào**: KH gọi hỏi "đơn hôm qua đã giao chưa?".

**Bước thực hiện**:
1. Vào `/orders`, nhập **Mã đơn** vào ô tìm kiếm
2. Hoặc lọc theo **Trạng thái** để xem nhóm đơn:
   - **Nháp** - mình chưa gửi duyệt
   - **Đã duyệt** - Manager đã xác nhận, chờ Kho soạn
   - **Đang lấy hàng** - Kho đang đóng gói
   - **Đang giao** - Tài xế trên đường
   - **Đã giao** - Hoàn tất
3. Click vào đơn → xem **Chi tiết** + **Lịch sử trạng thái**

**Kết quả**: Bạn báo lại cho KH chính xác.

**Lưu ý**: Đơn `cancelled` không thể khôi phục - phải tạo đơn mới.

## 5. Mẹo & Best practices

- Cài app vào màn hình chính điện thoại (Add to Home Screen) để mở nhanh như native app
- Trước khi đi tuyến, lọc KH theo **khu vực** + **lần ghé cuối** để ưu tiên KH lâu chưa thăm
- Luôn kiểm tra **tồn kho khả dụng** ở `/inventory` trước khi cam kết với KH (tránh hứa rồi thiếu hàng)
- Khi tạo đơn, đọc kỹ phần **khuyến mãi đề xuất** ở cuối form - thường tăng giá trị đơn 10-15%
- Báo Manager **ngay** nếu thấy đối thủ giảm giá đột ngột tại tuyến - giúp ra chính sách kịp thời
- Mỗi tối dành 5 phút xem `/commissions` để theo dõi hoa hồng tích lũy - động lực cho ngày mai
- Đừng tạo đơn khống / đơn ảo - hệ thống sẽ truy ra qua POD và công nợ, ảnh hưởng lương và uy tín

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Không thấy KH trong dropdown khi tạo đơn | KH chưa được Manager phân công cho bạn | Báo Manager vào KH → tab **Phân công** → gán Sales |
| Báo "Vượt hạn mức công nợ" khi tạo đơn | Tổng công nợ + giá trị đơn > limit | Thu nợ trước, hoặc xin Manager duyệt ngoại lệ |
| Khuyến mãi không tự áp | Đơn chưa thỏa điều kiện (số lượng / SKU / kênh) | Mở `/promotions` xem điều kiện rồi điều chỉnh đơn |
| Phiếu trả hàng bị từ chối | Quá 48h kể từ giao, hoặc thiếu ảnh chứng minh | Cần Manager phê duyệt ngoại lệ, kèm giải trình |
| Hoa hồng ngày thấp hơn dự kiến | Có đơn bị `cancelled` hoặc `returns` đã duyệt | Vào `/commissions` xem chi tiết bút toán điều chỉnh |

## 7. KPI bạn được đánh giá

- **Doanh số cá nhân tháng** (so với chỉ tiêu Manager giao)
- **Số khách hàng có đơn / tổng KH được giao** (Active customer rate - mục tiêu > 70%)
- **Số khách hàng mới mở mỗi tháng** (mục tiêu 5-10 KH tùy tuyến)
- **Tỷ lệ thu nợ trong hạn** (paid trước due_date - mục tiêu > 80%)
- **Số đơn bị Manager trả về sửa** (giữ < 5% / tổng đơn)
