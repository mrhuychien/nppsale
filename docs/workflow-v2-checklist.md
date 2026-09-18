# Workflow v2 — Checklist nghiệm thu tay trên staging

Chạy sau khi đã `supabase db push` bốn migration 118 · 119 · 120 · 121 lên
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

- [ ] **Đọc RIÊNG khối cảnh báo "đơn Hoàn thành không có phiếu xuất".**
      Migration 119 liệt kê ra mã từng đơn, MỘT LẦN DUY NHẤT, rồi thôi —
      chạy lại migration cũng không in lại vì lúc đó dữ liệu đã đổi. Đóng
      cửa sổ SQL Editor mà chưa chép là mất luôn danh sách.

      Chép các mã đơn vào đây:

      | Mã đơn | Đã kiểm tay chưa |
      |---|---|
      | | |

      ⚠ Đây là đơn có TRƯỚC migration 107: trạng thái nói đã giao nhưng
      tồn kho chưa bao giờ bị trừ cho chúng. Migration cố ý KHÔNG tự xử —
      trừ kho lùi cho một đơn từ năm ngoái là làm sai tồn hôm nay. Chủ NPP
      quyết từng đơn một.

      ```sql
      -- Chạy lại được bất cứ lúc nào nếu đã lỡ đóng cửa sổ:
      SELECT so.order_code, so.order_date, so.total_amount
      FROM sales_orders so
      WHERE so.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM stock_entries se
           WHERE se.type = 'export' AND se.status = 'posted'
             AND se.ref_order_ids @> jsonb_build_array(so.id::text))
      ORDER BY so.order_date DESC;
      ```

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

- [ ] **2.3 Lô sắp hết hạn bị BỎ QUA — và phải nói ra.** Dựng một lô có
      `expiry_date` trong vòng ngưỡng cảnh báo, để nó là lô CŨ NHẤT của
      sản phẩm, rồi xuất một đơn có sản phẩm đó.

      ```sql
      UPDATE batches SET expiry_date = CURRENT_DATE + 10
      WHERE id = '<lô cũ nhất>';
      ```
      · Phải thấy: FIFO **nhảy qua** lô đó (không đẩy hàng sắp hỏng cho
        khách), và màn hình nói rõ đã bỏ qua bao nhiêu lô.
      · Kiểm: `post_stock_export` trả `near_expiry_skipped` > 0, và lô đó
        `qty_on_hand` KHÔNG đổi.
      · ⚠ Bỏ qua trong im lặng là kiểu sai khó thấy nhất của mục này:
        hàng vẫn đi đủ, sổ vẫn khớp, chỉ có một lô nằm lại kho tới lúc
        hỏng mà không ai được báo.

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

- [ ] **4.3 Sửa đơn của NGƯỜI KHÁC.** Đăng nhập bằng một NVBH, mở đơn
      `completed` của NVBH khác, thử sửa.
      · Phải thấy: câu tiếng Việt "chỉ sửa được đơn của mình"
        (`FORBIDDEN_NOT_OWNER`), KHÔNG phải một màn trắng hay một câu
        tiếng Anh.
      · Thử cả nút **Huỷ** trên đơn đó — cùng một mã, cùng một câu.

- [ ] **4.4 Tổng không khớp các dòng.** Dựng bằng cách sửa dòng ở một tab
      rồi bấm Lưu ở tab kia đã mở từ trước (payload mang tổng cũ).
      · Phải thấy: bị chặn với `TOTAL_MISMATCH`, nêu CẢ HAI con số.
      · ⚠ Đây là lưới chặn cuối cùng giữa "giao diện tính sai" và "công
        nợ ghi sai". Nếu nó im lặng cho qua thì `receivables.amount` sẽ
        lệch khỏi tổng dòng, và không báo cáo nào phát hiện được.

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

- [ ] **5.8 Trả hàng cho đơn CHƯA xuất.** Lập phiếu trả gắn vào một đơn
      còn ở `submitted`, rồi bấm Hoàn thành.
      · Phải thấy: bị chặn, câu tiếng Việt "đơn gốc chưa xuất hàng, không
        nhập trả được" (`ORDER_NOT_COMPLETED`).
      · ⚠ Không có phép chặn này thì kho nhận lại hàng nó CHƯA TỪNG xuất
        — tồn tăng lên từ hư không, và công nợ bị trừ cho một khoản chưa
        bao giờ được ghi.

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

