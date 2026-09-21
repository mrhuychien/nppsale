# `/pos` — những chỗ giao diện đang chờ dữ liệu

Spec giao diện `/pos` chốt 21/09/2026, mục "⛔ Không đụng vào":

> Nếu gặp chỗ UI cần dữ liệu mà backend chưa trả → **ghi TODO vào
> `docs/pos-todo.md`, render placeholder, đi tiếp**. Không tự thêm endpoint.

Tệp này là danh sách ấy. Mỗi mục ghi **chỗ nào trên màn**, **thiếu gì**,
và **màn hình đang hiện gì thay thế** — để lần sau ai mở ra cũng biết
ngay là chưa làm chứ không phải hỏng.

---

## 1. Đơn vị giảm giá không sống qua lần mở lại

**Chỗ:** cột `GIẢM` của bảng hàng (spec §5) và dòng `Giảm giá đơn` trong panel.

**Thiếu:** bảng chứng từ hiện chỉ có cột **số tiền đã quy đổi**, không có
cột `discount_unit`. Nên một dòng gõ `5%` lưu xuống thành `33.500`, và lần
mở lại nó hiện `33.500 ₫` chứ không phải `5 %`.

**Đang hiện:** đúng số tiền — **con số không sai**, chỉ mất thông tin
"người dùng đã gõ theo đơn vị nào". Trong cùng một phiên thì đơn vị được
giữ ở state client nên đổi số lượng vẫn chạy đúng luật.

**Muốn sống qua lần mở lại** thì cần thêm một cột `discount_unit` — đó là
đổi schema, nằm ngoài đợt này.

---

## 2. "Nợ sau đơn này" chưa có số

**Chỗ:** panel màn 1, dòng ngay dưới `Tính vào công nợ`; card NCC màn 9–12.

**ĐÃ NỐI (đợt 5).** `loadCustomerDebt` / `loadSupplierDebt` đọc
`receivables` / `payables` qua `fetchAllForAggregate`.

**Còn thiếu:** không có gì — nhưng luật `null` phải giữ: đọc hỏng hoặc bị
cắt 1.000 dòng thì trả `null`, và màn hiện `chưa xác định`.

**Đang hiện:** số thật; `chưa xác định` khi chưa đọc được.

⚠ **Cố tình không hiện `0`.** Số 0 ở ô công nợ đọc như "khách này sạch nợ",
và người đi đòi tiền tin vào nó. Đây đúng là luật §4 của Coder Pack.

---

## 3. Dòng phụ dưới tên hàng còn thiếu ba số

**Chỗ:** bảng hàng màn 1 (spec §4).

**ĐÃ NỐI (đợt 5):**
- `đã xuất N` — qua `loadInvoiceableLines`, và đó chính là **sàn của
  stepper** ở màn sửa đơn (§7.1).
- `giá gần nhất … · N lần mua` — `loadLastPrices`, đọc từ **dòng hóa đơn**
  đã ghi sổ (không đọc dòng đơn: đơn là thứ đã thoả thuận, hóa đơn là thứ
  đã thu). Trần 500 dòng gần nhất — là **gợi ý**, không phải thống kê đủ.

**Còn thiếu:** `Đã đặt N` (số đã đặt của mặt hàng trên các đơn khác).

**Đang hiện:** `Tồn N` và hai số đã nối là số thật; `Đã đặt` không vẽ ra
chứ không vẽ số 0.

---

## 4. Lô & hạn sử dụng chưa có danh sách

**Chỗ:** cột `LÔ / HSD` (spec §4) và select lô trong bảng trả/đổi.

**ĐÃ NỐI (đợt 5):** `loadLotsByProduct` — lô còn hàng, **chỉ kho BÁN**,
sắp **hạn gần trước** (lô cần đẩy đi trước nằm trên cùng).

**Còn thiếu:** không có ở phía BÁN.

⚠ Không để select rỗng — một select rỗng trông y hệt một select đã chọn xong.

⚠ **Phía MUA thì khác hẳn, xem mục 16 và 17:** màn nhập không có ô lô (máy
chủ tự sinh), màn trả NCC không có ô chọn lô (máy chủ lấy FIFO).

