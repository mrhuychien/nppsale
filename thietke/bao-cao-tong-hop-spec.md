# Báo cáo tổng hợp — spec cho thiết kế giao diện

Phiên bản 1 · 26/09/2026 · npp.sale

## 0. Vì sao làm lại

Chủ nhà 26/09/2026: *"Rà soát cho tao phần báo cáo xem có giản lược bớt đi hoặc có cách nào thông
minh hơn thể hiện không? Hiện tại phức tạp nhiều báo cáo, lọc nhiều loại, nhiều mối quan tâm."*
Sau rà soát, chủ nhà chốt: **6 màn**, gộp báo cáo Đặt hàng vào màn Bán hàng, chưa làm khối
"Cần chú ý", quản lý và kế toán thấy hết. Làm **menu mới "Báo cáo tổng hợp" chạy song song** với
các báo cáo cũ; báo cáo cũ chỉ gỡ khi màn mới đã dùng ổn.

Hiện trạng đang có:

- **26 màn** báo cáo / phân tích, chia hai nhóm menu "Báo cáo" và "Phân tích" chồng lên nhau.
- Doanh thu thuần tính ở khoảng **14 chỗ**. Doanh thu theo mặt hàng có ở 5 màn, theo khách ở 4
  màn, theo nhân viên ở 4 màn, công nợ khách ở 6 màn, lãi lỗ ở 4 màn.
- Có **5 kiểu chọn thời gian** khác nhau, và từ 0 đến khoảng 10 bộ lọc tuỳ màn.
- Tab con làm theo 3 cách khác nhau.

**Mục tiêu:** mỗi câu hỏi người dùng hay hỏi có đúng một màn. Tất cả dùng chung một khung, một
thanh lọc, một cách bấm để đào sâu.

| # | Màn | Câu hỏi nó trả lời | Đường dẫn |
|---|---|---|---|
| 1 | Tổng quan | Hôm nay / tháng này kinh doanh thế nào? | `/bao-cao` |
| 2 | Bán hàng | Bán được gì, cho ai, ai bán, đơn đặt ra sao? | `/bao-cao/ban-hang` |
| 3 | Cuối ngày | Hôm nay tiền, hàng, chứng từ có khớp không? | `/bao-cao/cuoi-ngay` |
| 4 | Kho | Kho còn gì, trị giá bao nhiêu, hàng nào sắp hết hạn / nằm lâu? | `/bao-cao/kho` |
| 5 | Công nợ | Ai đang nợ, nợ bao lâu, nhân viên nào đang giữ nợ? | `/bao-cao/cong-no` |
| 6 | Tài chính | Lãi lỗ, dòng tiền, tài sản — nợ phải trả? | `/bao-cao/tai-chinh` |

Báo cáo **Nhà cung cấp** (nhập hàng, công nợ NCC) chuyển về nhóm menu Mua hàng. **Hoa hồng** giữ
ở Nhân sự. Hai thứ này không nằm trong đợt thiết kế này.

---

## 1. Luật số liệu dùng chung (KHÔNG được sai)

Người thiết kế không cần tính các số này. Nhưng **nhãn và chú thích trên giao diện phải nói đúng
như dưới đây**. Mỗi chỉ số có một biểu tượng (i); di chuột hoặc chạm vào thì hiện định nghĩa
ngắn gọn.