- [ ] **6.6 Số dư có — Q11, phần đổi nghiệp vụ.** Dựng đúng thứ tự này:
      một đơn đã xuất, **thu ĐỦ tiền**, rồi mới lập phiếu trả cho đơn đó
      và hoàn thành.
      · Phải thấy: phiếu trả hoàn thành ĐƯỢC.
      · ⚠ Trước Q11 bước này bị chặn bằng `OVERPAID_AFTER_CREDIT` và
        phiếu trả kẹt vĩnh viễn, không có đường đi tiếp nào ngoài huỷ
        phiếu thu đã in. Nếu vẫn gặp câu đó thì migration 120 chưa chạy.
      · Kiểm: `receivables.paid` > `amount` — **đó là hợp lệ**;
        `status` = `paid`.

        ```sql
        SELECT id, amount, paid, paid - amount AS du, status
        FROM receivables WHERE customer_id = '<id khách>' AND paid > amount;
        ```

- [ ] **6.7 Số dư có PHẢI NHÌN THẤY ĐƯỢC.** Vẫn khách đó, mở
      `/receivables` và `/receivables/by-customer/<id>`.
      · Phải thấy: **không có số âm màu đỏ ở đâu cả**. Dòng dư hiện là
        "Dư có …" (xanh), và màn theo khách có dòng "Đang giữ hộ … — nợ
        ròng …".
      · ⚠ Số âm màu đỏ trông y hệt một khoản nợ khẩn cấp, trong khi sự
        thật ngược lại: nhà phân phối đang nợ khách.
      · Kiểm tổng không khai cao lố: "Tổng công nợ" luôn ≥ nợ ròng đúng
        bằng số dư — đó là cố ý (kẹp về 0), nhưng phải NÓI RA phần bị kẹp.

- [ ] **6.8 Rút số dư có ra dùng.** Vẫn khách đó, tạo thêm một đơn mới và
      xuất hàng để họ có khoản nợ mới. Vào `/finance/cash-receipts/new`.
      · Phải thấy: thẻ **"Số dư có của khách"** hiện đúng con số ở mục
        6.6, kèm ô **Rút từ số dư** và nút **Rút tối đa**.
      · Tick khoản nợ mới, bấm **Rút tối đa**, lưu.
      · Kiểm ô **Khách đưa** = nợ đã chọn − phần rút, và
        `cash_receipts.submitted_amount` đúng bằng con số đó.
      · Kiểm **HAI VẾ** trong sổ:

        ```sql
        SELECT receivable_id, amount, kind FROM cash_receipt_lines
        WHERE receipt_id = '<id phiếu vừa lập>' ORDER BY amount;
        ```
        Phải thấy một dòng ÂM (`kind='credit_applied'`, ở khoản đang dư)
        và một dòng DƯƠNG (`kind='credit_applied'`, ở khoản được thu),
        cộng lại bằng 0.
      · ⚠ Chỉ thấy MỘT vế là sai. `void_cash_receipt` đảo phiếu bằng cách
        duyệt chính bảng này; thiếu vế rút thì huỷ phiếu sẽ cộng lại phần
        đắp mà không trả lại phần đã rút — tiền của khách bốc hơi, và
        không lệnh nào báo lỗi.

- [ ] **6.9 Huỷ phiếu thu CÓ rút số dư.** Huỷ đúng phiếu ở mục 6.8.
      · Kiểm: cả hai dòng công nợ về ĐÚNG số trước khi lập phiếu — khoản
        dư dư lại đúng bằng cũ, khoản nợ mới nợ lại đúng bằng cũ.
      · ⚠ So bằng số cụ thể, đừng nhìn ước chừng. Đây là chỗ duy nhất
        trong cả đợt có bút toán hai vế; sai ở đây lệch sổ mà vẫn "trông
        hợp lý".

