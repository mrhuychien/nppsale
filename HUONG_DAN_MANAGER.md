# Hướng dẫn cho Quản lý: Manager

> Bạn được cấp quyền **Manager**. Đây là hướng dẫn đầy đủ cho công việc xuất hàng, quản lý khách hàng, sản phẩm và khuyến mãi hàng ngày.

## 1. Trách nhiệm chính

- Xuất hàng cho đơn do Sales gửi lên, và hoàn thành phiếu trả hàng
- Quản lý danh mục khách hàng: thêm mới, phân nhóm, gán Sales phụ trách
- Vận hành danh mục sản phẩm và bảng giá nhiều cấp
- Thiết kế và chạy chương trình khuyến mãi (chiết khấu, mua X tặng Y, lũy kế)
- Theo dõi công nợ sinh ra từ mỗi lần xuất hàng

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Dashboard | Xem | Theo dõi KPI tổng, top KH, cảnh báo HSD/nợ |
| Đơn hàng | Đọc / Tạo / Sửa / Xuất hàng | Xuất hàng cho đơn của Sales, hỗ trợ tạo đơn khi Sales bận |
| Khách hàng | Đọc / Tạo / Sửa | Quản lý cửa hàng, gán Sales, đặt nhóm KH |
| Sản phẩm | Đọc / Tạo / Sửa | Mở SKU mới, sửa đơn vị quy đổi, cập nhật bảng giá |
| Kho hàng | Xem | Xem tồn trước khi xuất hàng (không chỉnh được lô) |
| Giao hàng *(ngưng dùng)* | Xem | Tra cứu chuyến giao cũ. Phiếu giao nay in ngay khi bấm **Xuất hàng** |
| Công nợ | Xem | Theo dõi công nợ, không thu tiền trực tiếp |
| Khuyến mãi | Đọc / Tạo / Sửa | Soạn chương trình khuyến mãi, kích hoạt / tạm tắt |
| Hóa đơn | Xem | Xem hóa đơn, không xuất được (Kế toán làm) |
| Trả hàng | Đọc / Hoàn thành | Bấm **Hoàn thành** thì hàng mới vào kho và công nợ mới giảm |
| Hoa hồng | Xem | Xem chính sách (không sửa được) |
| Báo cáo | Xem | Tất cả báo cáo doanh số, tồn kho, công nợ |
| Cài đặt | Xem | Chỉ xem cấu hình, không sửa |

## 3. Luồng công việc hàng ngày

```
   Đầu giờ                        Trong ngày                       Cuối giờ
       │                              │                                │
       ▼                              ▼                                ▼
   Mở /orders ──► Lọc "Phiếu ──► Xuất hàng ──► Hoàn thành ──► Theo dõi ──► Báo cáo
   Xem đơn        Mở chi tiết     hoặc gửi      giao hàng     /deliveries    ngày
   chờ xử lý      tạm
                  (KH, SP, giá,                                tiến độ
                   tồn, hạn mức)
```

**Mô tả các bước:**

1. **Đầu giờ** - Vào `/orders`, lọc trạng thái **Phiếu tạm** để xem các đơn chờ xuất
2. **Xuất hàng** - Mở từng đơn, kiểm tra tồn kho thực tế, hạn mức KH, giá đúng hợp đồng, rồi bấm **Xuất hàng**
3. **Phiếu trả** - Vào `/returns` bấm **Hoàn thành** cho các phiếu đã nhận đủ hàng
4. **Trong ngày** - Theo dõi `/receivables` để nắm công nợ mới sinh trong ngày
5. **Cuối giờ** - Vào `/reports` xem tổng đơn ngày, soát đơn fail / đơn trả

## 4. Các thao tác thường gặp (step-by-step)

### 4.1 Xuất hàng cho đơn của Sales

**Khi nào**: Sales gửi đơn lên, đơn ở trạng thái **Phiếu tạm**
(`submitted`).

**Bước thực hiện**:
1. Vào `/orders`, lọc **Trạng thái = Phiếu tạm**
2. Click vào dòng đơn → mở chi tiết
3. Kiểm tra 5 mục:
   - **Khách hàng** đúng người, không bị khóa
   - **Sản phẩm và số lượng** hợp lý so với lịch sử
   - **Giá** đúng bảng giá KH, **chiết khấu** không vượt định mức
   - **Tồn kho** đủ (xem cột "Khả dụng" bên cạnh từng SKU)
   - **Hạn mức công nợ** còn đủ chỗ (so công nợ hiện tại + giá trị đơn)
4. Cần sửa thì sửa thẳng trên đơn — **Phiếu tạm** vẫn sửa được
5. Xong thì nhấn **Xuất hàng**

**Kết quả**: Trong MỘT giao dịch, hệ thống trừ kho theo FIFO, ghi công
nợ phải thu, đổi đơn sang `completed` và mở hộp in phiếu giao.

**Lưu ý**:
- ⚠ **ĐỌC THÔNG BÁO SAU KHI BẤM, ĐỪNG CHỈ NHÌN "Đã xuất hàng".** Nếu tổ
  chức bật `allow_oversell`, đơn vẫn xuất được khi thiếu tồn và hệ thống
  báo RIÊNG một dòng đỏ "xuất thiếu hàng" kèm số thiếu. Bỏ qua dòng đó
  là kho đóng hàng theo phiếu, tới nơi mới biết thiếu, và thẻ kho âm
  không ai hay tới kỳ kiểm kê.
- Không còn ngưỡng tiền nào cần ai duyệt. Đơn to hay nhỏ đều một nút.

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

### 4.4 Giao hàng — bước này đã bỏ

