# Hướng dẫn cho Tài xế: Driver

> Bạn được cấp quyền **Driver**. Đây là hướng dẫn đầy đủ cho công việc giao hàng, chụp POD (Proof of Delivery) và thu tiền COD ngay tại điểm giao (chủ yếu thao tác trên điện thoại).

## 1. Trách nhiệm chính

- Nhận chuyến từ Kho, đi giao hàng đến từng khách hàng theo lộ trình
- Chụp ảnh POD và lấy chữ ký xác nhận của khách khi giao thành công
- Thu tiền COD (tiền mặt) tại điểm giao và ghi nhận trên hệ thống
- Báo cáo các đơn giao thất bại (khách vắng, khách từ chối, sai địa chỉ)
- Cuối ngày nộp tiền và biên nhận về Kế toán

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Đơn hàng | Xem | Chỉ thấy đơn thuộc chuyến của mình |
| Giao hàng | Đọc / Sửa | Cập nhật trạng thái từng đơn (`pending` / `delivered` / `failed`) |
| Công nợ | Đọc / Tạo | Thu tiền COD và ghi nhận thanh toán tại điểm |

> ❌ Bạn KHÔNG có quyền truy cập: Dashboard, Khách hàng, Sản phẩm, Kho, Khuyến mãi, Hóa đơn, Trả hàng, Hoa hồng, Báo cáo, Cài đặt.

## 3. Luồng công việc hàng ngày

```
   Sáng (7:00 tại kho)             Trên đường giao             Cuối ca (17:30 về kho)
       │                                │                              │
       ▼                                ▼                              ▼
   Mở app điện thoại ──► Xem chuyến ──► Đến điểm giao ──► Chụp POD ──► Nộp tiền
   /deliveries          hôm nay         + ký nhận khách    + ký       Kế toán
   Lấy hàng ở kho       Lộ trình theo   Thu tiền nếu có    Cập nhật   Đối soát
   Đối chiếu phiếu      thứ tự đã sắp   COD                "Đã giao"  chuyến đã hoàn
                        xếp                                            tất
```

**Mô tả các bước:**

1. **Sáng** - Đến kho, đăng nhập app, vào `/deliveries` xem chuyến của mình hôm nay
2. **Lấy hàng** - Đối chiếu phiếu xuất kho với từng đơn, ký nhận với Kho, bấm **Bắt đầu chuyến**
3. **Trên đường** - Đi theo thứ tự đơn đã sắp xếp (Manager đã tối ưu lộ trình)
4. **Tại điểm** - Giao hàng → khách kiểm → chụp ảnh POD → ký xác nhận → thu tiền (nếu COD)
5. **Cuối ca** - Về kho, vào `/deliveries/[id]` đảm bảo tất cả đơn đã được cập nhật, nộp tiền cho Kế toán

## 4. Các thao tác thường gặp (step-by-step)

### 4.1 Bắt đầu chuyến giao

**Khi nào**: Đầu ca, sau khi nhận đủ hàng từ Kho.

**Bước thực hiện**:
1. Mở app trên điện thoại, đăng nhập với tài khoản Driver
2. Vào `/deliveries` - hiển thị chuyến của bạn
3. Click chuyến hôm nay → mở `/deliveries/[id]`
4. Xem thẻ **Thông tin chuyến**: tên tuyến, phương tiện, số đơn
5. Lướt **Danh sách đơn hàng** - xem tổng quát các điểm sẽ ghé
6. Nhấn **Bắt đầu chuyến** (nếu có) - chuyến chuyển sang `in_transit`

**Kết quả**: Trạng thái chuyến `pending` → `in_transit`. Manager và Kho thấy bạn đã xuất phát.

**Lưu ý**: Chỉ bấm bắt đầu khi đã có **đủ hàng trên xe** - tránh bắt đầu rồi quay lại lấy hàng.

### 4.2 Giao hàng tại điểm và chụp POD

**Khi nào**: Đến địa chỉ khách hàng và đã giao hàng cho họ kiểm tra.

**Bước thực hiện**:
1. Mở `/deliveries/[id]` (chuyến đang chạy)
2. Tìm dòng đơn của khách trong **Danh sách đơn hàng**
3. Khách kiểm hàng - nếu đủ và đúng → tiếp tục
4. Nhấn nút **Xác nhận** ở cột cuối → mở form POD
5. Chụp **ảnh POD** (chụp hàng đã đặt tại quầy KH, hoặc khách + hàng)
6. Lấy **chữ ký** khách trên màn hình điện thoại (`pod_signature`)
7. Nhấn **Lưu** - đơn chuyển từ `pending` → `delivered`, ghi `delivered_at = now()`

**Kết quả**: Hai icon trên cột POD chuyển xanh (📷 ảnh + ✍️ chữ ký), trạng thái Badge **Đã giao** màu xanh lá.

**Lưu ý**: Phải có **đủ ảnh + chữ ký** mới được tính là giao thành công. Nếu khách không cho ký, ghi chú lý do trong app và yêu cầu khách viết tay vào phiếu giấy.

### 4.3 Thu tiền mặt COD tại điểm

**Khi nào**: Khách hàng có công nợ đơn này (COD) hoặc trả nợ cũ tiền mặt.

**Bước thực hiện**:
1. Sau khi giao hàng xong, vào `/receivables/collect`
2. Chọn **Công nợ** từ dropdown - chỉ hiện công nợ chưa trả
3. Chọn **Hình thức** = **Tiền mặt** (`cash`)
4. Nhập **Số tiền thu** (đúng số khách đưa)
5. Hệ thống hiển thị **Còn nợ** sau khi trừ
6. Nhấn **Xác nhận thu tiền**
7. Đưa biên nhận điện tử / chụp màn hình cho khách