| Chỉ số | Định nghĩa | Ghi chú hiển thị |
|---|---|---|
| **Doanh thu (bán ra)** | Tổng tiền các **hoá đơn đã ghi sổ**, theo **ngày hoá đơn** (giờ VN) | Không tính đơn đặt chưa xuất hoá đơn |
| **Hàng trả** | Tiền hàng trả (tiền ghi có cho khách), theo **ngày trừ doanh số** của phiếu trả | Hàng đổi không tính |
| **Doanh thu thuần** | Doanh thu − Hàng trả | Là số chính của mọi màn. Khớp với công nợ |
| **Giá vốn** | Giá vốn hàng đã xuất − giá vốn hàng trả đã nhập lại kho | Chỉ người có quyền "giá vốn" mới thấy |
| **Lãi gộp** | Doanh thu thuần − Giá vốn | Kèm **biên lãi** = Lãi gộp / Doanh thu thuần (%). Có quyền giá vốn mới thấy |
| **Số hoá đơn** | Số hoá đơn đã ghi sổ trong kỳ | |
| **Khách mua** | Số khách có ít nhất một hoá đơn trong kỳ | |
| **TB / hoá đơn** | Doanh thu thuần / Số hoá đơn | |
| **Số lượng** | Quy về **đơn vị cơ sở**, hiển thị kèm đơn vị lớn | Ví dụ `4 thùng (96 hộp)`. Không cộng lẫn thùng với hộp |
| **Đơn đặt** | Đơn hàng không huỷ, theo **ngày đặt** | Chỉ là số liệu hoạt động, **không phải doanh thu** |
| **Công nợ** | Σ(tiền phải thu − đã thu) các khoản chưa tất toán | Có thể **âm** (khách dư có) — hiện chữ "dư có", không bao giờ ép về 0 |
| **Nợ quá hạn** | Phần công nợ đã qua ngày hạn | |
| **Tuổi nợ** | Nhóm theo số ngày quá hạn: Trong hạn · 1–30 · 31–60 · 61–90 · Trên 90 ngày | |

**Quy ước chung:**
- Tiền chia nhóm 3 số bằng dấu chấm (`1.234.000`), không có phần lẻ. Riêng ô chỉ số và ô biểu đồ
  được rút gọn: `923 tr`, `1,2 tỷ`. Bảng số thì luôn ghi đủ.
- Ngày ghi `dd/MM/yyyy`, giờ ghi `HH:mm` (24 giờ).
- Số âm tô màu đỏ và có dấu trừ. Số tăng hoặc giảm so với kỳ trước có mũi tên kèm %.
- Màu **đỏ chỉ dùng cho lỗi và nợ quá hạn**. Tình trạng cần lưu ý dùng màu hổ phách.

---

## 2. Khung chung cho cả 6 màn

### 2.1 Menu

Nhóm menu mới **"Báo cáo tổng hợp"** đặt **trên** nhóm "Báo cáo" cũ, gồm 6 mục theo đúng thứ tự
ở bảng trên. Mỗi người chỉ thấy mục mình có quyền (xem mục 9). Trên điện thoại, nhóm này nằm
trong ngăn kéo menu, cùng chỗ với menu cũ.

### 2.2 Đầu trang

```
[Tên màn]                                   [Xuất Excel]
[Thanh lọc chung ─────────────────────────────────────]
[Đường đào sâu: Tổng quan › Tháng 9 › Tạp hoá Cô Ba ✕]
```

- **Tên màn** ghi rõ câu trả lời, ví dụ "Bán hàng". Không dùng tên kỹ thuật.
- **Xuất Excel** xuất đúng những gì đang thấy: đúng kỳ, đúng lọc, đúng chế độ xem, đúng cột đang
  bật. Chỉ hiện với người có quyền xuất file.
- **Đường đào sâu** chỉ hiện khi đã bấm đào sâu (mục 2.5).

### 2.3 Thanh lọc chung (một thiết kế cho cả 6 màn)

1. **Chọn kỳ** — một nút, bấm ra danh sách:
   - Hôm nay · Hôm qua · Tuần này · Tuần trước · **Tháng này** · Tháng trước · Quý này · Năm nay ·
     Tuỳ chỉnh (chọn từ ngày – đến ngày trên lịch).
   - "Tháng này" là **tháng lịch** (01/09 – hôm nay), không phải 30 ngày gần nhất.
   - Mặc định là **Tháng này**; riêng màn Cuối ngày mặc định là **Hôm nay**.
   - Nút ghi kỳ đang chọn kèm ngày cụ thể: `Tháng này · 01/09 – 26/09`.
2. **So với** — công tắc, mặc định bật: so với kỳ liền trước cùng độ dài. Tháng này (26 ngày)
   so với 26 ngày đầu tháng trước. Tắt đi thì mũi tên % biến mất.