---

## 5. Dải xem trước delta mới nói được một nửa

**Chỗ:** cuối cột trái các màn sửa chứng từ đã ghi sổ (spec §7.2). Đã dựng
ở màn 8 (sửa phiếu trả); màn 7/10/12 thuộc đợt 3–4.

**Thiếu:** endpoint dry-run trả trước "kho sẽ đổi thế nào, công nợ sẽ đổi
thế nào" khi lưu.

**Đang hiện:** dải nói được phần suy ra từ chính các dòng đang gõ — CHIỀU
và SỐ LƯỢNG hàng vào kho nhận / ra Kho bán. Hai thứ còn thiếu là tồn
TRƯỚC/SAU và công nợ TRƯỚC/SAU; ô nào chưa biết thì hiện `đang tính…`.

⚠ **Cố tình không vẽ số 0 vào phần chưa biết.** Một dải toàn 0 đọc như
"lưu xong chẳng có gì đổi" — câu trả lời nguy hiểm nhất có thể hiện ở đó,
vì nó đứng ngay trước một bút toán kho thật.

⚠ Spec ghi rõ: **không tự viết RPC**.

---

## 6. Nút `Hoàn tác` trên toast

**Chỗ:** toast xác nhận sau khi lập hóa đơn (spec §9).

**Thiếu:** chưa xác nhận đường huỷ nào dùng được ngay sau khi lập mà không
đụng nghiệp vụ. Kho mã có `cancelInvoice` (đi qua RPC `cancel_invoice`),
nhưng huỷ một hóa đơn vừa lập là một thao tác **ghi sổ thật**, không phải
"hoàn tác" theo nghĩa nhẹ nhàng mà toast gợi ra.

**Đang hiện:** chưa dựng toast hoàn tác. Spec cho phép: *"Nếu chưa có → ẩn
nút, ghi TODO"*.

---

## 7. Lưu chứng từ từ `/pos` chưa nối

**Chỗ:** nút `Lưu tạm` / `Lưu thay đổi` / `Xuất hàng & lập HĐ` màn 1.

**ĐÃ NỐI (đợt 5)** — toàn bộ nằm ở `src/lib/pos/save.ts`, và tệp ấy
KHÔNG viết một dòng nghiệp vụ mới nào. Nó chỉ dịch state của màn POS sang
đúng tải trọng mà lib/RPC đang chạy đã nhận:

| chứng từ | đi qua |
|---|---|
| đơn hàng | `createOrderRecords` / `applyOrderEdit` |
| hóa đơn | `postInvoice` / `reissueInvoice` |
| phiếu trả | bảng `returns` + `completeReturn` |
| phiếu nhập | `saveReceiptLines` + RPC `complete_purchase_invoice` |
| trả NCC | `saveReturnLines` + RPC `complete_supplier_return` |

**Rà soát (đợt 6):** hàng trả kèm đơn (`F8`/`F9`) nay đi xuống thật qua
`returnLines` + `heldReturnId` — bản đầu gửi `[]` trong khi panel vẫn trừ
"Trừ hàng trả". Mã chống lặp `client_request_id` sinh MỘT lần mỗi lần mở
màn (bản đầu sinh mỗi cú bấm nên bấm lại sau rớt mạng là hai đơn).

**Còn thiếu:** nút `Lưu thay đổi` của màn 1b làm **hai bước** khi vừa lưu
vừa lập hóa đơn (`applyOrderEdit` rồi `postInvoice`). Bước 2 hỏng thì đơn
ĐÃ lưu, và màn nói thẳng điều đó thay vì báo "chưa lưu được".

⚠ **Không** tự gọi đại một RPC cho có. Mọi thao tác đụng tồn kho / công nợ
/ trạng thái đơn phải đi qua đúng RPC `SECURITY DEFINER` đang có, một giao
dịch, idempotent. Có chốt canh ba việc: chỉ `lib/pos/save.ts` được gọi
`.rpc()`, mọi tên RPC phải có trong migration, và tên tham số phải khớp
đúng thứ `/purchasing` đang gửi.

---

