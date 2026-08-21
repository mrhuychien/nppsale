/**
 * Parse + validate bảng khách hàng import từ Excel/CSV (client-side).
 * Mỗi dòng = 1 KH. Cột bắt buộc: Tên cửa hàng. Phone không bắt buộc
 * nhưng nếu có thì cần unique (theo phone-không-khoảng-trắng).
 */

export type CustomerField =
  | "store_name"
  | "owner_name"
  | "phone"
  | "address"
  | "ward"
  | "channel"
  | "credit_limit"
  | "payment_terms"
  | "status"
  | "tax_code"
  | "billing_name"
  | "billing_address"
  | "billing_email"
  | "payment_method_label"

export interface ParsedCustomerRow {
  rowNo: number
  store_name: string
  owner_name: string
  phone: string
  address: string
  ward: string | null
  channel: string | null
  credit_limit: number
  payment_terms: string
  status: string
  tax_code: string | null
  billing_name: string | null
  billing_address: string | null
  billing_email: string | null
  payment_method_label: string
  errors: string[]
}

export interface ParseCustomerResult {
  rows: ParsedCustomerRow[]
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

const HEADER_MAP: Record<string, CustomerField> = {
  // store_name
  "ten cua hang": "store_name", "ten kh": "store_name", "ten khach hang": "store_name",
  "cua hang": "store_name", "ten quan": "store_name", "store": "store_name",
  "ten": "store_name",
  // owner_name
  "ten chu cua hang": "owner_name", "chu cua hang": "owner_name", "chu quan": "owner_name",
  "nguoi lien he": "owner_name", "ho ten": "owner_name", "owner": "owner_name",
  // phone
  "so dien thoai": "phone", "dien thoai": "phone", "sdt": "phone", "phone": "phone", "tel": "phone",
  // address — số nhà + tên đường
  "dia chi": "address", "so nha": "address", "duong": "address",
  "so nha + duong": "address", "so nha + ten duong": "address",
  // ward
  "phuong": "ward", "phuong xa": "ward", "ward": "ward", "xa": "ward",
  // channel
  "kenh": "channel", "kenh ban": "channel", "channel": "channel", "loai kh": "channel",
  // credit_limit
  "han muc cong no": "credit_limit", "han muc": "credit_limit",
  "credit limit": "credit_limit", "no toi da": "credit_limit",
  // payment_terms
  "dieu khoan thanh toan": "payment_terms", "cong no": "payment_terms",
  "thanh toan": "payment_terms", "payment terms": "payment_terms",
  // status
  "trang thai": "status", "hoat dong": "status", "status": "status",
  // tax + billing
  "ma so thue": "tax_code", "mst": "tax_code", "tax": "tax_code",
  "ten don vi xuat hd": "billing_name", "ten cong ty": "billing_name", "billing name": "billing_name",
  "ten don vi": "billing_name",
  "dia chi xuat hd": "billing_address", "billing address": "billing_address",
  "email xuat hd": "billing_email", "billing email": "billing_email", "email hd": "billing_email",
  "hinh thuc thanh toan": "payment_method_label", "phuong thuc thanh toan": "payment_method_label",
}

const VALID_TERMS = new Set(["COD", "NET7", "NET15", "NET30", "NET45", "NET60"])
const VALID_CHANNELS = new Set(["GT", "MT", "HORECA"])

function parsePaymentTerms(raw: unknown): string {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "")
  if (!s) return "COD"
  if (VALID_TERMS.has(s)) return s
  const m = s.match(/(\d+)/)
  if (m) {
    const n = parseInt(m[1], 10)
    const candidate = `NET${n}`
    if (VALID_TERMS.has(candidate)) return candidate
  }
  if (s.includes("COD") || s.includes("TIENMAT")) return "COD"
  return "COD"
}

function parseChannel(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toUpperCase()
  if (!s) return null
  if (VALID_CHANNELS.has(s)) return s
  // Các nhánh dưới đây so với chuỗi KHÔNG DẤU nên phải bỏ dấu trước.
  // Trước đây chỉ toUpperCase(): "Truyền thống" thành "TRUYỀN THỐNG",
  // không bao giờ khớp "TRUYEN" — toàn bộ phần nhận diện tiếng Việt là
  // code chết, người dùng gõ đúng tiếng Việt lại không được gán kênh.
  const plain = normHeader(s)
  if (plain.includes("gt") || plain.includes("truyen")) return "GT"
  if (plain.includes("mt") || plain.includes("hien dai") || plain.includes("sieu thi")) return "MT"
  if (plain.includes("horeca") || plain.includes("nha hang") || plain.includes("khach san")) {
    return "HORECA"
  }
  return null
}

