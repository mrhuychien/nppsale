import { describe, it, expect } from "vitest"
import { taiHaiNhip, NHIP_DAU } from "../src/lib/supabase/hai-nhip"

/** ⚠ Chủ nhà 26/09/2026: "load nhanh 20 đơn trước, hiển thị luôn, trong khi vẫn load tiếp". */
type R = { data: number[] | null; count: number | null; error: string | null; aborted?: boolean }
const ds = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("taiHaiNhip", () => {
  it("nhịp 1 = 20 dòng đầu kèm đếm, vẽ NGAY; nhịp 2 chạy song song, không đếm; ghép đủ trang", async () => {
    const goi: string[] = []
    const lich: string[] = []
    const chay = async (from: number, to: number, dem: boolean): Promise<R> => {
      goi.push(`${from}-${to}${dem ? " đếm" : ""}`)
      await cho(from === 0 ? 5 : 30)
      lich.push(`xong ${from}`)
      return { data: ds(from, to), count: dem ? 120 : null, error: null }
    }
    let dau: number[] | null = null
    const kq = await taiHaiNhip<number, R>(chay, 0, 49, (d) => { dau = d.data; lich.push("vẽ") })
    expect(goi).toEqual(["0-19 đếm", "20-49"]) // cả hai bắn đi ngay, không chờ nhau
    expect(lich).toEqual(["xong 0", "vẽ", "xong 20"]) // vẽ trước khi nhịp 2 về
    expect(dau).toHaveLength(NHIP_DAU)
    expect(kq.data).toEqual(ds(0, 49))
    expect(kq.count).toBe(120)
  })
  it("trang nhỏ hơn nhịp đầu → một lượt như cũ", async () => {
    const goi: string[] = []
    const kq = await taiHaiNhip<number, R>(async (f, t, d) => { goi.push(`${f}-${t}${d ? " đếm" : ""}`); return { data: ds(f, t), count: 10, error: null } }, 0, 19)
    expect(goi).toEqual(["0-19 đếm"])
    expect(kq.data).toHaveLength(20)
  })
  it("tổng ≤ 20 → không chờ nhịp 2", async () => {
    let xong2 = false
    const kq = await taiHaiNhip<number, R>(async (f, t, d) => {
      if (!d) { await cho(50); xong2 = true }
      return { data: d ? ds(0, 7) : [], count: d ? 8 : null, error: null }
    }, 0, 49)
    expect(kq.data).toHaveLength(8)
    expect(xong2).toBe(false)
  })
  it("nhịp 2 hỏng → giữ 20 dòng đã vẽ, báo lỗi", async () => {
    const kq = await taiHaiNhip<number, R>(async (f, t, d) => (d ? { data: ds(f, t), count: 50, error: null } : { data: null, count: null, error: "mất mạng" }), 0, 49)
    expect(kq.data).toHaveLength(20)
    expect(kq.error).toBe("mất mạng")
  })
  it("nhịp 1 hỏng → trả nhịp 1, không gọi onDau", async () => {
    let goiDau = false
    const kq = await taiHaiNhip<number, R>(async (f, t, d) => (d ? { data: null, count: null, error: "403" } : { data: ds(f, t), count: null, error: null }), 0, 49, () => { goiDau = true })
    expect(kq.error).toBe("403")
    expect(goiDau).toBe(false)
  })
  it("tải thêm (boQuaDau) không vẽ lại 20 dòng đầu", async () => {
    let goiDau = false
    const kq = await taiHaiNhip<number, R>(async (f, t, d) => ({ data: ds(f, t), count: d ? 100 : null, error: null }), 0, 39, () => { goiDau = true }, { boQuaDau: true })
    expect(goiDau).toBe(false)
    expect(kq.data).toHaveLength(40)
  })
})

describe("laTaiThem", () => {
  it("cùng đầu, dài hơn = tải thêm; lần đầu / đổi trang / cùng độ dài = không", async () => {
    const { laTaiThem } = await import("../src/lib/supabase/hai-nhip")
    const ref = { current: null as { from: number; to: number } | null }
    expect(laTaiThem(ref, 0, 19)).toBe(false)
    expect(laTaiThem(ref, 0, 39)).toBe(true)
    expect(laTaiThem(ref, 0, 39)).toBe(false) // đổi bộ lọc, giữ độ dài
    expect(laTaiThem(ref, 50, 99)).toBe(false) // sang trang 2
  })
})