3. **+ Thêm lọc** — mở danh sách các loại lọc của màn đó. Chọn xong, mỗi lọc đang bật hiện thành
   một **thẻ nhỏ** cạnh nút, ví dụ `Khách: Tạp hoá Cô Ba ✕` hoặc `Kênh: 2 kênh ✕`. Bấm vào thẻ
   để sửa, bấm ✕ để bỏ. Có nút **Bỏ hết lọc** khi có từ 2 thẻ trở lên.
   - Các loại lọc dùng chung: Khách hàng · Nhóm khách · Kênh / tuyến · Tỉnh · Nhân viên bán ·
     Mặt hàng · Nhóm hàng · Thương hiệu · Nhà cung cấp.
   - Mỗi lọc chọn được nhiều giá trị, có ô tìm, gõ không dấu vẫn tìm được.
   - Lọc nào không hợp với màn thì không có trong danh sách của màn đó (bảng ở từng màn).
4. **Trạng thái đọc số** — chữ nhỏ cuối thanh lọc: `Cập nhật 14:05`, kèm nút tải lại.

Kỳ, lọc và chế độ xem nằm trên **đường dẫn**. Gửi link cho người khác là họ thấy đúng như mình.

### 2.4 Chỉ số đầu màn (thẻ KPI)

- Một hàng 3–5 thẻ. Mỗi thẻ gồm: tên chỉ số + (i), số lớn, dòng so sánh `▲ 12% so với kỳ trước`
  (xanh hoặc đỏ tuỳ chiều tốt / xấu), và một đường nhỏ vẽ xu hướng theo ngày trong kỳ.
- **Bấm thẻ nào là đào sâu vào chỉ số đó** (mục 2.5).
- Điện thoại: 2 thẻ một hàng, vuốt ngang được khi có nhiều hơn 4 thẻ.

### 2.5 Bấm để đào sâu

Đây là thay đổi quan trọng nhất. **Con số nào cũng bấm được.** Bấm vào là mở ra phần chi tiết
tạo nên con số đó, với lọc đã đặt sẵn. Ví dụ:

`Tổng quan: Doanh thu thuần 923 tr` → `Bán hàng · Xem theo Thời gian · Tháng 9` → bấm ngày
`12/09` → `Xem theo Khách · ngày 12/09` → bấm `Tạp hoá Cô Ba` → `Xem theo Mặt hàng · ngày 12/09 ·
Cô Ba` → bấm một mặt hàng → danh sách hoá đơn.

- Mỗi bước thêm một mắt vào **đường đào sâu**. Bấm một mắt cũ là quay lại đúng bước đó.
- Bấm ✕ ở cuối là về trạng thái ban đầu của màn.
- Nút Quay lại của trình duyệt cũng lùi từng bước.
- **Điểm cuối luôn là chứng từ:** hoá đơn, phiếu trả, phiếu thu, phiếu kho. Bấm vào thì mở màn
  xem nhanh chứng từ đã có sẵn.

### 2.6 Chế độ "Xem theo" (dùng ở Bán hàng, Kho, Công nợ)

- Một hàng **nút chọn** ngay dưới thẻ KPI: `Xem theo: [Thời gian] [Mặt hàng] [Khách] …`.
- Trên điện thoại, hàng nút cuộn ngang được.
- Đổi chế độ xem thì **giữ nguyên kỳ và lọc**.

### 2.7 Bảng số liệu chuẩn

- Cột đầu là **tên chiều đang xem** (ngày, mặt hàng, khách…). Các cột sau là chỉ số, căn phải,
  chữ số thẳng cột.
- **Nút "Cột"** bật / tắt từng cột chỉ số. Mỗi màn có sẵn một bộ mặc định.
- Bấm tiêu đề cột để sắp xếp tăng / giảm. Mặc định sắp **Doanh thu thuần giảm dần**.
- **Dòng Tổng** ghim ở đầu bảng, ngay dưới tiêu đề — không để ở cuối.
- Có cột **% trên tổng**, vẽ kèm một thanh ngang mảnh trong ô.
- Nhiều dòng thì phân trang 50 dòng (máy tính) hoặc "Tải thêm 20" (điện thoại).
- **Điện thoại:** bảng chuyển thành **danh sách thẻ**. Mỗi thẻ có tên chiều, số chính (doanh thu
  thuần) nằm bên phải, 2–3 số phụ ở dòng dưới. Bấm thẻ để đào sâu.

