/**
 * TRƯỜNG LỌC NÂNG CAO CỦA TỪNG DANH SÁCH — xem `advanced-filter.ts`.
 *
 * ⚠ CHỈ CỘT CÓ THẬT CỦA CHÍNH BẢNG (đối chiếu migration). Một cột gõ sai ở đây
 *   là PostgREST 42703 và CẢ danh sách trắng — chốt tests/loc-nang-cao.test.ts
 *   giữ danh sách cột được phép.
 */
import type { TruongLoc } from "@/lib/search/advanced-filter"
import {
  INVOICE_STATUS_MAP, ORDER_STATUS_MAP, PAYMENT_METHODS, PAYMENT_TERMS, PROMOTION_TYPES, RETURN_REASONS,
  RETURN_STATUS_MAP, STOCK_ENTRY_TYPES,
} from "@/lib/constants"
import { MISA_STATUS_BADGE } from "@/lib/misa/labels"
import { ISSUE_REASONS } from "@/lib/inventory/stock-issue"

const tuMap = (m: Record<string, { label: string }>) =>
  Object.entries(m).map(([value, v]) => ({ value, label: v.label }))
const HINH_THUC = PAYMENT_TERMS.map((p) => ({ value: p.value, label: p.label }))
/* Hai kho theo CHECK warehouse_zone IN ('sale', 'date'). */
const KHO = [
  { value: "sale", label: "Kho hàng bán" },
  { value: "date", label: "Kho hàng date (gần hạn)" },
]

export const LOC_DON_HANG: readonly TruongLoc[] = [
  { key: "ma", nhan: "Mã đơn", cot: "order_code", kieu: "text" },
  { key: "ngay", nhan: "Ngày đặt", cot: "order_date", kieu: "date" },
  { key: "giao", nhan: "Ngày giao dự kiến", cot: "expected_delivery", kieu: "date" },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: tuMap(ORDER_STATUS_MAP) },
  { key: "hinh_thuc", nhan: "Hình thức thanh toán", cot: "payment_terms", kieu: "enum", luaChon: HINH_THUC },
  { key: "tam_tinh", nhan: "Tạm tính", cot: "subtotal", kieu: "number" },
  { key: "chiet_khau", nhan: "Chiết khấu", cot: "discount", kieu: "number" },
  { key: "vat", nhan: "Thuế VAT", cot: "vat", kieu: "number" },
  { key: "tong", nhan: "Tổng tiền", cot: "total", kieu: "number" },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "notes", kieu: "text" },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

export const LOC_HOA_DON: readonly TruongLoc[] = [
  { key: "ma", nhan: "Mã hóa đơn", cot: "invoice_code", kieu: "text" },
  { key: "ngay", nhan: "Ngày xuất", cot: "invoice_date", kieu: "date" },
  { key: "han", nhan: "Hạn trả", cot: "due_date", kieu: "date" },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: tuMap(INVOICE_STATUS_MAP) },
  { key: "hinh_thuc", nhan: "Hình thức thanh toán", cot: "payment_terms", kieu: "enum", luaChon: HINH_THUC },
  { key: "tam_tinh", nhan: "Tạm tính", cot: "subtotal", kieu: "number" },
  { key: "vat", nhan: "Thuế VAT", cot: "vat", kieu: "number" },
  { key: "tong", nhan: "Tổng tiền", cot: "total", kieu: "number" },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "notes", kieu: "text" },
  { key: "ly_do_huy", nhan: "Lý do huỷ", cot: "cancel_reason", kieu: "text" },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

export const LOC_TRA_HANG: readonly TruongLoc[] = [
  { key: "ly_do", nhan: "Lý do trả", cot: "reason", kieu: "enum", luaChon: RETURN_REASONS.map((r) => ({ value: r.value, label: r.label })) },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: tuMap(RETURN_STATUS_MAP) },
  { key: "tien_tru", nhan: "Tiền trừ công nợ", cot: "credit_note_amount", kieu: "number" },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "notes", kieu: "text" },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

