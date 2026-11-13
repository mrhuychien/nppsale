# npp.sale — quy tắc dự án

ERP nhà phân phối (Next.js 14 + Supabase + Tailwind/shadcn). Trả lời chủ nhà bằng **tiếng Việt**.
Quy tắc giao diện: `.claude/skills/design-ux-ui/SKILL.md`.

## 1. Nghiệp vụ — KHÔNG ĐƯỢC LÀM SAI

### Công nợ tính theo HÓA ĐƠN, không theo đơn hàng
Chủ nhà chốt 24/09/2026: *"công nợ đang tính theo đơn hàng, phải tính theo Hoá đơn mới đúng"*.
- Nguồn sự thật duy nhất của công nợ phải thu là bảng `receivables`: **mỗi hóa đơn đã ghi sổ
  (`sales_invoices.status = 'posted'`) một phiếu**, qua `_wf2b_recompute_receivable(invoice_id)`.
  Nợ đầu kỳ (`opening_balance`) là phiếu không có hóa đơn.
- **Không bao giờ** lấy `sales_orders.total` làm số nợ, cộng tổng đơn "Hoàn thành" làm bên Nợ, hay
  tạo / cập nhật `receivables` theo `order_id` (`ensureReceivableForOrder`, `recomputeReceivableForOrder`
  là luồng cũ — đã khoá).
- Đơn nhiều hóa đơn = nhiều phiếu công nợ: **gộp** (`gopCongNoCuaDon` / `gopCongNoTheoDon` trong
  `src/lib/orders/receivable-sum.ts`), không lấy dòng đầu / dòng cuối.
- Nhãn và liên kết của một khoản nợ là **mã hóa đơn** (`/sales-invoices/<id>`); mã đơn chỉ là thông
  tin phụ.
- Nợ của khách = Σ(`amount − paid`) trên các phiếu `status <> 'paid'` — dùng `loadCustomerDebt`
  (`src/lib/pos/load.ts`) hoặc `loadDebtByCustomer` (`src/lib/sell/debt.ts`), đừng tự viết lại.
- Kiểm hạn mức = **nợ sẵn có + đơn này** so với `credit_limit`.

### Doanh thu tính theo HÓA ĐƠN
Chủ nhà chốt 24/09/2026: *"làm tiếp phần doanh thu tính theo hoá đơn"*.
- Doanh thu = Σ `sales_invoices.total` của hóa đơn **`status = 'posted'`**
  (`is_revenue_invoice_status`), theo **`invoice_date`**; theo mặt hàng thì từ `sales_invoice_lines`
  của hóa đơn đã ghi sổ. Như `dashboard_summary` (mig 126).
- **Không** cộng `sales_orders.total` (đơn "Hoàn thành") làm doanh thu. Đơn hàng chỉ dùng cho số
  liệu HOẠT ĐỘNG (số đơn đã đặt, nháp…).
