import { describe, it, expect, vi } from "vitest"
import {
  fetchAllForAggregate,
  AGGREGATE_ROW_CAP,
  truncationWarning,
} from "@/lib/supabase/aggregate"

/**
 * Lớp lấy đủ dữ liệu để cộng tiền.
 *
 * Bối cảnh: `db.max_rows` của dự án đang là 1.000. Server trả 200 kèm đúng
 * 1.000 dòng và KHÔNG có lỗi nào khi vượt trần, nên nếu lớp này sai thì
 * trang công nợ hiện số thiếu mà trông vẫn bình thường.
 */

/**
 * Giả lập PostgREST có `db.max_rows`:
 *  - `count` luôn là TỔNG SỐ DÒNG THẬT (không bị trần cắt) — đúng hành vi
 *    của header Content-Range.
 *  - mỗi request trả tối đa `maxRows` dòng.
 */
function fakeServer(total: number, maxRows = 1000) {
  const calls: Array<[number, number]> = []
  const build = (from: number, to: number) => {
    calls.push([from, to])
    const want = Math.min(to - from + 1, maxRows)
    const rows = []
    for (let i = from; i < Math.min(from + want, total); i++) rows.push({ i })
    return Promise.resolve({ data: rows, error: null, count: total })
  }
  return { build, calls }
}

describe("fetchAllForAggregate — lấy đủ dù server chặn 1.000 dòng/lần", () => {
  it("bảng nhỏ hơn trần server: một request là xong", async () => {
    const { build, calls } = fakeServer(300)
    const r = await fetchAllForAggregate<{ i: number }>(build)
    expect(r.rows).toHaveLength(300)
    expect(r.total).toBe(300)
    expect(r.truncated).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it("ĐÚNG 1.000 dòng — ranh giới: vẫn phải đủ và KHÔNG coi là thiếu", async () => {
    const { build } = fakeServer(1000)
    const r = await fetchAllForAggregate<{ i: number }>(build)
    expect(r.rows).toHaveLength(1000)
    expect(r.truncated).toBe(false)
  })

  it("2.500 dòng: lấy đủ cả 2.500, không dừng ở 1.000", async () => {
    // Đây chính là ca bệnh thật: trước đây trang chỉ cộng 1.000 dòng đầu.
    const { build, calls } = fakeServer(2500)
    const r = await fetchAllForAggregate<{ i: number }>(build)
    expect(r.rows).toHaveLength(2500)
    expect(r.truncated).toBe(false)
    expect(calls).toHaveLength(3) // 1 lần dò + 2 lần lấy phần còn lại
  })

  it("không trả trùng và không sót dòng nào", async () => {
    const { build } = fakeServer(2500)
    const r = await fetchAllForAggregate<{ i: number }>(build)
    const ids = r.rows.map((x) => x.i)
    expect(new Set(ids).size).toBe(2500)
    expect(Math.min(...ids)).toBe(0)
    expect(Math.max(...ids)).toBe(2499)
  })

  it("các trang sau chạy SONG SONG, không nối đuôi nhau", async () => {
    let running = 0
    let peak = 0
    const build = (from: number, to: number) => {
      running++
      peak = Math.max(peak, running)
      const rows: Array<{ i: number }> = []
      for (let i = from; i < Math.min(from + Math.min(to - from + 1, 1000), 3000); i++) rows.push({ i })
      return new Promise<{ data: unknown; error: null; count: number }>((res) =>
        setTimeout(() => { running--; res({ data: rows, error: null, count: 3000 }) }, 5)
      )
    }
    await fetchAllForAggregate<{ i: number }>(build)
    expect(peak).toBeGreaterThan(1)
  })

  it("vượt trần của ứng dụng: cắt đúng trần VÀ báo thiếu", async () => {
    const { build } = fakeServer(5000)
    const r = await fetchAllForAggregate<{ i: number }>(build, 2000)
    expect(r.rows).toHaveLength(2000)
    expect(r.truncated).toBe(true)
    expect(r.total).toBe(5000) // vẫn cho biết thực tế có bao nhiêu
  })

  it("server KHÔNG đặt trần: vẫn chạy đúng, chỉ một request", async () => {
    const { build, calls } = fakeServer(5000, 999999)
    const r = await fetchAllForAggregate<{ i: number }>(build)
    expect(r.rows).toHaveLength(5000)
    expect(r.truncated).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it("bảng rỗng", async () => {
    const { build } = fakeServer(0)
    const r = await fetchAllForAggregate<{ i: number }>(build)
    expect(r.rows).toEqual([])
    expect(r.truncated).toBe(false)
    expect(r.total).toBe(0)
  })

  it("lỗi ở request đầu: trả rỗng kèm lỗi, KHÔNG báo thiếu nhầm", async () => {
    const r = await fetchAllForAggregate(() =>
      Promise.resolve({ data: null, error: { message: "permission denied" }, count: null })
    )
    expect(r.rows).toEqual([])
    expect(r.error).toBe("permission denied")
    expect(r.truncated).toBe(false)
  })

  it("lỗi ở request sau: KHÔNG trả về dữ liệu một nửa", async () => {
    // Trả nửa dữ liệu ở đây nguy hiểm hơn trả lỗi: trang sẽ cộng ra một con
    // số nhỏ hơn thực tế mà vẫn trông hợp lệ.
    let n = 0
    const build = (from: number) => {
      n++
      if (n > 1) return Promise.resolve({ data: null, error: { message: "timeout" }, count: 3000 })
      const rows = []
      for (let i = from; i < 1000; i++) rows.push({ i })
      return Promise.resolve({ data: rows, error: null, count: 3000 })
    }
    const r = await fetchAllForAggregate<{ i: number }>(build)
    expect(r.rows).toEqual([])
    expect(r.error).toBe("timeout")
  })

  it("count nói có dòng nhưng không trả dòng nào: dừng, không lặp vô hạn", async () => {
    const build = vi.fn().mockResolvedValue({ data: [], error: null, count: 500 })
    const r = await fetchAllForAggregate<{ i: number }>(build)
    expect(r.truncated).toBe(true)
    expect(build).toHaveBeenCalledTimes(1)
  })

  it("thiếu count (quên `count: exact`): coi số nhận được là toàn bộ", async () => {
    // Suy biến an toàn, nhưng đây là lỗi lập trình — đã ghi rõ trong docblock.
    const build = () => Promise.resolve({ data: [{ i: 1 }], error: null })
    const r = await fetchAllForAggregate<{ i: number }>(build)
    expect(r.rows).toHaveLength(1)
    expect(r.total).toBe(1)
  })

  it("request đầu xin đúng trần ứng dụng", async () => {
    const { calls } = fakeServer(10)
    const spy: Array<[number, number]> = []
    await fetchAllForAggregate<{ i: number }>((from, to) => {
      spy.push([from, to])
      return Promise.resolve({ data: [], error: null, count: 0 })
    })
    expect(spy[0]).toEqual([0, AGGREGATE_ROW_CAP - 1])
    expect(calls).toHaveLength(0)
  })
})

describe("truncationWarning", () => {
  it("nói rõ số tổng đang THIẾU, không nói mơ hồ kiểu 'hiển thị một phần'", () => {
    const msg = truncationWarning(20000)
    expect(msg).toContain("THIẾU")
    expect(msg).toContain("20.000")
  })
})