export const LOC_KHACH_HANG: readonly TruongLoc[] = [
  { key: "ten", nhan: "Tên cửa hàng", cot: "store_name", kieu: "text" },
  { key: "chu", nhan: "Chủ cửa hàng", cot: "owner_name", kieu: "text" },
  { key: "sdt", nhan: "Số điện thoại", cot: "phone", kieu: "text" },
  { key: "dia_chi", nhan: "Địa chỉ", cot: "address", kieu: "text" },
  { key: "phuong", nhan: "Phường/xã", cot: "ward", kieu: "text" },
  { key: "quan", nhan: "Quận/huyện", cot: "district", kieu: "text" },
  { key: "tinh", nhan: "Tỉnh/thành", cot: "province", kieu: "text" },
  { key: "mst", nhan: "Mã số thuế", cot: "tax_code", kieu: "text" },
  { key: "han_muc", nhan: "Hạn mức công nợ", cot: "credit_limit", kieu: "number" },
  { key: "hinh_thuc", nhan: "Hình thức thanh toán", cot: "payment_terms", kieu: "enum", luaChon: HINH_THUC },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

export const LOC_SAN_PHAM: readonly TruongLoc[] = [
  { key: "ten", nhan: "Tên hàng", cot: "name", kieu: "text" },
  { key: "ma", nhan: "Mã hàng", cot: "sku", kieu: "text" },
  { key: "ma_vach", nhan: "Mã vạch", cot: "barcode", kieu: "text" },
  { key: "nhom", nhan: "Nhóm hàng", cot: "category", kieu: "text" },
  { key: "thuong_hieu", nhan: "Thương hiệu", cot: "brand", kieu: "text" },
  { key: "dvt", nhan: "Đơn vị cơ sở", cot: "base_unit", kieu: "text" },
  { key: "gia_ban", nhan: "Giá bán", cot: "sell_price", kieu: "number" },
  { key: "vat", nhan: "Thuế suất (0,1 = 10%)", cot: "vat_rate", kieu: "number" },
  { key: "han_dung", nhan: "Hạn dùng (ngày)", cot: "shelf_life_days", kieu: "number" },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

export const LOC_NHA_CUNG_CAP: readonly TruongLoc[] = [
  { key: "ten", nhan: "Tên NCC", cot: "name", kieu: "text" },
  { key: "ma", nhan: "Mã NCC", cot: "code", kieu: "text" },
  { key: "nhom", nhan: "Nhóm", cot: "category", kieu: "text" },
  { key: "lien_he", nhan: "Người liên hệ", cot: "contact_name", kieu: "text" },
  { key: "sdt", nhan: "Số điện thoại", cot: "phone", kieu: "text" },
  { key: "email", nhan: "Email", cot: "email", kieu: "text" },
  { key: "dia_chi", nhan: "Địa chỉ", cot: "address", kieu: "text" },
  { key: "mst", nhan: "Mã số thuế", cot: "tax_code", kieu: "text" },
  { key: "hinh_thuc", nhan: "Hình thức thanh toán", cot: "payment_terms", kieu: "enum", luaChon: HINH_THUC },
  { key: "xac_minh", nhan: "Đã xác minh", cot: "is_verified", kieu: "bool" },
  { key: "hoat_dong", nhan: "Đang hoạt động", cot: "is_active", kieu: "bool" },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "notes", kieu: "text" },
]

/** /receivables — bảng receivables. Thẻ tuổi nợ (RPC tổng hợp) vẫn là toàn sổ. */
export const LOC_CONG_NO_PHAI_THU: readonly TruongLoc[] = [
  { key: "phai_thu", nhan: "Số phải thu", cot: "amount", kieu: "number" },
  { key: "da_thu", nhan: "Đã thu", cot: "paid", kieu: "number" },
  { key: "han", nhan: "Hạn thanh toán", cot: "due_date", kieu: "date" },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: [
    { value: "open", label: "Chưa thu" }, { value: "partial", label: "Thu một phần" },
    { value: "paid", label: "Đã thu đủ" }, { value: "overdue", label: "Quá hạn" },
  ] },
  { key: "dau_ky", nhan: "Nợ đầu kỳ", cot: "opening_balance", kieu: "bool" },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "note", kieu: "text" },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /payables — bảng payables. */
export const LOC_CONG_NO_PHAI_TRA: readonly TruongLoc[] = [
  { key: "so_hd", nhan: "Số hóa đơn NCC", cot: "invoice_number", kieu: "text" },
  { key: "phai_tra", nhan: "Số phải trả", cot: "amount", kieu: "number" },
  { key: "da_tra", nhan: "Đã trả", cot: "paid", kieu: "number" },
  { key: "han", nhan: "Hạn thanh toán", cot: "due_date", kieu: "date" },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: [
    { value: "open", label: "Chưa trả" }, { value: "partial", label: "Trả một phần" },
    { value: "paid", label: "Đã trả đủ" }, { value: "overdue", label: "Quá hạn" },
  ] },
  { key: "dau_ky", nhan: "Nợ đầu kỳ", cot: "opening_balance", kieu: "bool" },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "notes", kieu: "text" },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/**
 * /deliveries — bảng deliveries.
 * ⚠ KHÔNG dùng DELIVERY_STATUS_MAP: khoá của nó (delivered/partial/failed) không
 *   khớp CHECK của deliveries.status — lọc theo đó không bao giờ ra dòng nào.
 */