- `invoice_date` là DATE: so bằng ngày theo giờ VN (`vnDateKey`), không so với mốc ISO/UTC.
- **Doanh số THUẦN = hàng đi − hàng trả** (chủ nhà 25/09/2026, mig 192: *"Rà soát lại toàn bộ doanh số
  tính bằng số đi - số trả"*). Hàng trả trừ theo `returns.revenue_date` — **một luật khớp công nợ**:
  phiếu tự sinh theo HĐ trừ vào ngày HĐ (kể cả khi còn Chờ xử lý), phiếu tự lập trừ vào ngày hoàn thành;
  số tiền `credit_note_amount` (hàng đổi không tính). Dùng `fetchReturnsRowsDu` / `fetchReturnLines` /
  `fetchReturnCosts` (`src/lib/analytics/sales.ts`), `traTheoHoaDon` / `traCuaKhach`
  (`src/lib/analytics/net-revenue.ts`). Lãi gộp = doanh thu thuần − (giá vốn − giá vốn hàng trả đã nhập kho).
  Tiền của một hóa đơn trong danh sách là **số còn lại** sau hàng trả.

### Chênh lệch giá của nhân viên
Chủ nhà chốt lại 01/10/2026 (thay luật "giá lúc bán" của mig 218): *"hiện tại chỉ có 1 giá bán ra. Cách
tính chênh lệch: Hàng đi: lấy số liệu trên hóa đơn. Giá trên hóa đơn so với giá trên bảng giá (lưu ý phải
cùng đơn vị tính) x số lượng"*.
- Chênh = SL × (đơn giá trên HĐ − giá bảng của **đúng đơn vị dòng**), **trước thuế**. Bán thùng so với giá
  thùng (`giaNiemYetDonVi`), không lấy giá lon × hệ số khi thùng có giá riêng.
- Hàng trả là hàng đi **tính âm** (chủ nhà 03/11/2026: *"phần chênh lệch trả tính sai: phải là giá trị âm"*): chênh trả =
  (−SL trả) × (đơn giá phiếu trả − giá bảng cùng đơn vị) = giá bảng hàng trả − tiền trả (`chenhTra` / `chenhTraDong`). Trả lại
  đúng giá đã bán trên bảng giá → **âm** (thu hồi); bán dưới bảng giá rồi trả → dương. **Chênh thuần = chênh bán + chênh trả**
  (chủ nhà 12/10/2026, thay "bán − trả": *"Giá trị này npp đã trả cho nhân viên nên giờ cần thu hồi"*) — `chenhThuan`. Bản 12/10
  giữ dấu hàng đi (`chenhDong` cho dòng trả) nên trả cùng giá ra dương, chênh net đội lên — đừng quay lại.
- Ở "Hàng bán theo nhân viên" cột thuần tên là **Doanh thu net / Chênh lệch net** (chủ nhà 03/11/2026) — bảng, chi tiết, Excel.
- **Báo cáo tổng hợp › Nhân viên** (`/bao-cao/nhan-vien`, chủ nhà 03/11/2026: *"Lôi cho tao riêng báo cáo này ra ngoài menu BÁO
  CÁO TỔNG HỢP > Nhân viên (Lưu ý khi bấm vào từng nhân viên xem được chi tiết như bên báo cáo)"*) là CHÍNH trang Báo cáo › Nhân
  viên chạy ở đường dẫn khác: `laManHangBanNv(usePathname())` → chỉ "Hàng bán theo nhân viên", ẩn ô Mối quan tâm
  (`anMoiQuanTam`), không đọc giá vốn. Đừng chép bảng sang màn khác (hai bản = hai con số). Cùng ô quyền `reports.employees`.
  Màn này không có đầu trang xanh + ☰ riêng → `hidesMobileAppBar` chừa nó ra (ẩn là điện thoại mất menu lẫn nút lùi).
- Giảm giá cả đơn là cột riêng. Một luật cho hai báo cáo: `chenhDong` trong `src/lib/analytics/chenh-lech.ts`.
- **Tổng chênh lệch = chênh thuần − giảm giá đơn** (chủ nhà 12/10/2026), chỉ ở cấp nhân viên — `tongChenhLech`.
- **Doanh thu dòng nhân viên là TIỀN HOÁ ĐƠN** (gồm VAT, sau giảm giá đơn, làm tròn — khớp công nợ, `chotTienChungTu`), chênh
  tính trước thuế theo dòng nên "Doanh thu − Theo bảng giá" KHÔNG bằng "Chênh lệch bán". Chủ nhà 29/10/2026 chốt giữ Doanh thu
  khớp công nợ và thêm cột **Thuế + làm tròn** = tiền chứng từ − Σ `line_total` + giảm giá đơn (`thueLamTronNv`), ở cả hai
  báo cáo: Doanh thu − Theo bảng giá = Chênh lệch bán − Giảm giá đơn + Thuế + làm tròn. Đừng đổi Doanh thu về cộng dòng.

### Quy đổi đơn vị trong báo cáo
Chủ nhà 24/09/2026 (SP001945: giá niêm yết theo đơn vị cơ sở × SL theo đơn vị trung gian).
- Cộng / hiện số lượng qua nhiều dòng → quy về **đơn vị cơ sở** trước (`soLuongCoSo`,
  `heSoQuyDoi` trong `src/lib/analytics/units.ts`; ưu tiên hệ số chụp trên dòng).
- SL gộp nhiều mặt hàng hiện **theo từng đơn vị cơ sở** ("640 hộp · 12 chai", `hienSLTheoDonVi`) — trừ **phần tổng hợp của
  Hàng bán theo nhân viên** (chủ nhà 03/11/2026: *"cột số lượng bán tổng hợp số lượng và ghi 'đơn vị' ko cần diễn giải chi tiết
  ở phần tổng hợp"*): dòng nhân viên, dòng tổng, dòng "(Tổng hợp)" của Excel là MỘT số Σ quy về đơn vị cơ sở (`hienTongSL` /
  `tongSoSL`) + cột Đơn vị ghi `DON_VI_TONG` ("đơn vị"); chi tiết mở ra vẫn theo từng đơn vị tính của dòng.
- Tiền = SL × giá thì giá phải là giá **của đúng đơn vị đó** (`giaNiemYetDonVi`).
- `unit_cost` (kho) là giá **mỗi đơn vị cơ sở**.
- Doanh số theo hóa đơn; báo cáo Đặt hàng theo đơn hàng.
- **Sửa HĐ giữ hệ số của tờ cũ** (chủ nhà 16/10/2026, mig 247: *"đổi hệ số quy đổi trong danh mục … rồi Sửa một hoá đơn
  cũ, thì tờ mới lấy hệ số mới chứ không giữ số cũ"*): dòng cùng mặt hàng + đơn vị với tờ cũ lấy hệ số **chụp trên tờ cũ**;
  đơn vị / hàng mới tra danh mục; HĐ mới tra danh mục (mig 174). Máy chủ không tin hệ số trình duyệt gửi — tờ cũ đi qua
  cờ phiên `npp.he_so_tu_hd` do `reissue_invoice` đặt (`_chuan_he_so_dong_hoa_don(lines, hd_cu)`).

### Một đơn một hóa đơn; huỷ HĐ = huỷ đơn
Chủ nhà chốt 30/09/2026 (mig 217): *"Khi hủy hóa đơn -> coi như đóng đơn hàng -> Chuyển luôn đơn hàng về
trạng thái Đã hủy … đơn nào xuất xong coi như xong (hoàn thành) -> ko còn trạng thái Xuất 1 phần và đã đóng"*.
- Xuất HĐ (kể cả giao thiếu) → đơn **Hoàn thành**; không có HĐ thứ hai (chỉ mục `uq_sales_invoices_mot_don_mot_hd`).
  Không còn `partially_invoiced` / `closed` / Đóng đơn (`close_order` → `ORDER_CLOSE_REMOVED`).
- **Huỷ HĐ** → đơn **Đã huỷ**, phiếu trả Nháp / Chờ xử lý của đơn và HĐ **Đã huỷ** (không về Nháp).
- **Sửa HĐ** (`reissue_invoice`) KHÔNG huỷ đơn — cờ `npp.reissue_chuyen_thu` phân biệt hai đường.

### Sửa hoá đơn đổi được khách hàng
Chủ nhà 12/11/2026 (mig 261): *"E sửa phần sửa hoá đơn cho phép đổi khách hàng (cả trên đt và pos)"*.
- Màn Sửa HĐ gửi `customer_id` chỉ khi đã chọn khách KHÁC (`khachGuiLen`, `src/lib/pos/invoice-edit.ts`): POS — thẻ khách có
  "Đổi khách F4" + `SearchDropdown`; điện thoại — nút "Đổi khách" → `ChonKhachSheet` (`src/components/customers/chon-khach-sheet.tsx`,
  dùng chung với phiếu trả; sổ khách tải lúc mở hộp). Xuất hàng vẫn theo khách của đơn (thẻ chỉ đọc).
- Máy chủ (`_doi_khach_lap_lai_kiem` ngay sau `_mac_dinh_lap_lai`, `_doi_khach_lap_lai_ap` ngay trước `post_invoice`): tờ mới,
  **đơn** (`trg_sales_orders_bump_edit` tăng số sửa — DH-…-n) và mọi phiếu trả sẽ bám tờ mới (theo đơn, tự lập gắn tờ, đã nhập kho
  giữ nguyên — mig 210) sang khách mới. Phiếu bám hoá đơn phải cùng khách (`_phieu_tra_dung_khach_hoa_don`) nên đổi lúc chúng đang
  KHÔNG bám tờ nào (tờ cũ đã huỷ) — đổi sớm hơn là INVOICE_CUSTOMER_MISMATCH. Tờ cũ giữ khách cũ. NV bán + người giữ nợ không đổi
  (nhầm khách không đổi ai đã bán). Nhật ký đơn: `edit_after_complete` kèm `doi_khach` (tên cũ → mới) — trang đơn hiện "Đổi khách".
- **Đã thu tiền thì KHÔNG đổi khách** (`REISSUE_DOI_KHACH_DA_THU`, cùng phép kiểm "đã thu" của `cancel_invoice`): mig 184 chuyển tiền
  thu sang tờ mới — đổi khách là chuyển tiền người này sang nợ người khác; huỷ phiếu thu trước. Màn khoá trước bằng `khoaDoiKhach`
  (đọc phiếu thu hỏng cũng khoá). Khách mới phải cùng NPP và người sửa NHÌN THẤY được (cùng điều kiện `customer_select` —
  `REISSUE_KHACH_KHONG_HOP_LE`; hàm SECURITY DEFINER, RLS không tự chặn).
- Dòng cũ giữ giá; dòng thêm / hàng trả thêm theo bảng giá nhóm của khách mới (như đổi khách ở màn đơn).
- Sổ chưa chạy mig 261 thì `reissue_invoice` cũ lặng lẽ bỏ qua `customer_id` (preview và production chung sổ): `reissueInvoice`
  hỏi lại khách của tờ mới, lệch → `canhBaoKhach` báo đỏ (POS không tự đóng).
- Điện thoại: `/sales-invoices/new` + `/sales-invoices/:id/edit` KHÔNG có thanh nav (`laManHoaDonDienThoai`,
  `src/lib/nav/mobile-chrome.ts`) — nav (z-40) từng đè kín thanh "Xuất hàng / Lập lại" (z-30), nút lưu không bấm được.
- Bộ thử: `scripts/sql/thu-261-sua-hd-doi-khach.sql` (17 bước, luồng thật), `tests/sua-hd-doi-khach.test.ts`,
  `e2e/sua-hd-doi-khach.spec.ts`.

### Chuyến giao
Chủ nhà 24/09/2026: không dùng chuyến giao nữa — không làm thêm gì cho luồng chuyến giao.

### Công nợ ÂM khi hàng trả nhiều hơn hàng xuất
Chủ nhà chốt 24/09/2026 (mig 186): phần hàng trả vượt tiền hóa đơn phải ghi thành **công nợ âm**,
không được kẹp về 0.
- `receivables.amount < 0` là **dư có** của khách: vẫn `'open'` tới khi dùng hết (trigger
  `trg_cong_no_am_trang_thai`), được trừ vào tổng nợ, được rút ở phiếu thu (`paid − amount`).
- **Không** kẹp từng dòng về 0 khi cộng nợ (`Math.max(0, amount − paid)` là sai).
- Trạng thái công nợ do **một trigger** quyết (`_cong_no_am_trang_thai`, mig 212): `'paid'` chỉ khi
  |amount − paid| < 0,01; khách **trả dư** (paid > amount) là `'open'` — dư có, được trừ vào tổng nợ.
- Tiền / công nợ / phiếu thu / trạng thái phiếu trả **không ghi thẳng** được từ trình duyệt (mig 214) —
  chỉ nợ đầu kỳ chưa thu, xác nhận phiếu thu, phiếu trả Nháp là ghi thẳng được.
- Màn thu tiền không liệt kê dòng âm (không phải khoản để thu).
- POS: "Khách cần trả" vẫn kẹp 0; phần vượt hiện dòng "Ghi có cho khách (công nợ âm)"
  (`tachPhaiTra` trong `src/lib/pos/totals.ts`).

### Phiếu trả TỰ SINH (theo hóa đơn) và phiếu trả TỰ LẬP
Chủ nhà chốt 25/09/2026 (mig 191).
- **Tự sinh** (`returns.credit_with_invoice`, đơn có hàng đổi trả khi xuất hóa đơn): công nợ trừ vào
  hóa đơn **ngay lúc xuất**; phiếu chỉ treo nhập kho ở **Chờ xử lý**. Không sửa ở phiếu — sửa từ hóa
  đơn. Chờ xử lý thì **không huỷ**; đã nhập kho thì huỷ = đảo kho, phiếu **về Chờ xử lý**, nợ giữ nguyên.
- Sửa hóa đơn có phiếu tự sinh đã nhập kho → hỏi "Cần huỷ phiếu nhập trước?" (mig 210). **Có** = huỷ
  phiếu nhập, sửa, lập lại → phiếu **về Chờ xử lý** (không tự nhập kho lại — chủ nhà 28/09/2026, mig 216);
  **Không** = giữ phiếu nhập, gắn sang tờ mới.
- **"Chờ xử lý" chỉ có ở phiếu tự sinh.** Phiếu tự lập đi Nháp → Hoàn thành → Đã huỷ.
- **Tự lập**: hoàn thành = nhập kho **và** trừ nợ cùng lúc (gắn HĐ → trừ vào HĐ; không gắn → dòng công nợ
  âm `receivables.return_id`, `_cong_no_phieu_tra`). Sửa / huỷ luôn được — kể cả khi tiền đã thu /
  dư có đã dùng: nợ tự tăng lại. Không cấn trừ phiếu trả ở phiếu thu nữa (trừ hai lần).
- Luật ở giao diện: `hanhDongPhieuTra` (`src/lib/returns/loai-phieu.ts`). Quét sổ: `scripts/sql/kiem-phieu-tra.sql`.

### Màn POS phiếu nhập / phiếu trả NCC
Chủ nhà 13/10/2026: *"Sao sửa phiếu nháp -> ra màn post lại hiện trạng thái đã xuất kho và ko có nút lưu nháp tiếp"*.
- Nhãn + nút theo **trạng thái thật** của phiếu (`manPhieuNcc`, `src/lib/pos/purchase.ts`), không theo đường dẫn `/sua` —
  nút "Sửa" của phiếu nháp cũng đi đường ấy. Nháp: NHÁP + Lưu nháp / Lưu tạm. Đã ghi nhận: **không** có nút lưu nháp
  (trả NCC: lưu nháp = huỷ phiếu, rút hàng về kho). Sửa phiếu trả NCC đã xuất giữ nguyên số phiếu (huỷ rồi xuất lại).

### Công nợ NCC: dư nợ hiện tại
Chủ nhà 08/11/2026: *"Phần công nợ NCC : Công nợ chưa có cột dư nợ hiện tại"*.
- Dư nợ hiện tại của một NCC = Σ(`amount − paid`) trên các khoản `status <> 'paid'`, **không kẹp dòng âm** (phiếu trả NCC, tiền
  trả trước — mig 231 / 242): âm = NCC còn nợ lại mình. Một số ở ba nơi: cột "Dư nợ hiện tại" của `/payables` (mỗi dòng là
  MỘT chứng từ — cột này là tổng của cả NCC dòng ấy, không theo ô tìm / lọc / trang), cột cùng tên ở Theo NCC
  (`payables_by_supplier.remaining`, trước là "Còn lại") và ô Công nợ NCC ở chi tiết NCC (`tongNoNcc`).
- `/payables` cộng từ chính sổ khoản chưa xong của bốn ô tổng (`gopNoTheoNcc(allOpen)` → `duNoHienTaiCuaNcc`,
  `src/lib/payables/so-no-ncc.ts`), không hỏi máy chủ thêm. Chưa đọc xong → khung chờ; đọc hỏng / chạm trần → "—" (số
  thiếu trông y như số thật). Cột không xếp được (cộng ở trình duyệt).
- **Tab Công nợ ở chi tiết NCC là SỔ CHI TIẾT** (chủ nhà 08/11/2026: *"phần chi tiết công nợ từng ncc chưa có dư nợ sau mỗi giao
  dịch, kiểm tra xem phần tiền thanh toán cho ncc cũng chưa có trong công nợ"*): mỗi giao dịch một dòng — phiếu nhập / nợ đầu kỳ /
  công nợ lập tay (tăng), phiếu trả NCC (giảm), phiếu chi trả NCC (**MỘT dòng cả phiếu**, gom phần `payable_payments` theo
  `supplier_payment_id`, kể cả phần trả trước), trả thẳng (Ghi trả NCC, mỗi lần một dòng) — kèm **dư nợ sau giao dịch**, mới trước;
  nợ đầu kỳ đứng đầu sổ. Luật: `soChiTietNoNcc` (`src/lib/payables/so-chi-tiet-ncc.ts`). Tiền trả lấy từ `payable_payments`
  (tiền thật), dòng "Trả trước NCC" của phiếu chi KHÔNG là dòng sổ (đếm hai lần); `paid` lớn hơn tổng phiếu của khoản (nợ đầu kỳ
  nhập sẵn, dữ liệu cũ) → dòng "Đã thanh toán — không có phiếu chi" — nhờ vậy dư nợ cuối sổ = `tongNoNcc`. Đọc lần trả hỏng /
  dư cuối lệch đầu tab → báo đỏ / vàng.
- Ba đường trả NCC đều trừ nợ: Phiếu chi loại "Trả NCC" + nút "Chi trả NCC" (`chi_tra_ncc`, mig 242), "Ghi trả" một khoản
  (`record_payable_payment`, mig 167). Phiếu chi loại **"Chi phí" KHÔNG trừ nợ NCC** — trả tiền hàng mà lập nhầm loại ấy thì nợ
  không giảm. Khám trên sổ thật (chỉ đọc, MỘT câu): `supabase/diagnostics/kham_tra_tien_ncc.sql` — dư nợ + tiền trả theo đường
  ghi, khoản đã trả không phiếu, phiếu chi phí nghi là trả NCC (tên NCC / từ khoá), phiếu chi NCC lệch. Bộ thử:
  `scripts/sql/thu-kham-tra-tien-ncc.sql`.

### Thêm hàng ở POS
Chủ nhà 13/10/2026: *"thêm sản phẩm thì sản phẩm xuất hiện đầu danh sách luôn"* · *"phần đổi trả dài quá ko có scroll
… chỉ hiện hàng đổi trả không hiện phiếu đi"*.
- Dòng mới lên **đầu** danh sách ở mọi màn POS (`themLenDau` / `donLenDau`, `src/lib/pos/them-dong.ts`); gộp dòng trùng
  thì dòng được cộng cũng lên đầu. Thứ tự lưu = thứ tự trên màn. Bảng cuộn tới dòng vừa thêm (`dongMoi`, `data-dong`).
- Khối **hàng đổi trả** (màn đơn, hoá đơn) có trần `max-h-[42vh]`, dòng cuộn trong khối — không được che bảng hàng đi.
  Màn **xem** hoá đơn / đơn: khối chứng từ liên quan (`RelatedDocs`, kèm hàng đổi trả) bọc trong `cuon-lien-quan` có trần.

### Ô số lượng gõ được + địa chỉ khách (điện thoại)
Chủ nhà 09/11/2026 (phiếu trả hàng trên điện thoại): *"khi chọn khách trong danh sách hiển thị thêm thông tin địa chỉ, phần số
lượng dùng bàn phím numpad và gõ được, ngoài việc +/-"*.
- Ô số lượng giữa −/+ là `OSoLuong` (`src/components/ui/o-so-luong.tsx`, luật chữ `docSoLuongGo`): bàn phím số (`inputMode`),
  chạm vào chọn cả số (đặt vùng chọn sau một nhịp — iOS bỏ qua `select()` trong `focus`), **giữ chữ đang gõ** (trống / "0" / "1."
  không đẩy số), rời ô khi trống → về số đã chốt. Đừng quay lại `value={String(qty)}` + bỏ qua chữ không ra số > 0: xoá trắng là
  ô tự hiện lại số cũ, không gõ được. Dùng ở phiếu trả hàng + phiếu nhập / trả NCC điện thoại (`BoSoLuong`).
- Danh sách chọn khách của phiếu trả (`ChonKhachSheet`, `phieu-tra-khach-mobile.tsx`) hiện địa chỉ (`fullCustomerAddress` — một
  chỗ ghép số nhà · phường · quận · tỉnh) dưới tên chủ · SĐT, tìm được theo địa chỉ; trang `/returns/new` đọc thêm 4 cột địa chỉ.

### Giá bán gần nhất ở POS
- `loadLastPrices` (`src/lib/pos/load.ts`): `SO_TO_GIA_GAN_NHAT` tờ ghi sổ gần nhất của khách (ngày HĐ rồi lúc tạo) → dòng
  của các tờ ấy, xếp theo thứ tự tờ, bỏ dòng hàng đổi. ⚠ `sales_invoice_lines` KHÔNG có `created_at` (mig 124) — bản cũ sắp
  theo cột ấy, máy chủ trả 42703 mỗi lần (log Supabase 03/11/2026), lỗi bị nuốt nên gợi ý giá chưa bao giờ hiện. Sổ giả e2e
  không kiểm tên cột — đọc cột mới thì đối chiếu migration.

### Quét mã vạch ở form sản phẩm
Chủ nhà 24/10/2026: *"phần thêm sản phẩm đoạn mã vạch thêm cho tao phần quét mã vạch nhé"*.
- Ô Mã vạch của `ProductForm` (máy tính, điện thoại, khung tạo nhanh) có nút quét → **dùng lại** `BarcodeScanner`
  (`src/components/ui/barcode-scanner.tsx`: camera + nhập tay), không dựng bộ quét thứ hai; mỗi lần mở chỉ nhận
  MỘT mã rồi đóng (camera đọc ~8 khung/giây — `daNhanRef`). Luật mã: `src/lib/products/ma-vach.ts` (`chuanMaVach` bỏ CR/LF
  máy quét gửi kèm). Nhãn nút nhập tay theo nơi gọi (`manualLabel`).
- **Enter trong ô Mã vạch không gửi form** (máy quét USB / Bluetooth gõ mã rồi Enter) — chỉ sang ô Tên hàng.
- Mã đã gắn cho sản phẩm KHÁC → **cảnh báo** (`cauTrungMaVach`, hỏi sổ lúc quét / rời ô, loại chính hàng đang sửa), vẫn cho
  lưu — sổ không khoá trùng mã vạch.
- **Camera do app tự lo, không giao lại cho `Html5Qrcode.start()`** (chủ nhà 02/11/2026: *"phần tạo sản phẩm mới trên điện
  thoại mã vạch chưa quét được"* — bản html5-qrcode: 0/3 tình huống camera giả đọc được trong 15 giây; đóng hộp lúc camera
  chạy thì `clear()` ném lỗi trong hàm dọn → SẬP TRANG "Không thể kết nối"). `src/lib/quet/camera.ts`: xin camera sau
  **1920×1080 lý tưởng** (`RANG_BUOC_CAMERA` — mặc định 640×480 không đủ điểm ảnh ở 10–15 cm), lấy nét liên tục, cắt ĐÚNG ô
  ngắm (`O_NGAM`, `vungCat` theo `object-fit: cover`) ở **độ phân giải gốc** rồi mới giải — đừng giải trên ô cỡ CSS (280 px là
  ~1 điểm ảnh / mô-đun). `src/lib/quet/bo-giai.ts`: `BarcodeDetector` của máy (Android) nếu có, không thì ZXing đóng kèm
  html5-qrcode **đã vá** (`src/lib/quet/zxing-va.ts` — bản đóng kèm dò vạch mở đầu EAN/UPC + Code128 sai: có vùng tối bên trái
  mã là trượt). Hàm dọn chỉ tắt camera (`tatCamera`), không gì được ném ra; đóng hộp trước khi có quyền camera thì luồng về
  sau vẫn bị tắt. Lỗi camera hiện câu tiếng Việt + "Thử lại camera" (`cauLoiCamera`).
- **Cùng một mã qua camera chỉ báo lại sau 1,5 giây** (`shouldAcceptScan` ngay trong `BarcodeScanner`): Nhập kho thêm một DÒNG
  mỗi lần báo mã, không tự lọc — giơ mã một giây từng là tám dòng. Nhập tay / máy quét USB không qua cửa này.
- E2E camera: Chromium chiếu video Y4M giống camera điện thoại (`e2e/camera-gia.mjs`: mã nhỏ giữa khung, nền tối, mờ, nhiễu;
  `e2e/camera-trang.ts`) — `quet-ma-vach-camera*.spec.ts`. Bài chỉ đi đường Nhập tay thì camera hỏng vẫn xanh.
- **Phiếu xuất kho (`/inventory/stock-issue`) có nút quét** (chủ nhà 03/11/2026: *"có sửa luôn đi em"*) — bộ quét chung, hộp để
  mở quét tiếp; `ketQuaQuetXuat` (`src/lib/inventory/stock-issue.ts`): hàng đã trên phiếu thì báo "Đã có trên phiếu", không
  thêm dòng thứ hai. **Tra mã một luật** cho mọi màn quét: `findByCode` (`src/lib/sell/scan.ts` — mã vạch trước rồi SKU, bỏ
  khoảng trắng, không phân biệt hoa thường); đừng tự viết `p.sku === code` (màn cũ `/inventory/stock-out` làm thế — mã vạch
  thật không bao giờ ra; màn ấy đã chặn từ 22/09/2026, `LEGACY_V2_HREFS`, đừng sửa thêm).

### Thẻ khách / NCC ở POS: xem đủ + sửa tại chỗ
Chủ nhà 21/10/2026: *"Phần tạo đơn POS : phần Khách hàng / NCC khi ấn vào hiện modal xem thông tin đầy đủ và sửa các
thông tin"*.
- Bấm tên / dòng phụ ở thẻ đối tác (`PartnerCard` `onOpen`) ở **mọi** màn POS, kể cả thẻ chỉ đọc của hoá đơn →
  `KhachPosModal` / `NccPosModal` (`src/components/pos/partner-info-modal.tsx`). Sửa bằng **biểu mẫu đang có**
  (`CustomerForm` `onDaSua`; `SupplierFields` + `luuHoSoNcc` — một đường lưu với tấm Sửa ở chi tiết NCC), không viết form thứ hai.
- Lưu xong **ở lại POS**: thẻ + danh mục POS theo ngay (`doiTacSauSua`, `capNhatKhach` / `capNhatNcc` → `gopTheoId`,
  `src/lib/pos/doi-tac.ts`) — nhóm khách đổi là bảng giá đổi. "Mở hồ sơ" mở tab mới. Phím tắt POS không lọt khỏi hộp
  (`chanPhimPos` — F9 lọt ra là gửi đơn đằng sau). Quyền như hai màn hồ sơ: khách `customers.update`, NCC `inventory.update`.
  Trong hộp không có nút Định vị (máy POS ở văn phòng) — vị trí dời ở hồ sơ khách.

### Mở POS ở tab mới
Chủ nhà 23/09/2026: *"Mỗi khi mở pos bật tab mới đi"*; 21/10/2026: *"nút tạo đơn khoanh đỏ ở phần danh sách đơn hàng khi ấn
vào chưa mở tab mới"*.
- Thẻ `<a>` vào lối POS do `PosNewTab` bắt. Nút đi bằng `router.push` thì bộ bắt không thấy — máy tính phải gọi
  `diHoacMoPos(router.push, …)` (`src/components/sell/pos-new-tab.tsx`); `tests/pos-tab-moi-nut.test.ts` chặn
  `router.push(newOrderHref(` / ``router.push(`/sell/edit/``.
- **Mở THẲNG đích POS, không qua màn cũ** (chủ nhà 02/11/2026: *"dường như trễ 1 nhịp để nhận diện là phải load pos"*):
  nút "Xuất hàng" mở `/sales-invoices/new?order=…` → tab mới tải trọn màn cũ rồi mới `router.replace` sang POS (nhật ký
  production: 1,1–2,7 giây thừa mỗi lần, màn cũ chớp lên). `openInNewTab` (`src/components/ui/new-tab-link.tsx`) nay tự đổi
  lối vào POS cũ thành đích POS trên máy tính (`posTargetFor`) — `PosDesktopRedirect` chỉ là đường lùi cho dấu trang / gõ
  tay. Bài e2e lối POS phải ghi **mọi lượt điều hướng** của tab mới (`isNavigationRequest`), không chỉ địa chỉ cuối —
  kiểm địa chỉ cuối thì đi vòng vẫn xanh.
- **Máy chủ nhận diện máy tính ngay lượt mở trang** (chủ nhà 03/11/2026: *"có cách gì xử lý nhận diện từ đầu là đang trên
  máy tính để load pos luôn ko"*): trình duyệt ghi khổ màn vào cookie `npp_kho` (`GhiKhoMan` ở layout gốc — vào app + đổi cỡ
  cửa sổ, ngưỡng `POS_MIN_WIDTH`); middleware thấy `rong` + lượt **mở trang** vào lối POS cũ thì trả **307** sang đích POS
  trước khi dựng màn cũ (`dichPosMayChu`, `src/lib/nav/kho-man.ts`) — dấu trang, chuột giữa, link dán Zalo hết đi vòng (bản
  build, CPU ×4: 3,0–3,5 s / 18–21 câu / ~1,7 MB → 2,3–2,7 s / 11–13 câu / 82 KB). Lượt mở trang = `GET` + `Accept: text/html`
  + `Sec-Fetch-Dest: document` — **hoặc `empty` kèm `Sec-Fetch-Mode: navigate`**: service worker tự `fetch(event.request)` khi
  không có tải trước điều hướng thì Chromium gắn thế (đo bản build; thiếu nhánh này đường ấy dựng trọn màn cũ, 1,3 s thay vì
  0,6 s). Next **gỡ** header `RSC` / `Next-Router-Prefetch` trước middleware nên đừng dựa vào chúng — câu RSC là `fetch`
  (mode `cors` / `same-origin`, Accept `*/*`); chuyển nó là kéo POS vào ngay tab cũ (ngược luật tab mới). Không cookie / `hep`
  thì để yên (đoán "rộng" ở máy chủ là đẩy điện thoại vào POS 1.400 px); `PosDesktopRedirect` vẫn là đường lùi. E2E (không có
  SW — `next dev`): `e2e/pos-nhan-dien-may-chu.spec.ts`; đường SW chỉ thử được trên bản build.

### POS tác vụ đơn: in xong đóng luôn
Chủ nhà 04/11/2026: *"tao muốn tác vụ đơn nghĩa là sau khi hoàn thành 1 đơn thì tự đóng pos, cần thì mở lại sau"*; 05/11/2026
(sau khi trao đổi ưu / nhược điểm): *"In xong đóng luôn"*.
- Xong việc = chứng từ ghi xong: Xuất hàng & lập HĐ / Lập lại HĐ, Gửi đơn / Lưu đơn đã gửi, Hoàn thành phiếu trả / phiếu nhập,
  Ghi nhận trả NCC → màn gọi `ketThuc` (`usePosKetThuc`, `src/store/pos/tabs.tsx`; luật `src/lib/pos/tac-vu-don.ts`). HĐ, phiếu
  trả (`IN_KHI_XONG`) bật in rồi đóng **sau khi hộp in đóng** (`inTaiCho(…, khiXong)`); phiếu nhập / trả NCC chưa có mẫu in →
  đóng ngay. **Đơn đặt hàng KHÔNG in** (chủ nhà 09/11/2026: *"Sửa để khi đặt đơn hàng k hiện ra màn in đơn đặt hàng nữa"*) —
  Gửi đơn / Lưu đơn đã gửi xong đóng ngay như phiếu nhập; in phiếu đặt bằng nút In ở màn đơn. Lưu nháp / lưu tạm không gọi.
- Không đóng (in vẫn bật như cũ): công tắc tắt, hoặc có cảnh báo phải đọc trên màn (`coCanhBao`: xuất thiếu hàng, chưa gán được
  người phụ trách). Đơn đã có HĐ từ lần bấm trước (`?daXuat=1`, dải nhắc In) không phải xong việc ở cửa sổ này.
- Cửa sổ còn tab con khác thì chỉ đóng tab con (`dongGi`). Trình duyệt chỉ cho script đóng tab do script mở: POS mở từ nút
  trong app đi `window.open` (`openInNewTab`) nên đóng được; mở bằng dấu trang / gõ địa chỉ thì `close()` bị lờ → về `/pos` +
  `CAU_KHONG_TU_DONG` (`dongCuaSo`). Bài e2e phải mở POS từ nút trong app (popup) — `page.goto` thẳng là đi đường lùi.
- Câu báo ("Đã xuất hóa đơn HD-…") mất theo tab → ghi `localStorage` `npp.pos.xong` (`goiLoiBao`) ngay trước khi đóng; tab danh
  sách hiện qua `ThongBaoTuPos` (sự kiện `storage`; tab đang ẩn thì chờ quay về, quá 2 phút bỏ). Danh sách Đơn hàng / Hoá đơn /
  Phiếu nhập đã tự tải lại khi quay về (`useRefreshOnFocus`).
- Bật tác vụ đơn thì mỗi tab trình duyệt chỉ giữ tab con CỦA NÓ: không đọc / ghi bản lưu chung `npp.pos.tabs.v1` (dùng chung
  mọi tab trình duyệt — mở POS mới từng kéo theo tab con cũ tới trần 8, và cửa sổ còn tab thừa thì không bao giờ đóng cả cửa
  sổ). Kho tab chờ `PosSettingsProvider` đọc xong (`caiDatSan`) — effect của con chạy trước effect của cha.
- Công tắc `tacVuDon` ở Thiết lập hiển thị › Sau khi hoàn thành, **mặc định bật**. Trình duyệt bắn `afterprint` cả khi bấm Huỷ
  → huỷ in vẫn đóng (đã nói chủ nhà). Chromium không giao diện (e2e) bắn `beforeprint` / `afterprint` ngay khi gọi `print()` →
  bài e2e cũ cần ở lại màn sau khi xong thì tắt công tắc (`tatTacVuDon`, `e2e/helpers.ts`); bài của luật này:
  `e2e/pos-tac-vu-don.spec.ts`.
- **E2E: đọc câu báo TRƯỚC, chờ địa chỉ SAU** (lượt đủ bộ 13/11/2026 hỏng 2 bài vì thế): toast thường tắt sau 5 giây, câu báo
  thanh trên POS (`notice`) sau 6 giây — đếm từ lúc hiện, tức ngay lúc gọi chuyển trang; `next dev` lúc chạy đủ bộ có khi
  chuyển trang lâu hơn thế (`/pos` = 2 câu RSC). Chờ `toHaveURL` trước là tới lúc đọc câu đã tắt. Tái hiện: làm chậm câu
  `?_rsc=` của đường đích bằng `page.route`.

### Tờ in hoá đơn: hàng đổi / hàng trả
Chủ nhà 13/10/2026: *"mẫu phiếu in hiện tại không in ra hàng đổi và hàng trả hóa đơn"*.
- Tờ in hoá đơn (POS `/in/hoa-don`, màn quản lý, Excel "như mẫu in") in **mọi dòng đổi / trả của phiếu đã trừ vào tờ**
  (`creditCounted`) — kể cả hoá đơn chỉ có hàng đổi (trừ 0đ) và hoá đơn **đã phát hành HĐĐT**. Một luật:
  `hangDoiTraTrenBanIn` (`src/lib/orders/invoice-credit.ts`). Phiếu nháp / đã huỷ không in.
- "Tổng cộng" giữ tiền hoá đơn; "Trừ hàng trả" / "Còn phải thu" là dòng thêm khi có trừ. Dòng đổi xuất đi (0đ) vẫn bỏ
  khỏi bảng hàng — món đổi hiện ở dòng "(Hàng đổi) … không trừ".

### Tờ in hoá đơn / đơn đặt hàng: câu "Lưu ý" + giờ tạo hoá đơn + mã QR chuyển khoản
Chủ nhà 10/11/2026: *"thêm cho tao vào dưới bảng đơn hàng/hóa đơn : Lưu ý: Khách hàng thanh toán bằng tiền mặt và chỉ chuyển
khoản vào số tài khoản của NPP: … Thêm vào cạnh ngày hóa đơn giờ tạo hóa đơn."*
- Câu "Lưu ý" là **cài đặt của NPP** (`organizations.settings.print_note`, Cài đặt → Cấu hình tổ chức; đọc qua `loadOrgHeader`
  → `printNote`), in nguyên văn **ngay dưới bảng hàng** của hoá đơn bán + đơn đặt hàng (`SalesInvoice`, kể cả `/in/*` của POS)
  và Excel "như mẫu in" (`CO_LUU_Y_IN`); nhãn đầu câu ("Lưu ý:") in đậm (`tachNhanLuuY`, `src/lib/printing/luu-y-in.ts`). Trống
  → không in — TRỪ KHI có tài khoản nhận tiền (mã QR): chủ nhà 11/11/2026 *"Thu nhỏ mã qr. vẫn thêm dòng Lưu ý khi có mã qr"* →
  ô câu trống mà có tài khoản thì in **câu mặc định đúng lời chủ nhà** điền ngân hàng · số TK · tên chủ TK (`cauLuuYMacDinh`,
  tên chủ TK tuỳ chọn `settings.bank_account_name`); câu tự viết luôn thắng. Một luật cho ba màn in + Excel + màn cài đặt (báo
  trước câu sẽ in): `luuYTrenTo` — đừng truyền thẳng `org.printNote`. **Không ghi cứng số tài khoản vào mã / migration**:
  `schema_full.sql` cài cho NPP khác, tài khoản của NPP này lên tờ của NPP khác là khách chuyển tiền nhầm chỗ (bài test quét
  `src/` + `supabase/`).
- Dòng "Ngày …" của tờ in hoá đơn = ngày HĐ + **giờ tạo** (`ngayGioHoaDon`, `src/lib/printing/doc-stamp.ts` — thay luật 01/10
  "chỉ in ngày"): giờ là `created_at` của tờ, giờ VN; ngày HĐ khác ngày lập (chọn "Ngày hóa đơn" ở POS, Sửa HĐ giữ ngày tờ cũ —
  mig 213) → "08/11/2026 (lập 10/11/2026 09:15)" — giờ trần cạnh một ngày khác là bịa. Đơn đặt hàng vẫn **chỉ ngày đơn**.
- **Mã QR chuyển khoản (VietQR)** (chủ nhà 10/11/2026: *"em thêm cho a mã QR thanh toán số tiền trên hóa đơn, nội dung Thanh
  toán đến tài khoản. mã để cạnh khu vực ký (song song)"*): tờ in hoá đơn **đã ghi sổ** có mã chuyển khoản đúng **số còn phải
  thu** (số "Bằng chữ" đọc), nội dung `NOI_DUNG_QR_HOA_DON` ("Thanh toan den tai khoan"), đứng cột đầu hàng ô ký (`paymentQr`
  của `SalesInvoice`, cạnh **5,5em — A5 ≈ 20 mm**: chủ nhà 11/11/2026 "thu nhỏ mã qr" từ 7em / 26 mm; mã 41 + 4 mô-đun nên
  dưới ~17 mm là mỗi mô-đun < 3 điểm ở máy in nhiệt 203 dpi — đừng thu thêm). Đơn đặt hàng / HĐ huỷ / không còn phải thu /
  NPP chưa đặt tài khoản → không có mã; Excel "như mẫu in" chưa có mã. Tài khoản = cài đặt NPP (`settings.bank_bin` + `bank_account_no`, Cấu hình tổ chức: chọn
  ngân hàng theo BIN NAPAS `NGAN_HANG_VIETQR`, có mã xem thử để quét kiểm tên chủ tài khoản; đủ cả hai hoặc trống cả hai —
  `loiTaiKhoanNhan`). Chuỗi dựng TẠI CHỖ (`chuoiVietQr`, `src/lib/thanh-toan/vietqr.ts`: EMVCo/NAPAS, CRC-16/CCITT-FALSE, chỉ
  ASCII — chữ có dấu là app ngân hàng đọc lệch); mã vẽ SVG **đồng bộ** (`QrSvg`, `QRCode.create`, mức sửa lỗi M) — dựng bất đồng
  bộ như `QrCode` là tờ in tự động (`?auto=1`) ra không có mã. Test giải ngược bằng ZXing: `tests/vietqr-hoa-don.test.ts` (đáp án
  tính bằng Python), e2e chụp mã trên trang rồi giải (`e2e/qr-thanh-toan-hoa-don.spec.ts`).

### Thêm khách hàng: TÌM khách đã có trước khi tạo
Chủ nhà 06/06/2026: *"trước khi NV sale thêm KH mới, cần check trùng (theo SĐT, địa chỉ, tên). Nếu KH đã tồn tại — kể
cả do NV khác phụ trách — cho phép sale 'thêm vào danh sách của tôi' thay vì tạo trùng"*; 14/10/2026: *"…trên điện thoại
của nhân viên mất phần tìm khách hàng đã có trước khi tạo rồi"*; 03/11/2026: *"em rà soát luôn tất cả các chỗ tạo khách
hàng đều phải qua bước lọc trùng nhé"*.
- **MỌI lối tạo khách qua bước lọc trùng SĐT** — không có đường tắt vào thẳng form: `/customers/new` (máy tính + điện
  thoại, kể cả `?sdt=`), khung tạo nhanh `TaoNhanhKhach` (đơn /sell, phiếu thu, trả hàng, tuyến — cả hai khổ), nhập Excel.
  POS không có nút tạo khách. Thêm lối tạo khách mới thì đi qua bước này — ô tìm của phiếu / danh sách chỉ thấy khách CỦA
  MÌNH (RLS), không ra ≠ số chưa có khách.
- `/customers/new`: bước "Tìm khách hàng đã có" trước (`CustomerDupeFinder` / `TimKhachTruocKhiTao`, một đường tìm
  `useDoTrungKhach` → `search_customer_dupes`, thấy cả khách NV khác). Tới bằng `?sdt=` (đã tìm số không ra ở danh sách,
  chủ nhà 01/10/2026) thì số **điền sẵn ở bước tìm** (dò ngay) rồi đi theo sang form — luật 01/10 "vào thẳng form" đã bỏ
  (03/11/2026). "Thêm khách khác" về bước tìm.
- **Tìm ra khách thì KHOÁ nút "Tạo khách hàng mới"** (chủ nhà 20/10/2026: *"khi tìm kiếm ở màn tạo khách hàng này đã có
  kết quả thì nút tạo khách hàng mới không bấm được để ngăn tạo trùng khi đã có, khi không có kết quả tìm kiếm mới bấm
  được"*): số đủ mà kết quả chưa về cũng khoá; chưa gõ / số chưa đủ thì bấm được (form vẫn chặn trùng số). Một luật cho
  máy tính + điện thoại: `khoaTaoKhachMoi` qua `useDoTrungKhach`. Một số một khách là `UNIQUE(org_id, phone)` — đừng gỡ.
- **Chỉ tìm CHÍNH XÁC theo số điện thoại** (chủ nhà 15/10/2026: *"nhập đúng số điện thoại của khách thì khách mới hiện
  ra"*): tên / địa chỉ / số dở không tìm, không gửi đi (`sdtTimChinhXac`); máy chủ cũng chỉ khớp đúng số (mig 245).
  Đừng nới lại thành tìm từng phần — hàm SECURITY DEFINER, tìm từng phần là lộ khách của nhân viên khác.
- Nhận khách: `nhanKhachVeDanhSach` (`claim_customer_for_me`, chỉ vai sales). NVBH chưa nhận thì **không** đưa link
  mở khách (RLS — trang trống). Form điện thoại trùng SĐT → nút "Thêm vào DS của tôi" (tạo nhanh: nhận xong chọn luôn).
- **Tạo nhanh hai bước** (chủ nhà 03/11/2026: *"tạo đơn hàng trên điện thoại bấm Tạo khách hàng -> vẫn phải qua bước lọc
  trùng số điện thoại chứ ko được đến thẳng màn tạo khách hàng"*): `TaoNhanhKhach` = bước tìm rồi mới form — điện thoại
  `TimKhachTruocKhiTao` → `TaoKhachDienThoai` (`HaiBuocDienThoai`: lùi ở bước tìm = đóng khung, lùi ở form = về bước tìm),
  máy tính `CustomerDupeFinder` → `CustomerForm` (`HaiBuocMayTinh`: "Hủy" ở form đóng hộp thoại như cũ). Chữ đang tìm là số
  thì điền sẵn ở bước tìm (dò ngay), là tên thì mang sang ô tên. Tìm ra khách dùng được → "Chọn khách này"; NVBH chưa nhận
  → "Thêm vào DS của tôi và chọn…" (`onChon`). Link "Xem" khách chỉ khi mở được (NVBH đã nhận / không phải NVBH — RLS).
- **Nhập Excel lọc trùng TRƯỚC khi nhập** (`kiemTrungSdtHangLoat`, `src/lib/customers/kiem-trung-hang-loat.ts`): đọc file xong
  hỏi `search_customer_dupes` (GET — hàm STABLE) từng số đủ, 8 lệnh cùng lúc; dòng trùng hiện "Trùng SĐT: đã có “…”" và
  bị bỏ qua; chưa lọc xong / lọc hỏng thì **không cho nhập** (nút "Kiểm lại"). Đừng quay lại đối chiếu bằng đọc thẳng
  `customers.phone`: dưới RLS NVBH chỉ thấy khách của mình. Số lưu chuẩn hoá như tạo tay (`sdtDeLuu` → `chuanHoaSdt`) —
  UNIQUE(org_id, phone) so NGUYÊN VĂN, "0911.111.111" lưu thô là khách thứ hai cùng số. Lô bị từ chối vì trùng (số vừa
  được tạo ở nơi khác) thì ghi lại từng dòng, dòng trùng bỏ qua.

### Bàn giao khách giữa nhân viên + hàng khách đã lấy
Chủ nhà 15/10/2026 (mig 246): *"Gán cho toàn bộ khách hàng của nv A cho nv B (làm chung khách hàng) Hoặc là như kiểu bàn
giao lại khách hàng … dskh tuyến đó, đã lấy hàng gì, số lượng, hàng cty nào mà nv đó làm … thể hiện luôn trên máy của nv"*.
Chốt: cả hai kiểu; toàn bộ / theo tuyến / theo công ty; mốc 3 / 6 / 12 tháng / tất cả; chuyển hẳn → nợ theo NV nhận.
- `/customers/ban-giao` (chủ NPP / quản lý — khoá `customers.handover`, cùng RLS phân công): một RPC `ban_giao_khach`
  (xem trước rồi mới thực hiện; nguồn: khách của một NV · chưa ai phụ trách · mọi khách; lọc tuyến, công ty + mốc).
- **Làm chung**: thêm NV nhận (phụ nếu khách đã có NV chính còn làm); NV đang phụ trách và công nợ giữ nguyên.
  **Chuyển hẳn** (chỉ từ một NV): NV nhận thay đúng vai NV giao, NV giao gỡ khỏi khách; **nợ chưa thu xong** sang NV nhận
  (đã thu xong giữ tên cũ); **doanh số / `sales_invoices.sales_user_id` không đổi**. Lịch đi tuyến chỉ chép / chuyển cho
  khách MỚI với NV nhận. NV nhận làm chính → nhận luôn nợ NPP đang giữ (NV cũ nghỉ việc).
- Nợ đã giao mang dấu `receivables.giao_tu_nv`: tính lại theo chứng từ (`_wf2b_recompute_receivable`, `_cong_no_phieu_tra`)
  vẫn ghi NV giao → trigger `_cong_no_giu_ve_npp` giữ NV nhận; chứng từ đổi sang người khác → theo chứng từ. Dấu chỉ RPC
  đổi được; sửa HĐ (`reissue_invoice`) chép dấu sang tờ mới. Đừng bỏ dấu — nợ chuyển tay sẽ quay về NV cũ.
- **Hàng khách đã lấy** (`hang_khach_da_lay`): SL **đơn vị cơ sở**, HĐ ghi sổ − hàng trả đã trừ (`revenue_date`), bỏ hàng
  đổi; **chỉ số lượng, không tiền**. NVBH: chỉ khách mình đang phụ trách + hàng công ty mình làm (`user_suppliers`, như RLS
  sản phẩm). Màn `/customers/hang-da-lay` (NVBH; chủ / QL / KT chọn NV, xuất Excel) + khối "Hàng đã lấy" ở chi tiết khách.
  Luật hiển thị: `src/lib/customers/ban-giao.ts`.

### Báo cáo của NVBH: chỉ doanh số theo Ngày / Tuần / Tháng
Chủ nhà 13/11/2026: *"Sửa Nvbh chỉ được xem doanh số tổng bán (ngày,tuần,tháng)"* — hỏi lại, chốt **"Chỉ sửa màn Báo cáo"**
(trang chủ NVBH giữ nguyên: Doanh số của tôi Hôm nay / Tuần / Tháng / Quý, Top khách hàng tháng, Doanh thu theo kênh).
- Báo cáo tổng hợp › Bán hàng (`/bao-cao/ban-hang` — nút Báo cáo ở thanh dưới của NVBH) khi vai `sales`: trạng thái ép qua
  `chiDoanhSoTong` (`src/lib/bao-cao/trang-thai.ts`) — chỉ Thời gian, nguồn Hoá đơn, không lọc, không đào sâu. Ép ở TRẠNG THÁI,
  không chỉ giấu nút: đường dẫn gõ tay / gửi Zalo (`xem=`, `nguon=ord`, `l_*`, `dao=`) cũng chỉ ra chừng ấy. "Xem theo" của NVBH
  là **Ngày / Tuần / Tháng** (`DS_DO_HAT`, tham số `hat` trên đường dẫn; chưa chọn = theo độ dài kỳ, `doHat`). Thẻ chỉ Doanh thu
  thuần + Hàng trả (`THE_NVBH`, không bấm); bảng Doanh thu / Hàng trả / DT thuần; dòng, cột biểu đồ không bấm đào sâu; không khối
  hàng trả / giảm giá; không ô lọc (còn kỳ + so với kỳ trước + thẻ "Nhân viên: tôi"); không Xuất Excel — kể cả khi được cấp quyền
  xuất riêng. Số của NVBH vẫn chỉ của chính mình (khoá nhân viên `khoaNV`, RLS).
- Báo cáo bán hàng cũ `/reports/sales` (hoá đơn từng ngày kèm khách, Giảm giá HĐ, Trả hàng, Nhân viên) **chặn theo vai**: cùng ô
  `reports.sales` với màn mới nên không chặn bằng ô quyền được → `NAV_PERMISSION` khai `truVai: { sales: "/bao-cao/ban-hang" }`:
  `kiemMuc` từ chối vai ấy TRƯỚC quyền riêng từng người và lối tắt chủ NPP (menu ẩn, cửa vào chặn), `useRoleGuard` đưa sang
  `trangThayChoVai` thay vì /home. Chỗ thay phải vào được (`tests/trang-dau-theo-vai.test.ts` duyệt mọi `truVai`).
- Bộ thử: `tests/bao-cao-nvbh-chi-doanh-so.test.ts`, `e2e/bao-cao-nvbh-chi-doanh-so.spec.ts` (dữ liệu mẫu tháng 9: người đóng vai
  NVBH thấy 900.000 — của riêng mình; chủ NPP 1.200.000).

### Quyền
- Tiền, tồn kho, trạng thái chứng từ chỉ đổi qua **RPC** — không ghi thẳng từ trình duyệt.
- **Ô quyền riêng** (chủ nhà 20/10/2026: *"Kiểm tra lại sao tk nhân viên bán hàng lại có bàn giao khách nhỉ"*): tính năng
  khai `defaultRoles` (Bàn giao khách, Công nợ NCC, Phiếu thu, `reports.*`…) **không** thừa hưởng mô-đun cha — dòng
  `role_permissions` của mô-đun và quyền riêng từng người ở mô-đun **không mở** được nó (thu cả mô-đun của một người thì
  vẫn mất cả ô con — `kiemMuc`). Lúc chạy và cả hai màn phân quyền dùng một
  luật `laORieng` / `macDinhTinhNang` (`src/lib/permissions.ts`). Màn Phân quyền từng chép quyền mô-đun sang ô riêng nên
  bấm Lưu là ghi thật cho NVBH (mig 248 trả "Bàn giao khách" về mặc định).
- Giảm giá: nhân viên theo `users.allow_discount` + trần `discount_max_*` (mig 185); chủ NPP / kế
  toán toàn quyền.
- In ở POS: trang in riêng `/in/*` nạp vào khung ẩn (`inTaiCho`); header phải là
  `X-Frame-Options: SAMEORIGIN` (DENY làm nút In không chạy).

### Hẹn giờ câu hỏi Supabase (trình duyệt)
Chủ nhà 22/10/2026 (màn Sản phẩm trên điện thoại): *"Không tải được danh sách sản phẩm — AbortError: Fetch is aborted"* —
không ai huỷ, chính bộ hẹn giờ 10 giây của app cắt câu.
- Một bộ duy nhất `fetchCoHetGio` (`src/lib/supabase/fetch-het-gio.ts`, `global.fetch` của `createClient`): **app nằm nền
  thì không đếm** (hiện lại đếm từ đầu); câu **đọc** (GET/HEAD) hết giờ thử lại **một** lần; câu **ghi** không thử lại và
  dặn tải lại kiểm tra (có thể đã ghi); tôn trọng `signal` của nơi gọi (`.abortSignal()`).
- Hết giờ ném lỗi tên `AbortError` (thư viện PostgREST không tự thử thêm 3 lần) nhưng câu chữ có `LOI_HET_GIO`:
  `laHetGio` nhận ra, `errorMessage` / `selectResilient` dịch thành câu tiếng Việt (`cauHetGio`), `isAbortError` **không**
  coi là huỷ — coi là huỷ thì trang lặng lẽ `return`, danh sách đứng trắng.
- **Giao dịch hỏng (25P02) thì gửi lại** (chủ nhà 29/10/2026, Báo cáo nhân viên: *"đọc dòng phiếu nhập hàng trả: current
  transaction is aborted, commands ignored until end of transaction block"*): lỗi này không do câu bị báo gây ra — kết nối
  PostgREST đã hỏng từ một lệnh trước (lỗi gốc ở nhật ký Postgres, ngay trước dòng 25P02); giao dịch 25P02 bị huỷ trọn nên
  gửi lại **an toàn kể cả câu ghi / RPC**. `thuLaiKhiGiaoDichHong` (`src/lib/supabase/thu-lai-giao-dich-hong.ts`): chỉ câu
  `/rest/v1/`, thân gửi lại được (không có / chuỗi), tối đa 2 lần, nơi gọi huỷ thì thôi — một luật cho client trình duyệt
  (`fetchCoHetGio`), máy chủ và admin. Gửi lại vẫn hỏng thì `errorMessage` nói tiếng Việt kèm nguyên văn. E2E tiêm lỗi:
  `POST /__loi_25p02` (`e2e/fake-supabase.mjs`).
- **Hàm chỉ đọc gọi bằng GET** (chủ nhà 29/10/2026, Báo cáo tổng hợp: *"Đọc số bán hàng hỏng: … Máy chủ chưa trả lời sau 10
  giây — thao tác có thể đã được ghi"*): RPC STABLE (báo cáo một lượt `goiMotLuot`, `dashboard_*`, `finance_*`) gọi
  `rpc(…, { get: true })` — gửi POST thì bộ hẹn giờ coi là câu GHI: không thử lại, dặn nhầm "có thể đã ghi". Hàm có ghi giữ
  POST (GET chạy giao dịch chỉ đọc). Hàm báo cáo một lượt `/rpc/bao_cao_*` (dòng thô cả kỳ) chờ **45 giây, một lượt**
  (`HET_GIO_BAO_CAO_MS`, `laBaoCaoMotLuot`) — chậm ở máy chủ, gửi lại là bắt máy đang bận làm lại từ đầu. Sổ giả e2e đọc
  tham số GET trên URL.
- **Dòng đơn của POS đọc bằng GET** (chủ nhà 03/11/2026: *"rà soát kỹ phần load đơn vào pos vẫn có hiện tượng chậm hoặc báo
  lỗi quá 10s"*): `get_invoiceable_lines` chỉ đọc (VOLATILE nhưng không ghi — PostgREST cho GET, chạy giao dịch chỉ đọc) →
  `loadInvoiceableLines` gọi `{ get: true }`: hết giờ được thử lại một lần, không dặn nhầm "có thể đã ghi". Thêm câu ghi vào
  hàm ấy thì phải về POST.
- **Câu GHI chờ 60 giây; xuất hàng chưa biết kết quả thì HỎI LẠI SỔ** (chủ nhà 03/11/2026, khách NPP 18:07–18:25: *"Đơn
  trên a chưa tạo mới bấm vào xuất hàng mà khi loát kém a thoát máy rồi vào lại thì nó đã ra hoàn thành"* · *"người nào ko
  quen mà in đơn sẽ rơi vào quên đơn đó"*): bỏ chờ ở trình duyệt KHÔNG dừng được máy chủ, chỉ làm mất câu trả lời + lệnh in.
  `HET_GIO_GHI_MS` = 60 giây (câu ghi, không gửi lại). Xuất hàng / Sửa HĐ / Xuất đủ ở danh sách đơn báo lỗi → MỘT luật
  `kiemLaiSauLoiXuat` (`src/lib/orders/post-invoice.ts`): hết giờ / rớt mạng (`"chua-biet"`) → hỏi sổ vài lượt
  (`choHoaDonCuaDon`), thấy tờ thì xử lý như trả lời bình thường (in + mở tờ); máy chủ nói đơn không còn xuất được
  (`"da-co"` — lần bấm trước đã ghi, `post_invoice` khoá dòng đơn `FOR UPDATE` nên bấm lại an toàn) → mở tờ đã có
  `?daXuat=1` + dải nhắc In, KHÔNG tự in; không thấy tờ mới báo hỏng kèm `DA_KIEM_LAI_CHUA_THAY`. Mở lại màn Xuất hàng của
  đơn không còn xuất được mà đã có tờ (`hoaDonThayManXuat`, cùng luật trạng thái `post_invoice`) → sang thẳng tờ ấy (POS) /
  báo + nút In (điện thoại). Đang ghi: `beforeunload` hỏi trước khi rời trang, quá `CHO_LAU_MS` nút nói "Máy chủ chậm — đang
  chờ, đừng tắt máy…" (`nhanDangGhi`), POS khoá nút Huỷ. E2E giữ câu `post_invoice` + đồng hồ giả:
  `e2e/xuat-hang-may-chu-cham.spec.ts`. Dữ liệu mẫu có HD-E2E-2 ghi sổ cho đơn DH-0001 đang `submitted` (lệch luật mig 217)
  — vì thế màn chỉ chuyển khi đơn KHÔNG còn xuất được, đừng nới thành "có tờ là chuyển".
- **Đo nạp POS ngoài thực tế**: `fetchCoHetGio` ghi mỗi câu vào vòng nhớ 80 lượt (`src/lib/supabase/do-mang.ts` — chỉ đường
  dẫn + cách gọi + ms + kết quả, **không tham số / dữ liệu**); màn POS (Xuất hàng / Sửa HĐ / Sửa đơn) nạp xong gửi tóm tắt về
  `/api/do-nap` (`baoNapSauKhiVe`, `src/lib/pos/bao-nap.ts`) → nhật ký Vercel dòng `[pos-nap]` (gói Hobby giữ 1 giờ — chậm thì
  đọc ngay). Khám phía Postgres (chỉ đọc, chủ nhà chạy ở SQL Editor): `supabase/diagnostics/kham_cham_pos.sql` — **MỘT câu
  duy nhất** (UNION ALL, cột chung): SQL Editor chỉ hiện kết quả câu CUỐI, bản nhiều câu trước đây chủ nhà chỉ gửi được phần
  cuối. Có phần "ghi tệp tạm nhiều nhất" (`temp_blks_written` của `pg_stat_statements`), cài đặt `work_mem` /
  `statement_timeout` theo vai, bảng đọc tuần tự nhiều. Chủ nhà xuất kết quả bằng nút Export → JSON.
- **57014 = Postgres tự huỷ câu quá hạn** (log Supabase chủ nhà gửi 03/11/2026: 101 câu trong ngày, dồn vào 8h / 10h / 18h, kể
  cả `post_invoice`): vai `authenticated` của Supabase chặn mỗi câu ở **8 giây** — chờ ở trình duyệt lâu hơn (60 giây câu
  ghi, 45 giây báo cáo) chỉ có ích khi câu phải xếp hàng chờ kết nối lúc máy chủ bận, KHÔNG kéo dài được thời gian Postgres
  chạy câu. Bị huỷ là huỷ trọn giao dịch → câu ghi CHƯA ghi gì: `errorMessage` dịch (`QUA_HAN_VI`, bắt cả theo câu chữ vì lỗi
  đi qua `new Error(...)` thì mất mã), Xuất hàng không hỏi lại sổ cho lỗi này. Câu nặng phải sửa ở máy chủ (chỉ mục, bớt sắp
  xếp tràn `work_mem`), không nới hẹn giờ ở app.
- **Sổ thật chậm ~70 lần sổ thử cho CÙNG lệnh** (bảng khám 03/11/2026, đối chiếu sổ thử dựng lại cùng cỡ: 1.835 hàng, 598
  khách, ~2.000 đơn / 2.700 HĐ qua đúng RPC): Xuất hàng 1.294 ms / 19 ms, kể cả câu `set_config` rỗng việc của PostgREST
  3 ms / 0,02 ms — máy chủ Supabase THIẾU RAM, không phải câu lệnh. Observability → Database chủ nhà gửi 03/11/2026: gói
  **Free** (CPU dùng chung, RAM thật 409 MB), **Swap ~800 MB (≈196% RAM) suốt cả ngày**, đỉnh ~9h và ~18h đúng giờ khách kêu
  chậm; Memory commitment 1,94 GB / sức chứa 1,4 GB — Supabase gắn SEVERE. CPU rảnh ~89% (IOWait ~7% do swap), đĩa 4 / 3.000
  IOPS, kết nối 8–25 / 60 — không nghẽn. App chỉ bớt được việc (mig 258–260); hết chậm hẳn phải nâng gói (Pro + cỡ máy
  ≥ 2 GB RAM — Micro 1 GB vẫn thiếu so với ~1,1 GB đang dùng) — việc của chủ nhà. Nâng xong thì Swap phải về ~0.
- **Khám bộ nhớ máy sổ** (chủ nhà 03/11/2026: *"đéo phải, mày chưa nghĩ hết cách"*): `supabase/diagnostics/kham_bo_nho.sql` —
  MỘT câu, chỉ đọc: kết nối theo dịch vụ, khe / bảng theo dõi / đăng ký của Realtime, lịch pg_cron + sổ lịch sử chạy, cài
  đặt, câu gọi nhiều nhất, bảng lớn nhất mọi schema, tỉ lệ đọc trúng bộ đệm. Bảng Realtime / pg_cron đọc qua `query_to_xml`
  SAU phép kiểm USAGE schema + SELECT bảng (`bang.doc_duoc`, tra qua catalog — `to_regclass('cron.job')` vẫn ném lỗi khi thiếu
  USAGE): thiếu quyền một bảng là mất cả bảng kết quả. Bộ thử: `scripts/sql/thu-kham-bo-nho.sql` (vai đủ quyền + vai thường,
  ROLLBACK). **Hạ `shared_buffers` không bớt RAM thật** khi sổ nhỏ hơn bộ đệm (sổ 56,6 MB < 224 MB, đọc trúng 99,3% — trang
  bộ đệm chỉ chiếm bộ nhớ khi đã đọc tới), chỉ đổi con số commitment: đừng đề xuất như cách chữa swap — TRỪ KHI
  `huge_pages_status = on` (bộ đệm nằm trên huge pages là khoá cứng trong RAM, không ra swap được; câu khám phần 5 có dòng
  này từ Postgres 17). **Gói Free không có sao lưu tự động** (Pro: hằng ngày, giữ 7 ngày).
- **Sổ thật từ 04/11/2026: Postgres 17 + PostgREST 14** (câu khám 0h40: `walsummarizer`, pg_stat_statements 1.11, câu
  `binary_upgrade_*` của pg_upgrade lúc ~0h03; cỡ máy vẫn Nano — effective_cache_size 384 MB, max_connections 60). Sổ thử /
  e2e ở máy dev vẫn PG16 + PostgREST 12.2.3. Đã soát luật search_path an toàn lúc bảo trì của PG17: chỉ mục gọi hàm tự viết
  duy nhất là `normalize_phone` (mig 104, toàn hàm có sẵn), không có materialized view — không vướng.
- **pg_cron CHƯA bật** trên sổ thật (không có schema `cron`, chỉ có tiến trình launcher nạp sẵn): lịch dọn khoá mỗi phút của
  mig 053 chưa từng chạy — khoá treo chỉ được dọn lúc có người mở khoá (mig 046). Đừng tính nó là chỗ tốn.
- **Chuông thông báo + khoá sửa đơn: Realtime chưa từng nhận gì** (câu khám 04/11/2026: publication `supabase_realtime`
  không có bảng nào — chỉ `supabase_realtime_messages_publication` → `realtime.messages_*` nội bộ; 0 đăng ký, không có khe):
  `notification-bell.tsx` / `use-entity-lock.ts` nghe `postgres_changes` trên `notifications` / `entity_locks` nên số trên
  chuông chỉ đổi khi tải lại trang hoặc bấm mở chuông (`khoTB.daDoc` giữ qua các lần chuyển màn), màn sửa đơn không tự biết
  người kia đã nhả khoá. Sửa thì đổi sang hỏi lại (quay lại tab / định
  kỳ khi tab đang mở) — đừng "bật Realtime cho bảng" (mỗi lần ghi bảng là máy sổ giải nhật ký cho Realtime).

### Tải trang: hồ sơ gửi kèm, không hỏi nối đuôi
Chủ nhà 23/10/2026: *"tốc độ load trang chậm lắm"* (đo bản build production, điện thoại 4G + CPU ×4).
- **Hồ sơ người dùng do máy chủ đọc** khi dựng layout (dashboard, POS — `layHoSoMayChu`) và gửi kèm trang (`NapHoSo`);
  `AuthProvider` dùng ngay ở sự kiện phiên đầu nếu **đúng người** (`hoSoGuiKemDung`), không đọc `users` lần nữa — vẫn qua
  chốt tài khoản bị khoá (`apDungHoSo`). Bộ cột một chỗ: `src/lib/auth/ho-so.ts` (cột giảm giá mig 185 vẫn đọc riêng).
- Màn có **luật theo vai** (NVBH khác chủ) chờ biết người dùng rồi mới hỏi (`authLoading` của `useRoleGuard`) — hỏi trước
  là hỏi hai lần (Đơn hàng: `sanSang`). Thư viện vốn chờ phiên xong mới gửi câu, nên chờ thế không tốn thêm vòng mạng.
- Câu không phụ thuộc nhau **đi cùng đợt**; câu phụ thuộc chỉ chờ đúng câu nó cần (trang chủ NVBH: tên khách chờ hoá đơn /
  trả / nợ, không chờ cả chùm). Thứ màn **không hiện thì không đọc** (người phụ trách khách trên điện thoại NVBH).
- Service worker bật **tải trước điều hướng** (`public/sw.js`, `event.preloadResponse`).
- **Điện thoại không dựng phần chỉ máy tính mới hiện** (đợt 2): thẻ danh sách máy tính (`DocListLayout`, thẻ của Đơn hàng /
  Hoá đơn bán — `data-doc-list="desktop"`) và menu trái (`aside[data-menu-trai]`) chỉ dựng khi `useKhoMay() !== false`.
  `useKhoMay` là `useSyncExternalStore`: `null` chỉ ở lượt vẽ khớp HTML máy chủ, đi trong app thì biết khổ ngay lượt đầu —
  đừng đổi lại `useState` + `useEffect` (mỗi lần mở màn vẽ cả phần khổ kia rồi mới gỡ).
- **Phần chỉ dùng khi bấm tải lúc bấm**: hộp chuông (`notification-panel`), menu người dùng (`user-menu-day`), phần ghi tệp
  của Xuất Excel — `lazy` / `import()`, rê / chạm là tải trước, bấm MỘT lần là mở. Đừng nhập thẳng lại vào khung.
- Ô chọn Radix **dài** (phường/xã, tuyến, nhân viên) dựng mục qua `mucCanDung` (`src/lib/ui/muc-chon.ts`): đóng thì chỉ mục
  đang chọn — Radix dựng sẵn mọi mục kể cả khi đóng.
- Bảng quyền mặc định dựng **một lần** (`getPermissionsCache`), chỉ đọc — `rowsToCache` dựng bản riêng để sửa.
- **POS / bán hàng nhớ danh mục hàng** (đợt 3, chủ nhà *"Làm nốt"*): `loadSellRefData(sb, nguoi)` dùng lại sản phẩm + bảng
  giá + đơn vị trong bản lưu IndexedDB khi khớp ĐỦ khoá `dungLaiSanPham` — số phiên (mig 209, đọc **trước** câu sản
  phẩm), `uid`, vai, công ty được làm (NVBH chỉ thấy hàng công ty mình — RLS mig 081). Khách + tồn **luôn đọc mới**.
  Khoá ghi **cùng** bản lưu (`cacheOrderRefData(…, khoa)`), không để riêng. Màn chờ biết người (`useNguoiTaiDanhMuc`,
  mất mạng thì không chờ). Bản lưu của người khác trên cùng máy không hiện (`cuaNguoiKhac`).
- **Đổi người trên cùng tab** (đăng xuất / đăng nhập là chuyển trang mềm) → `xoaNhoTheoNguoi` xoá danh mục bán trong RAM +
  danh mục nền của ô lọc (`AuthProvider`). Thêm bộ nhớ RAM theo người mới thì xoá ở đó.
- Ô lọc **Khách hàng** của Đơn hàng / Hoá đơn bán (`useKhachLoc`): chỉ tải sổ khách khi khung Lọc nhanh / tấm lọc mở
  hoặc đang lọc một khách — không tải lúc mở màn.
- **Đợt 4** (chủ nhà 24/10/2026 *"lần lượt hoàn thành toàn bộ"* các chỗ còn chậm rà ra):
  · Chi tiết khách: `fetchData` đúng **hai** đợt `Promise.all`, chạy sau khi biết người (`authLoading`), bảng giá chỉ tải
  khi mở tab Bảng giá (`giaDaTai`).
  · POS nhập hàng / trả NCC **không tải sổ khách** (`canKhachPos`, `loadSellRefData(sb, nguoi, { khach: false })`); mở thêm tab
  cần khách thì `loadSellCustomers` tải riêng và `setCoKhach(true)` **sau** khi tải xong (gọi trước là effect dọn dẹp huỷ
  kết quả). Bản lưu IndexedDB giữ khách cũ khi `khach: false`.
  · Trả hàng (máy tính): một câu gộp `reason, count()` (`docDemNhomTheo`, `src/lib/list/dem-nhom.ts`) thay 6 câu đếm; máy chủ
  chưa gom nhóm → lùi về đếm lẻ.
  · Báo cáo `/reports/*`: `useFilterCatalogs` tải danh mục **nhẹ** lúc mở (`taiDanhMucNhe`); danh mục **nặng** (khách / hàng /
  thương hiệu) chỉ khi ô chọn mở (`khiMo={catalogs.nang}`, `loading={catalogs.nangDangTai}`), một bản dùng chung.
  · Điểm bán cần cập nhật (`/customers/missing-photos`): đọc qua RPC `khach_thieu_anh` / `khach_cho_duyet_anh` (mig 253,
  SECURITY INVOKER — RLS tự lọc): máy chủ lọc + đếm ảnh + phân trang 50 dòng kèm `total_count`; tab khác chỉ hỏi tổng
  (`p_limit` 1); "Tải thêm" nối trang qua `ghepTrang` (không lặp id). Sổ chưa chạy mig 253 (PGRST202 — `chuaCoRpc`) → lùi
  về cách cũ (`doc-anh.ts`) — đừng bỏ đường cũ khi chủ nhà chưa chạy migration. E2E tắt RPC giả: `POST /__tat_rpc`
  (`e2e/fake-supabase.mjs`).
  · **Sổ khách POS / bán hàng nhớ như hàng** (mig 254): số phiên `phien_khach` CÙNG DÒNG `danh_muc_ban_phien` (trigger mức
  câu lệnh trên `customers` / `customer_groups` / `customer_assignments` / `user_permission_overrides` / `role_permissions`
  — KHÔNG gắn `sales_orders`). `docPhienDanhMucDu` đọc hai số MỘT câu; thiếu cột (chưa chạy 254) thì hỏi lại chỉ `phien`,
  khách tải như cũ. Khớp khoá `dungLaiKhach` (số phiên khách + `uid` + vai) mới dùng lại; câu khách CHỜ số phiên như câu
  hàng; tồn kho luôn mới. Khoá khách ghi cùng bản lưu (`cacheOrderRefData(…, khoa, khach)`), màn NCC giữ khoá khách cũ.
  Quay lại app (`kiemPhienDanhMucShared`) số khách đổi cũng là tải lại. Sổ giả e2e tự tăng `phien_khach` khi ghi các bảng
  ấy (qua bảng hay RPC) như trigger thật.
  · **Tồn kho hiện tại** (`/inventory`, `StockBalanceTable`): đọc qua RPC `ton_kho_trang` (mig 255, SECURITY INVOKER): máy chủ
  gộp kho bán / kho date theo mặt hàng, lọc "còn tồn", tìm theo `tim_kd` (mọi từ, không dấu), sắp (tên `vi-x-icu` / giá trị /
  tồn), chia trang; mỗi dòng kèm `total_count` + `sum_*` của CẢ tập đã lọc — dòng "N sản phẩm — tổng giá trị" và Tổng cộng vẫn
  đúng trên cả sổ. Máy tính theo thanh trang, điện thoại 20 dòng + "Xem thêm" (`ghepTrang`, `src/lib/list/ghep-trang.ts`); ô
  tìm hỏi sau 300 ms ngừng gõ; Xuất Excel đọc hết các trang (`docTatCaTon`). Sổ chưa chạy 255 (`chuaCoRpc`,
  `src/lib/supabase/chua-co-rpc.ts` — dùng chung cho mọi màn có đường lùi) → lùi về cách cũ (`gopTonTheoSanPham`), giữ nguyên
  đường cũ.
- **Đợt 5** (chủ nhà 01/11/2026: *"tìm kiếm trong danh sách (đơn hàng, hóa đơn...) nhiều khi còn chậm hoặc mở đơn hàng, sửa đơn
  hàng, hóa đơn... ở pos còn chậm"* — đo bằng PostgREST thật trên sổ thử 40.000 HĐ):
  · **Tổng / đếm của cả bộ lọc gộp TRÊN MÁY CHỦ** (`src/lib/list/tong-may-chu.ts`: `gopMayChu`, `docTongGop`, `docDemTheoTuyen`,
  `NHOM_TUYEN`): Đơn hàng `total.sum()`, Hoá đơn `con_lai.sum()` trên view `v_hoa_don_con_lai` (mig 257 — tiền CÒN LẠI sau hàng
  trả, luật `creditCounted`, **security_invoker**; khoản trừ là truy vấn con THEO TỪNG TỜ — đừng đổi về LEFT JOIN nhóm sẵn: ô tìm
  khớp rộng Postgres đoán sai, 2–3,3 giây thay vì 0,1), đếm theo tuyến `count(), customer:customers!inner(channel)` — cùng bộ lọc
  với danh sách. Đừng quay lại tải mọi dòng rồi cộng: kỳ "Tất cả" là 20 câu rồi chạm trần (dải "—", đếm tuyến thiếu); NVBH mở Hoá
  đơn 86–100 câu / 66–68 đợt (điện thoại ~10 giây) → nay 10–12 câu. Lỗi / sổ chưa chạy 257 → `null`, lùi về cách cũ
  (`gopMayChu` nằm trong `NULL_ON_ERROR_WRAPPERS` của máy dò `scripts/audit-unchecked-db.py` — đưa câu vào thẳng nó, kể cả
  `await gopMayChu(applyFilters(q), …)`, là đã kiểm lỗi). `traTheoHoaDon` (đường lùi + nơi khác) chạy **song song 6 lô** 200 id,
  không tuần tự.
  · **Tồn kho POS / bán hàng một câu**: `docTonBan` (`src/lib/sell/ref-data.ts`) gọi `ton_ban_theo_hang` (mig 257, GET) thay cho
  tải từng lô; chỉ lùi về `docLoBan` khi sổ CHƯA CÓ hàm (`chuaCoRpc`) — lỗi khác báo như đọc lô hỏng, không gửi thêm câu.
  · **Khoá tìm dựng một lần**: `taoMucTim` chuẩn hoá mỗi trường MỘT lần và nhớ theo nội dung (sổ hàng / sổ khách / từng ô tìm
  dùng chung) — mở POS ở máy chậm từng mất ~0,5 giây dựng lại 2–3 lần cùng danh mục. `khoa` phải y hệt `viSearchKey`.
  · View đọc bảng có RLS **phải** `WITH (security_invoker = true)` (luật mig 092) — view thường bỏ qua RLS, NVBH cộng được tiền
  của cả NPP; khám sổ dòng 96 báo LỆCH nếu thiếu. View chốt cột lúc tạo (`i.*`): migration nào
  thêm cột cho `sales_invoices` thì dựng lại `v_hoa_don_con_lai` trong cùng tệp (quên thì lọc theo cột mới hỏng, danh sách
  lùi về cách chậm — khám sổ 96 cũng báo LỆCH).
- **Đợt 6 — báo cáo Nhân viên** (chủ nhà 03/11/2026: *"Kiểm tra lại tại sao phần báo cáo lại load lâu thế"*; đo bản build + sổ
  giả một tháng 3.000 HĐ, proxy giống production — trần 1.000 dòng, chỉ cột được chọn, nén gzip):
  · Báo cáo › Nhân viên + Báo cáo tổng hợp › Nhân viên đọc **một lượt** `bao_cao_so_ban` qua `docSoBanMotLuot`
  (`src/lib/bao-cao/nap-ban-hang.ts`, chung với Báo cáo tổng hợp — `tuMotLuot` ra đúng dòng thô của cách cũ) **cùng đợt** với danh
  mục (nhân viên / khách / mặt hàng): 91 câu / 6,4–6,7 s → 15 câu / 4,3–4,5 s (CPU ×4). Cách cũ là hai đợt nối đuôi (21 lô dòng
  HĐ + 22 lô dòng kho + 20 lô soát phiếu xuất của HĐ huỷ, mỗi câu `count: exact`) và giá vốn đọc cả khi không xem "Lợi nhuận".
  Sổ chưa có hàm (`null`) → đọc từng bảng như cũ (`bao-cao-nv-25p02.spec.ts` tắt hàm để kiểm đường ấy). Hàm trả cả dòng hàng
  đổi — `linesByInvoice` bỏ chúng. Sổ giả `bao_cao_so_ban` phải đúng bộ cột mig 256 (dòng trả có `unit_price`).
  · **Chỉ tính bảng của mối quan tâm đang xem** (`if (variant !== "…") return []` + `variant` trong mảng phụ thuộc): cả 5
  bảng từng tính cùng lúc (~0,8 s JS ở CPU ×4 → ~0,17 s).
  · Đo thực tế: `baoNapSauKhiVe("bc-nhan-vien" | "bc-hang-ban-nv", …)` → nhật ký `[bao-cao-nap]` (`/api/do-nap`); màn bắt đầu nạp
  sau `MO_TRANG_MS` (15 s) kể từ lúc mở trang thì tính từ lúc mở màn (báo cáo mở bằng menu, không tải lại trang).
- **Đợt 7 — các báo cáo cũ** (chủ nhà 03/11/2026: *"chuyển nốt các báo cáo cũ đi em"*): `/reports/sales`, `customers`,
  `products`, `finance`, `/analytics/business/overview`, `cost-profit`, `/analytics/products/overview`, `categories` đọc số bán
  **một lượt** qua `docSoBanKy(sb, range)` (`src/lib/bao-cao/nap-ban-hang.ts`) CÙNG ĐỢT với danh mục; màn Phân tích gọi hai lượt
  (kỳ này + kỳ trước) song song. Đo sổ giả một tháng: Bán hàng 92 → 16 câu, Tài chính 83 → 9, Tổng quan 91 → 13, Chi phí – lợi
  nhuận 62 → 7, Hàng hoá 28 → 15. Sổ chưa có hàm → đường đọc từng bảng giữ NGUYÊN bên dưới (bài ghim đọc nó).
  · `docSoBanKy` = đúng tập dòng của cách cũ: **bỏ dòng hàng đổi** (như `fetchInvoiceLines`; `docSoBanMotLuot` thì trả đủ — Báo
  cáo tổng hợp / Nhân viên tự bỏ). `tuMotLuot` **xếp lại** `hd` (ngày giảm dần rồi id) và `tra` (id) như cách cũ — hàm máy chủ
  không xếp, mà `nhanVienPhieuTra` đoán NV phiếu trả cũ theo HĐ GẶP TRƯỚC khi hai HĐ cùng ngày (thiếu bước xếp là phiếu rơi
  sang NV khác). Kèm `giaVonXuat` (= `fetchCogsForRange().cogs`) và `giaVonTheoSp` (Hàng hoá › Lợi nhuận).
  · Phần màn ấy chỉ cần khi mở một tab thì **đọc khi mở tab** (effect có `let bo` — đổi kỳ / tab giữa chừng thì bỏ kết quả cũ):
  Bán hàng › Lợi nhuận không lọc (giá vốn THEO NGÀY — `fetchCogsForRange`, `canGiaVonNgay`); Hàng hoá › Giá trị kho / Xuất nhập
  tồn (lô tồn `canLo`; phiếu kho + dòng + biến động `canXnt`). Bảng của từng tab chỉ tính khi đang xem (`if (variant !== …)`).
  · Đo thực tế `[bao-cao-nap]`: khoá `bc-ban-hang`, `bc-khach-hang`, `bc-hang-hoa`, `bc-tai-chinh`, `pt-tong-quan`,
  `pt-chi-phi-loi-nhuan`, `pt-hang-tong-quan`, `pt-hang-nhom` (`/api/do-nap` nhận `bc-` / `pt-`).
  · Bấm thật so HAI đường trên cùng dữ liệu (chụp chữ trong `<main>` có hàm rồi tắt hàm, phải bằng nhau):
  `e2e/bao-cao-cu-mot-luot.spec.ts`. Sổ giả `bao_cao_so_ban` mang luật mig 228 (bỏ phiếu xuất của HĐ huỷ / "Đảo phiếu trả").
  · Còn đọc từng bảng (không cần dòng bán hoặc khác nguồn): `end-of-day` (giá vốn theo phiếu xuất của từng HĐ), `channels`,
  `/analytics/customers/*`, `suppliers`, `orders` (đơn hàng).

### Ảnh + vị trí điểm bán
Chủ nhà 12/10/2026: *"phần cập nhật ảnh kèm định vị cho điểm bán. chưa sửa, cập nhật lại, xoá ảnh + vị trí cũ"*.
- **Nén trước khi tải lên** (`prepareImage`, `src/lib/images/prepare.ts` — dùng chung ảnh điểm bán + ảnh POD): cạnh dài tối
  đa **1024 px** (chủ nhà 24/10/2026 *"hạ xuống"* từ 1280), JPEG 0,7, đóng dấu giờ + toạ độ; không phóng to ảnh nhỏ
  (`kichThuocSauNen`). Nén hỏng (trình duyệt không giải mã được file) thì tải nguyên file gốc, không mất ảnh.
- **Chụp lại** = sửa dòng `customer_photos` tại chỗ (giữ ô), không xoá-rồi-chèn. Tấm đã ghim vị trí
  (`isStorePinFromPhoto`) thì vị trí đi theo ảnh mới; xoá tấm ấy thì hỏi xoá luôn vị trí.
- Tự ghim lúc chụp vẫn **chỉ khi chưa có toạ độ** (`shouldPinCustomer`). Dời / xoá vị trí là nút riêng, đọc vị trí
  mới rồi hỏi (`canRepinStore`) — `src/components/customers/customer-photo-capture.tsx`.
- File trong kho `customer-photos` xoá qua **`/api/customers/photo-cleanup`** (khoá máy chủ; chỉ file của đúng đơn vị,
  không còn dòng nào trỏ tới, kể cả ảnh mới của yêu cầu đang chờ). Trình duyệt gọi `storage.remove` thì im lặng không xoá
  gì — mig 207 đã bỏ policy SELECT.
- **Duyệt** (chủ nhà 12/10/2026, mig 244: *"Chủ NPP đã phê duyệt thì khi thay đổi hoặc xoá ảnh+vị trí cần nhà phân phối
  phê duyệt"*): người có quyền `customers.approve` (chủ NPP; ai khác do chủ cấp) bấm "Duyệt ảnh + vị trí" là khoá
  (`customers.photo_approved_at`). Đã duyệt thì NV thêm / thay / xoá ảnh, dời / xoá vị trí → **yêu cầu**
  (`customer_photo_requests`, `xin_doi_anh_diem_ban`), chưa đổi gì tới khi duyệt (`duyet_yeu_cau_anh_diem_ban`). Trigger
  chặn ghi thẳng; người duyệt sửa thẳng được. Luật ở màn: `src/lib/customers/photo-approval.ts`. Form "Sửa thông tin"
  **không gửi lại toạ độ** khi lưu (nút Định vị đã ghi ngay) — gửi kèm là đè vị trí vừa được duyệt dời.
- **Đi tuyến chỉ check-in, không chụp ảnh** (chủ nhà 12/10/2026): hộp Ghé thăm chỉ ghi vị trí + kết quả + ghi chú.
- **"Mở để chụp" / "Mở để duyệt" mở thẳng khối ảnh** (chủ nhà 20/10/2026: *"…mở ra chi tiết khách hàng ở phần chụp ảnh
  luôn (hiện tại đang phải cuộn chuột xuống mới thấy)"*): `linkAnhDiemBan` → `/customers/<id>#anh-diem-ban`; chi tiết khách
  vẽ sau khi tải nên tự cuộn MỘT lần khi khối đã có. Mở khách không kèm neo thì vẫn ở đầu trang.
- Trang chủ NVBH có nút **"Cập nhật ảnh điểm bán"** (chủ nhà 20/10/2026) ngay dưới Đi tuyến / Thu công nợ →
  `/customers/missing-photos`; chỉ hiện khi vào được màn ấy (`anhDiemBan` của `SalesHome`).

## 2. Git / phát hành
- Chủ nhà chốt 25/09/2026: *"tạo branch mới upv2 để tao phát triển tiếp các tính năng, thử nghiệm kỹ
  trên branch preview rồi mới đẩy lên production"*.
- **Phát triển và push trên nhánh `upv2`** (`git push -u origin upv2`) — đó là bản preview để thử.
- **KHÔNG đẩy lên `main` (production) khi chủ nhà chưa bảo rõ trong chính lượt đó.** Không tự đẩy
  theo thói quen của các đợt trước. `newdesign` là nhánh cũ, không push thêm. Không tạo PR khi chưa được bảo.
- Preview và production **dùng chung một DB Supabase** — migration chạy là chạy thật.
- Supabase ở **Singapore** → function Vercel chạy **`sin1`** (`vercel.json` → `regions`, chủ nhà chốt
  25/09/2026). Không bỏ / đổi vùng: về `iad1` (Mỹ) là mọi lượt vẽ trang đi vòng VN → Mỹ → Singapore.
- **Font Manrope TỰ LƯU trong repo — build không tải từ Google** (chủ nhà 12/11/2026: *"Có lỗi gì mà font chữ thay đổi hết
  vậy"*): `next/font/google` tải font LÚC BUILD riêng cho phần máy chủ và phần trình duyệt, tên lớp băm từ CSS Google trả.
  Google đổi tệp Manrope → bản ceb2b87 trên Vercel: phần máy chủ tải mới (`<html class="__variable_08700a">`), CSS dùng lại
  bộ nhớ build cũ (chỉ có `.__variable_6c36b7`) → `--font-manrope` rỗng, cả app về font mặc định mà build vẫn xanh. Nay
  `next/font/local` + `src/app/fonts/manrope-latin-vi.woff2` (Manrope[wght] 4.505 của google/fonts, OFL; cắt đúng ba vùng
  latin + latin-ext + vietnamese, bỏ hinting, giữ trục 200–800 và tính năng của Google — có `tnum`; nét + độ rộng từng ký tự
  y hệt tệp Google ở 6 độ đậm; một tệp 36 KB thay ba tệp ~48 KB) — **đừng quay lại `next/font/google`**. Cắt lại tệp: lệnh
  trong chú thích `src/app/layout.tsx`. `npm run build` = `next build && node scripts/kiem-font-build.mjs`: lớp next/font trên
  mọi trang dựng sẵn phải có trong CSS CHÍNH trang ấy nạp — lệch là build THẤT BẠI, Vercel giữ bản đang chạy. Test:
  `tests/font-tu-luu.test.ts` (đọc thẳng cmap / GSUB / fvar của tệp WOFF2: đủ chữ tiếng Việt, có `tnum`, trục phủ 400–700),
  `e2e/font-manrope.spec.ts` (biến có giá trị, mặt chữ tải được — bỏ `variable` là đỏ).
- Commit message tiếng Việt. Không ghi tên / mã model vào bất cứ thứ gì đẩy lên repo.

## 3. Migration (`supabase/migrations/NNN_*.sql`)
- Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS`), đầu tệp có khối **VÌ SAO**
  (trích lời chủ nhà + ngày).
- Thẻ dollar ASCII (`$fn$`, `$chk$`…). Hàm `SECURITY DEFINER` nội bộ phải
  `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (luật mig 166).
- Kết thúc bằng `NOTIFY pgrst, 'reload schema';` và một câu `SELECT` tóm tắt kết quả.
- Thêm một dòng kiểm vào `scripts/sql/kham-so-that.sql`, rồi chạy
  `bash scripts/build-combined-migration.sh`.
- Nhắc chủ nhà các migration cần chạy trên Supabase sau mỗi đợt.
- **Khoá tìm `tim_kd` là CỘT THẬT do trigger ghi** (chủ nhà 20/10/2026, mig 249: *"sao tìm kiếm số hóa đơn trong danh sách
  hóa đơn chậm thế ?"*). Đừng làm khoá tìm thành hàm tính từng dòng (cột tính PostgREST) hay cột generated: dưới RLS `ilike`
  không đi chỉ mục, máy chủ tính lại khoá cho MỌI dòng ở mọi câu (40.000 HĐ ≈ 43 giây một câu); generated thì từ chối câu
  ghi lại nguyên dòng (mig 177). Trigger `trg_zzzz_tim_kd` phải chạy SAU mọi trigger BEFORE khác (trigger đặt mã).
- **Chính sách RLS: bọc hàm quyền trong `(SELECT …)`** (chủ nhà 20/10/2026, mig 250: *"làm tương tự cho tìm kiếm các danh
  sách khác"*): viết `org_id = (SELECT user_org_id())`, `(SELECT user_role()) = …`, `x = (SELECT auth.uid())` — gọi thẳng thì
  Postgres gọi lại cho TỪNG dòng (NVBH đếm công nợ 1,4 giây thay vì 8 ms). Hoặc cuối migration gọi
  `SELECT public._rls_tinh_mot_lan_ap();`. Hàm theo dòng (`customer_org_id(customer_id)`) để nguyên.
- **Chính sách RLS: không tra `information_schema` / catalog, hàm gọi từng dòng thì đổi sang tập tính một lần** (chủ nhà
  03/11/2026 *"làm cả 2"*, mig 260): vế dò cột `created_by` trong `information_schema.columns` của `customer_select` tốn ~1,5 ms
  LẬP KẾ HOẠCH ở MỌI câu đụng bảng khách (mọi danh sách đơn / HĐ / phiếu thu kèm tên khách); `user_sells_to_customer(id)` gọi
  cho từng khách NVBH không phụ trách → `id IN (SELECT khach_toi_da_ban())` (SECURITY DEFINER — không đệ quy RLS; tính một
  lần, tra băm). Trong OR đặt vế rẻ trước (phân công "của chính tôi" trước `customer_org_id(...)`). Sổ khách màn bán của NVBH
  35,9 → 1,6 ms. Vá trên **bản đang chạy** (`pg_get_expr` → `ALTER POLICY`, như mig 250), đừng chép lại trọn chính sách từ tệp
  cũ (mig 154); kiểm bằng so TẬP DÒNG từng người thấy trước / sau (`scripts/sql/thu-260-rls-khach-tinh-mot-lan.sql`) — cắt
  chuỗi sai một ngoặc là ai cũng thấy hết khách mà mọi bài khác vẫn xanh.
- **JIT tắt cho vai `authenticated`** (mig 251): bật thì mỗi câu danh sách mất ~0,9 giây biên dịch, trang chủ 4,9 giây.
  Đừng bật lại; câu nào thật sự cần thì `ALTER FUNCTION … SET jit = on` riêng hàm ấy. **Mig 252 tắt thêm ở vai đăng nhập
  `authenticator` + `anon`** (chủ nhà 24/10/2026, bảng `pg_stat_statements`: danh sách hoá đơn ~3 s/câu; tái hiện trên sổ
  thử 40.000 HĐ: JIT bật 4.245 ms, tắt 11 ms) — cài đặt của vai đăng nhập do Postgres tự áp lúc mở kết nối, không phụ
  thuộc PostgREST có áp cài đặt của vai giả lập hay không.
- **Hàm báo cáo tắt JIT ngay trên hàm** (mig 256, chủ nhà 29/10/2026 — Báo cáo Bán hàng quá 10 giây): `bao_cao_so_ban`
  ước lượng ~1,09 triệu > ngưỡng tối ưu JIT nên mỗi lần gọi ngồi biên dịch ~3 giây (sổ thử: bật 3,4–4,1 s, tắt 0,3–0,6 s)
  dù đã có mig 251 / 252. `SET jit = off` trên hàm thì áp ngay lúc gọi, không phụ thuộc vai / kết nối nào. Hàm báo cáo
  nặng mới: viết `SET jit = off` ngay trong `CREATE FUNCTION`. `bao_cao_so_ban` không còn `dong_don` / `dong_hd_goc` (giá lúc
  bán của mig 218 — luật chênh 01/10/2026 không dùng); đừng thêm lại phần app không đọc.
- **Hàm phụ gọi từ trigger / plpgsql viết plpgsql** (mig 258, chủ nhà 03/11/2026 — khách NPP *"Loát chậm quá" · "Mất 3
  phút"*, Xuất hàng TB 1.294 ms): hàm `LANGUAGE sql` có `SET search_path` không mở (inline) được và bị **lập kế hoạch lại MỖI
  lần** một câu plpgsql gọi nó (Postgres ≤ 17) — khoá tìm `khoa_tim_ds` 1,45 ms / lần, `_da_xuat_cua_dong_don` 0,45 ms / dòng
  HĐ, `_chuan_he_so_dong_hoa_don` 1,7 ms / lần Xuất hàng. plpgsql giữ kế hoạch cả phiên: sổ thử cỡ thật Xuất hàng −27%, Sửa HĐ
  −25%, Tạo đơn −20%, khoá tìm ×25. Viết lại hàm có sẵn thì dựng lại bản cũ và so TỪNG kết quả trên kho mẫu (kể cả lỗi báo
  ra) như `scripts/sql/thu-258-ham-phu-plpgsql.sql`; khoá tìm vẫn phải trùng `viValueKey`. Đo trong vòng lặp `x := f(…)` thì
  bản SQL không lộ chậm (biểu thức đơn giữ kế hoạch) — đo đúng cách gọi thật: mỗi lần một câu / một giao dịch. Đợt 2 mig 259
  (chủ nhà *"làm cả 2"*): 11 hàm nữa — quyền / giảm giá đơn, thuế, mã chứng từ, điều khoản, `vn_today`, `_la_trinh_duyet`
  (tổng 123,6 → 32,5 ms / 100 lệnh; Tạo đơn −10%, Sửa HĐ −13%). Đổi ngôn ngữ hàm KHÔNG đổi PARALLEL / STRICT / search_path /
  quyền — bộ thử so cả `proacl` (`scripts/sql/thu-259-ham-phu-plpgsql-dot2.sql`).

## 4. Trước mỗi commit
`npx tsc --noEmit` · `npx next lint` · `npx vitest run` · `npx next build` · e2e **liên quan** tới chỗ sửa
(`npx playwright test e2e/<tệp>.spec.ts`).
- **Full e2e (`npx playwright test` đủ bộ) chỉ chạy khi chủ nhà chỉ định** (chủ nhà 26/09/2026: *"full
  e2e sẽ do tao chỉ định"*). Không tự chạy đủ bộ, kể cả trước khi push lên main.
- Mỗi sửa lỗi có test; thử phá (mutation) để chắc test bắt được lỗi.
- Không thêm thư viện mới.

## 5. Bảo mật
- **Không bao giờ xin hay nhận khoá / mật khẩu / token qua chat** (chủ nhà: *"đừng đưa khoá cho
  tôi qua chat — nó sẽ nằm lại trong lịch sử hội thoại"*).