## 8. In phiếu — chưa có mẫu in riêng cho POS

**Chỗ:** nút `In` ở topbar và trên panel mọi màn; tab `In phiếu` của drawer.

**Rà soát (đợt 6):** bản đầu gọi `window.print()` — in cả màn POS ra một
trang toàn nút bấm. Nay: đơn hàng và hóa đơn đã lưu **mở trang in của
phần đang chạy** (`/orders/[id]/print`, `/sales-invoices/[id]/print`, xem
`posPrintHref`); phiếu trả / phiếu nhập / trả NCC **chưa có mẫu in** nên
nút mờ kèm lý do.

**Thiếu:** mẫu in cho ba loại phiếu kia, và thiết lập in riêng cho POS.

---

## 9. Ô `NVBH` và `Tuyến` trên sub-header màn 1

**Chỗ:** góc phải sub-header (spec §2).

**ĐÃ NỐI một nửa (đợt 5):** `loadSellers` nạp NVBH — và **đúng bộ vai trò
trigger cho phép** (`sales/manager/owner`, migration 153). Hiện ra một cái
tên máy chủ sẽ từ chối là bẫy người dùng.

**Còn thiếu:** danh sách **tuyến**.

**Đang hiện:** select NVBH có tên thật; select tuyến chỉ có ô rỗng `—`.

⚠ Select **phải** có ô rỗng rõ ràng, nếu không người dùng không có cách
nào bỏ chọn thứ họ lỡ chọn.


---

## 10. Phiếu trả chưa nối hóa đơn gốc

**Chỗ:** màn 3, dòng `Giá gốc hàng mua` trên panel và ô tìm hàng trả.

**ĐÃ NỐI (đợt 5):** `loadInvoiceLinesForReturn` nạp dòng của tờ gốc vào
bảng hàng trả, kèm giá khách đã mua. **Số lượng nạp về 0**, không nạp bằng
số đã mua — điền sẵn cả tờ là một cú Enter nhầm trả sạch hóa đơn.

⚠ **Bỏ dòng `is_exchange` của tờ gốc.** Dòng ấy là hàng đã GIAO BÙ cho
khách, không phải hàng khách mua — trả lại nó là một việc khác hẳn.

**Rà soát (đợt 6):** đã gắn hóa đơn gốc thì ô tìm hàng trả **chỉ liệt kê
món có trên tờ ấy**; khách của tờ lên card luôn; `Giá gốc hàng mua` có số
thật khi mọi dòng trả đều nằm trên tờ gốc. Nút `Trả hàng` trên màn hóa đơn
mở thẳng phiếu mới nạp sẵn tờ ấy (`/pos/tra-hang/moi?invoice=`).

**Còn thiếu:** không có gì ở phía nạp.

⚠ Đây là **ràng buộc nghiệp vụ**, không phải thẩm mỹ: trả một món không có
trên hóa đơn gốc là trả hàng không bán. Phần nghiệp vụ đang chạy đã có chốt
chặn (`enforce_return_line_cap`); màn này chỉ cần chặn sớm cho đỡ mất công.


---

## 11. ⚠ BẢN THIẾT KẾ NÓI SAI VỀ TIỀN ĐÃ THU — đã chỉnh câu chữ

**Chỗ:** màn 7, khối `ĐÃ THU` trên panel.

**Bản thiết kế ghi:** `ĐÃ THU — GIỮ NGUYÊN QUA LẬP LẠI`.

**Cơ chế thật KHÔNG như vậy.** `reissue_invoice` gọi `cancel_invoice`, và
`cancel_invoice` **từ chối thẳng** khi hóa đơn đã có tiền thu:

```sql
IF EXISTS (SELECT 1 FROM receivables r
           WHERE r.invoice_id = … AND COALESCE(r.paid, 0) > 0)
   OR EXISTS (SELECT 1 FROM cash_receipt_lines crl
              JOIN cash_receipts cr ON cr.id = crl.receipt_id
              WHERE cr.status <> 'voided' AND (…))
THEN RAISE EXCEPTION 'LOCKED_HAS_PAYMENT: hóa đơn đã có tiền thu, huỷ phiếu thu trước'
```