export const LOC_CHUYEN_GIAO: readonly TruongLoc[] = [
  { key: "tuyen", nhan: "Tuyến", cot: "route_name", kieu: "text" },
  { key: "xe", nhan: "Xe", cot: "vehicle", kieu: "text" },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: [
    { value: "pending", label: "Chưa khởi hành" }, { value: "in_transit", label: "Đang giao" },
    { value: "completed", label: "Đã giao" }, { value: "cancelled", label: "Đã huỷ" },
  ] },
  { key: "bat_dau", nhan: "Khởi hành lúc", cot: "started_at", kieu: "date", coGio: true },
  { key: "hoan_tat", nhan: "Hoàn tất lúc", cot: "completed_at", kieu: "date", coGio: true },
  { key: "nop_tien", nhan: "Nộp tiền lúc", cot: "settled_at", kieu: "date", coGio: true },
  { key: "tien_nop", nhan: "Số tiền đã nộp", cot: "settled_amount", kieu: "number" },
  { key: "ghi_chu_ban_giao", nhan: "Ghi chú bàn giao hàng", cot: "goods_handover_notes", kieu: "text" },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /invoices (hóa đơn điện tử MISA) — bảng invoices. */
export const LOC_HOA_DON_DIEN_TU: readonly TruongLoc[] = [
  { key: "so_hd", nhan: "Số hóa đơn", cot: "invoice_number", kieu: "text" },
  { key: "khach", nhan: "Tên khách hàng", cot: "customer_name", kieu: "text" },
  { key: "mst", nhan: "Mã số thuế", cot: "customer_tax_code", kieu: "text" },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: [
    { value: "draft", label: "Nháp" }, { value: "issued", label: "Đã phát hành" }, { value: "cancelled", label: "Đã hủy" },
  ] },
  { key: "misa", nhan: "Trạng thái MISA", cot: "misa_status", kieu: "enum", luaChon: tuMap(MISA_STATUS_BADGE) },
  { key: "so_misa", nhan: "Số HĐ MISA", cot: "misa_inv_no", kieu: "text" },
  { key: "ngay_misa", nhan: "Ngày HĐ MISA", cot: "misa_inv_date", kieu: "date" },
  { key: "vat", nhan: "Thuế VAT", cot: "vat", kieu: "number" },
  { key: "tong", nhan: "Tổng tiền", cot: "total", kieu: "number" },
  { key: "loi_misa", nhan: "Lỗi MISA", cot: "misa_error", kieu: "text" },
  { key: "phat_hanh", nhan: "Ngày phát hành", cot: "issued_at", kieu: "date", coGio: true },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /purchasing/invoices — bảng stock_entries (chỉ phiếu nhập mua). */
export const LOC_PHIEU_NHAP_MUA: readonly TruongLoc[] = [
  { key: "ma", nhan: "Mã phiếu nhập", cot: "entry_code", kieu: "text" },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: [
    { value: "draft", label: "Nháp" }, { value: "posted", label: "Đã ghi sổ" }, { value: "cancelled", label: "Đã huỷ" },
  ] },
  { key: "kho", nhan: "Kho", cot: "warehouse_zone", kieu: "enum", luaChon: KHO },
  { key: "ngay_nhap", nhan: "Ngày nhập", cot: "posted_at", kieu: "date", coGio: true },
  { key: "ly_do", nhan: "Lý do", cot: "issue_reason", kieu: "text" },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "notes", kieu: "text" },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /purchasing/receipts — bảng purchase_invoices (lọc ở trình duyệt, `khopLoc`). */
