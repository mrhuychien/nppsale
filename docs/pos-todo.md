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

**Chỗ:** panel màn 1, dòng ngay dưới `Tính vào công nợ`.

**Thiếu:** công nợ hiện tại của khách chưa được nạp vào màn POS.

**Đang hiện:** chữ `chưa xác định`.

⚠ **Cố tình không hiện `0`.** Số 0 ở ô công nợ đọc như "khách này sạch nợ",
và người đi đòi tiền tin vào nó. Đây đúng là luật §4 của Coder Pack.

---

## 3. Dòng phụ dưới tên hàng còn thiếu ba số

**Chỗ:** bảng hàng màn 1 (spec §4).

**Thiếu:**
- `Đã đặt N` — số đã đặt của mặt hàng, chưa nạp.
- `đã xuất N` — số đã xuất của **dòng** này; đây là thứ chặn stepper ở màn
  sửa đơn (spec §7.1).
- `giá gần nhất … · N lần mua` — lịch sử giá bán cho đúng khách này.

**Đang hiện:** phần `Tồn N` có thật và đúng (đọc qua `loadSellRefData`,
chỉ cộng kho BÁN). Ba số còn lại không vẽ ra chứ không vẽ số 0.

**Hệ quả cần biết:** vì `đã xuất` chưa có, **sàn của stepper ở màn sửa đơn
đang là 0**. Ràng buộc §7.1 đã được cài sẵn trong `QtyStepper` (`min`), chỉ
chờ số thật cắm vào.

---

## 4. Lô & hạn sử dụng chưa có danh sách

**Chỗ:** cột `LÔ / HSD` (spec §4) và select lô trong bảng trả/đổi.

**Thiếu:** danh sách lô còn hàng theo từng mặt hàng.

**Đang hiện:** select có đúng một lựa chọn `chưa chọn lô`.

⚠ Không để select rỗng — một select rỗng trông y hệt một select đã chọn xong.

**Liên quan đến đợt 4:** spec §8 đòi *"Trả NCC: select lô chỉ liệt kê lô
thuộc phiếu nhập gốc"*, và *"lô & HSD bắt buộc khi nhập"*. Cả hai cần dữ
liệu này.

---

## 5. Dải xem trước delta mới nói được một nửa

**Chỗ:** cuối cột trái các màn sửa chứng từ đã ghi sổ (spec §7.2). Đã dựng
ở màn 8 (sửa phiếu trả); màn 7/10/12 thuộc đợt 3–4.

**Thiếu:** endpoint dry-run trả trước "kho sẽ đổi thế nào, công nợ sẽ đổi
thế nào" khi lưu.

**Đang hiện:** dải nói được phần suy ra từ chính các dòng đang gõ — CHIỀU
và SỐ LƯỢNG hàng vào Kho hàng lỗi / ra Kho bán. Hai thứ còn thiếu là tồn
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

**Thiếu:** phần nối xuống `createOrderRecords` / `applyOrderEdit` /
`post_invoice`. Đợt này dựng **bề mặt** (spec §"Phạm vi": *"dựng bề mặt
`/pos` desktop, bind vào API và store đã có"*), và phần bind dữ liệu ĐỌC đã
xong (danh mục hàng, khách, tồn kho, hóa đơn, phiếu trả).

**Đang hiện:** nút có thật, mờ khi chưa đủ điều kiện, và nói rõ lý do mờ
trong `title`.

⚠ **Không** tự gọi đại một RPC cho có. Mọi thao tác đụng tồn kho / công nợ
/ trạng thái đơn phải đi qua đúng RPC `SECURITY DEFINER` đang có, một giao
dịch, idempotent — nối ẩu ở đây là đúng loại lỗi đắt nhất.

---

## 8. Tab `In phiếu` trong drawer thiết lập

**Chỗ:** drawer thiết lập hiển thị (spec §9), tab thứ ba.

**Đang hiện:** một câu nói rằng mẫu in dùng chung với phần đang chạy và
thiết lập riêng cho POS chưa có trong đợt này.

---

## 9. Ô `NVBH` và `Tuyến` trên sub-header màn 1

**Chỗ:** góc phải sub-header (spec §2).

**Thiếu:** danh sách nhân viên bán hàng và danh sách tuyến chưa nạp vào POS.

**Đang hiện:** select có ô rỗng `—` và không có lựa chọn nào khác.

⚠ Select **phải** có ô rỗng rõ ràng, nếu không người dùng không có cách
nào bỏ chọn thứ họ lỡ chọn.


---

## 10. Phiếu trả chưa nối hóa đơn gốc

**Chỗ:** màn 3, dòng `Giá gốc hàng mua` trên panel và ô tìm hàng trả.

**Thiếu:** modal chọn hóa đơn gốc đã dựng và đọc được danh sách hóa đơn
thật, nhưng chọn xong thì chưa nạp dòng hàng của tờ ấy vào bảng hàng trả,
và chưa lấy được giá khách đã mua.

**Đang hiện:** `Giá gốc hàng mua` để chữ `chưa xác định`. Ô tìm hàng trả
đang tìm trong toàn danh mục chứ chưa giới hạn trong hóa đơn gốc.

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
