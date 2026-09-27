import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  boPhieuHuyKhoiTong, cashReceiptBadge, nhanNhieu, tomTatDongPhieuThu,
  TIM_NHANH_PHIEU_THU, TRUONG_PHIEU_THU,
} from "@/lib/finance/cash-receipt-list"
import { dieuKienTruong } from "@/lib/search/field-search"

/**
 * KHUÔN DANH SÁCH CHUNG — chủ nhà 27/09/2026: "Làm danh sách Phiếu thu format giống Danh
 * sách đơn hàng / Hóa đơn đi, giờ đang 1 mình 1 format. Làm chung form hiển thị danh sách
 * cho toàn bộ các danh sách theo form đang dùng cho Đơn hàng, hóa đơn, trả hàng."
 *
 * Chốt bằng cách đọc mã nguồn (đã bỏ chú thích — chú thích nhắc tên một lớp không được giữ
 * test xanh, xem SKILL §Testing UI by reading source).
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích theo DÒNG, không dùng regex nuốt khối (SKILL). */
function code(s: string): string {
  const out: string[] = []
  let trongKhoi = false
  for (const line of s.split("\n")) {
    const t = line.trim()
    if (trongKhoi) {
      if (t.includes("*/")) trongKhoi = false
      continue
    }
    if (t.startsWith("{/*") || t.startsWith("/*")) {
      if (!t.includes("*/")) trongKhoi = true
      continue
    }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(line)
  }
  return out.join("\n")
}
const cat = (s: string, dau: string, cuoi: string) => {
  const a = s.indexOf(dau)
  expect(a, `không thấy mốc "${dau}"`).toBeGreaterThan(-1)
  const b = s.indexOf(cuoi, a + dau.length)
  expect(b, `không thấy mốc "${cuoi}"`).toBeGreaterThan(a)
  return s.slice(a, b)
}

const LAYOUT = code(read("src/components/ui/doc-list-layout.tsx"))
const TABLE = code(read("src/components/ui/doc-table.tsx"))
const CARDS = code(read("src/components/ui/doc-card-list.tsx"))
const PHIEU_THU = code(read("src/app/(dashboard)/finance/cash-receipts/page.tsx"))

describe("DocListLayout — một thẻ như màn hóa đơn", () => {
  it("máy tính: thanh công cụ → lọc nhanh → dòng tổng → lưới → phân trang, đúng thứ tự", () => {
    const may = cat(LAYOUT, 'data-doc-list="desktop"', 'data-doc-list="mobile"')
    expect(may).toContain("hidden flex-col overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest lg:flex")
    const iTool = may.indexOf("{toolbar}")
    const iAdv = may.indexOf("{advanced}")
    const iTong = may.indexOf("<DocListTotals desktopOnly")
    const iLuoi = may.indexOf("table\n")
    const iTrang = may.indexOf("<DataPagination pg={pg}")
    expect(iTool).toBeGreaterThan(0)
    expect(iAdv).toBeGreaterThan(iTool)
    expect(iTong).toBeGreaterThan(iAdv)
    expect(iLuoi).toBeGreaterThan(iTong)
    expect(iTrang).toBeGreaterThan(iLuoi)
  })
  it("màn có màn điện thoại riêng (cards = null) thì khuôn chỉ dựng phần máy tính", () => {
    expect(LAYOUT).toContain("{cards !== null && (")
  })
  it("điện thoại: dải tóm tắt → thẻ → phân trang; rỗng thì EmptyState, không trắng", () => {
    const dt = LAYOUT.slice(LAYOUT.indexOf('data-doc-list="mobile"'))
    expect(dt).toContain("space-y-3 lg:hidden")
    expect(dt.indexOf("mobileSummary")).toBeGreaterThan(0)
    expect(dt.indexOf("{cards}")).toBeGreaterThan(dt.indexOf("mobileSummary"))
    expect(dt.indexOf("<DataPagination pg={pg}")).toBeGreaterThan(dt.indexOf("{cards}"))
    expect(dt).toContain("{empty}")
  })
})

describe("mảnh dùng chung của thanh công cụ", () => {
  it("KetQuaThieu nói ra khi tra mã chạm trần", () => {
    const k = cat(LAYOUT, "export function KetQuaThieu", "\n}\n")
    expect(k).toContain("if (!show) return null")
    expect(k).toContain("Kết quả tìm đang thiếu")
  })
})

describe("DocTable — bấm dòng xem nhanh, bấm mã sang chi tiết", () => {
  it("dòng gọi onOpen; mã chặn nổi bọt", () => {
    expect(TABLE).toContain("onClick={onOpen ? () => onOpen(r) : undefined}")
    const ma = cat(TABLE, "export function DocCodeLink", "\n}\n")
    expect(ma).toContain("onClick={(e) => e.stopPropagation()}")
  })
  it("một phép dựng cột cho cả tiêu đề lẫn dòng", () => {
    expect(TABLE.match(/style=\{\{ gridTemplateColumns: tracks \}\}/g)?.length).toBe(2)
  })
  it("tiền căn phải, số dạng bảng", () => {
    expect(TABLE).toContain('c.align === "right" && "text-right font-extrabold tabular-data"')
  })
})