- [ ] **6.11 Tiền mặt trên báo cáo KHÔNG đếm phần cấn trừ — mig 121.**
      Sau khi đã có ít nhất một phiếu thu cấn trừ phiếu trả (mục 6.3) và
      một phiếu rút số dư có (mục 6.8):
      · Mở `/reports/finance` xem **Dòng tiền** và **Bảng cân đối**.
      · Kiểm bằng tay, hai số phải BẰNG NHAU:

        ```sql
        -- Số hệ thống ĐANG hiện (sau mig 121)
        SELECT * FROM finance_cash_flow('<từ ngày>', '<đến ngày>');

        -- Tiền thật khách đưa trong kỳ
        SELECT COALESCE(sum(p.amount), 0)
        FROM payments p JOIN receivables r ON r.id = p.receivable_id
        WHERE r.org_id = '<org>'
          AND p.collected_at >= '<từ ngày>' AND p.collected_at < '<đến ngày>'::date + 1
          AND COALESCE(p.method,'') NOT IN ('return_credit','credit_applied');
        ```
      · ⚠ **CHƯA CHẠY 121 THÌ SỐ ĐẦU SẼ CAO HƠN**, đúng bằng tổng các
        dòng `return_credit`. Mỗi đồng hàng trả được cấn trừ hiện ra như
        một đồng tiền mặt thu được — không lỗi nào bắn ra, chỉ có tiền
        mặt trên sổ cao hơn két thật.
      · Kiểm luôn cột **Hình thức** ở `/receivables/[id]`: dòng cấn trừ
        phải hiện **"Cấn trừ phiếu trả"** / **"Rút số dư có"**, không
        phải chữ tiếng Anh.

- [ ] **6.12 Ô chọn hình thức thu vẫn HẸP.** Mở `/finance/cash-receipts/new`
      và `/receivables/collect`, bung ô **Hình thức**.
      · Phải thấy ĐÚNG ba lựa chọn: Tiền mặt / Chuyển khoản / Ví điện tử.
      · ⚠ Nếu thấy "Cấn trừ phiếu trả" trong ô chọn thì kế toán lập được
        một phiếu thu cấn trừ RỖNG — không gắn phiếu trả nào, không có vế
        đối ứng, công nợ giảm mà không có gì đỡ lưng.

- [ ] **6.13 Nhập công nợ đầu kỳ cho khách đang DƯ — Q13.**
      `/finance/opening-balances`, tải file có một dòng hạ số nợ xuống
      THẤP HƠN số đã thu của khách đó.
      · Phải thấy: dòng đó **KHÔNG phải lỗi** — nó ghi được, và bảng xem
        trước hiện cảnh báo cam nêu rõ **số dư sẽ sinh ra là bao nhiêu**,
        kèm một dòng đếm "N dòng sẽ tạo SỐ DƯ CÓ cho khách" phía trên.
      · ⚠ Trước Q13 đây là lỗi cứng: người dùng không nhập lại được chính
        con số hệ thống vừa sinh ra.
      · ⚠ Nhưng XOÁ một khoản đã thu một phần thì VẪN phải là lỗi — xoá
        dòng đi là mất dấu số tiền đã nhận.

- [ ] **6.10 Rút quá tay bị chặn.** Thử gõ số lớn hơn số dư, rồi thử gõ
      số lớn hơn phần còn phải trả.
      · Phải thấy: chặn ngay ở màn (chữ đỏ, nút mờ), hai câu KHÁC NHAU.
      · Nếu lách được: RPC phải ném `CREDIT_BALANCE_TOO_LOW` hoặc
        `CREDIT_EXCEEDS_SELECTED`, dịch sang tiếng Việt.

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

## 9. Luồng cũ đã ẩn — P7

⚠ Ba việc KHÁC NHAU, kiểm riêng từng việc: **ẩn khỏi menu**, **vẫn vào xem
được**, **nút ghi đã khoá**. Lẫn ba việc này vào nhau là hoặc để lọt một
đường ghi, hoặc chặn mất chứng từ cũ.

