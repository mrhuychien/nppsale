# Hướng dẫn cho Kho: Warehouse

> Bạn được cấp quyền **Warehouse**. Đây là hướng dẫn đầy đủ cho công việc nhập / xuất / kiểm kê, quản lý lô hàng và hạn sử dụng (FIFO).

## 1. Trách nhiệm chính

- Nhập kho hàng từ nhà cung cấp, gán mã lô và hạn sử dụng (HSD)
- Theo dõi phiếu xuất do nút **Xuất hàng** trên đơn tự dựng, đối chiếu hàng thật với phiếu
- Kiểm kê định kỳ (tuần / tháng / quý), điều chỉnh chênh lệch
- Theo dõi và cảnh báo lô hàng sắp hết hạn (mặc định < 30 ngày)
- Tiếp nhận hàng trả về, kiểm tra chất lượng và quyết định nhập lại / hủy

## 2. Các module bạn truy cập được

| Module | Quyền | Làm gì? |
| --- | --- | --- |
| Dashboard | Xem | Theo dõi cảnh báo HSD, tồn kho thấp |
| Đơn hàng | Xem | Tra cứu đơn `completed` để đối chiếu hàng đã ra |
| Sản phẩm | Xem | Tra cứu SKU, đơn vị quy đổi (thùng - lốc - chai) |
| Kho hàng | Đọc / Tạo / Sửa | Tạo phiếu nhập / xuất / chuyển / kiểm kê, quản lý lô hàng |
| Giao hàng *(ngưng dùng)* | Xem | Tra cứu chuyến giao cũ; các nút ghi đã khoá |
| Trả hàng | Đọc / Sửa / Hoàn thành | Bấm **Hoàn thành** khi hàng đã về tới kho — đó là lúc tồn tăng |
| Báo cáo | Xem | Báo cáo tồn kho, vòng quay, hàng hết hạn |

> ❌ Bạn KHÔNG có quyền truy cập: Khách hàng, Công nợ, Khuyến mãi, Hóa đơn, Hoa hồng, Cài đặt.

## 3. Luồng công việc hàng ngày

```
   Sáng (7:00)                 Trong ngày                       Cuối ngày (17:00)
       │                            │                                  │
       ▼                            ▼                                  ▼
   Nhập kho hàng ──► Đối chiếu ──► Đóng hàng theo ──► Nhận hàng ──► Kiểm kê tồn
   từ NCC            phiếu xuất     phiếu               trả về          cuối ngày
   /inventory/       (đơn vừa                           /returns        /inventory
   stocktake         Xuất hàng)     ⚠ đọc cảnh báo      bấm             Cảnh báo
   gán lô + HSD                     "xuất thiếu hàng"   Hoàn thành      HSD < 30 ngày
                                                                        /inventory/expiring
```

**Mô tả các bước:**

1. **Sáng** - Nhận hàng từ NCC, vào `/inventory/stocktake` chọn loại **Nhập kho** (`import`), nhập **mã lô**, **HSD**, **vị trí**
2. **Đối chiếu** - Đơn vừa **Xuất hàng** tự dựng phiếu kho và tự trừ tồn theo **FIFO**. Việc của kho là đóng đúng lô ghi trên phiếu
3. **Hàng trả** - Khi hàng khách trả về tới kho, vào `/returns` bấm **Hoàn thành** đúng phiếu
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

### 4.2 Đóng hàng theo phiếu xuất

**Khi nào**: Một đơn vừa được bấm **Xuất hàng** (`completed`).

⚠ **BƯỚC "SOẠN HÀNG" TRONG HỆ THỐNG ĐÃ BỎ.** Trước đây kho phải vào
`/inventory/stock-out` dựng phiếu rồi tự đổi trạng thái đơn. Nay nút
**Xuất hàng** trên đơn làm hết: dựng phiếu kho, chọn lô theo FIFO, trừ
tồn và ghi công nợ trong một giao dịch. Màn cũ vẫn mở để tra cứu nhưng
các nút ghi đã khoá.

**Bước thực hiện**:
1. Mở đơn vừa xuất, in **Phiếu giao hàng** (hộp in tự bật sau khi xuất)
2. Đi nhặt hàng **theo đúng lô ghi trên phiếu** — hệ thống đã chọn lô,
   đừng tự đổi sang lô khác
3. Đếm đủ theo từng đơn vị (thùng / lốc / chai)
4. Bàn giao cho người đi giao kèm phiếu

**Lưu ý**:
- ⚠ **LÔ TRÊN PHIẾU LÀ LÔ ĐÃ TRỪ TRONG SỔ.** Lấy lô khác là thẻ kho và
  hàng thật lệch nhau, và chênh đó chỉ lộ ra ở kỳ kiểm kê.