### 2.8 Biểu đồ

- Chỉ vẽ khi biểu đồ nói được điều mà bảng không nói được. Mỗi màn tối đa **một biểu đồ chính**.
  - Theo thời gian: cột theo ngày / tuần / tháng tuỳ độ dài kỳ, thêm đường mảnh cho kỳ so sánh.
  - Theo chiều khác: thanh ngang top 10, phần còn lại gộp thành "Khác".
- Bấm vào cột hoặc thanh cũng đào sâu như bấm vào dòng bảng.

### 2.9 Trạng thái

| Trạng thái | Hiển thị |
|---|---|
| Đang tải | Khung xám nhấp nháy đúng hình dạng thẻ và bảng. **Không dùng vòng quay** |
| Không có số liệu | Một dòng chữ nói rõ lý do, kèm việc nên làm tiếp. Ví dụ: "Tháng này chưa có hoá đơn nào — đổi kỳ sang Tháng trước?" kèm nút |
| Lỗi đọc số | Hộp đỏ: đọc hỏng phần nào, nút Thử lại. **Không hiện số 0 thay cho lỗi** |
| Số liệu chưa đủ | Hộp hổ phách, ví dụ: "Số liệu quá lớn, đang hiện 10.000 dòng đầu — thu hẹp kỳ hoặc thêm lọc" |
| Không có quyền giá vốn | Ẩn hẳn cột và thẻ giá vốn, lãi gộp. Không để trống, không hiện "***" |

### 2.10 Điện thoại (≥ 360px)

- Thanh lọc gọn lại thành: nút kỳ + nút `Lọc (2)`. Bấm `Lọc (2)` mở bảng lọc từ dưới lên.
- Thẻ KPI 2 cột. Bảng chuyển thành danh sách thẻ. Biểu đồ cao tối đa 200px.
- Đường đào sâu rút gọn thành: `‹ Tạp hoá Cô Ba` (nút lùi một bước) + nút ✕.

---

## 3. Màn 1 — Tổng quan (`/bao-cao`)

**Câu hỏi:** Hôm nay / tháng này kinh doanh thế nào?
**Ai xem:** chủ NPP, quản lý, kế toán, thủ kho (theo quyền "Tổng quan").
**Thay cho:** Tổng quan (`/dashboard`), trang Báo cáo tổng (`/reports`), Phân tích kinh doanh.

**Bố cục (máy tính):**
1. Thanh lọc chung. Chỉ có **chọn kỳ + so sánh**, không có "Thêm lọc".
2. **Thẻ KPI:** Doanh thu thuần · Lãi gộp (kèm biên %) · Số hoá đơn · Khách mua · Công nợ phải thu
   (kèm dòng "trong đó quá hạn X").
3. **Biểu đồ chính:** Doanh thu thuần theo ngày (hoặc theo tuần, theo tháng nếu kỳ dài), có đường
   so sánh kỳ trước.
4. **Bốn khối "Top 5"** xếp 2×2:
   - Mặt hàng · Khách hàng · Nhân viên · Kênh.
   - Mỗi dòng có tên, doanh thu thuần, thanh %.
   - Dòng cuối mỗi khối ghi "Xem tất cả →", mở màn Bán hàng ở đúng chế độ xem đó.
5. **Hàng số nhanh (chỉ đọc, bấm được):**
   - Đơn đặt chưa xuất hoá đơn (số đơn, giá trị) → Bán hàng › Đơn đặt.
   - Giá trị tồn kho → Kho.
   - Hàng sắp hết hạn (số lô) → Kho › Sắp hết hạn.
   - Nợ quá hạn (số khách) → Công nợ › Tuổi nợ.

**Điện thoại:** các khối xếp dọc: KPI → biểu đồ → Top (4 tab nhỏ đổi qua lại) → số nhanh.

**Để sau:** khối "Cần chú ý" (tự viết câu nhận xét). Chủ nhà chưa làm đợt này; giữ **chỗ trống
có tên** trong thiết kế để sau này chèn vào dưới hàng KPI.

---

## 4. Màn 2 — Bán hàng (`/bao-cao/ban-hang`)

