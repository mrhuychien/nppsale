import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dongTraGhiSo } from "../src/lib/pos/save"
import { inTaiCho, trangInHoaDon, voiAuto, KHUNG_IN_ID } from "../src/lib/pos/print-window"
import { IN_XONG, leavePrintView } from "../src/hooks/use-leave-after-print"
import type { PosLine } from "../src/lib/pos/types"

const dong = (p: Partial<PosLine>): PosLine => ({
  key: "k", productId: "p1", sku: "", name: "Sữa", unit: "hộp", units: [],
  qty: 1, price: 0, discount: { value: 0, unit: "vnd" }, ...p,
})

/**
 * ⚠ CHỦ NHÀ BÁO 23/09/2026: "Lưu đơn hàng trả lỗi … null value in column
 *   line_total of relation return_lines violates not-null constraint (23502)".
 *   Màn Trả hàng POS chèn dòng mà không có `line_total`.
 */
describe("POS trả hàng: dòng ghi sổ có line_total", () => {
  it("line_total = làm tròn SL × giá × (1 + VAT) — cùng công thức toReturnLine / mig 152", () => {
    expect(dongTraGhiSo("r1", dong({ qty: 3, price: 19_000 }))).toMatchObject({
      return_id: "r1", product_id: "p1", unit_name: "hộp", quantity: 3, unit_price: 19_000,
      vat_rate: 0, line_total: 57_000, is_exchange: false,
    })
    expect(dongTraGhiSo("r1", dong({ qty: 1.5, price: 333, vatRate: 0.1 })).line_total).toBe(Math.round(1.5 * 333 * 1.1))
  })

  it("dòng đổi vẫn mang line_total (cột NOT NULL) và cờ is_exchange", () => {
    const r = dongTraGhiSo("r1", dong({ qty: 2, price: 10_000, isExchange: true }))
    expect(r.line_total).toBe(20_000)
    expect(r.is_exchange).toBe(true)
  })

  it("savePosReturn chèn dòng qua dongTraGhiSo", () => {
    const S = readFileSync("src/lib/pos/save.ts", "utf8")
    const i = S.indexOf("export async function savePosReturn")
    expect(S.slice(i)).toMatch(/\.map\(\(l\) => dongTraGhiSo\(id!?, l\)\)/)
  })
})

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Màn Hóa đơn, Đơn hàng, Trả hàng, in đơn tại chỗ ko
 *   cần mở tab. Chỉ bật cửa sổ in".
 */
describe("in tại chỗ bằng khung ẩn", () => {
  /* Không có jsdom — dựng đủ phần DOM mà `inTaiCho` chạm tới. */
  const dom = () => {
    const nghe: Array<(e: MessageEvent) => void> = []
    const body: unknown[] = []
    const cu = { remove: vi.fn() }
    const f = {
      id: "", title: "", src: "", style: { cssText: "" }, contentWindow: {} as Window,
      setAttribute: vi.fn(), remove: vi.fn(),
    }
    const doc = {
      getElementById: vi.fn((id: string) => (id === KHUNG_IN_ID ? cu : null)),
      createElement: vi.fn(() => f),
      body: { appendChild: (x: unknown) => body.push(x) },
      defaultView: {
        addEventListener: (_: string, h: (e: MessageEvent) => void) => nghe.push(h),
        removeEventListener: vi.fn(),
      },
    }
    return { doc: doc as unknown as Document, f, cu, body, nghe }
  }

  it("nạp trang in ?auto=1 vào khung 0×0 trên chính màn này — không mở tab", () => {
    const d = dom()
    inTaiCho(trangInHoaDon("inv1"), d.doc)
    expect(d.f.src).toBe("/sales-invoices/inv1/print?auto=1")
    expect(d.body).toEqual([d.f])
    expect(d.f.style.cssText).toContain("width:0")
    /* ⚠ display:none là Chrome in ra trang trắng. */
    expect(d.f.style.cssText).not.toContain("display:none")
  })

  it("bấm In lần nữa gỡ khung cũ trước", () => {
    const d = dom()
    inTaiCho("/orders/o1/print", d.doc)
    expect(d.cu.remove).toHaveBeenCalled()
  })

  it("thêm ?auto=1 đúng một lần", () => {
    expect(voiAuto("/orders/o1/print")).toBe("/orders/o1/print?auto=1")
    expect(voiAuto("/x/print?auto=1")).toBe("/x/print?auto=1")
    expect(voiAuto("/x/print?a=b")).toBe("/x/print?a=b&auto=1")
  })

  it("in xong khung báo về thì gỡ khung — tin của khung khác thì bỏ qua", async () => {
    const d = dom()
    inTaiCho("/orders/o1/print", d.doc)
    d.nghe[0]({ source: {}, data: { type: IN_XONG } } as unknown as MessageEvent)
    await new Promise((r) => setTimeout(r, 0))
    expect(d.f.remove).not.toHaveBeenCalled()
    d.nghe[0]({ source: d.f.contentWindow, data: { type: IN_XONG } } as unknown as MessageEvent)
    await new Promise((r) => setTimeout(r, 0))
    expect(d.f.remove).toHaveBeenCalled()
  })

  /** ⚠ Khung dùng CHUNG lịch sử với tab mẹ — lùi ở đây là kéo cả màn POS lùi. */
  it("trang in trong khung chỉ báo trang mẹ, không lùi, không đóng", () => {
    const hit: string[] = []
    leavePrintView({
      historyLength: 5, close: () => hit.push("close"), back: () => hit.push("back"),
      embedded: true, notifyParent: () => hit.push("bao"),
    })
    expect(hit).toEqual(["bao"])
  })
})
