# Workflow v2 — Checklist nghiệm thu tay trên staging

Chạy sau khi đã `supabase db push` ba migration 118 · 119 · 120 lên
**staging** (KHÔNG chạy trên production cho tới khi checklist này xanh).

Mục đích: bảy RPC của workflow v2 chỉ đúng khi chạy thật. Bộ test trong
kho là test CẤU TRÚC — nó đọc mã nguồn, nó KHÔNG gọi cơ sở dữ liệu. Nó
bắt được "ai đó xoá mất phép kiểm", nó không bắt được "phép kiểm chạy sai
trên dữ liệu thật". Checklist này là chỗ duy nhất kiểm điều đó.

## Cách dùng

Mỗi mục có ba phần: **Làm gì** · **Phải thấy gì** · **Kiểm ở đâu**. Phần
"Kiểm ở đâu" là câu SQL chạy trong SQL Editor của Supabase — nhìn màn
hình là chưa đủ, vì đúng những lỗi đắt nhất của đợt này đều là *màn hình
báo thành công cho một lệnh chưa chạy*.

Tick `[x]` khi đã chạy và đúng. Gặp sai thì DỪNG, ghi lại, đừng chạy tiếp
— các mục sau dựa trên dữ liệu các mục trước tạo ra.

---

## 0. Trước khi bắt đầu

- [ ] **Đọc kỹ `RAISE NOTICE` của lần push.** Migration 119 in ra số dòng
      backfill từng loại. Ghi lại các con số đó vào đây:

      | Backfill | Số dòng |
      |---|---|
      | Đơn: nháp giữ nguyên | |
      | Đơn: nháp → phiếu tạm | |
      | Đơn: đã duyệt → phiếu tạm | |
      | Đơn: → hoàn thành | |
      | Đơn huỷ được đóng dấu mốc xuất kho | |
      | Phiếu trả: → nháp | |
      | Phiếu trả: chờ → phiếu tạm | |
      | Phiếu trả: đã duyệt → phiếu tạm | |
      | Phiếu trả: bị từ chối → huỷ | |

      ⚠ Nếu tổng số đơn sau backfill ≠ tổng trước khi chạy thì DỪNG NGAY.

- [ ] **Không còn trạng thái cũ nào sót lại.**

      ```sql
      SELECT status, count(*) FROM sales_orders GROUP BY 1;
      SELECT status, count(*) FROM returns GROUP BY 1;
      ```
      Phải chỉ thấy `draft/submitted/completed/cancelled` ở cả hai bảng.

- [ ] **Chuẩn bị số liệu gốc.** Chọn một khách thật, ghi lại công nợ hiện
      tại của họ — mọi mục dưới đây so với con số này.

      ```sql
      SELECT id, order_id, amount, paid, status
      FROM receivables WHERE customer_id = '<id khách>';
      ```

---

## 1. Đường cơ bản: nháp → gửi → xuất hàng

- [ ] **1.1 Lưu nháp.** Vào `/sell`, chọn khách, thêm 2 mặt hàng, bấm
      **Lưu nháp**.
      · Phải thấy: màn báo "Đã lưu nháp", và đơn nằm ở `/sell/drafts`.
      · Kiểm: `SELECT status FROM sales_orders WHERE order_code='<mã>'`
        → `draft`.
      · ⚠ Mở `/orders` bằng tài khoản KHÁC: **không được thấy** đơn này.

- [ ] **1.2 Gửi đơn.** Ở `/sell/drafts` bấm **Gửi đơn**.
      · Phải thấy: "Đã gửi đơn", đơn rời khỏi Đơn nháp.
      · Kiểm: `status` = `submitted`, `submitted_at` khác NULL.
      · ⚠ `submitted_at` do trigger đóng — nếu nó NULL thì trigger chưa
        chạy, DỪNG.

- [ ] **1.3 Xuất hàng.** Bằng tài khoản có quyền `orders.approve`, vào
      `/orders` tab **Phiếu tạm**, mở Xem nhanh, kiểm cột **Tồn** rồi bấm
      **Xuất hàng**.
      · Phải thấy: "Đã xuất hàng 1 đơn", đơn sang tab Hoàn thành.
      · Kiểm ba thứ cùng lúc:

        ```sql
        SELECT status, completed_at, completed_by FROM sales_orders WHERE id='<đơn>';
        SELECT * FROM stock_entries WHERE ref_order_ids @> jsonb_build_array('<đơn>');
        SELECT amount, paid, status, due_date FROM receivables WHERE order_id='<đơn>';
        ```
      · ⚠ `receivables.amount` phải BẰNG `sales_orders.total`. Lệch là
        `_wf2_recompute_receivable` tính sai.
      · Kiểm tồn đã trừ: so `batches.qty_on_hand` trước/sau.