**Đo trên Postgres 16 thật:**

| Tình huống | Kết quả |
|---|---|
| chưa có tiền thu | lập lại **được** → số mới `HD-0001-1` |
| có tiền thu | **`LOCKED_HAS_PAYMENT`** — chặn hẳn |

**Đã làm gì:** spec §7.2 cho phép — *"Chỉnh lại câu chữ cho khớp hành vi
thật nếu khác"*. Nhãn nay là `Đã thu — phải huỷ trước khi lập lại`, và nút
`Huỷ HĐ & lập lại` **mờ kèm lý do** khi còn phiếu thu. Có chốt cấm câu cũ
quay lại.

**Còn thiếu:** nút `×` gỡ phiếu thu đang **mờ**. Huỷ một phiếu thu là ghi
sổ thật; đợt này chỉ dựng bề mặt. Người dùng vẫn huỷ được ở màn Thu tiền
đang chạy.

⚠ Chốt chặn thứ hai cũng đã nối: `LOCKED_EINVOICE` — hóa đơn đã phát hành
hóa đơn điện tử thì không lập lại được. Ô `HĐĐT MISA` của dải delta nói
đúng điều đó thay vì "cần điều chỉnh" (một đường đi phần mềm không mở).

---

## 12. Ô `KHO` của dải delta màn 7 chưa nói được chiều

**Chỗ:** dải delta màn 7, ô đầu tiên.

**Thiếu:** danh sách **lô đã lấy** của tờ hóa đơn cũ. Không có nó thì không
dựng được câu `SP001754 · L2609  hoàn về +5  trừ lại −3  ròng +2 gói` mà
spec §7.2 mô tả.

**Đang hiện:** số dòng hàng, không vẽ phần ròng.

⚠ Cố tình không đoán chiều. `cancel_invoice` hoàn hàng về **đúng lô đã
lấy**; đoán sai lô là dải này nói một chiều kho khác với chiều máy chủ sẽ
ghi — ngay trước lúc người dùng bấm.


---

## 13. ⚠ BÊN MUA KHÔNG CÓ LỆNH "LẬP LẠI" — đã chỉnh câu chữ

**Chỗ:** banner màn 10 (sửa phiếu nhập) và màn 12 (sửa phiếu trả NCC).

**Bản thiết kế ghi:** màn 10 mượn câu của màn 7 — *"huỷ và lập lại trong
cùng một giao dịch… giá vốn bình quân được tính lại"*; màn 12 mượn câu của
màn 8 — *"giữ nguyên số phiếu"*.

**Cơ chế thật khác cả ba điểm:**

| | Bên BÁN | Bên MUA |
|---|---|---|
| lệnh lập lại một bước | `reissue_invoice` ✓ | **không có** |
| giữ số chứng từ | `HD-0143-1` ✓ | **không** — phiếu mới, số mới |
| giá vốn | — | **theo LÔ** (`batches.unit_cost`), không có số bình quân |

Bên mua chỉ có `cancel_purchase_invoice` / `cancel_supplier_return` rời với
`complete_*`. Huỷ rồi lập lại là **hai thao tác riêng**, không phải một
giao dịch.

Giá vốn ghi ở `complete_purchase_invoice`:

```sql
v_unit_cost := (quantity * unit_price - line_discount) / base_qty
```

— từng lô một giá riêng. Không có số bình quân nào trôi theo mỗi lần nhập,
nên ô delta `GIÁ VỐN BQ` của spec §7.2 đổi thành **`GIÁ VỐN LÔ`**.

**Đã làm gì:** spec §7.2 cho phép — *"Chỉnh lại câu chữ cho khớp hành vi
thật nếu khác"*. Banner nay nói đúng: hai thao tác riêng, phiếu mới mang số
mới, giá vốn theo lô. Có chốt cấm cả ba câu cũ quay lại.