export const LOC_HOA_DON_MUA: readonly TruongLoc[] = [
  { key: "ma", nhan: "Mã phiếu", cot: "receipt_code", kieu: "text" },
  { key: "so_hd", nhan: "Số hoá đơn NCC", cot: "invoice_number", kieu: "text" },
  { key: "ngay", nhan: "Ngày hoá đơn", cot: "invoice_date", kieu: "date" },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: [
    { value: "draft", label: "Phiếu tạm" }, { value: "completed", label: "Hoàn thành" }, { value: "cancelled", label: "Đã huỷ" },
  ] },
  { key: "kho", nhan: "Kho nhận", cot: "warehouse_zone", kieu: "enum", luaChon: KHO },
  { key: "tam_tinh", nhan: "Tạm tính", cot: "subtotal", kieu: "number" },
  { key: "vat", nhan: "Thuế VAT", cot: "vat", kieu: "number" },
  { key: "vat_sua", nhan: "VAT sửa tay", cot: "vat_override", kieu: "number" },
  { key: "tong", nhan: "Tổng tiền", cot: "total", kieu: "number" },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "notes", kieu: "text" },
  { key: "hoan_thanh", nhan: "Ngày hoàn thành", cot: "completed_at", kieu: "date", coGio: true },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /purchase-returns — bảng supplier_returns. */
export const LOC_TRA_HANG_NCC: readonly TruongLoc[] = [
  { key: "ma", nhan: "Mã phiếu trả", cot: "return_code", kieu: "text" },
  { key: "ngay", nhan: "Ngày trả", cot: "return_date", kieu: "date" },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: [
    { value: "draft", label: "Nháp" }, { value: "completed", label: "Đã gửi" }, { value: "cancelled", label: "Đã huỷ" },
  ] },
  { key: "kho", nhan: "Kho xuất", cot: "warehouse_zone", kieu: "enum", luaChon: KHO },
  { key: "ly_do", nhan: "Lý do trả", cot: "reason", kieu: "text" },
  { key: "tam_tinh", nhan: "Tạm tính", cot: "subtotal", kieu: "number" },
  { key: "chiet_khau", nhan: "Chiết khấu", cot: "discount", kieu: "number" },
  { key: "vat", nhan: "Thuế VAT", cot: "vat", kieu: "number" },
  { key: "tong", nhan: "Tổng tiền", cot: "total", kieu: "number" },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "notes", kieu: "text" },
  { key: "ly_do_huy", nhan: "Lý do huỷ", cot: "cancel_reason", kieu: "text" },
  { key: "hoan_thanh", nhan: "Ngày gửi", cot: "completed_at", kieu: "date", coGio: true },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /finance/cash-receipts — bảng cash_receipts. */
export const LOC_PHIEU_THU: readonly TruongLoc[] = [
  { key: "ma", nhan: "Mã phiếu thu", cot: "receipt_code", kieu: "text" },
  { key: "ngay", nhan: "Ngày thu", cot: "receipt_date", kieu: "date" },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: [
    { value: "pending", label: "Chờ xác nhận" }, { value: "received", label: "Đã nhận" }, { value: "voided", label: "Đã hủy" },
  ] },
  { key: "nguon", nhan: "Nguồn", cot: "source_type", kieu: "enum", luaChon: [
    { value: "delivery_settle", label: "Quyết toán chuyến giao" }, { value: "manual", label: "Nhập tay" }, { value: "standalone", label: "Phiếu độc lập" },
  ] },
  { key: "da_nop", nhan: "Đã nộp", cot: "submitted_amount", kieu: "number" },
  { key: "phai_thu", nhan: "Phải thu", cot: "expected_amount", kieu: "number" },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "notes", kieu: "text" },
  { key: "nhan_luc", nhan: "Ngày nhận", cot: "received_at", kieu: "date", coGio: true },
  { key: "huy_luc", nhan: "Ngày hủy", cot: "voided_at", kieu: "date", coGio: true },
  { key: "ly_do_huy", nhan: "Lý do hủy", cot: "void_reason", kieu: "text" },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /finance/expenses — bảng expenses. CHECK payment_method = đúng PAYMENT_METHODS. */
