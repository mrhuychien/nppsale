import { describe, it, expect } from "vitest"
import {
  fetchForAggregate,
  capRows,
  AGGREGATE_ROW_CAP,
  truncationWarning,
} from "@/lib/supabase/aggregate"

/**
 * Lớp chặn cho các trang tổng hợp. Điểm cần bảo vệ: khi dữ liệu bị cắt ở
 * trần, hàm PHẢI báo `truncated` — im lặng ở đây nghĩa là trang hiện một
 * con số công nợ thiếu mà trông vẫn bình thường.
 */

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }))

/** Giả lập query đã gắn .range(0, cap): trả về tối đa cap+1 dòng. */
const q = (available: number) => (cap: number) =>
  Promise.resolve({ data: rows(Math.min(available, cap + 1)), error: null })

describe("fetchForAggregate — biết khi dữ liệu bị cắt", () => {
  it("ít hơn trần: trả đủ, không báo cắt", async () => {
    const r = await fetchForAggregate(q(50), 100)
    expect(r.rows).toHaveLength(50)
    expect(r.truncated).toBe(false)
  })

  it("đúng bằng trần: vẫn KHÔNG coi là bị cắt", async () => {
    const r = await fetchForAggregate(q(100), 100)
    expect(r.rows).toHaveLength(100)
    expect(r.truncated).toBe(false)
  })

  it("vượt trần đúng 1 dòng: PHẢI báo cắt", async () => {
    // Đây là ranh giới quan trọng nhất — nếu chỉ xin đúng `cap` dòng thì
    // không tài nào phân biệt được "vừa hết" với "còn nữa".
    const r = await fetchForAggregate(q(101), 100)
    expect(r.truncated).toBe(true)
  })

  it("bị cắt thì chỉ trả đúng `cap` dòng, không trả dư dòng thăm dò", async () => {
    const r = await fetchForAggregate(q(9999), 100)
    expect(r.rows).toHaveLength(100)
    expect(r.truncated).toBe(true)
  })

  it("truy vấn lỗi: trả rỗng, có error, và KHÔNG báo cắt nhầm", async () => {
    const r = await fetchForAggregate(() =>
      Promise.resolve({ data: null, error: { message: "permission denied" } })
    )
    expect(r.rows).toEqual([])
    expect(r.error).toBe("permission denied")
    expect(r.truncated).toBe(false)
  })

  it("data null mà không lỗi cũng không làm vỡ hàm", async () => {
    const r = await fetchForAggregate(() => Promise.resolve({ data: null, error: null }))
    expect(r.rows).toEqual([])
    expect(r.truncated).toBe(false)
  })

  it("truyền đúng trần xuống hàm dựng query", async () => {
    let seen = -1
    await fetchForAggregate((cap) => {
      seen = cap
      return Promise.resolve({ data: [], error: null })
    })
    expect(seen).toBe(AGGREGATE_ROW_CAP)
  })
})

describe("capRows — dạng rời dùng trong Promise.all", () => {
  it("dưới trần thì giữ nguyên", () => {
    expect(capRows(rows(5), 10)).toEqual({ rows: rows(5), truncated: false })
  })

  it("vượt trần thì cắt và báo", () => {
    const r = capRows(rows(11), 10)
    expect(r.rows).toHaveLength(10)
    expect(r.truncated).toBe(true)
  })

  it("null / undefined quy về mảng rỗng", () => {
    expect(capRows(null).rows).toEqual([])
    expect(capRows(undefined).rows).toEqual([])
    expect(capRows(null).truncated).toBe(false)
  })
})

describe("truncationWarning", () => {
  it("nêu rõ số tổng đang THIẾU, không nói mơ hồ kiểu 'hiển thị một phần'", () => {
    const msg = truncationWarning(20000)
    expect(msg).toContain("THIẾU")
    expect(msg).toContain("20.000")
  })
})
