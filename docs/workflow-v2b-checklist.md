# Workflow v2b — Danh sách kiểm trên staging

Làm theo đúng thứ tự. Mỗi mục có **cách biết là đúng** — không có nó thì
"chạy xong rồi" chỉ nghĩa là không có lỗi đỏ nào hiện ra, mà phần lớn
những thứ hỏng trong hai đợt này đều hỏng **im lặng**.

Bốn migration của v2b là **124 · 125 · 126 · 127**. Chúng đi cùng một
lượt: 124 gỡ `complete_order` và `cancel_order` rồi 125 mới dựng bộ thay
thế, nên dừng giữa chừng là ứng dụng mất đường xuất hàng.

---

## 0. Trước khi chạy bất cứ thứ gì

- [ ] **Chạy v2 trước.** Migration 118 → 123 chưa chạy ở cơ sở dữ liệu
      nào, kể cả staging. Mig 124 sẽ `RAISE WF2B_NEEDS_V2` và dừng nếu
      `sales_orders` còn trạng thái của luồng cũ — đó là chốt chặn cố ý,
      không phải lỗi.
- [ ] Chạy hết `docs/workflow-v2-checklist.md`.
- [ ] Xem trước tài khoản sắp bị khoá (mig 122):
      `SELECT full_name, role FROM users WHERE COALESCE(is_active,true) = false;`
- [ ] **Sao lưu.** `cancel_invoice` hoàn kho theo dấu vết FIFO; nếu dấu
      vết sai thì không có đường lùi bằng phần mềm.

```bash
supabase db push --debug 2>&1 | tee push-v2b.log
```

Mỗi file một transaction, ghi nhận từng file — hỏng ở 126 thì 124/125
vẫn nằm lại, chạy lại chỉ tiếp từ chỗ hỏng.

---

## 1. Đọc `push-v2b.log` bằng mắt

Những dòng dưới đây **phải** có mặt. Thiếu một dòng nghĩa là khối sinh ra
nó không chạy, chứ không phải "không có gì để báo".

- [ ] `--- 124 backfill: N hóa đơn bán được tạo (M không có phiếu xuất) ---`
- [ ] Với mỗi `124 ⚠ đơn X KHÔNG có phiếu xuất đã ghi sổ` — ghi lại mã
      đơn. Đó là đơn có từ trước mig 107: tồn kho **chưa bao giờ** bị trừ
      cho chúng, và hóa đơn sinh ra không có `stock_entry_id`. Huỷ những
      hóa đơn ấy sẽ không hoàn được gì.
- [ ] `--- 124: N đơn Hoàn thành · N hóa đơn đã xuất · 0 đơn xuất một phần ---`
      → hai con số đầu phải **bằng nhau**. Lệch là backfill chưa khớp.
- [ ] `--- 125: 7/7 RPC đã dựng ---`
- [ ] `--- 126: doanh thu theo ĐƠN X · theo HÓA ĐƠN X ---` → hai số phải
      **bằng nhau** ngay sau backfill.
- [ ] `--- 127: N phiếu trả chưa gắn hóa đơn · M dòng phiếu thu đã gắn ---`
- [ ] Nếu có `127 ⚠ N phiếu trả ... thuộc đơn có NHIỀU hóa đơn` → gắn tay
      `returns.invoice_id` cho chúng **trước khi dùng tiếp**, nếu không
      chúng sẽ dừng với `RETURN_NEEDS_INVOICE` giữa ca.

---

## 2. Đối chiếu số trước / sau

Chạy **trước** khi push và ghi lại, rồi chạy lại **sau**:

```sql
-- Doanh thu kỳ này theo hai cách
SELECT sum(total) FROM sales_orders
 WHERE status = 'completed' AND order_date >= date_trunc('month', current_date);
SELECT sum(total) FROM sales_invoices
 WHERE status = 'posted' AND invoice_date >= date_trunc('month', current_date);

-- Tổng công nợ chưa tất toán
SELECT sum(GREATEST(0, amount - COALESCE(paid,0))) FROM receivables WHERE status <> 'paid';

-- Tồn kho theo lô
SELECT sum(qty_on_hand) FROM batches;
```