export const LOC_CHI_PHI: readonly TruongLoc[] = [
  { key: "ngay", nhan: "Ngày chi", cot: "expense_date", kieu: "date" },
  { key: "so_tien", nhan: "Số tiền", cot: "amount", kieu: "number" },
  { key: "mo_ta", nhan: "Mô tả", cot: "description", kieu: "text" },
  { key: "ma_tham_chieu", nhan: "Mã tham chiếu", cot: "reference_code", kieu: "text" },
  { key: "nguon", nhan: "Nguồn tự động", cot: "source_type", kieu: "text" },
  { key: "da_tra", nhan: "Đã thanh toán", cot: "is_paid", kieu: "bool" },
  { key: "tra_luc", nhan: "Ngày thanh toán", cot: "paid_at", kieu: "date", coGio: true },
  { key: "hinh_thuc", nhan: "Hình thức", cot: "payment_method", kieu: "enum", luaChon: PAYMENT_METHODS.map((p) => ({ value: p.value, label: p.label })) },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /inventory/entries — bảng stock_entries (lọc ở trình duyệt, `khopLoc`). */
export const LOC_PHIEU_KHO: readonly TruongLoc[] = [
  { key: "ma", nhan: "Mã phiếu", cot: "entry_code", kieu: "text" },
  { key: "loai", nhan: "Loại phiếu", cot: "type", kieu: "enum", luaChon: STOCK_ENTRY_TYPES.map((t) => ({ value: t.value, label: t.label })) },
  { key: "trang_thai", nhan: "Trạng thái", cot: "status", kieu: "enum", luaChon: [
    { value: "draft", label: "Nháp" }, { value: "posted", label: "Đã duyệt" }, { value: "cancelled", label: "Đã hủy" },
  ] },
  { key: "ly_do", nhan: "Lý do xuất", cot: "issue_reason", kieu: "enum", luaChon: ISSUE_REASONS.map((r) => ({ value: r.value, label: r.label })) },
  { key: "kho", nhan: "Kho", cot: "warehouse_zone", kieu: "enum", luaChon: KHO },
  { key: "kho_den", nhan: "Kho nhận (chuyển kho)", cot: "dest_warehouse_zone", kieu: "enum", luaChon: KHO },
  { key: "ghi_chu", nhan: "Ghi chú", cot: "notes", kieu: "text" },
  { key: "duyet_luc", nhan: "Ngày duyệt", cot: "posted_at", kieu: "date", coGio: true },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /inventory/batches — bảng batches (lọc ở trình duyệt). */
export const LOC_LO_HANG: readonly TruongLoc[] = [
  { key: "ma_lo", nhan: "Mã lô", cot: "batch_code", kieu: "text" },
  { key: "nsx", nhan: "Ngày sản xuất", cot: "manufactured_at", kieu: "date" },
  { key: "hsd", nhan: "Hạn sử dụng", cot: "expires_at", kieu: "date" },
  { key: "vi_tri", nhan: "Vị trí", cot: "location", kieu: "text" },
  { key: "kho", nhan: "Kho", cot: "warehouse_zone", kieu: "enum", luaChon: KHO },
  { key: "ban_dau", nhan: "SL ban đầu", cot: "qty_initial", kieu: "number" },
  { key: "ton", nhan: "Tồn", cot: "qty_on_hand", kieu: "number" },
  { key: "gia_von", nhan: "Giá vốn", cot: "unit_cost", kieu: "number" },
  { key: "trang_thai", nhan: "Trạng thái lô", cot: "status", kieu: "text" },
  { key: "nhap_luc", nhan: "Ngày nhập kho", cot: "received_at", kieu: "date", coGio: true },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /promotions — bảng promotions (lọc ở trình duyệt). */
export const LOC_KHUYEN_MAI: readonly TruongLoc[] = [
  { key: "ten", nhan: "Tên chương trình", cot: "name", kieu: "text" },
  { key: "loai", nhan: "Loại khuyến mãi", cot: "type", kieu: "enum", luaChon: PROMOTION_TYPES.map((t) => ({ value: t.value, label: t.label })) },
  { key: "uu_tien", nhan: "Độ ưu tiên", cot: "priority", kieu: "number" },
  { key: "bat_dau", nhan: "Ngày bắt đầu", cot: "starts_at", kieu: "date" },
  { key: "ket_thuc", nhan: "Ngày kết thúc", cot: "ends_at", kieu: "date" },
  { key: "dang_chay", nhan: "Đang chạy", cot: "is_active", kieu: "bool" },
  { key: "tao_luc", nhan: "Ngày tạo", cot: "created_at", kieu: "date", coGio: true },
]

/** /commissions — bảng commission_wallets (chỉ bốn cột lọc được). */
export const LOC_VI_HOA_HONG: readonly TruongLoc[] = [
  { key: "ky", nhan: "Kỳ (YYYY-MM)", cot: "period", kieu: "text" },
  { key: "da_huong", nhan: "Hoa hồng đạt", cot: "earned", kieu: "number" },
  { key: "da_tra", nhan: "Đã chi trả", cot: "paid", kieu: "number" },
  { key: "con_lai", nhan: "Còn phải trả", cot: "balance", kieu: "number" },
]
