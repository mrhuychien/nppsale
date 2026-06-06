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
  | "supplier_name"
  | "barcode"
  | "cost_price"
  | "sell_price"
  | "vat_rate"
  | "min_stock"
  | "max_stock"
  | "shelf_life_days"
  | "status"
  | "secondary_unit"
  | "conversion"
  | "parent_sku"
  | "description"
  | "shelf_location"
  | "weight"
  | "warranty_info"
  | "direct_sale"

export interface ParsedProductRow {
  /** Dòng trong sheet (1-based, không tính header) — để báo lỗi. */
  rowNo: number
  sku: string
  name: string
  category: string | null
  /** Tên NCC từ file — sẽ lookup/create vào suppliers khi nhập. */
  supplier_name: string | null
  barcode: string | null
  base_unit: string
  vat_rate: number
  cost_price: number
  sell_price: number
  min_stock: number
  max_stock: number | null
  shelf_life_days: number | null
  status: string
  secondary_unit: string | null
  conversion: number | null
  /** "Mã ĐVT Cơ bản" — nếu có giá trị trỏ tới SKU base nghĩa là dòng này
   * là đơn vị quy đổi (file KiotViet). */
  parent_sku: string | null
  description: string | null
  shelf_location: string | null
  weight: number | null
  warranty_info: string | null
  direct_sale: boolean
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

/** Alias header (đã chuẩn hoá) → field DB. Hỗ trợ file mẫu của tôi + export KiotViet. */
const HEADER_MAP: Record<string, ProductField> = {
  // name
  "ten san pham": "name", "ten hang": "name", "ten hang hoa": "name", "ten": "name", "ten sp": "name",
  // sku
  "sku": "sku", "ma sku": "sku", "ma hang": "sku", "ma san pham": "sku", "ma sp": "sku",
  // base_unit — KiotViet: "ĐVT"; chú ý KHÔNG map "don vi quy doi"
  "don vi tinh": "base_unit", "dvt": "base_unit", "don vi": "base_unit", "don vi co so": "base_unit",
  // category — KiotViet: "Nhóm hàng(3 Cấp)". Không map "loai hang" vì
  // KiotViet xuất cố định "Hàng hóa" — sẽ nuốt mất "Nhóm hàng" thực sự.
  "danh muc": "category", "nhom hang": "category", "nhom hang 3 cap": "category",
  "nhom": "category",
  // supplier — header chính "Nhà cung cấp". Giữ alias "Thương hiệu"/"Nhãn hàng"
  // để file mẫu/KiotViet cũ dùng được — tên cột đó sẽ map thành tên NCC.
  "nha cung cap": "supplier_name", "ncc": "supplier_name",
  "nhan hang": "supplier_name", "thuong hieu": "supplier_name",
  "hang": "supplier_name", "brand": "supplier_name",
  // barcode
  "ma vach": "barcode", "barcode": "barcode", "ma vach san pham": "barcode",
  // cost_price
  "gia von": "cost_price", "gia nhap": "cost_price", "gia goc": "cost_price",
  // sell_price
  "gia ban": "sell_price", "don gia": "sell_price", "gia ban le": "sell_price", "gia": "sell_price",
  // vat_rate
  "thue vat": "vat_rate", "vat": "vat_rate", "thue gtgt": "vat_rate", "thue": "vat_rate", "thue suat": "vat_rate",
  // min_stock — KiotViet: "Tồn nhỏ nhất"
  "ton toi thieu": "min_stock", "ton min": "min_stock", "dinh muc ton toi thieu": "min_stock",
  "ton kho toi thieu": "min_stock", "ton nho nhat": "min_stock",
  // max_stock — KiotViet: "Tồn lớn nhất"
  "ton lon nhat": "max_stock", "ton max": "max_stock", "ton kho toi da": "max_stock",
  // shelf_life_days
  "han sd": "shelf_life_days", "han su dung": "shelf_life_days", "hsd": "shelf_life_days",
  "han su dung ngay": "shelf_life_days",
  // status — KiotViet: "Đang kinh doanh" (1/0)
  "trang thai": "status", "tinh trang": "status", "dang kinh doanh": "status",
  // secondary_unit — chỉ khi file mẫu của tôi (2 cột riêng)
  "don vi quy doi": "secondary_unit", "dvt quy doi": "secondary_unit",
  // conversion — KiotViet: "Quy đổi" cùng dòng (xem parent_sku để biết là base hay secondary)
  "he so quy doi": "conversion", "ty le quy doi": "conversion", "quy doi so luong": "conversion",
  "he so": "conversion", "quy doi": "conversion",
  // parent_sku — KiotViet: "Mã ĐVT Cơ bản"
  "ma dvt co ban": "parent_sku", "ma don vi tinh co ban": "parent_sku", "ma dvt goc": "parent_sku",
  // các trường mở rộng KiotViet
  "mo ta": "description", "ghi chu": "description",
  "vi tri": "shelf_location", "vi tri kho": "shelf_location", "ke": "shelf_location",
  "trong luong": "weight",
  "bao hanh": "warranty_info",
  "duoc ban truc tiep": "direct_sale", "ban truc tiep": "direct_sale",
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
  if (["inactive", "ngung ban", "0", "off", "tat", "khoa", "an", "false", "no", "khong"].includes(s)) return "inactive"
  return "active"
}

function parseBool(raw: unknown, def: boolean): boolean {
  const s = normHeader(raw)
  if (!s) return def
  if (["1", "true", "co", "yes", "x", "v", "on"].includes(s)) return true
  if (["0", "false", "khong", "no", "off"].includes(s)) return false
  return def
}

function parseNumberOrNull(raw: unknown): number | null {
  if (typeof raw === "number") return isFinite(raw) ? raw : null
  const s = String(raw ?? "").replace(/[^\d.,-]/g, "").replace(/,/g, ".")
  if (!s) return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
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
    const parent_sku = str(get(raw, "parent_sku")) || null
    const supplier_name = str(get(raw, "supplier_name")) || null

    const errors: string[] = []
    if (!name) errors.push("Thiếu tên sản phẩm")
    // Dòng base (không có parent_sku) bắt buộc có NCC. Dòng quy đổi
    // (KiotViet xuất thùng/lốc) không cần — kế thừa NCC của SP cha.
    if (!parent_sku && !supplier_name) errors.push("Thiếu nhà cung cấp")
    // base_unit trống ở dòng base → default "cái" (KiotViet bỏ ĐVT khi
    // SP chỉ bán theo lô — hợp lệ). Trống ở dòng secondary (có parent_sku)
    // thì lỗi vì cần tên unit. Đã default "cái" ở output bên dưới.
    if (secondary_unit && (!conversion || conversion <= 0)) {
      errors.push("Đơn vị quy đổi cần hệ số > 0")
    }
    if (
      secondary_unit && conversion &&
      base_unit && secondary_unit.toLowerCase() === base_unit.toLowerCase()
    ) {
      errors.push("Đơn vị quy đổi trùng đơn vị tính")
    }

    // Tồn lớn nhất: KiotViet xuất "999999999" cho "không giới hạn" — coi như null.
    const max_stock_raw = parseNumberOrNull(get(raw, "max_stock"))
    const max_stock = max_stock_raw != null && max_stock_raw < 999999999 ? max_stock_raw : null

    rows.push({
      rowNo: i + 1,
      sku: str(get(raw, "sku")),
      name,
      category: str(get(raw, "category")) || null,
      supplier_name: str(get(raw, "supplier_name")) || null,
      barcode: str(get(raw, "barcode")) || null,
      base_unit: base_unit || "cái",
      vat_rate: parseVat(get(raw, "vat_rate")),
      cost_price: parseMoney(get(raw, "cost_price")),
      sell_price: parseMoney(get(raw, "sell_price")),
      min_stock: parseMoney(get(raw, "min_stock")),
      max_stock,
      shelf_life_days: parseIntOrNull(get(raw, "shelf_life_days")),
      status: parseStatus(get(raw, "status")),
      // 2 cấu trúc file:
      //  - File mẫu của tôi: secondary_unit + conversion ở 2 cột riêng cùng dòng base.
      //  - File KiotViet: dòng secondary có base_unit = tên unit + Quy đổi = hệ số.
      // Lưu thô cả 2; groupRowsForImport quyết định dùng cái nào.
      secondary_unit: secondary_unit && conversion && conversion > 0 ? secondary_unit : null,
      conversion: conversion && conversion > 0 ? conversion : null,
      parent_sku,
      description: str(get(raw, "description")) || null,
      shelf_location: str(get(raw, "shelf_location")) || null,
      weight: parseNumberOrNull(get(raw, "weight")),
      warranty_info: str(get(raw, "warranty_info")) || null,
      direct_sale: parseBool(get(raw, "direct_sale"), true),
      errors,
    })
  }