- Hàng không đủ thì **không tự sửa số lượng đơn**. Báo quản lý — họ sửa
  trên đơn, hệ thống tự chỉnh lại tồn và công nợ.
- Nếu màn đơn hiện cảnh báo **"xuất thiếu hàng"**, nghĩa là tổ chức cho
  phép xuất âm: sổ đã trừ nhưng kệ không có đủ. Báo ngay, đừng để người
  giao lên đường với hàng thiếu.


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

**Khi nào**: Có phiếu trả ở **Phiếu tạm** (`submitted`) và hàng đã về tới kho.

**Bước thực hiện**:
1. Vào `/returns`, lọc trạng thái **Phiếu tạm**
2. Mở phiếu, kiểm tra **Lý do trả**:
   - `damaged` / `expired` → **không nhập lại kho bán**, chuyển khu vực hủy
   - `wrong_item` / `refused` → kiểm tra chất lượng, nhập lại lô gốc nếu còn nguyên vẹn
   - `near_expiry` → nhập lại nhưng đẩy bán ngay
3. Chọn **kho nhận**: **Kho bán** cho hàng còn bán được, **Kho cận date**
   cho hàng gần hạn
4. Nhấn **Hoàn thành**

**Kết quả**: Phiếu nhập kho được dựng, tồn tăng, và công nợ khách giảm —
tất cả trong MỘT lần bấm.

⚠ **BẤM KHI HÀNG ĐÃ VỀ, KHÔNG BẤM TRƯỚC.** Ở quy trình cũ việc nhập kho
là một bước riêng làm sau; nay nó nằm ngay trong nút này. Bấm sớm là sổ
sách có hàng mà kệ thì không, và không lệnh nào báo lỗi.

**Lưu ý**: Hàng trả phải kiểm tra **trong vòng 24h** kể từ khi nhận về - quá lâu khó truy lý do.

## 5. Mẹo & Best practices

- Áp dụng nghiêm ngặt **FIFO** (First In - First Out): luôn xuất lô có HSD gần nhất trước
- Đặt **vị trí kho** chuẩn (Tầng - Kệ - Ngăn) ngay từ đầu để soạn hàng nhanh
- In nhãn lô có **mã vạch / QR** dán trực tiếp lên thùng, scan để tránh nhầm
- Mỗi sáng dành 10 phút xem `/inventory/expiring` - phát hiện sớm để báo Manager
- Khi nhập kho, **đếm lại 2 lần** trước khi tạo phiếu - sửa phiếu sau rất khó
- Tách khu **hàng lỗi** / **hàng trả** / **hàng hết hạn** riêng biệt, có nhãn cảnh báo
- Mỗi cuối ca, đối chiếu **số phiếu xuất** đã ghi sổ vs **số đơn Hoàn thành** trong ngày - phải khớp

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Tạo phiếu xuất báo "Vượt tồn kho" | Số xuất > `qty_on_hand` của lô | Kiểm kê lại lô đó, tạo phiếu điều chỉnh thừa nếu cần |
| Quên nhập HSD khi nhập lô | Bỏ trống `expires_at` lúc tạo phiếu | Vào `/inventory/batches`, sửa lại lô (cần Owner xác nhận) |
| Tồn âm sau khi đơn xuất hàng | Tổ chức bật `allow_oversell` nên đơn xuất được dù thiếu | Đọc cảnh báo "xuất thiếu hàng" trên màn đơn, đối chiếu rồi báo quản lý nhập bù |
| Hệ thống báo "Hết hàng" nhưng thực tế còn | Lô hàng chưa được nhập vào hệ thống | Tạo phiếu nhập kho ngay với mã lô và HSD đúng |
| Hàng trả về không nhập được | Đơn gốc chưa **Xuất hàng** — không có gì để trả | Kiểm tra đơn gốc: phải ở `completed` thì phiếu trả mới hoàn thành được |

## 7. KPI bạn được đánh giá

- **Tỷ lệ chính xác kiểm kê** (chênh lệch < 1% / tổng tồn - mục tiêu > 99%)
- **Thời gian đóng xong một đơn** (từ lúc đơn `completed` đến lúc hàng rời kho - mục tiêu < 2h)
- **Tỷ lệ hàng hết hạn phải hủy** (giữ < 0.5% / tổng nhập)
- **Tỷ lệ FIFO compliance** (% đơn xuất đúng lô gần HSD nhất - mục tiêu > 95%)
- **Số phiếu nhập / xuất sai phải sửa** (giữ < 2% / tổng phiếu)
