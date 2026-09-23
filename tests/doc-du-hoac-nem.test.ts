import { describe, it, expect } from "vitest"
import { docDuHoacNem, docTheoLoId, ID_MOI_LO } from "../src/lib/supabase/aggregate"

/**
 * Hai hàm đọc dùng chung cho mọi báo cáo (đợt QA 22/09/2026).
 *
 * ⚠ HAI LỖI IM LẶNG MÀ CHÚNG CHẶN:
 *   · `db.max_rows = 1000` — đọc trơn chỉ nhận 1.000 dòng, không báo gì;
 *   · lỗi đọc bị nuốt thành `[]` — "giá vốn 0", "doanh thu 0" trên màn hình.
 */

/** Bảng giả có `n` dòng, máy chủ trả tối đa `max` dòng mỗi lệnh. */
function bang(n: number, max = 1000, loiO?: number) {
  let goi = 0
  return {
    get goi() { return goi },
    trang: (from: number, to: number) => {
      goi++
      if (loiO !== undefined && goi === loiO) return Promise.resolve({ data: null, error: { message: "mạng rớt" }, count: null })
      const het = Math.min(to, from + max - 1, n - 1)
      const data = []
      for (let i = from; i <= het; i++) data.push({ i })
      return Promise.resolve({ data, error: null, count: n })
    },
  }
}

describe("docDuHoacNem", () => {
  it("đọc đủ khi vượt 1.000 dòng", async () => {
    const b = bang(2500)
    const r = await docDuHoacNem<{ i: number }>(b.trang, "thử")
    expect(r.rows).toHaveLength(2500)
    expect(r.truncated).toBe(false)
  })

  it("lỗi ở một trang thì NÉM, không trả mảng rỗng", async () => {
    const b = bang(2500, 1000, 2)
    await expect(docDuHoacNem(b.trang, "doanh thu")).rejects.toThrow(/doanh thu: mạng rớt/)
  })

  it("chạm trần thì báo truncated", async () => {
    const r = await docDuHoacNem(bang(50).trang, "thử", 20)
    expect(r.truncated).toBe(true)
  })
})

describe("docTheoLoId", () => {
  it(`chia lô ${ID_MOI_LO} id, bỏ id trùng`, async () => {
    const lo: number[] = []
    const ids = Array.from({ length: 400 }, (_, i) => `id-${i % 350}`)
    await docTheoLoId(ids, (l) => {
      lo.push(l.length)
      return Promise.resolve({ data: [], error: null, count: 0 })
    }, "thử")
    expect(lo).toEqual([150, 150, 50])
  })

  it("lỗi thì ném", async () => {
    await expect(
      docTheoLoId(["a"], () => Promise.resolve({ data: null, error: { message: "URL quá dài" }, count: null }), "giá vốn")
    ).rejects.toThrow(/giá vốn: URL quá dài/)
  })
})
