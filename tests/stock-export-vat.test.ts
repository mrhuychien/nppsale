import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import {
  buildStockExportAoa,
  stockExportFileName,
  STOCK_EXPORT_HEADERS,
  type StockExportRow,
} from "../src/lib/inventory/stock-export"
import { DEFAULT_VAT_RATE } from "../src/lib/constants"
import { parseProductSheet } from "../src/lib/products/import-parse"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const TABLE = read("src/components/inventory/stock-balance-table.tsx")
const FORM = read("src/components/products/product-form.tsx")
const MIG108 = read("supabase/migrations/108_default_vat_8.sql")

const row = (over: Partial<StockExportRow> = {}): StockExportRow => ({
  sku: "SP001",
  name: "Coca 330ml",
  baseUnit: "lon",
  saleQty: 100,
  saleValue: 500_000,
  dateQty: 20,
  dateValue: 100_000,
  totalQty: 120,
  totalValue: 600_000,
  ...over,
})

describe("Xuất tồn kho ra Excel", () => {
  it("có đủ tiêu đề, dòng dữ liệu và dòng tổng", () => {
    const aoa = buildStockExportAoa([row(), row({ sku: "SP002", name: "Mì" })])
    expect(aoa).toHaveLength(1 + 2 + 1)
    expect(aoa[0]).toEqual([...STOCK_EXPORT_HEADERS])
  })

  /**
   * ⚠ Số phải ghi xuống dưới dạng SỐ. Ghi "600.000đ" thì Excel coi là
   * chữ: không cộng được, không lọc được, không vẽ biểu đồ được — mà cộng
   * lại chính là việc người ta mở Excel để làm.
   */
  it("ghi số thật, không phải chuỗi đã định dạng", () => {
    const [, data] = buildStockExportAoa([row()])
    for (const cell of data.slice(3)) {
      expect(typeof cell, `ô ${cell} phải là số`).toBe("number")
    }
    expect(data).toContain(600_000)
    expect(JSON.stringify(data)).not.toContain("đ")
  })

  /**
   * ⚠ Người nhận file cần con số tổng KHỚP với con số trên màn hình thì
   * mới tin là đã xuất đủ. Không có dòng tổng thì phải tự cộng, và tự hỏi
   * mình cộng đúng chưa.
   */
  it("dòng cuối là tổng cộng đúng", () => {
    const aoa = buildStockExportAoa([
      row({ totalValue: 600_000, totalQty: 120, saleQty: 100 }),
      row({ totalValue: 400_000, totalQty: 80, saleQty: 60 }),
    ])
    const last = aoa[aoa.length - 1]
    expect(String(last[1])).toContain("TỔNG CỘNG")
    expect(String(last[1])).toContain("2 sản phẩm")
    expect(last[3]).toBe(160) // kho bán SL
    expect(last[7]).toBe(200) // tổng SL
    expect(last[8]).toBe(1_000_000) // tổng giá trị
  })

  it("không có dòng nào thì vẫn ra file hợp lệ, tổng bằng 0", () => {
    const aoa = buildStockExportAoa([])
    expect(aoa).toHaveLength(2)
    expect(aoa[1][8]).toBe(0)
    expect(String(aoa[1][1])).toContain("0 sản phẩm")
  })

  /**
   * ⚠ Tên file theo lịch VIỆT NAM. Xuất lúc 8h tối 15/09 mà file mang tên
   * 16/09 thì người ta xếp nhầm thư mục — và tháng sau không tìm ra.
   */
  it("tên file theo ngày Việt Nam, không theo UTC", () => {
    const t = new Date("2026-09-15T20:00:00+07:00") // = 13:00Z ngày 15
    expect(stockExportFileName(t)).toBe("ton-kho-20260915.xlsx")
    const nua_dem = new Date("2026-09-16T02:00:00+07:00") // = 19:00Z ngày 15
    expect(stockExportFileName(nua_dem)).toBe("ton-kho-20260916.xlsx")
  })

  /** Xuất ĐÚNG những dòng đang hiện — người ta lọc rồi mới bấm xuất. */
  it("xuất từ danh sách đã lọc, không phải toàn bộ kho", () => {
    expect(TABLE).toContain("pivot.map((r) => ({")
    expect(TABLE).toContain("buildStockExportAoa(")
  })

  /** Không có dòng nào thì nút phải tắt, không tạo ra file rỗng. */
  it("tắt nút khi không có gì để xuất", () => {
    expect(TABLE).toContain("disabled={loading || exporting || pivot.length === 0}")
  })

  /**
   * ⚠ Bấm xong không thấy gì thì người dùng bấm tiếp mấy lần rồi tưởng
   * máy treo. Hỏng phải nói ra trên màn hình.
   */
  it("hỏng thì báo lên màn hình", () => {
    expect(TABLE).toContain("setExportError(")
    expect(TABLE).toContain("Không xuất được file Excel")
  })

  /** `xlsx` nặng vài trăm KB — nạp động, đừng nhét vào gói chính. */
  it("nạp xlsx động", () => {
    expect(TABLE).toContain('await import("xlsx")')
  })
})