Quy trình cũ có ba bước rời nhau: Kho soạn hàng → lập chuyến, gán tài xế
→ tài xế bàn giao. **Cả ba đã bỏ.** Bấm **Xuất hàng** trên đơn là hệ
thống dựng phiếu kho, trừ tồn, ghi công nợ và in phiếu giao — nhà phân
phối cầm phiếu đó đi giao.

Màn `/deliveries` vẫn mở để tra cứu chuyến giao cũ, nhưng các nút ghi ở
đó đã khoá: bấm vào chỉ nhận một dòng chỉ đường sang cách làm mới.

### 4.5 Cập nhật bảng giá sản phẩm

**Khi nào**: Nhà cung cấp tăng giá, đổi nhóm khuyến mãi, áp giá ưu đãi cho 1 nhóm KH.

**Bước thực hiện**:
1. Vào `/products`, click sản phẩm cần đổi
2. Tab **Bảng giá** → chọn **Loại giá** (Bán lẻ / Bán sỉ / Đại lý / VIP)
3. Nhập **Giá mới**, **Ngày hiệu lực**
4. Có thể đặt **giá theo nhóm KH** (mỗi nhóm 1 mức)
5. Nhấn **Lưu**

**Kết quả**: Đơn tạo từ ngày hiệu lực sẽ tự áp giá mới.

**Lưu ý**: Đơn đã lập trước đó vẫn giữ giá cũ - sửa lại đơn (khi còn ở **Phiếu tạm**) hoặc tạo đơn mới nếu muốn áp giá mới.

### 4.6 Hoàn thành phiếu trả hàng

**Khi nào**: Sales lập phiếu trả do hàng hư hỏng, sai SKU, gần hết hạn,
khách từ chối — và hàng đã thật sự về tới kho.

**Bước thực hiện**:
1. Vào `/returns`, lọc **Trạng thái = Phiếu tạm**
2. Mở từng phiếu, xem **Lý do**: `damaged` / `wrong_item` / `near_expiry` / `expired` / `refused`
3. Đối chiếu với đơn gốc (link **Đơn liên quan**)
4. Chọn **kho nhận**: **Kho bán** hay **Kho cận date**
5. Nhấn **Hoàn thành**
6. Phiếu sai thì nhấn **Huỷ** kèm ghi chú

**Kết quả**: Hàng vào kho và công nợ giảm **cùng lúc**, trong một giao
dịch.

**Lưu ý**:
- ⚠ **BẤM KHI HÀNG ĐÃ VỀ, KHÔNG BẤM TRƯỚC.** Đây là thời điểm tồn kho
  tăng lên. Bấm sớm là sổ sách có hàng mà kệ thì không.
- Trả hàng `expired` chọn **Kho cận date**, đừng cho về kho bán.
- Không trả được quá số đã bán: hệ thống đếm các phiếu đã hoàn thành của
  cùng đơn và chặn ngay lúc bấm.

## 5. Mẹo & Best practices

- Mỗi sáng dành 30 phút xuất sạch hàng chờ trước khi Sales bắt đầu chạy thị trường - tránh tắc dòng chảy
- Khi từ chối đơn, luôn ghi lý do cụ thể (VD: "Giá sai 5%", "Khách vượt hạn mức 2tr") để Sales sửa nhanh
- Phân tuyến theo **địa lý** trước, **giá trị đơn** sau - tiết kiệm xăng và thời gian
- Đặt khuyến mãi có **giới hạn ngân sách** tránh chạy mất kiểm soát
- Hàng tuần xem `/reports` báo cáo theo Sales để biết ai đang yếu, ai mạnh để hỗ trợ kịp thời
- Trước khi gán Sales mới cho 1 KH lớn, hãy chuyển dần (chia tỷ lệ đơn) thay vì cắt ngay
- Kiểm tra tab **Hiệu lực** của khuyến mãi - nếu hết hạn mà chưa tắt sẽ làm rối báo cáo

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Bấm Xuất hàng xong mà tồn kho không giảm | Lệnh bị từ chối nhưng màn chỉ báo chung chung | Mở lại đơn: còn ở **Phiếu tạm** là chưa xuất. Đọc kỹ toast đỏ — nếu ghi "Không đủ tồn" thì cả giao dịch đã cuộn lại |
| Khuyến mãi không tự áp khi Sales tạo đơn | Sai điều kiện áp dụng (kênh / nhóm KH) hoặc chưa bật **Đang hoạt động** | Mở lại khuyến mãi, kiểm tra điều kiện và nút bật/tắt |
| Đơn xuất được dù kho báo thiếu hàng | Tổ chức đang bật `allow_oversell` | Đọc toast đỏ "xuất thiếu hàng" kèm số thiếu; tắt cờ ở Cài đặt → Tổ chức nếu không muốn |
| Sales không thấy KH vừa thêm | Quên gán Sales tại tab **Phân công** | Mở chi tiết KH → tab Phân công → chọn Sales |
| Bảng giá mới không áp được | Ngày hiệu lực ở tương lai | Sửa **Ngày hiệu lực** về hôm nay hoặc trễ hơn |

## 7. KPI bạn được đánh giá

- **Thời gian từ lúc Sales gửi đơn tới lúc xuất hàng** (mục tiêu < 30 phút)
- **Tỷ lệ đơn phải sửa lại sau khi gửi** (giữ < 5% - phản ánh chất lượng đào tạo Sales)
- **Tỷ lệ khuyến mãi hiệu quả** (số đơn áp khuyến mãi / tổng đơn trong kỳ)
- **Tỷ lệ đơn xuất hàng đúng ngày hẹn** (mục tiêu ≥ 95%)
- **Số khách hàng mới được kích hoạt mỗi tháng**
