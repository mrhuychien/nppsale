/**
 * THẺ KHO TỔNG (/inventory/stock-card/[productId]) — tồn chạy và lọc kỳ (`src/lib/inventory/the-kho.ts`).
 *
 * Lỗi đội test Kho 04/10/2026 (e2e/doi-kho-loi.spec.ts):
 *   A — lọc Từ / Đến ngày so `posted_at.slice(0, 10)` (ngày UTC): phiếu 01:30 sáng 25/09 giờ VN rơi về 24/09.
 *       CLAUDE.md: "so bằng ngày theo giờ VN, không so với mốc ISO/UTC".
 *   B — phiếu chuyển kho cộng +SL vào tồn chạy; chuyển kho chỉ đổi chỗ, tồn TỔNG không đổi.
 */
import { describe, it, expect } from "vitest"
import { bienDongTong, tonChayTheKho } from "../src/lib/inventory/the-kho"

const d = (date: string, entry_type: string, quantity: number, id = date) => ({ id, date, entry_type, quantity })

describe("thẻ kho tổng — lọc kỳ theo ngày giờ VN", () => {
  // 01:30 sáng 25/09 giờ VN = 18:30Z ngày 24/09.
  const dong = [d("2026-09-20T03:00:00Z", "import", 100), d("2026-09-24T18:30:00Z", "export", 10)]

  it("Từ ngày 25/09 giữ phiếu 00:00–06:59 sáng 25/09 giờ VN, tồn đầu kỳ 100 → tồn sau 90", () => {
    const r = tonChayTheKho(dong, "2026-09-25", "")
    expect(r.dong.map((x) => x.id)).toEqual(["2026-09-24T18:30:00Z"])
    expect(r.dauKy).toBe(100)
    expect(r.dong[0].running).toBe(90)
    expect(r.xuat).toBe(10)
  })

  it("Đến ngày 24/09 loại phiếu đó (nó thuộc ngày 25/09 giờ VN)", () => {
    const r = tonChayTheKho(dong, "", "2026-09-24")
    expect(r.dong.map((x) => x.id)).toEqual(["2026-09-20T03:00:00Z"])
  })

  it("23:59 giờ VN (16:59Z) vẫn thuộc đúng ngày đó, không sang hôm sau", () => {
    const r = tonChayTheKho([d("2026-09-25T16:59:00Z", "import", 5)], "2026-09-25", "2026-09-25")
    expect(r.dong).toHaveLength(1)
  })
})

describe("thẻ kho tổng — chuyển kho không đổi tồn tổng", () => {
  it("nhập 30, chuyển 10 bán → date: tồn sau vẫn 30, không vào tổng nhập / xuất", () => {
    const r = tonChayTheKho([d("2026-09-20T03:00:00Z", "import", 30, "nk"), d("2026-09-21T03:00:00Z", "transfer", 10, "ck")], "", "")
    expect(r.dong.map((x) => x.running)).toEqual([30, 30])
    expect(r.nhap).toBe(30)
    expect(r.xuat).toBe(0)
  })

  it("biến động: nhập +, xuất −, kiểm kê theo dấu chênh lệch, chuyển kho 0", () => {
    expect(bienDongTong({ entry_type: "import", quantity: 5 })).toBe(5)
    expect(bienDongTong({ entry_type: "export", quantity: 5 })).toBe(-5)
    expect(bienDongTong({ entry_type: "stocktake", quantity: -0.5 })).toBe(-0.5)
    expect(bienDongTong({ entry_type: "stocktake", quantity: 2 })).toBe(2)
    expect(bienDongTong({ entry_type: "transfer", quantity: 10 })).toBe(0)
  })
})
