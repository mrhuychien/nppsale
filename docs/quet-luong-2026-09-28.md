# Quét luồng Đơn hàng · Hoá đơn · Phiếu trả · Phiếu thu · Công nợ — 28/09/2026

Chủ nhà: *"ngồi tính hết các trường hợp từ Đơn hàng, Hoá đơn, Phiếu trả, Phiếu thu, Công nợ.
quét hết các trường hợp xem làm xuôi và làm ngược thế nào"*.

Chạy thật trên Postgres ở máy (đủ 210 migration). Mỗi kịch bản bọc BEGIN … ROLLBACK. Sau mỗi bước
kiểm con số: tồn kho khớp phiếu nhập/xuất, công nợ = HĐ − hàng trả − tiền thu, trạng thái đơn khớp
HĐ, `paid` khớp payments, doanh thu không đếm hai lần. Chạy lại:

```
PGHOST=/tmp/pgtest PGPORT=55432 PGUSER=postgres psql -d <db> -f scripts/sql/quet/don-hoa-don.sql
                                                              scripts/sql/quet/phieu-tra.sql
                                                              scripts/sql/quet/phieu-thu-cong-no.sql
```

| Mảng | Kịch bản / phép kiểm | Đạt | Chặn đúng thiết kế | Lỗi |
|---|---|---|---|---|
| Đơn ↔ Hoá đơn | 32 kịch bản | 21 | 1 (+ chặn trong kịch bản) | 8 |
| Phiếu trả | 84 phép kiểm | 70 | nhiều | 9 |
| Phiếu thu ↔ Công nợ | 36 kịch bản (66 kết quả) | 25 | 19 | 19 (6 nhóm) |

## Chạy đúng (xuôi và ngược)

- Xuất HĐ đủ / một phần / nhiều HĐ một đơn / xuất vượt; FIFO chẻ lô; quy đổi thùng–hộp; VAT nhiều mức;
  giảm giá đơn; hàng trả vượt HĐ → công nợ âm.
- Huỷ HĐ (một trong hai, cả hai): kho về đúng lô, công nợ xoá, đơn lùi trạng thái, xuất lại được.
- Sửa HĐ: đổi giá, SL, dòng, ngày; hai lần liên tiếp; có tiền thu (chuyển sang tờ mới); có phiếu trả
  chờ / đã nhập kho (hỏi Có / Không — mig 210); hỏng giữa chừng thì cuộn lại hết.
- Phiếu trả tự sinh: chờ → nhập kho → huỷ nhập → nhập lại, không đảo trùng; hàng đổi.
- Phiếu trả tự lập gắn HĐ / độc lập: hoàn thành, sửa, huỷ; dư có dùng ở phiếu thu rồi huỷ ngược.
- Phiếu thu: đủ, một phần, nhiều HĐ, nợ đầu kỳ, dùng dư có, huỷ phiếu thu.
- Doanh thu thuần theo ngày HĐ / ngày chứng từ; quyền theo vai; khác tổ chức bị chặn.

## Lỗi — sai tiền (nên sửa trước)