describe("DocCardList — khuôn thẻ của đơn / hóa đơn", () => {
  it("dùng DocListRow + DocListGroupHeader, cả thẻ là một nút", () => {
    expect(CARDS).toContain('from "@/components/ui/doc-list-row"')
    expect(CARDS).toContain("<DocListRow")
    expect(CARDS).toContain("<DocListGroupHeader")
    expect(CARDS).toContain("onClick={() => open(r)}")
  })
})

describe("/finance/cash-receipts — theo khuôn đơn / hóa đơn", () => {
  it("đủ các mảnh của khuôn", () => {
    for (const m of [
      "<PageHeader",
      "<StatusChips",
      "multi",
      "<MobileFilterBar",
      "<DocFieldInputs fields={TRUONG_PHIEU_THU}",
      "<DocSearchBox",
      "<PeriodSelect",
      "<LocNhanhButton",
      "<AdvancedFilter truong={LOC_PHIEU_THU}",
      "<FilterPicker available={CASH_RECEIPT_FILTERS}",
      "<ColumnPicker available={CASH_RECEIPT_COLUMNS}",
      "<DocListLayout",
      "<DocListSummary",
      "<DocTable rows={rows} columns={columns}",
      "<DocCardList",
      "<CashReceiptDrawer",
    ]) expect(PHIEU_THU, m).toContain(m)
    expect(PHIEU_THU).toContain('useListViewPrefs(\n    "cash-receipts"')
    expect(PHIEU_THU).toContain('useLuuTrangThai("cash-receipts"')
  })
  it("phân trang ở máy chủ 20/trang, tải hai nhịp — không tải hết sổ", () => {
    expect(PHIEU_THU).toContain("const pg = usePagination()")
    expect(PHIEU_THU).toContain("taiHaiNhip<ReceiptRow, KQ>(")
    expect(PHIEU_THU).toMatch(/taoQ\(dem\)\.range\(from, to\)/)
    // Bản cũ: fetchAllForAggregate<CashReceipt> đọc HẾT phiếu rồi vẽ.
    expect(PHIEU_THU).not.toContain("fetchAllForAggregate<CashReceipt>")
  })
  it("bấm dòng mở xem nhanh; mã sang chi tiết", () => {
    expect(PHIEU_THU).toContain("onOpen={(r) => setDrawerId(r.id)}")
    expect(PHIEU_THU).toContain("<DocCodeLink href={`/finance/cash-receipts/${r.id}`}>")
  })
  it("một bộ lọc cho danh sách, đếm và tổng", () => {
    const n = PHIEU_THU.match(/applyFilters\(q as never\)/g)?.length ?? 0
    expect(n).toBe(3)
  })
  it("tổng cộng expected_amount của CẢ bộ lọc, bỏ phiếu huỷ; chạm trần → null", () => {
    const tong = cat(PHIEU_THU, "const fetchTotal = useCallback", "}, [status, applyFilters, searchReady])")
    expect(tong).toContain('select("expected_amount", { count: "exact" })')
    expect(tong).toContain('if (boPhieuHuyKhoiTong(status)) q = q.neq("status", "voided")')
    expect(tong).toContain("if (res.error || res.truncated)")
    expect(tong).toContain("setFilteredTotal(null)")
  })
  it("chỉ đọc — không ghi tiền từ trình duyệt", () => {
    expect(PHIEU_THU).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect(PHIEU_THU).not.toContain(".rpc(")
  })
})

/**
 * DANH SÁCH ĐÃ VỀ KHUÔN CHUNG. Thêm màn nào vào khuôn thì thêm vào đây — chốt giữ cho màn ấy
 * không trôi về một bố cục riêng.
 */
const DA_VE_KHUON: Array<{ duong: string; mobileFilter?: boolean; statusChips?: boolean; thanhPhan?: string }> = [
  { duong: "finance/cash-receipts", mobileFilter: true, statusChips: true },
  { duong: "finance/expenses", mobileFilter: true, statusChips: true },
  { duong: "purchasing/receipts", mobileFilter: true, statusChips: true },
  { duong: "purchase-returns", mobileFilter: true, statusChips: true },
  { duong: "payables", mobileFilter: true, statusChips: true },
  { duong: "purchasing/invoices", mobileFilter: true, statusChips: true },
  { duong: "invoices", mobileFilter: true, statusChips: true },
  { duong: "inventory/entries", mobileFilter: true, statusChips: true },
  { duong: "suppliers", mobileFilter: true, statusChips: true },
  { duong: "products", mobileFilter: true, statusChips: true, thanhPhan: "src/components/products/product-table.tsx" },
  // Công nợ: điện thoại giữ dải tuổi nợ + thẻ có nút "Thu tiền" (NVBH đi thu).
  { duong: "receivables" },
]

