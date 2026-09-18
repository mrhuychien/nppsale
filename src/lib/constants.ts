/**
 * ⚠ KHÔNG CÒN `DRIVER`. Vai Tài xế đã ngưng dùng (mig 122): quy trình mới
 * không có bước lập chuyến giao, và cơ sở dữ liệu chặn gán mới bằng
 * trigger. Các dòng `users` cũ vẫn mang giá trị `'driver'` — xem
 * `ROLE_LABELS` ngay dưới.
 */
export const ROLES = {
  OWNER: "owner",
  MANAGER: "manager",
  ACCOUNTANT: "accountant",
  SALES: "sales",
  WAREHOUSE: "warehouse",
} as const

export const ROLE_LABELS: Record<string, string> = {
  owner: "Chủ NPP",
  manager: "Quản lý bán hàng",
  accountant: "Kế toán",
  sales: "NV Bán hàng",
  warehouse: "NV Kho",
  // ⚠ GIỮ NHÃN DÙ VAI ĐÃ BỎ — màn Người dùng vẫn liệt kê tài khoản tài
  //   xế cũ (đã khoá). Bỏ dòng này là ô "Vai trò" của họ trống trơn.
  driver: "Tài xế (ngưng dùng)",
}

export const CHANNELS = [
  { value: "GT", label: "GT - Truyền thống" },
  { value: "MT", label: "MT - Hiện đại" },
  { value: "HORECA", label: "HORECA" },
] as const

export const PAYMENT_TERMS = [
  { value: "COD", label: "COD - Thanh toán khi giao" },
  { value: "NET7", label: "Công nợ 7 ngày" },
  { value: "NET15", label: "Công nợ 15 ngày" },
  { value: "NET30", label: "Công nợ 30 ngày" },
  { value: "NET45", label: "Công nợ 45 ngày" },
  { value: "NET60", label: "Công nợ 60 ngày" },
] as const

/**
 * Hình thức thu tiền NGƯỜI DÙNG CHỌN ĐƯỢC.
 *
 * ⚠ ĐỪNG THÊM `return_credit` / `credit_applied` VÀO ĐÂY. Hai giá trị đó
 * do RPC tự ghi khi cấn trừ phiếu trả hoặc rút số dư có; cho chúng lên ô
 * chọn là mời kế toán lập một phiếu thu "cấn trừ" rỗng, không gắn phiếu
 * trả nào và không có vế đối ứng — công nợ giảm mà không có gì đỡ lưng.
 * Danh sách NHÃN nằm ở `PAYMENT_METHOD_LABEL` bên dưới, rộng hơn danh
 * sách này, và đó là cố ý.
 */
export const PAYMENT_METHODS = [
  { value: "cash", label: "Tiền mặt" },
  { value: "transfer", label: "Chuyển khoản" },
  { value: "ewallet", label: "Ví điện tử" },
] as const

/**
 * Nhãn của MỌI giá trị `payments.method` có thể đọc lên từ CSDL.
 *
 * ⚠ ĐỌC RỘNG HƠN GHI. Bốn màn từng tự khai bảng nhãn ba dòng
 * (cash/transfer/ewallet) rồi `|| p.method` khi tra trượt. Từ workflow
 * v2, `chk_payments_method_v2` cho thêm hai giá trị mà RPC ghi ra, nên
 * người dùng thấy đúng chữ `return_credit` in giữa bảng công nợ — nhìn
 * như dữ liệu hỏng, trong khi dòng đó hoàn toàn bình thường.
 *
 * ⚠ MỘT CHỖ KHAI, MỌI MÀN DÙNG. Bốn bản sao là bốn chỗ phải nhớ sửa,
 * và lần này đã quên cả bốn.
 */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  ewallet: "Ví điện tử",
  // Hai dòng dưới KHÔNG phải tiền vào két — xem migration 121.
  return_credit: "Cấn trừ phiếu trả",
  credit_applied: "Rút số dư có",
}

/**
 * Nhãn của một giá trị `method`, giữ nguyên chuỗi gốc nếu chưa biết.
 *
 * ⚠ KHÔNG ĐOÁN, KHÔNG ĐỂ TRỐNG. Giá trị lạ trả về nguyên văn để người
 * xem còn tra được; để trống là xoá thông tin khỏi màn.
 */
export function labelPaymentMethod(method: string | null | undefined): string {
  const m = method || ""
  return PAYMENT_METHOD_LABEL[m] || m || "—"
}

/**
 * Sáu trạng thái ĐƠN ĐẶT HÀNG của workflow v2b
 * (`chk_sales_orders_status_v2`, migration 124).
 *
 * ⚠ THIẾU MỘT NHÃN LÀ MỘT Ô TRỐNG TRÊN MÀN. Migration 124 cho phép
 * `partially_invoiced` và `closed` tồn tại; bảng này không có hai khoá
 * đó thì đơn xuất một phần hiện ra không tên, và người dùng không biết
 * mình đang nhìn cái gì.
 *
 * ⚠ ĐỪNG LẪN VỚI HÓA ĐƠN BÁN. Hoá đơn chỉ có `posted`/`cancelled` —
 * xem `INVOICE_STATUS_MAP`.
 */