**Còn thiếu:** hai bộ khoá chưa đọc được từ màn POS —
`DA_TRA_TIEN` / `HANG_DA_XUAT` (phiếu nhập) và
`DA_CAN_TRU` / `LO_DA_DONG` (trả NCC). Luật đã cài sẵn
(`purchaseCancelLock`, `supplierReturnCancelLock`) và có chốt; chỉ chờ số
thật cắm vào. Mặc định là **không khoá** — đoán sai theo hướng này chỉ mất
một lời nhắc sớm, còn máy chủ vẫn chặn thật. Đoán ngược lại thì màn hình
khoá một phiếu sửa được và không ai gỡ nổi.

---

## 14. ⚠ ĐƯỜNG VỀ PHIẾU NHẬP GỐC KHÔNG LƯU XUỐNG ĐƯỢC

**Chỗ:** màn 11/12 — ô `Phiếu nhập gốc`, cột `Lô của phiếu gốc`, cột `ĐÃ NHẬP`.

**ĐÃ NỐI một nửa (đợt 5):** chọn một phiếu nhập đã hoàn thành của NCC ấy
(`loadReceiptsOfSupplier`, 50 phiếu gần nhất) thì nạp sẵn dòng hàng, giá
nhập, **số đã nhập** và **lô mà phiếu ấy đã sinh ra**
(`loadReceiptLinesForReturn`, nhận lô qua `batch_code LIKE '<mã phiếu>-%'`).

**Cái KHÔNG làm được:** `supplier_returns` **không có cột trỏ về phiếu
nhập**. Nên đường nối ấy chỉ sống trong phiên đang lập; mở lại phiếu đã lưu
là mất cả lô lẫn cột `ĐÃ NHẬP`.

⚠ **Mở lại thì `ordered` về `null`, KHÔNG về 0.** `supplierReturnMax(0)` là
0 — stepper khoá cứng ở 0 và người dùng không sửa nổi phiếu họ vừa lưu.

⚠ **Không có chốt chặn phía máy chủ cho trần này.** `complete_supplier_return`
không kiểm "trả quá số đã nhập"; nó chỉ báo `INSUFFICIENT_STOCK` khi kho
không đủ. Trần ở màn hình là **tiện ích**, không phải hàng rào.

**Muốn sống qua lần mở lại** thì cần thêm cột
`supplier_returns.purchase_invoice_id` — đổi schema, nằm ngoài đợt này.

---

## 15. Danh mục nhà cung cấp chưa nạp vào POS

**Chỗ:** card đối tác của màn 9–12, và dropdown `F4`.

**ĐÃ NỐI (đợt 5):** `loadSuppliers` — nạp RIÊNG, không nhét vào
`loadSellRefData`. Hàm ấy phục vụ `/sell` trên điện thoại; NVBH ngoài quầy
không cần danh mục NCC, và mỗi cột thêm vào đó là thêm dữ liệu tải về đúng
những máy có đường truyền kém nhất.

**Đang hiện:** dropdown `F4` có NCC thật; `Nợ NCC sau phiếu` có số thật, và
`chưa xác định` khi chưa đọc được.

---

## 16. ⚠ MÀN NHẬP TỪNG BẮT GÕ MÃ LÔ, VÀ MÃ ẤY BỊ VỨT ĐI

**Chỗ:** màn 9/10 — cột `LÔ / HSD`.

**Bản đợt 4 ghi:** một ô gõ tay `L2609 · 12/26`, thiếu thì viền đỏ và nút
`Hoàn thành & nhập kho` mờ.

**Cơ chế thật:** giá trị ấy **không đi tới đâu cả.**

- `purchase_invoice_lines` không có cột lô nào. `linePayloadOf`
  (`src/lib/purchasing/save-receipt.ts:34`) ghi đúng 10 cột, không cột nào
  nhận mã lô — kể cả khi tải trọng có mang.
- `complete_purchase_invoice` (migration 145, dòng 141) tự đặt tên:
  `batch_code := <mã phiếu> || '-' || lpad(seq, 3, '0')`.
- Hạn dùng cũng không do người nhập gõ: cùng hàm ấy lấy
  `products.shelf_life_days` (dòng 107) cộng vào ngày hôm nay, và mốc
  `2099-12-31` nghĩa là "không hạn".

