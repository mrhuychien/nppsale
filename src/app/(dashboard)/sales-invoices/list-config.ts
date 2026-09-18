import type { ListViewOption } from "@/components/ui/list-view-toolbar"

/**
 * CỘT VÀ BỘ LỌC CỦA DANH SÁCH HÓA ĐƠN BÁN — bê nguyên từ danh sách đơn.
 *
 * ⚠ CÙNG TÊN KHOÁ VỚI `orders/list-config.ts` Ở NHỮNG CỘT TRÙNG NGHĨA
 * (`customer`, `route`, `address`, `salesUser`, `total`, `status`). Đặt
 * tên khác cho cùng một thứ là hai màn trôi xa nhau từ từ, và người sửa
 * sau phải đọc cả hai file mới biết chúng có giống nhau không.
 *
 * ⚠ HAI CỘT KHÔNG CÓ BÊN ĐƠN, vì hóa đơn có mà đơn không:
 *   • `date`  — NGÀY XUẤT, không phải ngày đặt. Đây là mốc ghi nhận
 *     doanh thu của v2b, nên nhãn phải nói đúng chữ "xuất".
 *   • `order` — đơn gốc. Không có cột này thì từ hóa đơn không lần
 *     ngược về đơn được, mà đó là việc tra sổ thường ngày.
 */

// Cột "Số hóa đơn" và ô thao tác luôn hiện — không khai báo ở đây.
export const INVOICE_COLUMNS = [
  { key: "customer", label: "Khách hàng" },
  { key: "route", label: "Tuyến bán" },
  { key: "ward", label: "Phường" },
  { key: "address", label: "Địa chỉ" },
  { key: "salesUser", label: "NV bán hàng" },
  { key: "date", label: "Ngày xuất" },
  { key: "order", label: "Đơn gốc" },
  { key: "total", label: "Tổng tiền" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type InvoiceColumnKey = (typeof INVOICE_COLUMNS)[number]["key"]

export const DEFAULT_INVOICE_COLUMNS: InvoiceColumnKey[] = [
  "customer",
  "salesUser",
  "date",
  "order",
  "total",
  "status",
]

export const INVOICE_FILTERS = [
  { key: "search", label: "Tìm số hóa đơn", required: true },
  { key: "date", label: "Ngày xuất" },
  { key: "customer", label: "Khách hàng" },
  { key: "sales", label: "NV bán hàng" },
  { key: "amount", label: "Giá trị hóa đơn" },
] as const satisfies readonly ListViewOption<string>[]

export type InvoiceFilterKey = (typeof INVOICE_FILTERS)[number]["key"]

export const DEFAULT_INVOICE_FILTERS: InvoiceFilterKey[] = ["search", "date"]