export const ORDER_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  draft: { label: "Nháp", variant: "secondary" },
  submitted: { label: "Phiếu tạm", variant: "warning" },
  partially_invoiced: { label: "Xuất một phần", variant: "default" },
  completed: { label: "Hoàn thành", variant: "success" },
  closed: { label: "Đã đóng", variant: "secondary" },
  cancelled: { label: "Đã hủy", variant: "danger" },
}

/**
 * Hai trạng thái HÓA ĐƠN BÁN (`sales_invoices.status`, migration 124).
 *
 * ⚠ KHÔNG CÓ NHÁP, và đó là cố ý: hoá đơn sinh ra và ghi sổ trong cùng
 * một RPC. Một hoá đơn "nháp" là giấy đã in mà kho chưa trừ.
 */
export const INVOICE_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  posted: { label: "Đã xuất", variant: "success" },
  cancelled: { label: "Đã hủy", variant: "danger" },
}

/**
 * Trạng thái đơn CHƯA sinh ra doanh thu nào — phần bù của
 * `is_revenue_status()` bên SQL.
 *
 * ⚠ HAI CÂU HỎI KHÁC NHAU, ĐỪNG GỘP. Hằng này trả lời "đơn này đã xuất
 * hàng chưa"; nó KHÔNG nói doanh thu là bao nhiêu. Số tiền cộng từ
 * `sales_invoices` (`is_revenue_invoice_status`), vì một đơn xuất một
 * phần đã sinh doanh thu nhưng không phải toàn bộ `total` của nó.
 *
 * ⚠ `partially_invoiced` và `closed` ĐỀU TÍNH. Hàng đã rời kho và công
 * nợ đã ghi; loại chúng ra là bảo một đơn giao thiếu thì coi như chưa
 * bán gì.
 *
 * ⚠ HẰNG NÀY PHẢI KHỚP TUYỆT ĐỐI với `is_revenue_status` — có chốt so
 * hai bên (`payroll-net-revenue.test.ts`). Hai nguồn sự thật cho cùng
 * một định nghĩa doanh thu là chỗ lệch không ai phát hiện bằng mắt.
 */
export const NON_REVENUE_ORDER_STATUSES = [
  "cancelled",
  "draft",
  "submitted",
] as const

export const CUSTOMER_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  active: { label: "Hoạt động", variant: "success" },
  suspended: { label: "Tạm ngưng", variant: "warning" },
  locked: { label: "Khóa", variant: "danger" },
}

export const DELIVERY_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  pending: { label: "Chờ giao", variant: "secondary" },
  in_transit: { label: "Đang giao", variant: "warning" },
  delivered: { label: "Đã giao", variant: "success" },
  partial: { label: "Giao 1 phần", variant: "warning" },
  failed: { label: "Thất bại", variant: "danger" },
}

export const PO_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  draft: { label: "Nháp", variant: "secondary" },
  confirmed: { label: "Đã duyệt", variant: "default" },
  received: { label: "Đã nhập kho", variant: "success" },
  partial: { label: "Nhập 1 phần", variant: "warning" },
  cancelled: { label: "Đã hủy", variant: "danger" },
}

export const PURCHASE_INVOICE_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  draft: { label: "Nháp", variant: "secondary" },
  completed: { label: "Hoàn thành", variant: "success" },
  cancelled: { label: "Đã huỷ", variant: "danger" },
  // legacy (trước mig 065) — vẫn map để không vỡ dữ liệu cũ
  confirmed: { label: "Hoàn thành", variant: "success" },
  paid: { label: "Hoàn thành", variant: "success" },
}

/**
 * Trạng thái thanh toán suy ra từ receivables.status. Hiển thị bên cạnh
 * trạng thái fulfillment để biết đơn đã thu tiền hay chưa.
 */
export const PAYMENT_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  open: { label: "Đơn nợ", variant: "danger" },
  partial: { label: "Trả 1 phần", variant: "warning" },
  paid: { label: "Đã trả tiền", variant: "success" },
  overdue: { label: "Quá hạn", variant: "destructive" },
}

/**
 * Bốn trạng thái phiếu trả của workflow v2 (`chk_returns_status_v2`,
 * migration 119).
 *
 * ⚠ NHÃN PHẢI NÓI ĐÚNG HÀNG ĐÃ VÀO KHO CHƯA. Bảng cũ gắn "Đã ghi nhận"
 * cho cả ba trạng thái, nên người đọc không phân biệt được phiếu đang
 * chờ xử lý với phiếu đã nhập kho — mà đó đúng là câu hỏi duy nhất người
 * ta mở danh sách phiếu trả ra để trả lời.
 *
 * ⚠ Ba khoá cuối là DI SẢN: giá trị không còn hợp lệ sau migration 119
 * (backfill đã đổi hết đi), nhưng giữ lại để phiếu cũ trong bản sao lưu
 * hay bản xuất CSV không hiện ra chữ tiếng Anh trần.
 */