describe("các danh sách đã về khuôn chung", () => {
  it.each(DA_VE_KHUON)("/$duong", ({ duong, mobileFilter, statusChips, thanhPhan }) => {
    // Màn tách lưới ra thành phần riêng (sản phẩm) thì đọc cả thành phần ấy.
    const s = code(read(`src/app/(dashboard)/${duong}/page.tsx`)) + (thanhPhan ? "\n" + code(read(thanhPhan)) : "")
    expect(s, "không dùng khuôn DocListLayout").toContain("<DocListLayout")
    expect(s, "lưới không theo DocTable").toMatch(/<DocTable rows=\{\w+\} columns=\{columns\}/)
    // Bấm dòng mở xem nhanh.
    expect(s).toMatch(/<DocTable[^>]*onOpen=\{/)
    expect(s).toMatch(/<DocQuickView|<CashReceiptDrawer/)
    // Lưới cũ tự dựng thì không còn.
    expect(s).not.toMatch(/<table[\s>]|<Table>/)
    // Phân trang 20/trang: máy chủ (`usePagination()`) hoặc tại chỗ (`usePhanTrangTaiCho`).
    expect(s).toMatch(/usePagination\(\)|usePhanTrangTaiCho\(/)
    expect(s).toContain("<ColumnPicker")
    expect(s).toContain("<AdvancedFilter")
    expect(s).toMatch(/totals=\{/)
    if (mobileFilter) expect(s).toContain("<MobileFilterBar")
    if (statusChips) expect(s).toContain("<StatusChips")
  })

  it("phân trang tại chỗ dùng đúng mặc định 20 dòng và về trang 1 khi đổi lọc", () => {
    const h = code(read("src/hooks/use-phan-trang-tai-cho.ts"))
    expect(h).toContain("const pg = usePagination()")
    expect(h).toContain("useEffect(() => { reset() }, [khoaLoc, reset])")
    expect(h).toContain("items.slice(pg.from, pg.to + 1)")
  })
})

describe("tóm tắt dòng phiếu thu", () => {
  it("khách từ công nợ → hóa đơn → đơn; mã hóa đơn không trùng", () => {
    const t = tomTatDongPhieuThu([
      { receipt_id: "p1", receivable: { customer: { store_name: "Tạp hoá A" } }, invoice: { invoice_code: "HD-1" } },
      { receipt_id: "p1", receivable: { customer: { store_name: "Tạp hoá A" } }, invoice: { invoice_code: "HD-1" } },
      { receipt_id: "p1", invoice: { invoice_code: "HD-2", customer: { store_name: "Tạp hoá B" } } },
      { receipt_id: "p2", order: { order_code: "DH-9", customer: { store_name: "Quán C" } } },
    ])
    expect(t.p1.khach).toEqual(["Tạp hoá A", "Tạp hoá B"])
    expect(t.p1.hoaDon).toEqual(["HD-1", "HD-2"])
    expect(t.p2).toEqual({ khach: ["Quán C"], hoaDon: [], don: ["DH-9"] })
  })
  it("nhãn nhiều khách: 'A +1'; chưa có → null", () => {
    expect(nhanNhieu(["A", "B"])).toBe("A +1")
    expect(nhanNhieu(["A"])).toBe("A")
    expect(nhanNhieu([])).toBeNull()
    expect(nhanNhieu(undefined)).toBeNull()
  })
  it("phiếu huỷ ra khỏi tổng, trừ khi chỉ xem Đã hủy", () => {
    expect(boPhieuHuyKhoiTong("all")).toBe(true)
    expect(boPhieuHuyKhoiTong("received")).toBe(true)
    expect(boPhieuHuyKhoiTong("pending,voided")).toBe(true)
    expect(boPhieuHuyKhoiTong("voided")).toBe(false)
  })
  it("huy hiệu thẻ chỉ khi khác thường", () => {
    expect(cashReceiptBadge("received")).toBeNull()
    expect(cashReceiptBadge("pending")?.label).toBe("Chờ xác nhận")
    expect(cashReceiptBadge("voided")?.label).toBe("Đã hủy")
  })
  it("tìm nhanh: mã phiếu + ghi chú + khách + hóa đơn + người thu, ghép HOẶC", () => {
    const [q] = TIM_NHANH_PHIEU_THU
    const dk = dieuKienTruong(q, "abc", [
      { ids: ["r1"], truncated: false },
      { ids: ["r2"], truncated: false },
      { ids: ["u1"], truncated: false },
    ])
    expect(dk).toBe('receipt_code.ilike."%abc%",notes.ilike."%abc%",id.in.(r1),id.in.(r2),collected_by.in.(u1)')
  })
  it("khách tra qua công nợ → dòng phiếu (đầu phiếu không có cột khách)", () => {
    const khach = TRUONG_PHIEU_THU.find((t) => t.key === "khach")!
    expect(khach.chuoi?.[0].buoc.map((b) => b.bang)).toEqual(["customers", "receivables", "cash_receipt_lines"])
    expect(khach.chuoi?.[0].cotDich).toBe("id")
  })
})