| # | Lỗi | Tái hiện | Chỗ gây lỗi |
|---|---|---|---|
| 1 | **Khách trả dư trên một HĐ bị giấu khỏi tổng nợ** — dòng công nợ `paid > amount` thành `paid` nên không được cộng (mất dư có) | Sửa HĐ 400k đã thu đủ xuống 250k → nợ hiện 0, đúng −150k. Thu đủ rồi trả hàng 200k → nợ hiện 2,2tr, đúng 2,0tr. Sửa nợ đầu kỳ xuống dưới số đã thu | `_wf2b_recompute_receivable`, trigger trạng thái công nợ |
| 2 | **Huỷ phiếu thu làm mất tiền** khi phần dư của khoản đó đã được rút sang khoản khác | Thu đủ HĐ1, trả 200k, rút dư 200k vào HĐ2, huỷ phiếu thu gốc → nợ 2,9tr, đúng 3,1tr | `void_cash_receipt` (kẹp `GREATEST(0, …)`) |
| 3 | `create_cash_receipt` nhận **dòng âm / 0đ** → `paid` tụt mà không có payment | Gọi RPC với dòng −500k | `create_cash_receipt` |
| 4 | **Sửa HĐ trên điện thoại mất giảm giá đơn** (khách bị ghi nợ thêm) và **không gửi ngày** → tờ mới lấy ngày hôm nay, doanh thu dời kỳ | HĐ 350k (giảm 50k) sửa ra 400k; HĐ 21/09 sửa thành 28/09 | `invoice-editor.tsx`, `reissue_invoice` |
| 5 | Phiếu trả lập ở `/returns/new` mang cả `order_id` → **sửa HĐ biến nó thành tự sinh**, trừ nợ khi chưa ai duyệt; huỷ HĐ thì khoá nó | Nháp tự lập + sửa HĐ → Chờ xử lý, nợ −120k | `/returns/new`, `create_return_with_lines`, câu gắn trong `post_invoice` |
| 6 | **Phiếu trả gắn được vào HĐ của khách khác** | Phiếu khách A gắn HĐ khách B → trừ nợ của B | `save_pos_return`, `complete_return` |
| 7 | **Hàng đổi xuất hai lần** khi đơn xuất hai đợt (nút xuất hàng loạt, màn điện thoại) | Đợt 2 trừ kho hàng đổi lần nữa | `get_invoiceable_lines` |

## Lỗi — quyền / ghi thẳng vượt RPC (trái luật "tiền, kho, trạng thái chỉ đổi qua RPC")

| # | Lỗi |
|---|---|
| 8 | Kế toán / chủ ghi thẳng được `receivables.amount`, `paid`; `payments`; đổi `cash_receipts.status`; quản lý xoá phiếu thu (dòng mất, `paid` ở lại); thủ kho chèn được phiếu thu 9.999.999đ. Trang `receivables/[id]` còn nút đặt tay "đã trả". |
| 9 | Dòng phiếu trả ĐÃ hoàn thành sửa thẳng được (credit 120k → 1,2tr, nợ / kho không tính lại); quản lý đổi thẳng `returns.status` → completed (không nhập kho); `create_return_with_lines` tin `status` và `line_total` từ trình duyệt. |
| 10 | `sales_order_lines.invoiced_qty` ghi thẳng được → đơn không còn gì để xuất. |
| 11 | `post_invoice` không kiểm dòng HĐ có thuộc đơn / đúng sản phẩm (chỉ gọi RPC tay mới gặp). |

## Luồng thiếu / cần chủ nhà chốt

| # | Việc | Hiện tại |
|---|---|---|
| 12 | Sửa HĐ của **đơn đã đóng** | Đơn 2 HĐ: không sửa được. Đơn 1 HĐ: sửa được nhưng mất trạng thái đóng |
| 13 | Huỷ phiếu trả khi hàng trả về đã bán hết | Cho huỷ, tồn âm (−5) — chặn hay cho? |
| 14 | Phiếu tự sinh bị bỏ hết dòng khi sửa HĐ | Nháp rỗng mang cờ tự sinh, kẹt không huỷ được |
| 15 | Bấm Lưu phiếu thu hai lần | Ra hai phiếu |
| 16 | Tiền lẻ (0,005đ) | Payment và dòng phiếu thu lệch 0,01 |
| 17 | Giá vốn hàng trả tự sinh theo ngày nhập kho, doanh thu theo ngày HĐ | Treo Chờ xử lý qua tháng thì lãi gộp hai kỳ lệch (mig 211 cho chọn ngày nhập kho giúp giảm lệch) |
| 18 | Màn quyết toán chuyến giao | Vẫn ghi công nợ theo đơn (luồng cũ đã cấm) — nên khoá |
| 19 | Màn lập phiếu thu | Còn liệt kê dòng công nợ âm "còn nợ 0" |
| 20 | Quyền | Quản lý không lập được phiếu thu; thủ kho không nhập kho phiếu trả — cố ý? |
| 21 | Không có RPC | Mở lại đơn đã đóng; sửa phần chưa giao của đơn đã xuất một phần; hoàn tiền mặt phần khách trả dư |