export const RETURN_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  draft: { label: "Nháp", variant: "secondary" },
  submitted: { label: "Chờ xử lý", variant: "warning" },
  completed: { label: "Đã nhập kho", variant: "success" },
  cancelled: { label: "Đã huỷ", variant: "danger" },
  // Di sản — không còn giá trị nào thuộc nhóm này sau migration 119.
  pending: { label: "Chờ xử lý (cũ)", variant: "secondary" },
  approved: { label: "Đã duyệt (cũ)", variant: "secondary" },
  rejected: { label: "Đã huỷ (cũ)", variant: "danger" },
}

export const RETURN_REASONS = [
  { value: "damaged", label: "Hàng hư hỏng" },
  { value: "wrong_item", label: "Sai hàng" },
  { value: "near_expiry", label: "Gần hết hạn" },
  { value: "expired", label: "Hết hạn sử dụng" },
  { value: "refused", label: "Khách từ chối nhận" },
] as const

export const PROMOTION_TYPES = [
  { value: "trade_discount", label: "Chiết khấu thương mại" },
  { value: "buy_x_get_y", label: "Mua X tặng Y" },
  { value: "payment_discount", label: "Chiết khấu thanh toán" },
  { value: "cumulative", label: "Lũy kế" },
  { value: "display", label: "Trưng bày" },
] as const

export const COMMISSION_TYPES = [
  { value: "percentage", label: "Phần trăm (%)" },
  { value: "fixed", label: "Cố định" },
  { value: "tiered", label: "Bậc lũy kế" },
] as const

export const STOCK_ENTRY_TYPES = [
  { value: "import", label: "Nhập kho" },
  { value: "export", label: "Xuất kho" },
  { value: "transfer", label: "Chuyển kho" },
  { value: "stocktake", label: "Kiểm kê" },
] as const

export const APPROVAL_THRESHOLDS = {
  AUTO_APPROVE: 20_000_000,
  MANAGER_APPROVE: 50_000_000,
} as const

/**
 * Thuế suất VAT mặc định cho sản phẩm mới: 0%.
 *
 * Một CHỖ DUY NHẤT. Trước đây con số này nằm rải ở ba nơi — mặc định của
 * cột trong migration, giá trị khởi tạo của form, và giá trị lùi của bộ
 * đọc file Excel. Sửa một chỗ quên hai chỗ thì sản phẩm tạo bằng form và
 * sản phẩm nhập bằng file mang hai thuế suất khác nhau, mà không có gì
 * báo ra.
 *
 * Lưu dạng tỉ lệ (0 = 0%, 0.08 = 8%) — đúng như cột `products.vat_rate`
 * trong cơ sở dữ liệu.
 *
 * ⚠ 0 LÀ MỘT LỰA CHỌN, KHÔNG PHẢI CHỖ CHƯA ĐIỀN. Mã nguồn này từng có
 * một phép kiểm mang tên "VAT trống thì mặc định 8%, không phải 0" với lý
 * do "mặc định 0 sẽ làm mọi hoá đơn thiếu thuế". Chủ NPP đã chốt ngược
 * lại: hàng ở đây xuất không kèm VAT, nên 0 mới là con số đúng và mặc
 * định 8% mới là thứ bắt người ta phải sửa tay mỗi lần.
 *
 * Ghi lại ở đây để người sau đọc mã đừng tưởng đây là chỗ bị bỏ quên rồi
 * "sửa" nó về 8% — mặt hàng nào có thuế thì khai trên chính sản phẩm đó.
 */
export const DEFAULT_VAT_RATE = 0

/**
 * Các bậc thuế suất VAT chọn được — MỘT danh sách cho form sản phẩm lẫn
 * sheet sửa dòng trong đơn. Hai nơi hai danh sách là có ngày một bên thêm
 * bậc mà bên kia không hiểu.
 *
 * Lưu dạng tỉ lệ như `products.vat_rate`.
 */
export const VAT_RATES = [
  { value: 0, label: "0%" },
  { value: 0.05, label: "5%" },
  { value: 0.08, label: "8%" },
  { value: 0.1, label: "10%" },
] as const

/** "8%" cho 0.08; thuế suất lạ (0.07) vẫn in ra "7%", không ép về bậc gần nhất. */
export function vatLabel(rate: number): string {
  const r = Number(rate) || 0
  return VAT_RATES.find((v) => Math.abs(v.value - r) < 1e-9)?.label ?? `${Math.round(r * 100)}%`
}