- [ ] **1.4 Vết FIFO.** `stock_line_consumptions` phải có dòng cho từng
      lần lấy lô — đây là thứ cho phép hoàn kho về ĐÚNG lô.

      ```sql
      SELECT slc.* FROM stock_line_consumptions slc
      JOIN stock_entry_lines sel ON sel.id = slc.line_id
      WHERE sel.entry_id = '<phiếu xuất>';
      ```

---

## 2. Thiếu tồn — hai ca khác hẳn nhau

⚠ Đây là chỗ dễ mất hàng nhất. `post_stock_export` **không** luôn ném lỗi
khi thiếu: nó rẽ theo `organizations.allow_oversell`.

- [ ] **2.1 `allow_oversell = false` (mặc định).** Tạo một đơn có số
      lượng LỚN HƠN tồn, gửi đi, bấm Xuất hàng.
      · Phải thấy: toast đỏ **"Không đủ tồn: …"** nêu rõ thiếu bao nhiêu,
        sản phẩm nào — KHÔNG phải một câu tiếng Anh kèm "(mã P0001)".
      · Kiểm: đơn VẪN ở `submitted`, KHÔNG có `stock_entries` mới, KHÔNG
        có `receivables` mới. Cả giao dịch phải rollback sạch.

- [ ] **2.2 `allow_oversell = true`.** Bật cờ cho tổ chức rồi lặp lại.

      ```sql
      UPDATE organizations SET allow_oversell = true WHERE id = '<org>';
      ```
      · Phải thấy: đơn xuất THÀNH CÔNG, **và** một toast đỏ riêng
        **"1 đơn xuất thiếu hàng"** nêu số thiếu theo đơn vị cơ sở.
      · ⚠ ĐÂY LÀ MỤC QUAN TRỌNG NHẤT CỦA CẢ CHECKLIST. Nếu chỉ thấy toast
        xanh "Đã xuất hàng" mà không thấy cảnh báo, nghĩa là giao diện lại
        vứt kết quả RPC — kho sẽ đóng hàng theo phiếu, tài xế tới nơi mới
        biết thiếu, và thẻ kho âm không ai hay tới kỳ kiểm kê.
      · Kiểm tồn có âm thật không:
        `SELECT product_id, qty_on_hand FROM batches WHERE qty_on_hand < 0;`
      · **Nhớ tắt cờ lại sau khi thử.**

---

## 3. Đi lùi và huỷ

- [ ] **3.1 Rút phiếu tạm về nháp.** Mở một đơn `submitted`, bấm **Rút về
      nháp** (trong menu ⋮ hoặc thẻ Thao tác).
      · Kiểm: `status` = `draft`. Đơn biến khỏi tab Phiếu tạm.
      · ⚠ Thử bằng tài khoản NVBH chủ đơn: phải chạy được. RLS từ chối sẽ
        cho 0 dòng và màn phải BÁO LỖI, không báo thành công.

- [ ] **3.2 Huỷ đơn chưa xuất.** Huỷ một đơn `draft` và một đơn
      `submitted`.
      · Kiểm: `status` = `cancelled`. Không có gì đụng kho.

- [ ] **3.3 Huỷ HÀNG LOẠT.** Chọn nhiều đơn rồi huỷ, trong đó **có ít
      nhất một đơn tài khoản hiện tại không có quyền** (ví dụ đơn của NVBH
      khác, đăng nhập bằng NVBH).
      · Phải thấy: số trong toast bằng số đơn THẬT SỰ huỷ được, và một
        toast đỏ nêu số đơn không huỷ được.
      · ⚠ Nếu toast báo đủ cả loạt thì phép đếm dòng đã mất — đó đúng là
        lỗi vừa sửa.

- [ ] **3.4 Huỷ đơn ĐÃ XUẤT.** Huỷ một đơn `completed` (chưa thu tiền).
      · Kiểm: tồn đã hoàn về ĐÚNG lô đã lấy (so `batches.qty_on_hand`),
        `receivables` của đơn đã biến mất, `status` = `cancelled`, và
        `completed_at` VẪN CÒN (dấu để biết đơn huỷ nào còn hồ sơ kho).
      · Kiểm hoàn đúng lô:
        `SELECT * FROM stock_line_consumptions WHERE line_id IN (…)`
        → `qty_in_base_uom` phải đã bị trừ đi.

