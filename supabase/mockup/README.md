# Mockup Dataset

Bộ script seed dữ liệu FMCG mẫu cho 1 NPP Việt Nam — để demo, training, UAT.

> ⚠ **BỘ NÀY ĐÃ ĐƯỢC CẬP NHẬT CHO WORKFLOW V2.** Bản cũ chèn thẳng năm
> giá trị trạng thái đã chết (`confirmed` / `picking` / `delivering` /
> `delivered`, và `approved` bên `returns`). Sau migration 119, hai ràng
> buộc `chk_sales_orders_status_v2` và `chk_returns_status_v2` từ chối
> chúng — mỗi lệnh INSERT sẽ ném lỗi giữa chừng, để lại nửa bộ dữ liệu
> trong CSDL. Nếu bạn còn giữ bản cũ ở đâu đó, đừng chạy.

## Trước khi chạy

1. Cần có **ít nhất 1 organization** và **ít nhất 1 user role=owner** tạo sẵn (đăng ký qua `/login` signup là đủ).
2. Script sẽ dùng org đầu tiên + owner đầu tiên tìm được. Nếu bạn có nhiều org, chỉnh `target_org_id` ở đầu mỗi file nếu cần.
3. Nên chạy sau khi đã dùng `supabase/reset/01 + 02 + 03` để bắt đầu từ môi trường sạch.

## Thứ tự

Chạy từng file theo số thứ tự. Mỗi file độc lập — nếu lỗi, chạy lại chỉ file đó (đa số được bọc trong `BEGIN/COMMIT` nên rollback nếu fail).

| # | File | Tạo | Phụ thuộc |
|---|------|-----|----------|
| 1 | `01_config.sql` | 3 customer_groups (VIP, Thường, Mới) + xác nhận sales_routes, expense_categories đã seed | org, owner |
| 2 | `02_products.sql` | 10 SP FMCG + units (thùng/lốc/gói) + price_lists theo group | 01 |
| 3 | `03_customers.sql` | 12 khách hàng spread đều 3 tuyến (GT/MT/HORECA) + assignments | 01, owner+sales user |
| 4 | `04_opening_stock.sql` | Phiếu nhập mở kỳ + batches đầy đủ tồn cho 10 SP | 02 |
| 5 | `05_sales_orders.sql` | 12 đơn hàng trải đều status (2 draft / 5 submitted / 5 completed) | 03, 04 |
| 6 | `06_deliveries_ar.sql` | 2-3 chuyến giao *(dữ liệu luồng cũ, để tra cứu)* + receivables cho đơn completed + 1-2 payments | 05 |
| 7 | `07_returns_visits.sql` | 2 phiếu trả ở **Phiếu tạm** (chưa nhập kho) + visit_logs 3 ngày gần đây | 05 |
| 8 | `08_expenses.sql` | 6-8 chi phí tháng hiện tại (rent, utilities, fuel, marketing...) | 01 |

## Chạy

**Supabase Dashboard → SQL Editor → tạo query mới → paste từng file → Run**

## Reset mockup

Nếu muốn xóa lại dữ liệu mockup này (ví dụ sau demo), chạy:
- `supabase/reset/01_reset_transactions.sql` — xoá đơn, giao, công nợ
- `supabase/reset/02_reset_catalog.sql` — xoá KH, SP, NCC

## Sau khi seed đủ 8 phần — nhìn thấy gì

- `/home`: "Chào buổi sáng, [Owner]!", KPI có số, lộ trình có KH
- `/customers`: 12 KH, 3 tuyến phân đều
- `/products`: 10 SP, giá theo bảng giá VIP/Thường
- `/inventory`: tồn đủ, card tổng giá trị hiện rõ
- `/orders`: đơn hàng chip filter có count: Nháp / Phiếu tạm / Hoàn thành
- `/deliveries`: **đã ẩn khỏi menu** (gõ thẳng địa chỉ để xem) — có chuyến giao cũ, chỉ đọc
- `/receivables`: công nợ mở + 1 payment
- `/returns`: 2 phiếu trả ở **Phiếu tạm** — bấm **Hoàn thành** thì hàng mới vào kho và công nợ mới giảm
- `/reports/finance/pnl`: Doanh thu, COGS, lãi ròng có số thật
- `/notifications`: bell có noti