**Câu hỏi:** Bán được gì, cho ai, ai bán, đơn đặt ra sao?
**Ai xem:** mọi người có quyền "Báo cáo bán hàng". **NVBH chỉ thấy số của chính mình** (hệ thống
tự khoá lọc nhân viên vào người đang đăng nhập, không bỏ được).
**Thay cho:**
- Báo cáo Bán hàng (5 tab)
- Hàng hoá (tab bán hàng, lợi nhuận)
- Khách hàng (tab bán hàng, lợi nhuận, hàng bán theo khách)
- Nhân viên (5 tab)
- Kênh bán hàng
- **Đặt hàng** (gộp vào đây)
- Phân tích hàng hoá, khách hàng, phân loại

### 4.1 Nguồn số

Công tắc ở đầu màn: **[Hoá đơn] [Đơn đặt]**. Mặc định: Hoá đơn.
- **Hoá đơn:** số bán thật (mục 1). Dùng cho doanh thu, lãi, hoa hồng.
- **Đơn đặt:** số đơn nhân viên đã đặt (theo ngày đặt), kể cả chưa xuất hoá đơn. Có thêm các
  cột Đã xuất / Chưa xuất.
  - Khi đang ở chế độ này, **đầu màn có băng hổ phách** ghi: "Đây là số đơn đặt — không phải
    doanh thu".
  - Ở chế độ Đơn đặt không có cột lãi.

### 4.2 Thẻ KPI

- **Hoá đơn:** Doanh thu thuần · Hàng trả · Lãi gộp (biên %) · Số hoá đơn · TB / hoá đơn.
- **Đơn đặt:** Số đơn · Giá trị đặt · Đã xuất hoá đơn · Chưa xuất · Tỷ lệ xuất (%).

### 4.3 Xem theo

`Thời gian · Mặt hàng · Nhóm hàng · Thương hiệu · Khách · Nhóm khách · Kênh · Tỉnh · Nhân viên`

| Xem theo | Cột mặc định (nguồn Hoá đơn) | Cột bật thêm được | Đào sâu khi bấm dòng |
|---|---|---|---|
| Thời gian (ngày / tuần / tháng tự chọn theo độ dài kỳ) | Doanh thu · Trả · Thuần · Số HĐ | Lãi gộp, Biên %, Khách mua, TB/HĐ | → Khách, trong ngày đó |
| Mặt hàng | Số lượng (đv cơ sở + đv lớn) · Thuần · % tổng | Trả (SL, tiền), Lãi gộp, Biên %, Giá bán TB, Số khách mua | → Khách đã mua mặt hàng đó |
| Nhóm hàng / Thương hiệu | Thuần · % tổng · Số mặt hàng bán được | Lãi gộp, Biên % | → Mặt hàng trong nhóm |
| Khách | Thuần · Số HĐ · Lần mua cuối | Trả, Lãi gộp, Công nợ hiện tại, Nhân viên phụ trách | → Mặt hàng khách đã mua |
| Nhóm khách / Kênh / Tỉnh | Thuần · Số khách mua · TB/khách | Lãi gộp | → Khách trong nhóm |
| Nhân viên | Thuần · Số HĐ · Số khách · Chỉ tiêu tháng · % đạt | Trả, Lãi gộp, Chênh giá niêm yết | → Khách của nhân viên đó |

Nguồn **Đơn đặt** dùng cùng các chế độ xem. Cột thay bằng: Số đơn · Giá trị đặt · Đã xuất ·
Chưa xuất.

### 4.4 Lọc có trong "+ Thêm lọc"

Khách · Nhóm khách · Kênh · Tỉnh · Nhân viên · Mặt hàng · Nhóm hàng · Thương hiệu · Nhà cung cấp ·
Bảng giá. Riêng nguồn Đơn đặt có thêm **Trạng thái đơn**.

### 4.5 Khối phụ (hiện dưới bảng, gập / mở được)

- **Hàng trả trong kỳ:** danh sách phiếu trả, gồm lý do, tiền, loại tự sinh / tự lập.
- **Giảm giá trên hoá đơn:** tổng tiền giảm giá, theo nhân viên.

Hai khối này thay cho tab "Trả hàng" và "Giảm giá HĐ" cũ.