- [ ] **3.5 Huỷ đơn đã xuất ĐÃ THU TIỀN.** Thu một phần tiền rồi thử huỷ.
      · Phải thấy: bị chặn, câu tiếng Việt nói rõ phải huỷ phiếu thu
        trước.

---

## 4. Sửa đơn đã xuất — bốn khoá

- [ ] **4.1 Sửa được khi không vướng gì.** Đơn `completed` trong hạn, chưa
      thu tiền, chưa hoá đơn, chưa phiếu trả hoàn thành.
      · Giảm số lượng một dòng → kiểm tồn HOÀN về đúng lô, `receivables.
        amount` giảm theo.
      · Tăng số lượng một dòng → kiểm tồn trừ thêm.

- [ ] **4.2 Bốn khoá chặn, mỗi khoá một lần.** Với mỗi khoá: màn hình phải
      mờ nút VÀ câu giải thích phải khớp với lý do RPC trả về.

      | Khoá | Cách dựng | Mã lỗi |
      |---|---|---|
      | Đã thu tiền | lập phiếu thu cho đơn | `LOCKED_HAS_PAYMENT` |
      | Quá hạn sửa | đổi `organizations.completed_edit_days` về 0 | `LOCKED_TOO_OLD` |
      | Đã phát hành hoá đơn | xuất hoá đơn MISA | `LOCKED_EINVOICE` |
      | Có phiếu trả hoàn thành | hoàn thành một phiếu trả của đơn | `LOCKED_RETURN_DONE` |

      · ⚠ Nếu màn hình MỞ nút mà RPC chặn (hoặc ngược lại) thì hai bên
        đang nói hai đằng — ghi lại, đó là lỗi.

---

## 5. Đơn trả

- [ ] **5.1 Phiếu trả kèm đơn.** Ở màn bán hàng, thêm hàng trả vào một
      đơn rồi gửi đơn.
      · Kiểm: `returns.status` = `draft`, `order_id` trỏ đúng đơn.
      · Xuất hàng đơn đó → phiếu trả tự sang `submitted`.

- [ ] **5.2 Hoàn thành phiếu trả, chọn kho bán.** Mở phiếu, chọn **Kho
      bán**, bấm Hoàn thành.
      · Kiểm: có `stock_entries` kiểu `import` mã `NL-…`; `batches` của
        lô nhận có `warehouse_zone = 'sale'`; `returns.destination_zone`
        = `sale`; `returns.completed_at` khác NULL.
      · ⚠ Kiểm GIÁ VỐN của lô nhận: `batches.unit_cost` phải > 0 và bằng
        giá vốn lô đã bán ra. Bằng 0 là lãi gộp sẽ báo khống.
      · Kiểm công nợ đơn gốc giảm đúng bằng `credit_note_amount`.

- [ ] **5.3 Hoàn thành phiếu trả, chọn kho cận date.** Lặp lại với **Kho
      cận date**.
      · ⚠ Kiểm `batches.warehouse_zone = 'date'` THẬT. Bảng `batches` có
        trigger tự xếp kho đẩy lô cận hạn sang `date`; RPC ép lại theo ý
        người duyệt. Nếu chọn `sale` mà ra `date` thì phép ép đã hỏng.

- [ ] **5.4 Trần số lượng trả — Q8.** Đây là lỗ vừa vá, phải thử.
      · Đơn bán 10 thùng, đã xuất. Lập phiếu trả A 10 thùng (để ở Chờ xử
        lý). Lập tiếp phiếu trả B 10 thùng nữa — **cả hai đều lập được**,
        đó là đúng, trigger chỉ chặn lúc chèn dòng.
      · Hoàn thành A → phải chạy được.
      · Hoàn thành B → **phải bị chặn**, câu tiếng Việt "Trả quá số đã
        bán: … đã bán 10, đã hoàn thành trả 10, phiếu này thêm 10 là
        vượt".
      · ⚠ Nếu B hoàn thành được thì kho vừa nhận 20 thùng cho một đơn bán
        10 và công nợ bị trừ gấp đôi — DỪNG NGAY.

