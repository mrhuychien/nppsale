# Hướng dẫn cho Tài xế: Driver

> ⚠ **QUY TRÌNH GIAO HÀNG QUA CHUYẾN ĐÃ NGƯNG.** Bản trước của tài liệu
> này hướng dẫn nhận chuyến, chụp POD và kết thúc chuyến trên app. Từ
> workflow v2, nhà phân phối bấm **"Xuất hàng"** ngay trên đơn — hệ
> thống trừ kho, ghi công nợ và **in luôn phiếu giao hàng**. Không còn
> bước lập chuyến, gán tài xế hay bàn giao trên hệ thống.
>
> Các chuyến giao cũ **vẫn tra cứu lại được** (kèm ảnh POD và chữ ký) —
> chúng là chứng từ, không bị xoá. Chỉ các nút GHI ở những màn đó đã
> khoá; bấm vào sẽ nhận một dòng chỉ sang cách làm mới.

## 1. Trách nhiệm chính

- Cầm **phiếu giao hàng** in ra từ đơn, đi giao đến từng khách
- Thu tiền tại điểm và ghi nhận trên hệ thống
- Báo về ngay khi khách vắng, từ chối nhận, hoặc trả lại hàng
- Cuối ngày nộp tiền và biên nhận về Kế toán

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Đơn hàng | Xem | Tra cứu đơn theo mã trên phiếu giao |
| Công nợ | Đọc / Tạo | Thu tiền tại điểm và ghi nhận thanh toán |
| Giao hàng *(ngưng dùng)* | Xem | Tra cứu chuyến giao cũ, ảnh POD, chữ ký |

> ❌ Bạn KHÔNG có quyền: Dashboard, Khách hàng, Sản phẩm, Kho, Khuyến
> mãi, Hóa đơn, Trả hàng, Hoa hồng, Báo cáo, Cài đặt.
>
> Màn **Giao hàng** không còn nằm trên menu. Muốn tra cứu chuyến cũ thì
> gõ thẳng địa chỉ `/deliveries` vào trình duyệt.

## 3. Luồng công việc hàng ngày

```
   Sáng (tại kho)                  Trên đường giao          Cuối ca (về kho)
       │                                │                         │
       ▼                                ▼                         ▼
   Nhận hàng + phiếu ──► Đến điểm ──► Giao, khách ──► Thu tiền ──► Nộp tiền
   giao in từ đơn        theo địa     kiểm hàng       nếu có       Kế toán
   Đối chiếu số lượng    chỉ trên                     /receivables Báo hàng
   với phiếu             phiếu                        /collect     trả về kho
```

**Mô tả các bước:**

1. **Sáng** - Nhận hàng ở kho, đối chiếu **từng dòng trên phiếu giao**
   với hàng thật. ⚠ Phiếu ghi cả **mã lô**; lấy nhầm lô là sổ sách và
   hàng thật lệch nhau.
2. **Trên đường** - Đi theo địa chỉ ghi trên phiếu.
3. **Tại điểm** - Giao hàng → khách kiểm → thu tiền nếu có.
4. **Hàng khách trả** - Nhận lại, mang về kho và báo để kho lập phiếu
   trả. ⚠ Đừng tự ghi gì trên hệ thống: tồn kho chỉ được tăng khi kho
   bấm **Hoàn thành** trên phiếu trả.
5. **Cuối ca** - Nộp tiền cho Kế toán kèm biên nhận.

## 4. Các thao tác thường gặp (step-by-step)

### 4.1 Thu tiền tại điểm giao

**Khi nào**: Khách trả tiền ngay khi nhận hàng.

**Bước thực hiện**:
1. Mở app trên điện thoại, vào `/receivables/collect`
2. Tìm khách theo **tên cửa hàng** hoặc **mã đơn** ghi trên phiếu
3. Xem **số còn nợ** hiển thị bên cạnh
4. Đếm tiền **trước mặt khách**
5. Nhập **số tiền thu** và nhấn **Lưu**

**Kết quả**: Công nợ của khách giảm đúng số vừa thu.

**Lưu ý**:
- Thu ít hơn số nợ thì khoản đó chuyển sang **Một phần** (`partial`) —
  bình thường, phần còn lại thu sau.
- ⚠ Không nhập nhiều hơn số còn nợ. Hệ thống chặn, và đó là chặn đúng.
- Thu tiền mặt > 5 triệu thì đề nghị khách chuyển khoản cho Kế toán
  thay vì ôm tiền cả ngày.

### 4.2 Khách vắng hoặc từ chối nhận

**Khi nào**: Đến nơi mà không giao được.

