/**
 * Parse + validate bảng sản phẩm import từ Excel/CSV (client-side).
 * Nhận mảng 2 chiều (aoa) từ xlsx sheet_to_json{header:1}, map header
 * tiếng Việt → field DB, validate từng dòng. Không I/O — dialog gọi rồi
 * tự bulk insert.
 */

export type ProductField =
  | "name"
  | "sku"
  | "base_unit"
  | "category"
  | "brand"
  | "barcode"
  | "cost_price"
  | "sell_price"
  | "vat_rate"
  | "min_stock"
  | "shelf_life_days"
  | "status"
  | "secondary_unit"
  | "conversion"

export interface ParsedProductRow {
  /** Dòng trong sheet (1-based, không tính header) — để báo lỗi. */
  rowNo: number
  sku: string
  name: string
  category: string | null
  brand: string | null
  barcode: string | null
  base_unit: string
  vat_rate: number
  cost_price: number
  sell_price: number
  min_stock: number
  shelf_life_days: number | null
  status: string
  secondary_unit: string | null
  conversion: number | null
  errors: string[]
}

export interface ParseResult {
  rows: ParsedProductRow[]
  /** Lỗi cấu trúc (thiếu cột bắt buộc) — chặn toàn bộ. */
  headerError: string | null
}

/** Bỏ dấu tiếng Việt + ký tự trang trí để so khớp header linh hoạt. */
function normHeader(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d") // đ/Đ
    .toLowerCase()
    .replace(/\([^)]*\)/g, "") // bỏ phần trong ngoặc, vd "(%)"
    .replace(/[*:]/g, "")
    .trim()
    .replace(/\s+/g, " ")
}

/** Alias header (đã chuẩn hoá) → field DB. */
const HEADER_MAP: Record<string, ProductField> = {
  // name
  "ten san pham": "name", "ten hang": "name", "ten hang hoa": "name", "ten": "name", "ten sp": "name",
  // sku
  "sku": "sku", "ma sku": "sku", "ma hang": "sku", "ma san pham": "sku", "ma sp": "sku",
  // base_unit
  "don vi tinh": "base_unit", "dvt": "base_unit", "don vi": "base_unit", "don vi co so": "base_unit",
  // category
  "danh muc": "category", "nhom hang": "category", "loai": "category", "nhom": "category", "loai hang": "category",
  // brand
  "nhan hang": "brand", "thuong hieu": "brand", "hang": "brand", "brand": "brand",
  // barcode
  "ma vach": "barcode", "barcode": "barcode", "ma vach san pham": "barcode",
  // cost_price
  "gia von": "cost_price", "gia nhap": "cost_price", "gia goc": "cost_price",
  // sell_price
  "gia ban": "sell_price", "don gia": "sell_price", "gia ban le": "sell_price", "gia": "sell_price",
  // vat_rate
  "thue vat": "vat_rate", "vat": "vat_rate", "thue gtgt": "vat_rate", "thue": "vat_rate", "thue suat": "vat_rate",
  // min_stock
  "ton toi thieu": "min_stock", "ton min": "min_stock", "dinh muc ton toi thieu": "min_stock", "ton kho toi thieu": "min_stock",
  // shelf_life_days
  "han sd": "shelf_life_days", "han su dung": "shelf_life_days", "hsd": "shelf_life_days", "han su dung ngay": "shelf_life_days",
  // status
  "trang thai": "status", "tinh trang": "status",
  // secondary_unit
  "don vi quy doi": "secondary_unit", "quy doi": "secondary_unit", "dvt quy doi": "secondary_unit",
  // conversion
  "he so quy doi": "conversion", "ty le quy doi": "conversion", "quy doi so luong": "conversion", "he so": "conversion",
}

/** VND nguyên: bỏ mọi ký tự không phải số. "15.000" → 15000. */
function parseMoney(raw: unknown): number {
  if (typeof raw === "number") return Math.max(0, Math.round(raw))
  const digits = String(raw ?? "").replace(/[^\d]/g, "")
  return digits ? parseInt(digits, 10) : 0
}

/** VAT: chấp nhận 0.1 / "10%" / "10" → 0.1. Mặc định 0.1 nếu trống. */
function parseVat(raw: unknown): number {
  const s = String(raw ?? "").replace("%", "").replace(",", ".").trim()
  if (!s) return 0.1
  let n = parseFloat(s)
  if (isNaN(n)) return 0.1
  if (n > 1) n = n / 100
  return Math.max(0, n)
}

function parseStatus(raw: unknown): string {
  const s = normHeader(raw)
  if (!s) return "active"
  if (["inactive", "ngung ban", "0", "off", "tat", "khoa", "an"].includes(s)) return "inactive"
  return "active"
}