- [ ] **9.1 Ẩn với MỌI vai trò, kể cả chủ.** Đăng nhập lần lượt bằng chủ,
      quản lý, kho, tài xế, kế toán.
      · Phải thấy: menu trái, menu dưới (điện thoại), lưới ô ở Trang chủ
        và màn Kho đều KHÔNG còn Giao hàng / Xuất kho / Chờ xử lý.
      · ⚠ Kiểm cả tài khoản CHỦ. Quyền của chủ mở hết mọi thứ, nên đây là
        vai dễ sót nhất.
      · Kiểm cả ô "Tạo phiếu" ở `/inventory/entries`: không còn mục
        **Xuất kho**.

- [ ] **9.2 Vẫn vào xem được chứng từ cũ.** Gõ thẳng `/deliveries` vào
      thanh địa chỉ.
      · Phải thấy: màn MỞ ra bình thường, không bị đá về trang chủ.
      · ⚠ Dữ liệu luồng cũ là chứng từ. Chặn luôn cửa vào là lấy mất lịch
        sử, mà ta chỉ định thôi dùng chứ không định vứt.

- [ ] **9.3 Năm nút ghi đều khoá.** Với mỗi màn, bấm đúng nút ghi:

      | Màn | Nút |
      |---|---|
      | `/inventory/stock-out` | Gộp / tạo phiếu xuất |
      | `/inventory/entries/<id>` | Tự giao |
      | `/inventory/stock-out/collect/<id>` | Lưu thu tiền |
      | `/deliveries/<id>/handover` | Bàn giao |
      | `/inventory/pending` | Nhập lại kho |

      · Phải thấy: toast đỏ "Bước này đã bỏ ở quy trình mới" kèm câu nói
        rõ **thay bằng gì** — không chỉ nói "không dùng được nữa".
      · Kiểm: KHÔNG có dòng mới nào trong `stock_entries`, `payments`,
        `returns` sau khi bấm.
      · ⚠ Hai màn cuối nguy hiểm nhất: bảng `returns` không có trigger
        chặn chuyển trạng thái, nên nếu khoá hỏng thì lệnh đẩy phiếu trả
        vào `completed` **vẫn chạy thành công** mà hàng không vào kho.
        Cơ sở dữ liệu không cãi một câu nào.

- [ ] **9.4 Màn Ngưỡng cảnh báo nói đúng việc nó làm.**
      `/settings/approval-rules` (menu: Cài đặt → **Ngưỡng cảnh báo đơn**).
      · Phải thấy: không còn chữ "duyệt" ở tiêu đề, nhãn ô, hay câu mô tả.
      · Đặt ngưỡng thấp rồi tạo một đơn vượt ngưỡng: đơn vẫn về
        **Phiếu tạm** bình thường, và mang câu nhắc **"soát kỹ trước khi
        Xuất hàng"** — KHÔNG phải "cần Manager duyệt".
      · ⚠ Màn này **không bị khoá** như ba màn luồng cũ, và đó là cố ý:
        ngưỡng công nợ và hạn mức tín dụng vẫn còn nguyên giá trị.

- [ ] **9.5 Tài xế đăng nhập không vào ngõ cụt.** Đăng nhập bằng tài
      khoản `driver`.
      · Phải thấy menu có: Trang chủ, Đơn hàng, Công nợ, Thu tiền, Phiếu
        thu, Trợ giúp — sáu bảy mục, không phải màn trắng.
      · ⚠ `/deliveries` đã ẩn với mọi vai. Nếu tài xế đăng nhập mà không
        còn màn việc nào thì phải báo lại — đó là quyết định nghiệp vụ,
        không phải lỗi kỹ thuật.

- [ ] **9.6 Trang Trợ giúp dạy đúng quy trình mới.** Mở `/help` bằng từng
      vai.
      · Phải thấy: không còn "Đã duyệt / Đang lấy / Đang giao", không còn
        ô module Giao hàng, và có câu hỏi thường gặp trả lời thẳng vì sao
        màn Giao hàng / Xuất kho biến mất.

---

## 10. Sau khi xong

- [ ] Ghi lại mọi mục SAI vào `docs/workflow-v2-questions.md`, kèm số liệu
      thật.
- [ ] Chỉ khi checklist xanh hết mới chạy migration lên production.
- [ ] Sau production: chạy lại mục 0 (đọc `RAISE NOTICE`) và mục 1 trên
      một đơn thật nhỏ trước khi để người dùng vào.
