# Hướng dẫn cho Quản lý: Manager

> Bạn được cấp quyền **Manager**. Đây là hướng dẫn đầy đủ cho công việc duyệt đơn, quản lý khách hàng, sản phẩm và khuyến mãi hàng ngày.

## 1. Trách nhiệm chính

- Duyệt / từ chối đơn hàng do Sales tạo và phiếu trả hàng
- Quản lý danh mục khách hàng: thêm mới, phân nhóm, gán Sales phụ trách
- Vận hành danh mục sản phẩm và bảng giá nhiều cấp
- Thiết kế và chạy chương trình khuyến mãi (chiết khấu, mua X tặng Y, lũy kế)
- Phân tuyến giao hàng và gán tài xế cho các đơn `confirmed`

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Dashboard | Xem | Theo dõi KPI tổng, top KH, cảnh báo HSD/nợ |
| Đơn hàng | Đọc / Tạo / Sửa / Duyệt | Duyệt đơn của Sales, hỗ trợ tạo đơn khi Sales bận |
| Khách hàng | Đọc / Tạo / Sửa | Quản lý cửa hàng, gán Sales, đặt nhóm KH |
| Sản phẩm | Đọc / Tạo / Sửa | Mở SKU mới, sửa đơn vị quy đổi, cập nhật bảng giá |
| Kho hàng | Xem | Xem tồn để duyệt đơn (không chỉnh được lô) |
| Giao hàng | Đọc / Tạo / Sửa | Tạo chuyến, gán tài xế, theo dõi tiến độ |
| Công nợ | Xem | Theo dõi công nợ, không thu tiền trực tiếp |
| Khuyến mãi | Đọc / Tạo / Sửa | Soạn chương trình khuyến mãi, kích hoạt / tạm tắt |
| Hóa đơn | Xem | Xem hóa đơn, không xuất được (Kế toán làm) |
| Trả hàng | Đọc / Duyệt | Duyệt phiếu trả hàng từ Sales |
| Hoa hồng | Xem | Xem chính sách (không sửa được) |
| Báo cáo | Xem | Tất cả báo cáo doanh số, tồn kho, công nợ |
| Cài đặt | Xem | Chỉ xem cấu hình, không sửa |

## 3. Luồng công việc hàng ngày

```
   Đầu giờ                        Trong ngày                       Cuối giờ
       │                              │                                │
       ▼                              ▼                                ▼
   Mở /orders ──► Lọc "Nháp" ──► Duyệt đơn ──► Tạo chuyến ──► Theo dõi ──► Báo cáo
   Xem đơn        Mở chi tiết     hoặc gửi      giao hàng     /deliveries    ngày
   chờ duyệt      kiểm 5 mục      về Sales      cho tài xế    cập nhật
                  (KH, SP, giá,                                tiến độ
                   tồn, hạn mức)
```

**Mô tả các bước:**

1. **Đầu giờ** - Vào `/orders`, lọc trạng thái **Nháp** để xem các đơn cần duyệt
2. **Duyệt đơn** - Mở từng đơn, kiểm tra tồn kho thực tế, hạn mức KH, giá đúng hợp đồng
3. **Phân tuyến** - Vào `/deliveries/new` gom các đơn `confirmed` thành chuyến cho tài xế
4. **Trong ngày** - Theo dõi `/deliveries` thấy đơn fail thì xử lý ngay (gọi tài xế hoặc đổi tuyến)
5. **Cuối giờ** - Vào `/reports` xem tổng đơn ngày, soát đơn fail / đơn trả

## 4. Các thao tác thường gặp (step-by-step)

### 4.1 Duyệt đơn hàng từ Sales

**Khi nào**: Sales tạo đơn ở trạng thái `draft` và gửi duyệt.

**Bước thực hiện**:
1. Vào `/orders`, lọc **Trạng thái = Nháp**
2. Click vào dòng đơn → mở chi tiết
3. Kiểm tra 5 mục:
   - **Khách hàng** đúng người, không bị khóa
   - **Sản phẩm và số lượng** hợp lý so với lịch sử
   - **Giá** đúng bảng giá KH, **chiết khấu** không vượt định mức
   - **Tồn kho** đủ (xem cột "Khả dụng" bên cạnh từng SKU)
   - **Hạn mức công nợ** còn đủ chỗ (so công nợ hiện tại + giá trị đơn)
