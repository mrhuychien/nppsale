/**
 * GHI TỆP .XLSX CÓ ĐỊNH DẠNG (đậm / nghiêng / kẻ ô / gộp ô / khổ giấy) — cho tệp Excel "như mẫu in" ở trang chi
 * tiết phiếu (chủ nhà 05/10/2026: "xuất excel như kiểu mẫu in hoá đơn ấy").
 *
 * ⚠ VÌ SAO TỰ GHI: thư viện `xlsx` bản cộng đồng (0.18) KHÔNG ghi kiểu ô — tệp ra không đậm, không kẻ ô, không
 *   giống tờ in. Không thêm thư viện mới (CLAUDE.md), nên tự dựng các tệp XML của gói .xlsx và nén bằng `CFB`
 *   có sẵn trong chính `xlsx`.
 * ⚠ SỐ LÀ SỐ (ô kiểu số, định dạng `#,##0`) — cộng / sửa được trong Excel, hiển thị dấu nghìn theo máy người mở.
 */
import type * as XLSXNS from "xlsx"

export interface KieuO {
  dam?: boolean
  nghieng?: boolean
  /** Cỡ chữ (pt) — mặc định 11. */
  co?: number
  canh?: "trai" | "giua" | "phai"
  /** Kẻ ô (viền mảnh 4 cạnh). */
  vien?: boolean
  /** Ô số: định dạng `#,##0`. */
  so?: boolean
  /** Xuống dòng trong ô. */
  xuong?: boolean
}

/** Một đoạn chữ trong ô — để "Khách hàng: **Tạp hoá A**" đậm một phần. */
export interface DoanChu {
  t: string
  dam?: boolean
  nghieng?: boolean
}

export interface OXlsx {
  v: string | number | null
  /** Chữ nhiều kiểu trong một ô (thay `v`). */
  doan?: DoanChu[]
  k?: KieuO
}

export interface SheetDinhDang {
  ten: string
  /** Bề rộng cột (số ký tự). */
  rong: number[]
  dong: Array<{ o: Array<OXlsx | null>; cao?: number }>
  /** Vùng gộp [dòng đầu, cột đầu, dòng cuối, cột cuối] — chỉ số từ 0. */
  gop: Array<[number, number, number, number]>
  kho?: "A5" | "A4"
}

const FONT = "Times New Roman"

export const tenO = (r: number, c: number): string => {
  let s = ""
  let n = c + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return `${s}${r + 1}`
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // Ký tự điều khiển làm Excel báo tệp hỏng.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")

const khoaKieu = (k: KieuO = {}) =>
  [k.dam ? 1 : 0, k.nghieng ? 1 : 0, k.co ?? 11, k.canh ?? "", k.vien ? 1 : 0, k.so ? 1 : 0, k.xuong ? 1 : 0].join("|")

/** Bảng kiểu dùng chung cho cả sổ: font / viền / xf — mỗi tổ hợp một số thứ tự. */
class BangKieu {
  fonts = new Map<string, number>()
  xfs = new Map<string, number>()
  dsFont: string[] = []
  dsXf: string[] = []
  constructor() {
    this.font(false, false, 11)
    this.xf({}) // xf 0 = mặc định
  }
  font(dam: boolean, nghieng: boolean, co: number) {
    const k = `${dam}|${nghieng}|${co}`
    let i = this.fonts.get(k)
    if (i === undefined) {
      i = this.dsFont.length
      this.fonts.set(k, i)
      this.dsFont.push(`<font>${dam ? "<b/>" : ""}${nghieng ? "<i/>" : ""}<sz val="${co}"/><name val="${FONT}"/><family val="1"/></font>`)
    }
    return i
  }
  xf(k: KieuO) {
    const key = khoaKieu(k)
    let i = this.xfs.get(key)
    if (i === undefined) {
      i = this.dsXf.length
      this.xfs.set(key, i)
      const f = this.font(!!k.dam, !!k.nghieng, k.co ?? 11)
      const canh = k.canh === "giua" ? "center" : k.canh === "phai" ? "right" : k.canh === "trai" ? "left" : ""
      const al = `<alignment vertical="top"${canh ? ` horizontal="${canh}"` : ""}${k.xuong ? ' wrapText="1"' : ""}/>`
      this.dsXf.push(
        `<xf numFmtId="${k.so ? 3 : 0}" fontId="${f}" fillId="0" borderId="${k.vien ? 1 : 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">${al}</xf>`
      )
    }
    return i
  }
  styles() {
    const vien = (s: string) => `<${s} style="thin"><color auto="1"/></${s}>`
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="${this.dsFont.length}">${this.dsFont.join("")}</fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
      `<border>${vien("left")}${vien("right")}${vien("top")}${vien("bottom")}<diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.dsXf.length}">${this.dsXf.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`
    )
  }
}