**Đã làm gì (đợt 5):** bỏ ô gõ. Cột nay hiện **mã lô THẬT sẽ được đặt**
(`generatedLotCode`), và chân bảng nói rõ mã lô theo mã phiếu, hạn dùng
theo hồ sơ mặt hàng. Bỏ luôn điều kiện "thiếu lô thì mờ nút" — nó đòi một
việc vô ích. Có chốt cấm ô ấy quay lại.

⚠ **Đây là lỗi của chính đợt 4, không phải của bản thiết kế.** Spec §8 mục
1 viết "lô & HSD bắt buộc khi nhập" — đúng, và máy chủ ĐANG bắt buộc thật.
Cái sai là đọc nó thành "bắt người dùng gõ".

**Muốn người nhập tự đặt mã lô** thì cần thêm cột vào
`purchase_invoice_lines` và sửa `complete_purchase_invoice` — đổi schema và
sửa một RPC đang chạy ngoài thị trường, nằm ngoài đợt này.

---

## 17. ⚠ TRẢ NCC KHÔNG CHỌN ĐƯỢC LÔ — máy chủ lấy FIFO

**Chỗ:** màn 11/12 — cột `Lô của phiếu gốc`.

**Bản thiết kế ghi (spec §8 mục 4):** *"select lô CHỈ liệt kê lô thuộc
phiếu nhập gốc, không liệt kê toàn kho"*.

**Cơ chế thật:** không có select nào là thật được.

- `supplier_return_lines` (migration 068 dòng 51-65, 146 dòng 41) **không
  có cột lô nào**.
- `complete_supplier_return` (migration 146, dòng 155-165) tự chọn:
  `ORDER BY expires_at NULLS LAST, created_at, id` trong `warehouse_zone`
  của phiếu — **FIFO theo hạn**.

Một ô chọn lô ở đây là một cái cần gạt không nối vào đâu: người dùng chọn
`L2609`, máy chủ lấy lô cũ nhất, và không câu nào báo cho họ biết. Đó là
kiểu nói dối tệ nhất — đúng tại chỗ người dùng cẩn thận nhất.

**Đã làm gì (đợt 5):** lô của phiếu gốc hiện dưới dạng **chữ đọc để đối
chiếu**, và chân bảng nói thẳng *"Lô xuất đi do hệ thống chọn: hạn cũ
trước, trong <kho>"*. Có chốt cấm ô chọn quay lại.

⚠ **Và vì thế `Kho xuất` thành ô BẮT BUỘC trên sub-header.** FIFO chỉ quét
trong đúng vùng kho ghi trên phiếu; mặc định cứng vào `date` là trả hàng từ
kho bán sẽ ăn `INSUFFICIENT_STOCK` trong khi kho bán đang đầy đúng món ấy.

---

## 18. Hình thức hoàn tiền của phiếu trả NCC chưa đi xuống sổ

**Chỗ:** màn 11/12 — ba nút `Trừ công nợ / Tiền mặt / Chuyển khoản`.

**Cơ chế thật:** `complete_supplier_return` **luôn** ghi một dòng
`payables` mang số ÂM — tức luôn là "trừ công nợ". Tiền mặt và chuyển khoản
là một **phiếu chi riêng**, và màn POS chưa lập phiếu chi.

**Đang hiện:** ba nút đổi câu chữ trên màn, và khi chọn hai hình thức kia
thì có một dòng chữ cam nói thẳng rằng phiếu vẫn ghi giảm công nợ, phải lập
phiếu chi riêng.

⚠ Cùng lý do với mục 6: không tự gọi đại một đường ghi sổ cho khớp nhãn.

---

## 19. Ô `HĐ điều chỉnh NCC` chưa có cột lưu

**Chỗ:** màn 11/12 — ô cuối panel (spec §8 mục 3).

**Thiếu:** `supplier_returns` không có cột nào cho số hóa đơn điều chỉnh.

**Đang hiện:** ô gõ được, và ngay dưới có câu *"Chưa có cột lưu số này; ghi
vào đây chỉ để in trên phiếu"*.

---

## 20. ⚠ RÀ SOÁT ĐỢT 6 — những ô ĐÃ BỎ vì không có cột