**Điện thoại:** công tắc nguồn và "Xem theo" nằm ở hai hàng cuộn ngang. Danh sách thẻ theo mục
2.7.

---

## 5. Màn 3 — Cuối ngày (`/bao-cao/cuoi-ngay`)

**Câu hỏi:** Hôm nay tiền, hàng, chứng từ có khớp không?
**Ai xem:** chủ NPP, quản lý, kế toán, thủ kho (theo quyền "Báo cáo cuối ngày").
**Thay cho:** Báo cáo cuối ngày hiện tại (giữ nội dung, làm theo khung chung).

- **Chọn kỳ** chỉ chọn **một ngày**: nút ‹ ngày trước · `Hôm nay 26/09` · ngày sau ›.
- **Lọc:** Nhân viên · Người tạo · Khách · Hình thức thanh toán.
- **Thẻ KPI:** Đơn tạo · Hoá đơn đã xuất · Doanh thu · Hàng trả · Doanh thu thuần · Lãi gộp.
- **Khối "Tiền trong ngày"** (quan trọng nhất với kế toán):
  - Tiền mặt thu · Chuyển khoản thu · Chi trong ngày · **Tồn quỹ cuối ngày**.
  - Bấm vào từng dòng để ra danh sách phiếu thu / phiếu chi.
- **Khối "Trạng thái đơn hôm nay":** số đơn theo từng trạng thái (Phiếu tạm, Hoàn thành…). Bấm
  để ra danh sách đơn.
- **Khối "Theo nhân viên":** mỗi nhân viên một dòng gồm số đơn, doanh thu thuần, tiền đã thu.
  Dùng để đối chiếu khi nhân viên nộp tiền.
- Nút **In báo cáo cuối ngày** (khổ A5, như các mẫu in hiện có).

**Điện thoại:** các khối xếp dọc; khối Tiền đứng ngay dưới KPI.

---

## 6. Màn 4 — Kho (`/bao-cao/kho`)

**Câu hỏi:** Kho còn gì, trị giá bao nhiêu, hàng nào sắp hết hạn / nằm lâu?
**Ai xem:** chủ NPP, quản lý, kế toán, thủ kho (quyền "Báo cáo tồn kho"). Cột **giá trị / giá
vốn** chỉ người có quyền giá vốn mới thấy.
**Thay cho:**
- Hàng hoá (tab giá trị kho, xuất nhập tồn, XNT chi tiết)
- Báo cáo tồn kho
- Phân tích tồn kho

**Thẻ KPI:** Giá trị tồn · Số mặt hàng còn hàng · Lô sắp hết hạn (≤ 30 ngày) · Mặt hàng tồn thấp ·
Hàng chậm bán.

**Xem theo:**

| Xem theo | Nội dung | Đào sâu |
|---|---|---|
| **Tồn hiện tại** (mặc định, không theo kỳ) | Mặt hàng · Tồn (đv cơ sở + đv lớn) · Giá trị · Số lô · HSD gần nhất | → Các lô của mặt hàng → thẻ kho |
| **Xuất – nhập – tồn** (theo kỳ) | Mặt hàng · Tồn đầu · Nhập · Xuất bán · Trả về · Xuất khác · Tồn cuối (SL và tiền) | → Phiếu kho của mặt hàng trong kỳ |
| **Sắp hết hạn** | Lô · Mặt hàng · HSD · Còn bao nhiêu ngày · SL · Giá trị | → Lô |
| **Tồn thấp** | Mặt hàng · Tồn · Bán TB / ngày (30 ngày) · Đủ bán bao nhiêu ngày | → Mặt hàng |
| **Chậm bán** | Mặt hàng · Tồn · Ngày bán gần nhất · Số ngày bán hết theo tốc độ hiện tại | → Mặt hàng |
| **Nhóm hàng / Thương hiệu / NCC** | Giá trị tồn · % tổng · Số mặt hàng | → Mặt hàng trong nhóm |

**Ngưỡng mặc định (người thiết kế ghi chú dạng "có thể chỉnh"):**
- Sắp hết hạn: ≤ 30 ngày.
- Tồn thấp: đủ bán < 7 ngày.
- Chậm bán: 30 ngày không bán, hoặc cần > 90 ngày mới bán hết.