describe("Thuế VAT mặc định của sản phẩm", () => {
  it("hằng số là 0 — hàng xuất không kèm VAT", () => {
    expect(DEFAULT_VAT_RATE).toBe(0)
  })

  /**
   * ⚠ MỘT chỗ duy nhất. Con số này từng nằm rải ở ba nơi — mặc định cột
   * trong migration, giá trị khởi tạo của form, giá trị lùi của bộ đọc
   * Excel. Sửa một chỗ quên hai chỗ là sản phẩm tạo bằng form và sản phẩm
   * nhập bằng file mang hai thuế suất khác nhau, không gì báo ra.
   */
  it("form và bộ đọc Excel đều dùng chung hằng số", () => {
    expect(FORM).toContain("DEFAULT_VAT_RATE")
    expect(FORM).not.toContain('vat_rate: product?.vat_rate?.toString() || "0.1"')
    expect(read("src/lib/products/import-parse.ts")).toContain("return DEFAULT_VAT_RATE")
  })

  it("cột trống trong file Excel thì nhận đúng mặc định của dự án", () => {
    const r = parseProductSheet([
      ["Tên sản phẩm", "Đơn vị tính", "Nhà cung cấp"],
      ["Coca", "lon", "Coca VN"],
    ])
    expect(r.rows[0].vat_rate).toBe(DEFAULT_VAT_RATE)
  })

  /**
   * ⚠ Mặc định CHỈ áp cho dòng không khai. Dòng có ghi thuế thì giữ
   * nguyên — kể cả 0% và kể cả 10%, vì vẫn còn mặt hàng chịu 10%.
   */
  it("file có khai thuế thì giữ nguyên, không đè", () => {
    const sheet = (v: unknown) => [
      ["Tên sản phẩm", "Đơn vị tính", "Nhà cung cấp", "Thuế VAT"],
      ["Coca", "lon", "Coca VN", v],
    ]
    expect(parseProductSheet(sheet("10%")).rows[0].vat_rate).toBe(0.1)
    expect(parseProductSheet(sheet(0)).rows[0].vat_rate).toBe(0)
    expect(parseProductSheet(sheet("5")).rows[0].vat_rate).toBe(0.05)
  })

  /**
   * Mig 108 (10% → 8%) là lịch sử, giữ nguyên. Mig 110 là mức đang dùng —
   * và nó phải KHỚP với hằng số trong mã, nếu không thì sản phẩm tạo bằng
   * form và sản phẩm chèn thẳng bằng SQL mang hai thuế suất khác nhau.
   */
  it("mặc định của cột khớp với hằng số trong mã", () => {
    expect(MIG108).toContain("ALTER COLUMN vat_rate SET DEFAULT 0.08;")
    // ⚠ Phải có DẤU CHẤM PHẨY. Không có nó thì `toContain("SET DEFAULT 0")`
    // khớp luôn cả "SET DEFAULT 0.08" — chuỗi con — và phép kiểm này xanh
    // kể cả khi migration đặt sai mức. Đã đo: đổi 110 thành 0.08 mà test
    // vẫn xanh, cho tới khi thêm dấu này.
    expect(read("supabase/migrations/110_default_vat_0.sql"))
      .toContain(`ALTER COLUMN vat_rate SET DEFAULT ${DEFAULT_VAT_RATE};`)
  })

  /**
   * ⚠ KHÔNG chạy UPDATE hàng loạt trong migration. Sản phẩm đang là 10%
   * có thể là do mặc định cũ (nên đổi), cũng có thể do người ta cố ý khai
   * (không được đổi) — hai trường hợp đó nhìn giống hệt nhau trong cơ sở
   * dữ liệu. Migration chỉ đổi mặc định; câu UPDATE để sẵn dưới dạng chú
   * thích cho người vận hành tự quyết sau khi đã đếm.
   */
  it("migration không tự đè thuế của sản phẩm đang có", () => {
    const code = MIG108.replace(/^--.*$/gm, "")
    expect(code).not.toMatch(/UPDATE\s+products/i)
  })
})