- [ ] **5.5 Dòng ĐỔI vẫn nhập kho.** Phiếu trả có một dòng `is_exchange`.
      · Kiểm: dòng đó VẪN vào `stock_entry_lines` (ghi chú "Hàng đổi thu
        về"), nhưng KHÔNG làm giảm công nợ.

- [ ] **5.6 Huỷ phiếu trả đã hoàn thành.** 
      · Kiểm: tồn trừ lại đúng số đã nhập, công nợ tính lại, `status` =
        `cancelled`.
      · Thử huỷ một phiếu mà đơn gốc ĐÃ thu tiền → phải bị chặn.

- [ ] **5.7 Lập phiếu trả tay.** `/returns/new`.
      · Kiểm: `status` = `submitted`, KHÔNG phải `completed`.
      · ⚠ Nếu ra `completed` thì hàng trả sẽ không bao giờ vào kho và
        phiếu kẹt vĩnh viễn — đó đúng là lỗi vừa sửa.

---

## 6. Phiếu thu

- [ ] **6.1 Thu một phần.** `/finance/cash-receipts/new`, chọn khách,
      nhập số nhỏ hơn số còn nợ.
      · Kiểm: `cash_receipts` có dòng mã `PT-…`; `payments` có dòng;
        `receivables.paid` cộng đúng; `status` = `partial`.
      · Kiểm `submitted_amount` = số khách đưa thật.

- [ ] **6.2 Thu vượt bị chặn.** Nhập lớn hơn số còn nợ.
      · Phải thấy: chặn ngay ở màn (viền đỏ, nút mờ). Nếu lách được thì
        RPC phải ném "thu vượt số còn nợ".

- [ ] **6.3 Cấn trừ phiếu trả độc lập.** Lập một phiếu trả KHÔNG gắn đơn,
      hoàn thành nó, rồi lập phiếu thu có tick phiếu trả đó.
      · Phải thấy: ô **Khách đưa** = tổng nợ đã chọn − khoản có.
      · Kiểm: `cash_receipt_lines` có dòng `kind='return_credit'` mang
        `return_id`; `returns.applied_receipt_id` đã được đóng dấu.
      · ⚠ Thử tick một phiếu trả GẮN ĐƠN: nó **không được hiện** trong
        danh sách. Phiếu đó đã giảm nợ từ lúc hoàn thành; cấn trừ nữa là
        trừ hai lần.

- [ ] **6.4 Cấn trừ trùng — Q10.** Cần hai trình duyệt / hai tài khoản.
      · Mở màn lập phiếu thu ở cả hai, cùng tick MỘT phiếu trả độc lập,
        rồi bấm Lưu gần như cùng lúc.
      · Phải thấy: một người thành công, người kia nhận "Phiếu trả không
        đủ điều kiện cấn trừ".
      · ⚠ Nếu cả hai thành công thì khoản có bị trừ hai lần — DỪNG.

- [ ] **6.5 Huỷ phiếu thu.** Mở phiếu vừa lập, bấm Huỷ, ghi lý do.
      · Kiểm: `receivables.paid` trừ lại ĐÚNG số; `payments` của phiếu đó
        đã biến mất; `returns.applied_receipt_id` về NULL (khoản có được
        thả ra để dùng lại); `cash_receipts.status` = `voided`.
      · ⚠ Nếu `paid` không giảm thì khách hiện ra đã trả tiền trong khi
        phiếu thu đã huỷ — đó đúng là lỗi vừa sửa.

---

## 7. Xoá đơn — Q12

- [ ] **7.1 Xoá đơn nháp có phiếu trả kèm.**
      · Phải thấy: xoá được, và `RAISE NOTICE` (hoặc log) nói đã bỏ N
        phiếu trả chưa hoàn thành.
      · ⚠ Trước khi vá, câu chặn hỏi giá trị trạng thái đã chết nên khoá
        ngoại 23503 chặn bằng một câu tiếng Anh.

- [ ] **7.2 Xoá đơn có phiếu trả ĐÃ HOÀN THÀNH.**
      · Phải thấy: bị chặn, câu tiếng Việt "…có N phiếu trả hàng ĐÃ HOÀN
        THÀNH…".

---

## 8. Thông báo

- [ ] **8.1 Bốn loại mới đều về đúng người.** Sau các bước trên, đăng nhập
      bằng NVBH chủ đơn và mở chuông.
      · Phải thấy đủ: đơn đã xuất hàng, đơn bị huỷ, đơn vừa được sửa,
        phiếu trả đã hoàn thành.
      · ⚠ Mỗi loại phải có biểu tượng RIÊNG. Nếu tất cả cùng một biểu
        tượng chữ "i" thì bảng biểu tượng thiếu khoá.

---

## 9. Sau khi xong

- [ ] Ghi lại mọi mục SAI vào `docs/workflow-v2-questions.md`, kèm số liệu
      thật.
- [ ] Chỉ khi checklist xanh hết mới chạy migration lên production.
- [ ] Sau production: chạy lại mục 0 (đọc `RAISE NOTICE`) và mục 1 trên
      một đơn thật nhỏ trước khi để người dùng vào.