**Kết quả**: Hệ thống tạo `payments`, công nợ giảm tương ứng (`paid` cộng thêm, `status` cập nhật).

**Lưu ý**: Số tiền thu **không được vượt quá còn nợ** - hệ thống chặn `max={remaining}`. Nếu khách muốn trả thừa, chỉ thu đúng số nợ.

### 4.4 Báo đơn giao thất bại

**Khi nào**: Khách vắng, từ chối nhận hàng, sai địa chỉ, hàng hư khi đến nơi.

**Bước thực hiện**:
1. Vào `/deliveries/[id]`, tìm dòng đơn cần báo
2. Nhấn vào dòng → mở chi tiết đơn
3. Đổi trạng thái sang **Thất bại** (`failed`)
4. Chọn / nhập **Lý do**: Khách vắng / Khách từ chối / Sai địa chỉ / Hàng hư trên đường
5. Chụp ảnh chứng minh (cửa hàng đóng, khách từ chối, ...)
6. Nhấn **Lưu**

**Kết quả**: Đơn ở trạng thái **Thất bại**, badge đỏ. Manager nhận thông báo để xử lý (giao lại / hủy / chuyển tài xế khác).

**Lưu ý**: Đơn `failed` cần báo Manager **ngay trong ngày** - không để qua hôm sau. Hàng phải mang về kho cùng buổi.

### 4.5 Kết thúc chuyến và bàn giao

**Khi nào**: Hết tất cả các điểm trên lộ trình, quay về kho.

**Bước thực hiện**:
1. Vào `/deliveries/[id]` - kiểm tra trạng thái mọi đơn:
   - **Đã giao** (xanh) - hoàn tất
   - **Thất bại** (đỏ) - đã báo Manager
   - **Chờ giao** (xám) - phải xử lý nốt hoặc đổi trạng thái
2. Nếu chuyến có nút **Kết thúc chuyến** → bấm để đổi trạng thái sang `delivered` / `partial`
3. Tổng hợp tiền thu được trong ngày
4. Xuống quầy Kế toán nộp tiền + biên nhận
5. Trả hàng `failed` về Kho

**Kết quả**: Chuyến đóng, tiền vào két Kế toán, hàng `failed` quay về kho.

**Lưu ý**: Không được giữ tiền qua đêm - nộp ngay cuối ca. Có thể bị truy cứu trách nhiệm nếu mất tiền.

### 4.6 Tra cứu lại đơn đã giao

**Khi nào**: Khách hàng gọi báo "thiếu 1 thùng" hoặc Kế toán hỏi về POD.

**Bước thực hiện**:
1. Vào `/deliveries`, lọc trạng thái **Đã giao** (`delivered`)
2. Chọn chuyến chứa đơn cần tra
3. Mở `/deliveries/[id]`, tìm đơn theo **Mã đơn** hoặc **Tên KH**
4. Click vào icon 📷 hoặc ✍️ để xem ảnh POD và chữ ký
5. Nếu có tranh chấp - gửi link cho Manager / Kế toán

**Kết quả**: Có bằng chứng giao hàng để xử lý khiếu nại.

**Lưu ý**: POD chỉ tra được trong vòng 90 ngày - sau đó hệ thống tự lưu trữ lạnh, cần Owner phục hồi.

## 5. Mẹo & Best practices

- Sạc đầy điện thoại + mang sạc dự phòng - app cần online để cập nhật trạng thái
- Mở **Google Maps** sẵn ở tab khác để chỉ đường nhanh giữa các điểm
- Chụp POD theo nguyên tắc **rõ + đủ**: thấy hàng + thấy mặt tiền cửa hàng + ánh sáng đủ
- Đếm tiền **trước mặt khách** rồi mới ghi nhận trên hệ thống - tránh tranh chấp
- Đi theo **đúng thứ tự đơn** Manager đã sắp xếp - bị tối ưu theo lộ trình rồi
- Báo Manager **ngay lập tức** khi gặp vấn đề: tai nạn, hỏng xe, khách phàn nàn lớn
- Sau mỗi điểm giao, dành 30 giây cập nhật trạng thái ngay - đừng để dồn cuối ca rồi quên
- Nếu thu tiền mặt > 5 triệu, đề nghị khách chuyển khoản cho Kế toán thay vì ôm tiền cả ngày

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Bấm "Xác nhận" báo lỗi không lưu được | Mạng yếu / mất kết nối | Tìm chỗ có sóng tốt, thử lại; ảnh sẽ tự upload khi có mạng |
| Khách không chịu ký vào màn hình | Cảm ứng kém / khách lớn tuổi | Ký thay vào phiếu giấy + chụp ảnh phiếu đính kèm POD |
| Số tiền thu lớn hơn còn nợ - không nhập được | Hệ thống chặn `amount > remaining` | Chỉ thu đúng số nợ; phần thừa trả lại khách hoặc ghi nhận đơn sau |
| Không thấy chuyến trong `/deliveries` | Manager chưa gán bạn vào chuyến | Liên hệ Manager / Kho xác nhận và gán lại |
| Đơn `failed` báo "Phải có lý do" | Quên chọn dropdown lý do thất bại | Mở lại đơn, chọn lý do, lưu lại |

## 7. KPI bạn được đánh giá

- **Tỷ lệ giao đúng hạn** (`delivered` đúng `delivery_date` - mục tiêu > 95%)
- **Tỷ lệ POD đầy đủ** (đơn có cả ảnh + chữ ký - mục tiêu > 98%)
- **Tỷ lệ thu hồi COD** (số tiền thu thực tế / tổng COD trong chuyến - mục tiêu 100%)
- **Số đơn `failed` / tổng đơn** (giữ < 5%)
- **Mức tiêu hao xăng / km** (so với định mức Manager giao - tiết kiệm được thưởng)