/** Ô bị gộp lấy kiểu của ô đầu vùng — không thì viền của ô gộp bị hở ở mép phải / dưới. */
function lapVungGop(sh: SheetDinhDang): Array<Array<OXlsx | null>> {
  const luoi = sh.dong.map((d) => [...d.o])
  for (const [r1, c1, r2, c2] of sh.gop) {
    const dau = luoi[r1]?.[c1]
    if (!dau) continue
    for (let r = r1; r <= r2; r++) {
      if (!luoi[r]) luoi[r] = []
      for (let c = c1; c <= c2; c++) {
        if (r === r1 && c === c1) continue
        luoi[r][c] = { v: null, k: dau.k }
      }
    }
  }
  return luoi
}

function oXml(ref: string, o: OXlsx, s: number): string {
  if (o.doan && o.doan.length > 0) {
    const runs = o.doan
      .map((d) => `<r><rPr>${d.dam ? "<b/>" : ""}${d.nghieng ? "<i/>" : ""}<sz val="${o.k?.co ?? 11}"/><rFont val="${FONT}"/><family val="1"/></rPr><t xml:space="preserve">${xml(d.t)}</t></r>`)
      .join("")
    return `<c r="${ref}" s="${s}" t="inlineStr"><is>${runs}</is></c>`
  }
  if (typeof o.v === "number" && Number.isFinite(o.v)) return `<c r="${ref}" s="${s}"><v>${o.v}</v></c>`
  if (o.v === null || o.v === "") return `<c r="${ref}" s="${s}"/>`
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(String(o.v))}</t></is></c>`
}

function sheetXml(sh: SheetDinhDang, bang: BangKieu): string {
  const luoi = lapVungGop(sh)
  const cols = sh.rong.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")
  const rows = luoi
    .map((o, r) => {
      const cao = sh.dong[r]?.cao
      const cells = o.map((x, c) => (x ? oXml(tenO(r, c), x, bang.xf(x.k ?? {})) : "")).join("")
      return `<row r="${r + 1}"${cao ? ` ht="${cao}" customHeight="1"` : ""}>${cells}</row>`
    })
    .join("")
  const gop = sh.gop.length
    ? `<mergeCells count="${sh.gop.length}">${sh.gop.map(([a, b, c, d]) => `<mergeCell ref="${tenO(a, b)}:${tenO(c, d)}"/>`).join("")}</mergeCells>`
    : ""
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols><sheetData>${rows}</sheetData>${gop}` +
    `<printOptions horizontalCentered="1"/>` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    /* Khổ A5 dọc như tờ in mặc định (paperSize 11 = A5, 9 = A4); vừa một trang bề ngang. */
    `<pageSetup paperSize="${sh.kho === "A4" ? 9 : 11}" orientation="portrait" fitToWidth="1" fitToHeight="0"/>` +
    `</worksheet>`
  )
}

/** Tên sheet hợp lệ: ≤ 31 ký tự, không `[]:*?/\`. */
export const tenSheet = (s: string) => (s.replace(/[[\]:*?/\\]/g, "-").slice(0, 31) || "Sheet1")

/** Dựng các tệp XML của gói .xlsx. Tách riêng để kiểm thử. */
export function cacTepXlsx(sheets: SheetDinhDang[]): Record<string, string> {
  const bang = new BangKieu()
  const tep: Record<string, string> = {}
  sheets.forEach((sh, i) => {
    tep[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sh, bang)
  })
  tep["xl/styles.xml"] = bang.styles()
  tep["[Content_Types].xml"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`
  tep["_rels/.rels"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
  tep["xl/workbook.xml"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets.map((s, i) => `<sheet name="${xml(tenSheet(s.ten))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
    `</workbook>`
  tep["xl/_rels/workbook.xml.rels"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`
  return tep
}

/** Nén thành tệp .xlsx (zip) bằng `CFB` của `xlsx`. */
export function nenXlsx(XLSX: typeof XLSXNS, sheets: SheetDinhDang[]): Uint8Array {
  const CFB = (XLSX as unknown as { CFB: CfbApi }).CFB
  const z = CFB.utils.cfb_new()
  /* `cfb_new` tự thêm một mục giữ chỗ — bỏ đi để gói zip sạch. */
  for (const p of z.FullPaths.slice(1)) CFB.utils.cfb_del(z, p.replace(/^Root Entry/, ""))
  const enc = new TextEncoder()
  for (const [ten, noiDung] of Object.entries(cacTepXlsx(sheets))) CFB.utils.cfb_add(z, `/${ten}`, enc.encode(noiDung))
  /* Ngày giờ của từng tệp trong gói — để trống thì zip ghi ngày 00/00/1980. */
  const now = new Date()
  for (const f of z.FileIndex) f.mt = now
  return CFB.write(z, { fileType: "zip", type: "array", compression: true }) as Uint8Array
}

interface CfbApi {
  utils: {
    cfb_new: () => { FullPaths: string[]; FileIndex: Array<{ mt?: Date }> }
    cfb_add: (z: unknown, p: string, d: Uint8Array) => void
    cfb_del: (z: unknown, p: string) => boolean
  }
  write: (z: unknown, o: Record<string, unknown>) => unknown
}

/** Tải tệp về máy (trình duyệt). */
export async function taiXlsxDinhDang(tenTep: string, sheets: SheetDinhDang[]) {
  const XLSX = await import("xlsx")
  const bytes = nenXlsx(XLSX, sheets)
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = tenTep
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
