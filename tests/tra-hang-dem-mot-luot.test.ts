import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { docDemNhom, docDemNhomTheo, tongDem } from "@/lib/list/dem-nhom"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "tốc độ load trang chậm lắm" → rà soát lại: màn Trả hàng (máy tính) bắn 1 câu đếm tổng + 5 câu
 *   HEAD đếm theo lý do mỗi lần mở — gộp thành MỘT câu `reason, count()` (mig 206), lỗi thì lùi về cách cũ.
 */
describe("docDemNhomTheo — gom theo một cột bất kỳ", () => {
  it("đọc `reason, count()`; lý do bỏ trống (NULL) gom vào khoá nullLa; tổng = cộng mọi nhóm", () => {
    const kq = { data: [{ reason: "damaged", count: 2 }, { reason: null, count: 1 }, { reason: "tự ghi", count: "3" }], error: null }
    const d = docDemNhomTheo("reason", kq, "")
    expect(d).toEqual({ damaged: 2, "": 1, "tự ghi": 3 })
    expect(tongDem(d!)).toBe(6)
  })

  it("không truyền nullLa thì NULL là dữ liệu lạ → null (lùi về cách cũ); lỗi / không phải mảng / count hỏng → null", () => {
    expect(docDemNhomTheo("reason", { data: [{ reason: null, count: 1 }], error: null })).toBeNull()
    expect(docDemNhomTheo("reason", { data: null, error: { message: "aggregate disabled" } })).toBeNull()
    expect(docDemNhomTheo("reason", { data: { reason: "x", count: 1 }, error: null })).toBeNull()
    expect(docDemNhomTheo("reason", { data: [{ reason: "x", count: "nhiều" }], error: null })).toBeNull()
    expect(docDemNhomTheo("reason", { data: [{ reason: "x" }], error: null })).toBeNull()
  })

  it("docDemNhom (trạng thái) giữ nguyên luật cũ: status NULL → null", () => {
    expect(docDemNhom({ data: [{ status: "draft", count: 2 }, { status: "draft", count: 1 }], error: null })).toEqual({ draft: 3 })
    expect(docDemNhom({ data: [{ status: null, count: 1 }], error: null })).toBeNull()
  })
})

describe("màn Trả hàng (máy tính): đếm lý do MỘT lượt", () => {
  const S = readFileSync("src/app/(dashboard)/returns/page.tsx", "utf8")
  const i = S.indexOf("async function loadStats()")
  const than = S.slice(i, S.indexOf("loadStats()", i + 30))

  it("hỏi một câu `reason, count()` trước; có kết quả thì tổng = tongDem, không bắn HEAD", () => {
    expect(than).toContain('docDemNhomTheo("reason", await supabase.from("returns").select("reason, count()" as string), "")')
    expect(than).toMatch(/if \(nhom\) \{\s*setTotalCount\(tongDem\(nhom\)\)\s*setReasonCounts\(nhom\)\s*return\s*\}/)
  })

  it("máy chủ chưa gom được thì vẫn còn đường đếm lẻ như cũ", () => {
    expect(than).toContain("RETURN_REASONS.map(async (r) =>")
    expect(than).toContain('.select("id", { count: "exact", head: true })')
  })
})