4. Nếu hợp lệ → nhấn **Duyệt đơn** (đơn chuyển sang `confirmed`)
5. Nếu cần sửa → nhấn **Trả về Sales** kèm ghi chú

**Kết quả**: Đơn `confirmed` được Kho thấy trong danh sách cần soạn.

**Lưu ý**: Đơn > 50.000.000 đ phải để Owner duyệt - bạn chỉ duyệt được đơn dưới ngưỡng này.

### 4.2 Thêm khách hàng mới và gán Sales

**Khi nào**: Có cửa hàng mới mở tài khoản, hoặc Sales đề xuất thêm khách.

**Bước thực hiện**:
1. Vào `/customers`, nhấn **Thêm KH** (`/customers/new`)
2. Nhập **Tên cửa hàng**, **Họ tên chủ**, **Số điện thoại**, **Địa chỉ**
3. Chọn **Kênh**: GT (truyền thống) / MT (siêu thị) / HORECA (nhà hàng - khách sạn)
4. Chọn **Nhóm khách hàng** (mức giá / chiết khấu áp dụng)
5. Nhập **Hạn mức công nợ** ban đầu, chọn **Điều khoản thanh toán** (NET15/30/45/60)
6. Tab **Phân công** → chọn **Sales phụ trách** từ dropdown
7. Nhấn **Lưu**

**Kết quả**: Khách hàng xuất hiện trong danh sách Sales được phân công.

**Lưu ý**: Khách hàng mới luôn nên đặt hạn mức nhỏ (5-10 triệu) trong 3 tháng đầu để giảm rủi ro.

### 4.3 Tạo chương trình khuyến mãi

**Khi nào**: Đầu tháng, dịp lễ, đẩy hàng tồn, ra mắt sản phẩm mới.

**Bước thực hiện**:
1. Vào `/promotions`, nhấn **Tạo khuyến mãi**
2. Nhập **Tên chương trình**, **Mã code** (VD: TET2026)
3. Chọn **Loại**:
   - **Chiết khấu thương mại** - giảm % hoặc số tiền
   - **Mua X tặng Y** - mua N sản phẩm tặng M sản phẩm
   - **Chiết khấu thanh toán** - giảm khi trả sớm
   - **Lũy kế** - tích doanh thu để thưởng
   - **Trưng bày** - thưởng theo cam kết bày hàng
4. Cấu hình **điều kiện áp dụng** (SKU, nhóm KH, kênh)
5. Đặt **Ngày bắt đầu** / **Ngày kết thúc**
6. Bật **Đang hoạt động** rồi nhấn **Lưu**

**Kết quả**: Hệ thống tự áp dụng khi Sales tạo đơn thỏa điều kiện.

**Lưu ý**: Có thể đặt **giới hạn ngân sách** để tự động tắt khi đạt mức cho phép.

### 4.4 Phân tuyến giao hàng

**Khi nào**: Có nhóm đơn `confirmed` cần giao trong ngày / hôm sau.

**Bước thực hiện**:
1. Vào `/deliveries`, nhấn **Tạo chuyến** (`/deliveries/new`)
2. Đặt **Tên tuyến** (VD: "Tuyến Quận 1 - sáng 17/04")
3. Chọn **Tài xế** và **Phương tiện** (xe tải / xe máy)
4. Chọn các đơn cần giao (lọc theo khu vực để gom hiệu quả)
5. Sắp xếp **thứ tự đơn** theo lộ trình hợp lý
6. Đặt **Ngày giao** dự kiến
7. Nhấn **Lưu chuyến**

**Kết quả**: Tài xế thấy chuyến trên app điện thoại, đơn chuyển sang `picking` rồi `delivering`.

**Lưu ý**: 1 chuyến không nên quá 15 đơn để tài xế còn xử lý kịp; ưu tiên gom theo phường / quận.

### 4.5 Cập nhật bảng giá sản phẩm

**Khi nào**: Nhà cung cấp tăng giá, đổi nhóm khuyến mãi, áp giá ưu đãi cho 1 nhóm KH.