- [ ] **Tồn kho không được đổi.** 124–127 không đụng vào `batches`; lệch
      một đơn vị nghĩa là có thứ tôi chưa lường.
- [ ] Công nợ không được đổi.
- [ ] ⚠ **Doanh thu ĐƯỢC PHÉP đổi**, và nó sẽ đổi: mig 126 tính theo
      **ngày hóa đơn**, không theo ngày đặt. Đơn đặt cuối tháng trước
      giao đầu tháng này sẽ chuyển sang tháng này. Lương và hoa hồng của
      các kỳ đã chốt vì thế tính lại khác đi — xem mục 6.

---

## 3. Đường đi thường ngày

- [ ] **Xuất đủ.** Tạo đơn 3 dòng → Xuất hàng từ thanh chọn nhiều → đơn
      về **Hoàn thành**, có 1 hóa đơn, 1 công nợ, 1 phiếu xuất kho.
- [ ] **Xuất một phần.** Đơn 3 dòng → mở dialog trên đúng dòng đó → giảm
      một dòng còn một nửa → đơn về **Xuất một phần**, `invoiced_qty`
      của dòng ấy bằng số vừa xuất.
- [ ] **Xuất tiếp đợt hai.** Cùng đơn đó → Xuất hàng lần nữa → đơn về
      **Hoàn thành**, có **2** hóa đơn và **2** dòng công nợ.
- [ ] Mở màn chi tiết đơn → ô "Công nợ" liệt kê **hai** dòng, không phải
      một. (Trang trắng ở bước này nghĩa là `maybeSingle()` quay lại.)
- [ ] **Đóng đơn.** Đơn xuất một phần → Đóng đơn, ghi lý do → trạng thái
      **Đã đóng**, phần chưa xuất thôi không giao.
- [ ] **Huỷ đơn chưa xuất** vẫn chạy như cũ.
- [ ] **Huỷ đơn ĐÃ xuất** phải bị từ chối, và câu từ chối nói rõ còn mấy
      hóa đơn phải huỷ trước.

---

## 4. Huỷ và lập lại hóa đơn

- [ ] Ghi lại `qty_on_hand` của một lô cụ thể trước khi xuất.
- [ ] Xuất hàng lấy đúng lô đó → huỷ hóa đơn → **`qty_on_hand` về đúng
      số cũ, đúng lô cũ**. Không phải "tổng tồn bằng nhau" — phải đúng
      lô, vì hạn dùng đi theo lô.
- [ ] Huỷ hóa đơn xong: công nợ của nó **biến mất**, đơn quay về **Phiếu
      tạm** (nếu hết hóa đơn) hoặc **Xuất một phần**.
- [ ] Huỷ lần hai cùng hóa đơn → bị từ chối `INVOICE_NOT_POSTED`, **và
      tồn kho không cộng thêm lần nữa**.
- [ ] **Sửa hóa đơn** (lập lại): đổi số lượng một dòng → hóa đơn cũ mang
      nhãn *Đã bị thay*, bản mới mang *Bản lập lại*, và trang tự chuyển
      sang bản mới.
- [ ] Sau một vòng sửa: `qty_on_hand` của lô = số cũ − số **mới**, không
      phải số cũ − số cũ − số mới.
- [ ] Thu tiền một phần cho hóa đơn rồi thử huỷ → bị từ chối
      `LOCKED_HAS_PAYMENT`.

---

## 5. Hoá đơn điện tử

⚠ **Làm trên sandbox MISA.** Hoá đơn đã phát hành không sửa được.

- [ ] Đơn xuất **hai đợt** → phát hành hoá đơn điện tử cho **từng** hóa
      đơn bán → mỗi tờ khai đúng phần của nó. Tổng hai tờ = tổng đơn,
      **không phải gấp đôi**.
- [ ] Nút "Xuất hóa đơn" trên màn ĐƠN của một đơn có hai hóa đơn bán phải
      **dừng lại** và chỉ đường sang mục Hóa đơn bán.
