/**
 * Chủ nhà 27/09/2026: "rà cách đọc dữ liệu cho nhanh hơn".
 * - `docTheoLoId` đọc các lô SONG SONG (≤ LO_SONG_SONG), giữ thứ tự, lỗi vẫn ném.
 * - Báo cáo: danh mục và số đọc song song; bộ nhớ tạm dùng chung giữa các màn.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { docTheoLoId, ID_MOI_LO, LO_SONG_SONG } from "@/lib/supabase/aggregate"

const cho = (ms: number) => new Promise((r) => setTimeout(r, ms))

function giaLap(tre = 15, loiO?: number) {
  let dang = 0
  let dinh = 0
  let luot = 0
  const dung = (lo: string[]) => {
    const i = luot++
    return (async () => {
      dang++
      dinh = Math.max(dinh, dang)
      await cho(tre)
      dang--
      if (loiO === i) return { data: null, error: { message: "rớt mạng" }, count: null }
      return { data: lo.map((id) => ({ id })), error: null, count: lo.length }
    })()
  }
  return { dung, dinh: () => dinh }
}

describe("docTheoLoId song song", () => {
  const ids = Array.from({ length: ID_MOI_LO * 10 + 7 }, (_, i) => `id-${String(i).padStart(5, "0")}`)

  it("11 lô chạy song song (không quá LO_SONG_SONG), kết quả đúng thứ tự, đủ dòng", async () => {
    const g = giaLap()
    const t0 = Date.now()
    const rows = await docTheoLoId<{ id: string }>(ids, (lo) => g.dung(lo), "thử")
    const ms = Date.now() - t0
    expect(rows.map((r) => r.id)).toEqual(ids)
    expect(g.dinh()).toBeGreaterThan(1)
    expect(g.dinh()).toBeLessThanOrEqual(LO_SONG_SONG)
    // Lần lượt: 11 × 15ms ≥ 165ms. Song song 6: 2 đợt ≈ 30ms.
    expect(ms).toBeLessThan(11 * 15)
  })

  it("một lô hỏng thì cả hàm NÉM (không trả thiếu dòng)", async () => {
    const g = giaLap(5, 3)
    await expect(docTheoLoId(ids, (lo) => g.dung(lo), "đọc dòng")).rejects.toThrow("đọc dòng: rớt mạng")
  })

  it("không có id thì không gọi mạng", async () => {
    const g = giaLap()
    expect(await docTheoLoId([], (lo) => g.dung(lo), "x")).toEqual([])
    expect(g.dinh()).toBe(0)
  })
})

describe("báo cáo: danh mục song song với số, nhớ tạm giữa các màn", () => {
  const src = (p: string) => readFileSync(p, "utf8")
  it("không màn nào đợi xong danh mục rồi mới đọc số", () => {
    for (const f of ["man-ban-hang", "man-tong-quan", "man-cuoi-ngay", "man-cong-no", "man-kho", "man-tai-chinh"]) {
      const s = src(`src/components/bao-cao/${f}.tsx`)
      expect(s).not.toMatch(/await layDanhMuc\(orgId\)\s*\n\s*const [^\n]*await (Promise\.all|nap)/)
    }
    for (const f of ["nap-ban-hang", "nap-cong-no", "nap-kho"]) expect(src(`src/lib/bao-cao/${f}.ts`)).toMatch(/dmVao: DanhMucVao/)
  })
  it("số bán / công nợ / tồn kho dùng chung bộ nhớ tạm; Bán hàng chỉ đọc sổ công nợ ở chế độ Khách", () => {
    expect(src("src/components/bao-cao/man-tong-quan.tsx")).toMatch(/nhoTam\(`ban\|/)
    expect(src("src/components/bao-cao/man-ban-hang.tsx")).toMatch(/nhoTam\(`ban\|/)
    expect(src("src/components/bao-cao/man-ban-hang.tsx")).toMatch(/view0 === "cust" \? \(\) => loadDebtByCustomer/)
    expect(src("src/components/bao-cao/dung-chung.ts")).toMatch(/boNhoTam\.clear\(\)/)
  })
})