**Bước thực hiện**:
1. Vào `/products`, click sản phẩm cần đổi
2. Tab **Bảng giá** → chọn **Loại giá** (Bán lẻ / Bán sỉ / Đại lý / VIP)
3. Nhập **Giá mới**, **Ngày hiệu lực**
4. Có thể đặt **giá theo nhóm KH** (mỗi nhóm 1 mức)
5. Nhấn **Lưu**

**Kết quả**: Đơn tạo từ ngày hiệu lực sẽ tự áp giá mới.

**Lưu ý**: Đơn đã `draft` trước đó vẫn giữ giá cũ - cần Sales tạo lại nếu muốn áp giá mới.

### 4.6 Duyệt phiếu trả hàng

**Khi nào**: Sales tạo phiếu trả do hàng hư hỏng, sai SKU, gần hết hạn, khách từ chối.

**Bước thực hiện**:
1. Vào `/returns`, lọc **Trạng thái = Chờ duyệt**
2. Mở từng phiếu, xem **Lý do**: `damaged` / `wrong_item` / `near_expiry` / `expired` / `refused`
3. Đối chiếu với đơn gốc (link **Đơn liên quan**)
4. Nếu hợp lý → nhấn **Duyệt** → Kho sẽ nhập lại hàng
5. Nếu sai → nhấn **Từ chối** kèm ghi chú

**Kết quả**: Phiếu duyệt → công nợ KH được giảm tương ứng, tồn kho cập nhật.

**Lưu ý**: Trả hàng `expired` cần xác nhận Kho hủy lô, không cho nhập lại bán tiếp.

## 5. Mẹo & Best practices

- Mỗi sáng dành 30 phút duyệt sạch hàng chờ trước khi Sales bắt đầu chạy thị trường - tránh tắc dòng chảy
- Khi từ chối đơn, luôn ghi lý do cụ thể (VD: "Giá sai 5%", "Khách vượt hạn mức 2tr") để Sales sửa nhanh
- Phân tuyến theo **địa lý** trước, **giá trị đơn** sau - tiết kiệm xăng và thời gian
- Đặt khuyến mãi có **giới hạn ngân sách** tránh chạy mất kiểm soát
- Hàng tuần xem `/reports` báo cáo theo Sales để biết ai đang yếu, ai mạnh để hỗ trợ kịp thời
- Trước khi gán Sales mới cho 1 KH lớn, hãy chuyển dần (chia tỷ lệ đơn) thay vì cắt ngay
- Kiểm tra tab **Hiệu lực** của khuyến mãi - nếu hết hạn mà chưa tắt sẽ làm rối báo cáo

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Duyệt đơn xong vẫn không thấy ở Kho | Đơn chưa được "Soạn hàng" - vẫn `confirmed` chưa `picking` | Báo Kho vào `/inventory/picking` để kéo đơn về |
| Khuyến mãi không tự áp khi Sales tạo đơn | Sai điều kiện áp dụng (kênh / nhóm KH) hoặc chưa bật **Đang hoạt động** | Mở lại khuyến mãi, kiểm tra điều kiện và nút bật/tắt |
| Không thấy đơn trong tuyến giao | Đơn chưa `confirmed` hoặc đã có chuyến khác | Lọc đơn `confirmed` chưa thuộc chuyến nào để gom mới |
| Sales không thấy KH vừa thêm | Quên gán Sales tại tab **Phân công** | Mở chi tiết KH → tab Phân công → chọn Sales |
| Bảng giá mới không áp được | Ngày hiệu lực ở tương lai | Sửa **Ngày hiệu lực** về hôm nay hoặc trễ hơn |

## 7. KPI bạn được đánh giá

- **Thời gian duyệt đơn trung bình** (mục tiêu < 30 phút từ lúc Sales gửi)
- **Tỷ lệ đơn bị Sales tạo lại do trả về** (giữ < 5% - phản ánh chất lượng đào tạo Sales)
- **Tỷ lệ khuyến mãi hiệu quả** (số đơn áp khuyến mãi / tổng đơn trong kỳ)
- **Tỷ lệ chuyến giao có ≥ 80% đơn delivered đúng ngày**
- **Số khách hàng mới được kích hoạt mỗi tháng**