function parseIntOrNull(raw: unknown): number | null {
  const digits = String(raw ?? "").replace(/[^\d]/g, "")
  return digits ? parseInt(digits, 10) : null
}

function str(raw: unknown): string {
  return String(raw ?? "").trim()
}

export function parseProductSheet(aoa: unknown[][]): ParseResult {
  if (!aoa || aoa.length < 2) {
    return { rows: [], headerError: "File không có dữ liệu (cần dòng tiêu đề + ít nhất 1 dòng sản phẩm)." }
  }

  // Tìm dòng header: dòng đầu tiên map được ≥ 2 cột.
  const headerRow = aoa[0]
  const colIndex: Partial<Record<ProductField, number>> = {}
  headerRow.forEach((cell, idx) => {
    const field = HEADER_MAP[normHeader(cell)]
    if (field && colIndex[field] === undefined) colIndex[field] = idx
  })

  if (colIndex.name === undefined) {
    return { rows: [], headerError: 'Thiếu cột "Tên sản phẩm". Tải file mẫu để xem đúng định dạng.' }
  }
  if (colIndex.base_unit === undefined) {
    return { rows: [], headerError: 'Thiếu cột "Đơn vị tính". Tải file mẫu để xem đúng định dạng.' }
  }

  const get = (row: unknown[], field: ProductField): unknown => {
    const idx = colIndex[field]
    return idx === undefined ? "" : row[idx]
  }

  const rows: ParsedProductRow[] = []
  for (let i = 1; i < aoa.length; i++) {
    const raw = aoa[i] || []
    // Bỏ qua dòng trống hoàn toàn.
    if (raw.every((c) => str(c) === "")) continue

    const name = str(get(raw, "name"))
    const base_unit = str(get(raw, "base_unit"))
    const secondary_unit = str(get(raw, "secondary_unit")) || null
    const conversionRaw = str(get(raw, "conversion"))
    const conversion = conversionRaw ? parseMoney(conversionRaw) : null

    const errors: string[] = []
    if (!name) errors.push("Thiếu tên sản phẩm")
    if (!base_unit) errors.push("Thiếu đơn vị tính")
    if (secondary_unit && (!conversion || conversion <= 0)) {
      errors.push("Đơn vị quy đổi cần hệ số > 0")
    }
    if (secondary_unit && conversion && secondary_unit.toLowerCase() === base_unit.toLowerCase()) {
      errors.push("Đơn vị quy đổi trùng đơn vị tính")
    }

    rows.push({
      rowNo: i, // header là dòng 1 trong file gốc → dòng dữ liệu đầu là 2; nhưng hiển thị theo thứ tự sheet
      sku: str(get(raw, "sku")),
      name,
      category: str(get(raw, "category")) || null,
      brand: str(get(raw, "brand")) || null,
      barcode: str(get(raw, "barcode")) || null,
      base_unit,
      vat_rate: parseVat(get(raw, "vat_rate")),
      cost_price: parseMoney(get(raw, "cost_price")),
      sell_price: parseMoney(get(raw, "sell_price")),
      min_stock: parseMoney(get(raw, "min_stock")),
      shelf_life_days: parseIntOrNull(get(raw, "shelf_life_days")),
      status: parseStatus(get(raw, "status")),
      secondary_unit: secondary_unit && conversion && conversion > 0 ? secondary_unit : null,
      conversion: secondary_unit && conversion && conversion > 0 ? conversion : null,
      errors,
    })
  }

  return { rows, headerError: null }
}

/** Cột header dùng cho file mẫu — khớp HEADER_MAP. */
export const TEMPLATE_HEADERS = [
  "Tên sản phẩm*",
  "Đơn vị tính*",
  "SKU",
  "Danh mục",
  "Nhãn hàng",
  "Mã vạch",
  "Giá vốn",
  "Giá bán",
  "Thuế VAT (%)",
  "Tồn tối thiểu",
  "Hạn SD (ngày)",
  "Trạng thái",
  "Đơn vị quy đổi",
  "Hệ số quy đổi",
] as const

/** 2 dòng ví dụ minh hoạ trong file mẫu. */
export const TEMPLATE_SAMPLE_ROWS: (string | number)[][] = [
  ["Nước ngọt Coca 330ml", "lon", "", "Nước giải khát", "Coca-Cola", "8935001712345", 6000, 8000, 8, 24, "", "active", "thùng", 24],
  ["Mì gói Hảo Hảo", "gói", "", "Thực phẩm khô", "Acecook", "", 3000, 4000, 8, 50, "", "active", "thùng", 30],
]