**Lọc:** Mặt hàng · Nhóm hàng · Thương hiệu · Nhà cung cấp.
**Biểu đồ:** chỉ ở chế độ Xuất – nhập – tồn, vẽ giá trị tồn theo ngày.

---

## 7. Màn 5 — Công nợ (`/bao-cao/cong-no`)

**Câu hỏi:** Ai đang nợ, nợ bao lâu, nhân viên nào đang giữ nợ?
**Ai xem:** mọi người có quyền Công nợ khách. **NVBH chỉ thấy khách của mình**, và không có chế độ
"Theo nhân viên".
**Thay cho:**
- Công nợ theo khách, theo nhân viên
- Phân tích công nợ
- Khách hàng (tab công nợ)
- Màn "Tuổi nợ" (thật ra là sổ chi tiết)

**Công nợ là số tại một thời điểm, không phải số theo kỳ.** Vì vậy chọn kỳ ở đây đổi thành
**"Tính đến ngày"** (mặc định hôm nay). Bộ chọn này chỉ có ở màn Công nợ.

**Thẻ KPI:** Tổng phải thu · Quá hạn (số tiền, % tổng) · Số khách đang nợ · Khách vượt hạn mức ·
Dư có (tổng tiền khách trả dư).

**Xem theo:**

| Xem theo | Cột | Đào sâu |
|---|---|---|
| **Khách** (mặc định) | Khách · Nhân viên phụ trách · Công nợ · Quá hạn · Hạn mức · Ngày quá hạn lâu nhất · Lần thu cuối | → **Sổ chi tiết** của khách: từng hoá đơn / phiếu trả / phiếu thu, nợ – có – số dư chạy |
| **Tuổi nợ** | Nhóm: Trong hạn · 1–30 · 31–60 · 61–90 · > 90 ngày — số khách, số tiền, thanh % | → Khách trong nhóm |
| **Nhân viên** | Nhân viên · Công nợ · Quá hạn · Tỷ lệ thu trong tháng · Số ngày thu tiền TB (DSO) | → Khách của nhân viên |
| **Hoá đơn** | Mã hoá đơn · Khách · Ngày · Hạn · Còn phải thu · Quá hạn bao nhiêu ngày | → Xem nhanh hoá đơn (có nút Thu tiền) |

**Lọc:** Khách · Nhân viên · Kênh · Tỉnh · **Tình trạng** (Quá hạn / Vượt hạn mức / Dư có).

**Biểu đồ:** thanh ngang theo nhóm tuổi nợ, xếp chồng trong hạn → quá hạn, màu nhạt dần tới
đỏ ở nhóm trên 90 ngày.

**Lưu ý nghiệp vụ:**
- Công nợ luôn **theo hoá đơn**, không theo đơn đặt.
- Khoản âm hiện ở dạng "dư có", tô màu xanh dương nhạt, không bao giờ ép về 0.

---

## 8. Màn 6 — Tài chính (`/bao-cao/tai-chinh`)

**Câu hỏi:** Lãi lỗ, dòng tiền, tài sản — nợ phải trả?
**Ai xem:** chủ NPP, quản lý, kế toán (quyền "Báo cáo tài chính").
**Thay cho:** Tài chính và 3 màn con trùng (Lãi lỗ, Lưu chuyển tiền, Cân đối). Chỉ còn **một
bản** cho mỗi báo cáo.

Ba tab: **[Kết quả kinh doanh] [Dòng tiền] [Tài sản – Nguồn vốn]**.

1. **Kết quả kinh doanh** (theo kỳ) — dạng bảng bậc thang:
   ```
   Doanh thu bán ra
   − Hàng trả
   = Doanh thu thuần
   − Giá vốn
   = Lãi gộp                (biên %)
   − Chi phí (theo từng nhóm: lương, vận chuyển, mặt bằng, khác…)
   = Lãi thuần              (biên %)
   ```
   Có cột kỳ này · kỳ trước · chênh lệch. Bấm một dòng để ra chi tiết (danh sách chi phí, hoặc
   Bán hàng theo thời gian). Có công tắc **"Theo tháng"** để trải 12 tháng thành 12 cột.
