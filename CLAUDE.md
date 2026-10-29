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
- Hàng trả cùng luật (đơn giá phiếu trả − giá bảng cùng đơn vị). **Chênh thuần = chênh bán + chênh trả** (chủ nhà
  12/10/2026, thay "bán − trả": *"Giá trị này npp đã trả cho nhân viên nên giờ cần thu hồi"*) — `chenhThuan`.
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

### Thêm hàng ở POS
Chủ nhà 13/10/2026: *"thêm sản phẩm thì sản phẩm xuất hiện đầu danh sách luôn"* · *"phần đổi trả dài quá ko có scroll
… chỉ hiện hàng đổi trả không hiện phiếu đi"*.
- Dòng mới lên **đầu** danh sách ở mọi màn POS (`themLenDau` / `donLenDau`, `src/lib/pos/them-dong.ts`); gộp dòng trùng
  thì dòng được cộng cũng lên đầu. Thứ tự lưu = thứ tự trên màn. Bảng cuộn tới dòng vừa thêm (`dongMoi`, `data-dong`).
- Khối **hàng đổi trả** (màn đơn, hoá đơn) có trần `max-h-[42vh]`, dòng cuộn trong khối — không được che bảng hàng đi.
  Màn **xem** hoá đơn / đơn: khối chứng từ liên quan (`RelatedDocs`, kèm hàng đổi trả) bọc trong `cuon-lien-quan` có trần.

### Quét mã vạch ở form sản phẩm
Chủ nhà 24/10/2026: *"phần thêm sản phẩm đoạn mã vạch thêm cho tao phần quét mã vạch nhé"*.
- Ô Mã vạch của `ProductForm` (máy tính, điện thoại, khung tạo nhanh) có nút quét → **dùng lại** `BarcodeScanner`
  (`src/components/ui/barcode-scanner.tsx`, html5-qrcode: camera + nhập tay), không dựng bộ quét thứ hai; mỗi lần mở chỉ nhận
  MỘT mã rồi đóng (camera bắn 10 lần/giây — `daNhanRef`). Luật mã: `src/lib/products/ma-vach.ts` (`chuanMaVach` bỏ CR/LF
  máy quét gửi kèm). Nhãn nút nhập tay theo nơi gọi (`manualLabel`).
- **Enter trong ô Mã vạch không gửi form** (máy quét USB / Bluetooth gõ mã rồi Enter) — chỉ sang ô Tên hàng.
- Mã đã gắn cho sản phẩm KHÁC → **cảnh báo** (`cauTrungMaVach`, hỏi sổ lúc quét / rời ô, loại chính hàng đang sửa), vẫn cho
  lưu — sổ không khoá trùng mã vạch.

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

### Tờ in hoá đơn: hàng đổi / hàng trả
Chủ nhà 13/10/2026: *"mẫu phiếu in hiện tại không in ra hàng đổi và hàng trả hóa đơn"*.
- Tờ in hoá đơn (POS `/in/hoa-don`, màn quản lý, Excel "như mẫu in") in **mọi dòng đổi / trả của phiếu đã trừ vào tờ**
  (`creditCounted`) — kể cả hoá đơn chỉ có hàng đổi (trừ 0đ) và hoá đơn **đã phát hành HĐĐT**. Một luật:
  `hangDoiTraTrenBanIn` (`src/lib/orders/invoice-credit.ts`). Phiếu nháp / đã huỷ không in.
- "Tổng cộng" giữ tiền hoá đơn; "Trừ hàng trả" / "Còn phải thu" là dòng thêm khi có trừ. Dòng đổi xuất đi (0đ) vẫn bỏ
  khỏi bảng hàng — món đổi hiện ở dòng "(Hàng đổi) … không trừ".

### Thêm khách hàng: TÌM khách đã có trước khi tạo
Chủ nhà 06/06/2026: *"trước khi NV sale thêm KH mới, cần check trùng (theo SĐT, địa chỉ, tên). Nếu KH đã tồn tại — kể
cả do NV khác phụ trách — cho phép sale 'thêm vào danh sách của tôi' thay vì tạo trùng"*; 14/10/2026: *"…trên điện thoại
của nhân viên mất phần tìm khách hàng đã có trước khi tạo rồi"*.
- `/customers/new` máy tính **và điện thoại**: bước "Tìm khách hàng đã có" trước (`CustomerDupeFinder` /
  `TimKhachTruocKhiTao`, một đường tìm `useDoTrungKhach` → `search_customer_dupes`, thấy cả khách NV khác). Tới bằng
  `?sdt=` (đã tìm số không ra, chủ nhà 01/10/2026) thì vào thẳng form gán sẵn số. "Thêm khách khác" về bước tìm.
- **Tìm ra khách thì KHOÁ nút "Tạo khách hàng mới"** (chủ nhà 20/10/2026: *"khi tìm kiếm ở màn tạo khách hàng này đã có
  kết quả thì nút tạo khách hàng mới không bấm được để ngăn tạo trùng khi đã có, khi không có kết quả tìm kiếm mới bấm
  được"*): số đủ mà kết quả chưa về cũng khoá; chưa gõ / số chưa đủ thì bấm được (form vẫn chặn trùng số). Một luật cho
  máy tính + điện thoại: `khoaTaoKhachMoi` qua `useDoTrungKhach`. Một số một khách là `UNIQUE(org_id, phone)` — đừng gỡ.
- **Chỉ tìm CHÍNH XÁC theo số điện thoại** (chủ nhà 15/10/2026: *"nhập đúng số điện thoại của khách thì khách mới hiện
  ra"*): tên / địa chỉ / số dở không tìm, không gửi đi (`sdtTimChinhXac`); máy chủ cũng chỉ khớp đúng số (mig 245).
  Đừng nới lại thành tìm từng phần — hàm SECURITY DEFINER, tìm từng phần là lộ khách của nhân viên khác.
- Nhận khách: `nhanKhachVeDanhSach` (`claim_customer_for_me`, chỉ vai sales). NVBH chưa nhận thì **không** đưa link
  mở khách (RLS — trang trống). Form điện thoại trùng SĐT → nút "Thêm vào DS của tôi" (tạo nhanh: nhận xong chọn luôn).

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
- **JIT tắt cho vai `authenticated`** (mig 251): bật thì mỗi câu danh sách mất ~0,9 giây biên dịch, trang chủ 4,9 giây.
  Đừng bật lại; câu nào thật sự cần thì `ALTER FUNCTION … SET jit = on` riêng hàm ấy. **Mig 252 tắt thêm ở vai đăng nhập
  `authenticator` + `anon`** (chủ nhà 24/10/2026, bảng `pg_stat_statements`: danh sách hoá đơn ~3 s/câu; tái hiện trên sổ
  thử 40.000 HĐ: JIT bật 4.245 ms, tắt 11 ms) — cài đặt của vai đăng nhập do Postgres tự áp lúc mở kết nối, không phụ
  thuộc PostgREST có áp cài đặt của vai giả lập hay không.

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
