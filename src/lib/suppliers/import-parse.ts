/**
 * Parse + validate bảng NCC import từ Excel/CSV (client-side).
 * Cấu trúc đơn giản hơn products: mỗi dòng = 1 NCC, không có quy đổi.
 */

export type SupplierField =
  | "name"
  | "code"
  | "category"
  | "contact_name"
  | "phone"
  | "email"
  | "address"
  | "tax_code"
  | "bank_account"
  | "bank_name"
  | "payment_terms"
  | "notes"
  | "is_verified"
  | "is_active"

export interface ParsedSupplierRow {
  rowNo: number
  name: string
  code: string | null
  category: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  tax_code: string | null
  bank_account: string | null
  bank_name: string | null
  payment_terms: string
  notes: string | null
  is_verified: boolean
  is_active: boolean
  errors: string[]
}

export interface ParseSupplierResult {
  rows: ParsedSupplierRow[]
  headerError: string | null
}

function normHeader(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[*:]/g, "")
    .trim()
    .replace(/\s+/g, " ")
}

const HEADER_MAP: Record<string, SupplierField> = {
  // name
  "ten ncc": "name", "ten nha cung cap": "name", "ten": "name",
  "ten nha cung cap*": "name", "nha cung cap": "name",
  "ten cong ty": "name", "company": "name",
  // code
  "ma ncc": "code", "ma nha cung cap": "code", "ma": "code", "code": "code",
  // category
  "danh muc": "category", "nhom": "category", "loai": "category", "loai ncc": "category",
  // contact
  "nguoi lien he": "contact_name", "lien he": "contact_name",
  "ten lien he": "contact_name", "contact": "contact_name",
  // phone
  "so dien thoai": "phone", "dien thoai": "phone", "sdt": "phone", "phone": "phone", "tel": "phone",
  // email
  "email": "email", "thu dien tu": "email", "e-mail": "email",
  // address
  "dia chi": "address", "address": "address",
  // tax_code
  "ma so thue": "tax_code", "mst": "tax_code", "tax": "tax_code", "tax code": "tax_code",
  // bank
  "so tai khoan": "bank_account", "stk": "bank_account",
  "so tai khoan ngan hang": "bank_account",
  "ngan hang": "bank_name", "ten ngan hang": "bank_name", "bank": "bank_name",
  // payment_terms
  "dieu khoan thanh toan": "payment_terms", "cong no": "payment_terms",
  "thanh toan": "payment_terms", "payment terms": "payment_terms",
  // notes
  "ghi chu": "notes", "mo ta": "notes", "note": "notes", "notes": "notes",
  // flags
  "da xac minh": "is_verified", "xac minh": "is_verified", "verified": "is_verified",
  "trang thai": "is_active", "hoat dong": "is_active", "active": "is_active",
}

const VALID_TERMS = new Set(["COD", "NET7", "NET15", "NET30", "NET45", "NET60"])

function parsePaymentTerms(raw: unknown): string {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "")
  if (!s) return "NET30"
  if (VALID_TERMS.has(s)) return s
  // "Công nợ 30 ngày", "30 ngày", "30" → NET30
  const m = s.match(/(\d+)/)
  if (m) {
    const n = parseInt(m[1], 10)
    const candidate = `NET${n}`
    if (VALID_TERMS.has(candidate)) return candidate
  }
  if (s.includes("COD") || s.includes("TIENMAT") || s.includes("THUTRUC")) return "COD"
  return "NET30"
}

function parseBool(raw: unknown, def: boolean): boolean {
  const s = normHeader(raw)
  if (!s) return def
  if (["1", "true", "co", "yes", "x", "v", "on", "hoat dong", "kich hoat"].includes(s)) return true
  if (["0", "false", "khong", "no", "off", "ngung", "tat", "khoa"].includes(s)) return false
  return def
}

function str(raw: unknown): string {
  return String(raw ?? "").trim()
}

export function parseSupplierSheet(aoa: unknown[][]): ParseSupplierResult {
  if (!aoa || aoa.length < 2) {
    return {
      rows: [],
      headerError: "File không có dữ liệu (cần dòng tiêu đề + ít nhất 1 dòng NCC).",
    }
  }

  const headerRow = aoa[0]
  const colIndex: Partial<Record<SupplierField, number>> = {}
  headerRow.forEach((cell, idx) => {
    const field = HEADER_MAP[normHeader(cell)]
    if (field && colIndex[field] === undefined) colIndex[field] = idx
  })

  if (colIndex.name === undefined) {
    return {
      rows: [],
      headerError: 'Thiếu cột "Tên NCC". Tải file mẫu để xem đúng định dạng.',
    }
  }

  const get = (row: unknown[], field: SupplierField): unknown => {
    const idx = colIndex[field]
    return idx === undefined ? "" : row[idx]
  }

  const rows: ParsedSupplierRow[] = []
  const seenNames = new Set<string>()
  for (let i = 1; i < aoa.length; i++) {
    const raw = aoa[i] || []
    if (raw.every((c) => str(c) === "")) continue

    const name = str(get(raw, "name"))
    const errors: string[] = []
    if (!name) errors.push("Thiếu tên NCC")

    const nameLower = name.toLowerCase()
    if (nameLower && seenNames.has(nameLower)) {
      errors.push("Trùng tên NCC trong file")
    }
    if (nameLower) seenNames.add(nameLower)

    rows.push({
      rowNo: i + 1,
      name,
      code: str(get(raw, "code")) || null,
      category: str(get(raw, "category")) || null,
      contact_name: str(get(raw, "contact_name")) || null,
      phone: str(get(raw, "phone")) || null,
      email: str(get(raw, "email")) || null,
      address: str(get(raw, "address")) || null,
      tax_code: str(get(raw, "tax_code")) || null,
      bank_account: str(get(raw, "bank_account")) || null,
      bank_name: str(get(raw, "bank_name")) || null,
      payment_terms: parsePaymentTerms(get(raw, "payment_terms")),
      notes: str(get(raw, "notes")) || null,
      is_verified: parseBool(get(raw, "is_verified"), false),
      is_active: parseBool(get(raw, "is_active"), true),
      errors,
    })
  }

  return { rows, headerError: null }
}

export const TEMPLATE_SUPPLIER_HEADERS = [
  "Tên NCC*",
  "Mã NCC",
  "Danh mục",
  "Người liên hệ",
  "SĐT",
  "Email",
  "Địa chỉ",
  "Mã số thuế",
  "Số tài khoản",
  "Tên ngân hàng",
  "Điều khoản thanh toán",
  "Ghi chú",
  "Đã xác minh",
  "Trạng thái",
] as const

export const TEMPLATE_SUPPLIER_SAMPLE_ROWS: (string | number)[][] = [
  [
    "Công ty TNHH Coca-Cola Việt Nam",
    "",
    "Nước giải khát",
    "Nguyễn Văn A",
    "0901234567",
    "contact@coca.vn",
    "Quận 1, TP.HCM",
    "0301234567",
    "1234567890",
    "Vietcombank",
    "NET30",
    "",
    "1",
    "active",
  ],
  [
    "Acecook Việt Nam",
    "",
    "Thực phẩm khô",
    "Trần Thị B",
    "0901234568",
    "",
    "Bình Dương",
    "",
    "",
    "",
    "NET15",
    "",
    "0",
    "active",
  ],
]