**Bước thực hiện**:
1. Chụp ảnh chứng minh (cửa hàng đóng, khách từ chối…)
2. Gọi báo nhà phân phối **ngay trong ngày**
3. Mang hàng về kho cùng buổi

**Lưu ý**: ⚠ **KHÔNG tự đổi trạng thái gì trên hệ thống.** Đơn đã
**Xuất hàng** nghĩa là kho đã trừ và công nợ đã ghi. Xử lý đúng là nhà
phân phối **huỷ đơn** (tồn và công nợ được hoàn lại) hoặc lập **phiếu
trả**. Cả hai việc đều không làm từ màn của tài xế.

### 4.3 Khách trả lại một phần hàng

**Khi nào**: Khách nhận đơn nhưng trả lại vài món (hàng móp, gần hạn…).

**Bước thực hiện**:
1. Nhận lại hàng, ghi rõ **món gì, bao nhiêu** lên mặt sau phiếu giao
2. Mang hàng về kho
3. Báo kho lập **phiếu trả** ở `/returns`

**Kết quả**: Kho bấm **Hoàn thành** trên phiếu → hàng vào kho và công nợ
khách giảm **cùng lúc**.

**Lưu ý**: ⚠ Hàng phải về tới kho TRƯỚC khi ai đó bấm Hoàn thành. Bấm
sớm là sổ sách có hàng mà kệ thì không.

### 4.4 Tra cứu chuyến giao cũ

**Khi nào**: Khách gọi báo "thiếu 1 thùng" cho một chuyến từ trước, hoặc
Kế toán hỏi về POD.

**Bước thực hiện**:
1. Gõ thẳng `/deliveries` vào trình duyệt (màn này không còn trên menu)
2. Chọn chuyến chứa đơn cần tra
3. Tìm đơn theo **Mã đơn** hoặc **Tên KH**
4. Mở ảnh POD và chữ ký
5. Gửi link cho nhà phân phối / Kế toán nếu có tranh chấp

**Lưu ý**: Màn này **chỉ xem**. Mọi nút ghi ở đó đã khoá — bấm vào sẽ
hiện dòng chỉ sang cách làm mới.

## 5. Mẹo & Best practices

- Sạc đầy điện thoại + mang sạc dự phòng - app cần online để ghi nhận thu tiền
- Mở **Google Maps** sẵn ở tab khác để chỉ đường nhanh giữa các điểm
- **Đếm hàng theo phiếu giao ngay tại kho**, đừng đợi tới nơi mới phát hiện thiếu
- Đếm tiền **trước mặt khách** rồi mới ghi nhận trên hệ thống - tránh tranh chấp
- Sau mỗi điểm thu tiền, dành 30 giây ghi nhận ngay - đừng để dồn cuối ca rồi quên
- Báo nhà phân phối **ngay lập tức** khi gặp vấn đề: tai nạn, hỏng xe, khách phàn nàn lớn
- Giữ lại phiếu giao đã ký tới khi Kế toán đối soát xong

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Bấm "Lưu" báo lỗi không ghi được | Mạng yếu / mất kết nối | Tìm chỗ có sóng tốt, thử lại. ⚠ Kiểm tra lại số nợ sau khi có mạng — đừng cho là đã lưu |
| Số tiền thu lớn hơn còn nợ - không nhập được | Hệ thống chặn `amount > remaining` | Chỉ thu đúng số nợ; phần thừa trả lại khách hoặc để Kế toán lập phiếu thu riêng |
| Không tìm thấy khoản nợ của đơn vừa giao | Đơn chưa được bấm **Xuất hàng** | Gọi nhà phân phối: công nợ chỉ sinh ra lúc xuất hàng |
| Vào `/deliveries` bấm nút thì báo "Bước này đã bỏ" | Đúng như vậy - màn cũ chỉ còn để xem | Không cần làm gì; việc giao nay theo phiếu in từ đơn |
| Không thấy menu Giao hàng | Màn đã ẩn khỏi menu ở quy trình mới | Gõ thẳng địa chỉ `/deliveries` nếu cần tra cứu chứng từ cũ |

## 7. KPI bạn được đánh giá

- **Tỷ lệ giao đúng ngày hẹn trên phiếu** (mục tiêu > 95%)
- **Tỷ lệ thu hồi tiền tại điểm** (số thu thực tế / số phải thu trong ngày - mục tiêu 100%)
- **Số đơn giao không thành công / tổng đơn** (giữ < 5%)
- **Số lần lệch giữa hàng trên xe và phiếu giao** (mục tiêu 0)
- **Mức tiêu hao xăng / km** (so với định mức - tiết kiệm được thưởng)