  return { rows, headerError: null }
}

/**
 * Group rows trước khi import: KiotViet xuất mỗi đơn vị quy đổi thành 1
 * dòng SKU riêng, liên kết với base qua cột "Mã ĐVT Cơ bản".
 * - Dòng có `parent_sku` trỏ tới SKU base trong file → biến thành product_unit.
 * - Dòng còn lại → product chính (insert vào bảng products).
 *
 * Nếu file không có cột parent_sku (file mẫu của tôi), mọi dòng đều là
 * base — cấu trúc cũ vẫn hoạt động.
 */
export interface GroupedImport {
  baseRows: ParsedProductRow[]
  /** Đơn vị quy đổi theo SKU base. Có thể có nhiều unit/SKU base (vd 1 SP có cả thùng + lốc). */
  unitsByParentSku: Record<string, Array<{ unit_name: string; conversion: number }>>
  /** Dòng bị bỏ qua vì parent_sku không tìm thấy trong file. */
  orphanedRows: ParsedProductRow[]
}

export function groupRowsForImport(rows: ParsedProductRow[]): GroupedImport {
  const validRows = rows.filter((r) => r.errors.length === 0)
  const baseSet = new Set(
    validRows.filter((r) => !r.parent_sku && r.sku).map((r) => r.sku)
  )

  const baseRows: ParsedProductRow[] = []
  const unitsByParentSku: Record<string, Array<{ unit_name: string; conversion: number }>> = {}
  const orphanedRows: ParsedProductRow[] = []

  for (const r of validRows) {
    if (r.parent_sku && baseSet.has(r.parent_sku)) {
      // Là đơn vị quy đổi của 1 SKU base trong file.
      const unitName = r.base_unit || r.secondary_unit || ""
      const conv = r.conversion ?? null
      // Conversion có thể là số float từ KiotViet (1.688, 0.167); làm tròn về int.
      const convInt = conv != null ? Math.max(1, Math.round(conv)) : null
      if (unitName && convInt) {
        const list = (unitsByParentSku[r.parent_sku] ||= [])
        // Tránh trùng tên unit trong cùng 1 product.
        if (!list.find((u) => u.unit_name.toLowerCase() === unitName.toLowerCase())) {
          list.push({ unit_name: unitName, conversion: convInt })
        }
      }
    } else if (r.parent_sku) {
      // parent_sku có giá trị nhưng không match base nào → mồ côi.
      orphanedRows.push(r)
    } else {
      // Base row: insert vào products. Cũng nhận unit từ cột "Đơn vị quy đổi" + "Hệ số".
      baseRows.push(r)
      if (r.sku && r.secondary_unit && r.conversion) {
        const list = (unitsByParentSku[r.sku] ||= [])
        const convInt = Math.max(1, Math.round(r.conversion))
        if (!list.find((u) => u.unit_name.toLowerCase() === r.secondary_unit!.toLowerCase())) {
          list.push({ unit_name: r.secondary_unit, conversion: convInt })
        }
      }
    }
  }

  return { baseRows, unitsByParentSku, orphanedRows }
}

/** Cột header dùng cho file mẫu — khớp HEADER_MAP. */
export const TEMPLATE_HEADERS = [
  "Tên sản phẩm*",
  "Đơn vị tính*",
  "Nhà cung cấp*",
  "SKU",
  "Danh mục",
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
  ["Nước ngọt Coca 330ml", "lon", "Coca-Cola VN", "", "Nước giải khát", "8935001712345", 6000, 8000, 8, 24, "", "active", "thùng", 24],
  ["Mì gói Hảo Hảo", "gói", "Acecook VN", "", "Thực phẩm khô", "", 3000, 4000, 8, 50, "", "active", "thùng", 30],
]