Mỗi ô dưới đây bản đầu vẽ đúng theo spec §6, và mỗi ô đều **đổi số trên
màn mà không đi xuống sổ**. Spec §7.2 cho phép chỉnh cho khớp hành vi
thật; ô không lưu được thì không vẽ, hoặc hiện để đọc.

| Màn | Ô đã bỏ / khoá | Vì sao |
|---|---|---|
| 3/8 phiếu trả | `Phí trả hàng` | `returns` không có cột; `complete_return` tính `credit_note_amount` từ dòng |
| 7 sửa HĐ | `Giảm giá đơn`, `Thu khác`, `Hạn trả`, `Kho xuất`, `NVBH`, đổi khách | `reissue_invoice` chỉ nhận dòng, `payment_terms`, `invoice_date`, `notes` |
| 9/10 nhập hàng | `Chi phí nhập khác` | `purchase_invoices` không có cột; RPC tính `subtotal + vat − discount` |
| 9/10 nhập hàng | `Tiền trả NCC` + 3 nút phương thức | RPC luôn ghi cả phiếu vào `payables`; trả tiền là phiếu chi riêng |
| 3/8, 11/12 | 3 nút `Hình thức hoàn` | vẫn vẽ, nhưng chọn tiền mặt/CK thì có câu nói phiếu vẫn ghi công nợ |

**Muốn có lại** thì cần thêm cột + sửa RPC — đổi schema, ngoài đợt này.

**Thuế thì giữ được:** màn 7 đẩy thuế suất xuống `vat_rate` từng dòng; màn
9 gửi `vat_override` (bản đầu gửi `vat` ở đầu phiếu rồi RPC ghi đè bằng 0).

---

## 21. Rà soát đợt 6 — lỗi giao diện đã sửa

- **Phím tắt chết cho tới khi bấm chuột vào màn** — khung không có tiêu
  điểm nên `keydown` từ `<body>` không tới. Nay khung `tabIndex={-1}`, tự
  lấy tiêu điểm, và kéo về khi tiêu điểm rơi ra `<body>`.
- **Dropdown tìm hàng mở rơi khỏi màn** — neo ở đáy panel phải, mở xuống
  dưới mép màn, bị `overflow-hidden` cắt. Nay neo ở đỉnh cột trái, xổ đè
  lên bảng.
- **Cột trái cứng 1012px** — 1366px bị cắt panel phải. Nay `flex-1`.
- **Tab không đồng bộ URL** — dán link không mở tab; lưu xong tab vẫn
  "Đơn mới 1"; chip "chưa lưu" không bao giờ hiện. Nay store nghe
  `pathname`, màn đặt tên tab qua `usePosDocLabel`, chip qua `usePosDirty`.
- **Ô tìm ở topbar là `<input>` không nối vào đâu** — nay là nút mở
  dropdown F3 của màn đang đứng.
- **Ô ngày là chữ tự do** đi vào cột `date` — nay `type="date"`, mặc định
  hôm nay; chứng từ mà ngày do máy chủ đặt thì chỉ đọc.
- **`returns.reason = 'wrong'`** vi phạm CHECK — nay dùng `RETURN_REASONS`.
- **Mở đơn đã lưu không lên khách** — nút lưu từ chối "chưa chọn khách"
  trên đơn đã có khách.
- **Mở HĐ ra sửa mất giảm giá dòng** — bản đầu nạp `discount: 0`.
- **`<Link>` lồng trong `<button>`** ở nút Sửa HĐ; nút `Phát hành HĐĐT`
  và `In` không làm gì — nay dẫn tới màn/trang thật của phần đang chạy.
- **Hóa đơn: "Còn lại" = tổng** — nay trừ tiền đã thu (đọc
  `cash_receipt_lines`), `chưa xác định` khi chưa đọc được.
- **Nút `+` chỉ mở đơn hàng** — nay hỏi loại chứng từ. Có trang gốc `/pos`
  (bản đầu đóng tab cuối là 404).
- **Thiết lập đọc từ `localStorage` sau lần vẽ đầu** nên đơn vị giảm mặc
  định / ghi nợ mặc định người dùng đã chọn bị bỏ qua — nay áp khi `ready`.