function parseStatus(raw: unknown): string {
  const s = normHeader(raw)
  if (!s) return "active"
  if (["inactive", "ngung", "khoa", "tat", "0", "off", "false", "no", "khong"].includes(s)) return "inactive"
  return "active"
}

function parseMoney(raw: unknown): number {
  if (typeof raw === "number") return Math.max(0, Math.round(raw))
  const digits = String(raw ?? "").replace(/[^\d]/g, "")
  return digits ? parseInt(digits, 10) : 0
}

function str(raw: unknown): string {
  return String(raw ?? "").trim()
}

function phoneKey(raw: string): string {
  return raw.replace(/\s+/g, "")
}

export function parseCustomerSheet(aoa: unknown[][]): ParseCustomerResult {
  if (!aoa || aoa.length < 2) {
    return {
      rows: [],
      headerError: "File không có dữ liệu (cần dòng tiêu đề + ít nhất 1 dòng KH).",
    }
  }

  const headerRow = aoa[0]
  const colIndex: Partial<Record<CustomerField, number>> = {}
  headerRow.forEach((cell, idx) => {
    const field = HEADER_MAP[normHeader(cell)]
    if (field && colIndex[field] === undefined) colIndex[field] = idx
  })

  if (colIndex.store_name === undefined) {
    return {
      rows: [],
      headerError: 'Thiếu cột "Tên cửa hàng". Tải file mẫu để xem đúng định dạng.',
    }
  }

  const get = (row: unknown[], field: CustomerField): unknown => {
    const idx = colIndex[field]
    return idx === undefined ? "" : row[idx]
  }

  const rows: ParsedCustomerRow[] = []
  const seenPhones = new Set<string>()
  for (let i = 1; i < aoa.length; i++) {
    const raw = aoa[i] || []
    if (raw.every((c) => str(c) === "")) continue

    const store_name = str(get(raw, "store_name"))
    const phone = str(get(raw, "phone"))
    const errors: string[] = []
    if (!store_name) errors.push("Thiếu tên cửa hàng")

    if (phone) {
      const pk = phoneKey(phone)
      if (seenPhones.has(pk)) errors.push("Trùng SĐT trong file")
      else seenPhones.add(pk)
    }

    rows.push({
      rowNo: i + 1,
      store_name,
      owner_name: str(get(raw, "owner_name")),
      phone,
      address: str(get(raw, "address")),
      ward: str(get(raw, "ward")) || null,
      channel: parseChannel(get(raw, "channel")),
      credit_limit: parseMoney(get(raw, "credit_limit")),
      payment_terms: parsePaymentTerms(get(raw, "payment_terms")),
      status: parseStatus(get(raw, "status")),
      tax_code: str(get(raw, "tax_code")) || null,
      billing_name: str(get(raw, "billing_name")) || null,
      billing_address: str(get(raw, "billing_address")) || null,
      billing_email: str(get(raw, "billing_email")) || null,
      payment_method_label: str(get(raw, "payment_method_label")) || "Chuyển khoản",
      errors,
    })
  }

  return { rows, headerError: null }
}

export const TEMPLATE_CUSTOMER_HEADERS = [
  "Tên cửa hàng*",
  "Tên chủ cửa hàng",
  "SĐT",
  "Số nhà + Đường",
  "Phường",
  "Kênh",
  "Hạn mức công nợ",
  "Điều khoản thanh toán",
  "Trạng thái",
  "Mã số thuế",
  "Tên đơn vị xuất HĐ",
  "Địa chỉ xuất HĐ",
  "Email xuất HĐ",
  "Hình thức thanh toán",
] as const

export const TEMPLATE_CUSTOMER_SAMPLE_ROWS: (string | number)[][] = [
  [
    "Tạp hoá Anh Minh",
    "Nguyễn Văn Minh",
    "0901234567",
    "12 Trần Phú",
    "Hồng Bàng",
    "GT",
    5000000,
    "COD",
    "active",
    "",
    "",
    "",
    "",
    "Tiền mặt",
  ],
  [
    "Siêu thị Lan Anh",
    "Trần Thị Lan",
    "0907654321",
    "55 Lê Lợi",
    "Lê Chân",
    "MT",
    20000000,
    "NET30",
    "active",
    "0301122334",
    "Công ty TNHH Lan Anh",
    "55 Lê Lợi, Hải Phòng",
    "ketoan@lananh.vn",
    "Chuyển khoản",
  ],
]