2. **Dòng tiền** (theo kỳ):
   ```
   Tồn quỹ đầu kỳ
   + Thu từ khách (tiền mặt, chuyển khoản)
   − Trả nhà cung cấp
   − Chi phí
   = Tồn quỹ cuối kỳ
   ```
   Biểu đồ cột thu / chi theo tuần.
3. **Tài sản – Nguồn vốn** (tại một ngày, dùng bộ chọn "Tính đến ngày"):
   - Tài sản: Tiền · Phải thu khách · Hàng tồn kho.
   - Nguồn vốn: Phải trả NCC · Vốn chủ (phần chênh).

**Không có "Thêm lọc".** Tài chính là số toàn NPP.

---

## 9. Quyền (dùng khoá quyền đang có, không tạo khoá mới)

| Màn | Khoá quyền | Chủ | Quản lý | Kế toán | Thủ kho | NVBH |
|---|---|---|---|---|---|---|
| Tổng quan | Tổng quan | ✓ | ✓ | ✓ | ✓ | — |
| Bán hàng | Báo cáo bán hàng | ✓ | ✓ | ✓ | ✓ | ✓ (chỉ của mình, không lãi) |
| Cuối ngày | Báo cáo cuối ngày | ✓ | ✓ | ✓ | ✓ | — |
| Kho | Báo cáo tồn kho | ✓ | ✓ | ✓ | ✓ | — |
| Công nợ | Công nợ KH | ✓ | ✓ | ✓ | — | ✓ (khách của mình) |
| Tài chính | Báo cáo tài chính | ✓ | ✓ | ✓ | — | — |

Cột và thẻ **giá vốn / lãi gộp / giá trị tồn** theo quyền "Giá vốn, giá trị tồn, lãi gộp".
Nút **Xuất Excel** theo ô "Xuất file" của ma trận quyền.

---

## 10. Danh sách khung cần thiết kế (checklist cho người thiết kế)

Mỗi mục dưới đây cần một khung **máy tính (1440px)** và một khung **điện thoại (390px)**, trừ
khi có ghi chú khác.

1. Khung chung, gồm:
   - Thanh lọc (đóng, mở chọn kỳ, mở "+ Thêm lọc", có 3 thẻ lọc).
   - Đường đào sâu.
   - Bảng mở chọn cột.
   - Bảng lọc trên điện thoại (bảng kéo từ dưới lên).
2. Tổng quan.
3. Bán hàng:
   - Hoá đơn, xem theo Thời gian.
   - Hoá đơn, xem theo Khách, **đang đào sâu 2 bước**.
   - Đơn đặt, xem theo Nhân viên (có băng hổ phách).
   - NVBH đang xem (lọc nhân viên bị khoá).
4. Cuối ngày.
5. Kho: Tồn hiện tại · Xuất – nhập – tồn · Sắp hết hạn.
6. Công nợ: Theo khách · Tuổi nợ · Sổ chi tiết một khách.
7. Tài chính: 3 tab (điện thoại chỉ cần tab Kết quả kinh doanh).
8. Các trạng thái (mục 2.9) vẽ trên một màn bất kỳ: đang tải · không có số · lỗi · số chưa đủ.

**Phong cách:**
- Theo hệ màu và chữ đang dùng ở npp.sale (xanh chủ đạo `#2563eb`, bo góc 12px, chữ số thẳng
  cột).
- Các màn điện thoại mới (Đơn hàng, Khách hàng) dùng đầu trang xanh + thẻ trắng nổi lên. Báo cáo
  trên điện thoại **nên đi theo cùng ngôn ngữ đó**.

---

## 11. Chưa làm trong đợt này

- Khối **"Cần chú ý"** (tự viết nhận xét) — chủ nhà chưa làm. Giữ chỗ ở Tổng quan.
- **Ghim báo cáo hay xem** lên Trang chủ — đợt sau.
- Báo cáo Nhà cung cấp và Hoa hồng — giữ ở chỗ cũ.
- **Gỡ các báo cáo cũ** — chỉ làm khi 6 màn mới đã chạy ổn và chủ nhà đồng ý.
