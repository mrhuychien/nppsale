/**
 * TRƯỜNG LỌC NÂNG CAO CỦA TỪNG DANH SÁCH — xem `advanced-filter.ts`.
 *
 * ⚠ CHỈ CỘT CÓ THẬT CỦA CHÍNH BẢNG (đối chiếu migration). Một cột gõ sai ở đây
 *   là PostgREST 42703 và CẢ danh sách trắng — chốt tests/loc-nang-cao.test.ts
 *   giữ danh sách cột được phép.
 */
import type { TruongLoc } from "@/lib/search/advanced-filter"
import {
  INVOICE_STATUS_MAP, ORDER_STATUS_MAP, PAYMENT_TERMS, RETURN_REASONS, RETURN_STATUS_MAP,
} from "@/lib/constants"

const tuMap = (m: Record<string, { label: string }>) =>
  Object.entries(m).map(([value, v]) => ({ value, label: v.label }))
const HINH_THUC = PAYMENT_TERMS.map((p) => ({ value: p.value, label: p.label }))

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