- [ ] Dòng có **giảm giá**: `TotalAmountWithoutVATOC` phải bằng
      `Σ qty × đơn giá đã giảm`. Thấp hơn đúng bằng khoản giảm là lỗi
      trừ hai lần quay lại.
- [ ] Thuế suất trên tờ hoá đơn là **10**, không phải **0,1** và không
      phải 0.
- [ ] Hóa đơn bán đã phát hành hoá đơn điện tử → nút Huỷ và Sửa **mờ**,
      và RPC cũng chặn nếu gọi thẳng.

---

## 6. Lương và báo cáo

- [ ] Tính lại một kỳ lương đã chốt → so "Tổng doanh số" trên phiếu lương
      với **tổng bảng kê ngay bên dưới nó**. Hai số phải bằng nhau.
- [ ] Bảng kê hiện **số hóa đơn** và **ngày xuất**, không hiện mã đơn.
- [ ] Trang tổng quan: ô "Đơn hàng (kỳ)" đếm **đơn**, không đếm hóa đơn —
      đơn giao hai chuyến vẫn là một đơn.
- [ ] `finance_pnl`: doanh thu và giá vốn nay cùng bám ngày giao. Lãi gộp
      của kỳ có đơn-đặt-tháng-trước-giao-tháng-này sẽ **khác bản cũ**, và
      bản mới mới là bản đúng.
- [ ] ⚠ **Quyết định của chủ nhà:** kỳ lương đã trả rồi có tính lại
      không. Tính lại là đúng sổ nhưng đụng vào tiền đã chi.

---

## 7. Đơn trả và phiếu thu

- [ ] Lập phiếu trả → ô chọn là **"Hóa đơn liên quan"**, danh sách chỉ có
      hóa đơn **đã xuất** (không có hóa đơn đã huỷ).
- [ ] Gợi ý hàng lấy từ dòng **hóa đơn**: số lượng đúng bằng số đã giao
      của chuyến đó, không phải số đã đặt.
- [ ] Trả **vượt** số đã xuất → bị chặn ngay lúc thêm dòng, và chặn lần
      nữa lúc Hoàn thành.
- [ ] Trả hàng của một đơn **Xuất một phần** → phải làm được. (Bị từ chối
      "đơn gốc chưa xuất hàng" nghĩa là mig 127 chưa chạy.)
- [ ] Hoàn thành phiếu trả → công nợ của **đúng hóa đơn ấy** giảm; công
      nợ của hóa đơn kia **không đổi**.
- [ ] Lập phiếu thu cho một hóa đơn → kiểm
      `SELECT invoice_id FROM cash_receipt_lines ORDER BY id DESC LIMIT 5;`
      → **không được rỗng**.
- [ ] Huỷ phiếu trả đã hoàn thành → hàng ra khỏi kho đúng lô đã nhập,
      công nợ trở lại số cũ.

---

## 8. Phân quyền

Đăng nhập lần lượt bằng **quản lý**, **kế toán**, **nhân viên bán hàng**:

- [ ] Quản lý: xuất hàng, huỷ hóa đơn, đóng đơn — làm được cả ba.
- [ ] Kế toán: **thấy** hóa đơn bán, **không** xuất hàng được.
- [ ] NVBH: chỉ thấy hóa đơn của đơn mình phụ trách; không có nút Xuất
      hàng.
- [ ] NVBH tạo đơn ở `/sell`: trần giá **vẫn chặn** như cũ. (PATCH 1 chỉ
      nới cho nhà phân phối ở màn Xuất hàng — chủ nhà chốt Q3 = a.)
- [ ] Mỗi vai vào `/sales-invoices` không bị chặn không lời giải thích.

---

## 9. Sau khi xong trên staging

- [ ] Đọc lại `push-v2b.log` một lần nữa, tìm mọi dòng có `⚠`.
- [ ] Danh sách đơn "không có phiếu xuất đã ghi sổ" (mục 1) → quyết định
      xử lý thế nào trước khi chạy trên production.
- [ ] Chạy lại mục 2 trên **production** trước khi push, và giữ lại con
      số để đối chiếu sau.
