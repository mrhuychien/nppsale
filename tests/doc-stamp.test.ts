import { describe, it, expect, vi, afterEach } from "vitest"
import { stampVN, dateVN, longDateVN, docStampAt } from "@/lib/printing/doc-stamp"

/**
 * Chốt cho mốc thời gian trên chứng từ in.
 *
 * Hai bản trước (`stamp` / `longDate` nằm trong component) đọc giờ MÁY
 * ĐANG CHẠY. Trang in là Client Component nhưng Next vẫn dựng trước ở máy
 * chủ (UTC), nên tờ giấy in ra mang giờ nào là tuỳ lúc bấm.
 */

afterEach(() => {
  vi.useRealTimers()
})

describe("stampVN", () => {
  it("in ngày TRƯỚC giờ, đúng thứ tự của mẫu", () => {
    // 00:39 UTC = 07:39 giờ Việt Nam cùng ngày.
    expect(stampVN(new Date("2026-09-17T00:39:00Z"))).toBe("17/09/2026 07:39")
  })

  /**
   * ⚠ ĐÂY LÀ CẢ LÝ DO ĐỔI. 19:00 UTC ngày 20/04 là 02:00 giờ Việt Nam
   * ngày 21/04 — máy chủ in ra một ngày, điện thoại in ra ngày khác.
   */
  it("đổi ngày theo giờ Việt Nam, không theo giờ máy chủ", () => {
    const d = new Date("2026-04-20T19:00:00Z")
    expect(stampVN(d)).toBe("21/04/2026 02:00")
    expect(dateVN(d)).toBe("21/04/2026")
  })

  /**
   * ⚠ KHÔNG CÓ MỐC THÌ TRẢ "—". Lấy giờ hiện tại là bịa một dữ kiện, và
   * hai lần in ra hai tờ khác nhau.
   */
  it("không có mốc thì trả — chứ không lấy giờ đang bấm in", () => {
    expect(stampVN(null)).toBe("—")
    expect(stampVN(undefined)).toBe("—")
    expect(stampVN(new Date("không phải ngày"))).toBe("—")
    expect(dateVN(null)).toBe("—")
  })

  it("giữ số 0 đứng đầu ở ngày, tháng và giờ", () => {
    expect(stampVN(new Date("2026-01-05T01:05:00Z"))).toBe("05/01/2026 08:05")
  })
})

describe("longDateVN", () => {
  it("đọc thành câu, ngày tháng có số 0 đứng đầu", () => {
    expect(longDateVN(new Date("2026-09-17T00:39:00Z"))).toBe("Ngày 17 tháng 09 năm 2026")
  })

  /** Đây là ngày KÝ, nên thiếu mốc thì lùi về hôm nay là đúng. */
  it("không có mốc thì lấy hôm nay — khác hẳn stampVN", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-19T03:00:00Z"))
    expect(longDateVN(null)).toBe("Ngày 19 tháng 09 năm 2026")
  })
})

describe("docStampAt", () => {
  /**
   * ⚠ CỘT NGÀY LÀ KIỂU `date`, KHÔNG CÓ GIỜ. `new Date("2026-09-17")` ra
   * nửa đêm UTC = 07:00 giờ Việt Nam — in kèm giờ là in "07:00" cho MỌI
   * chứng từ, một con số trông như dữ liệu thật mà không phải.
   */
  it("ưu tiên created_at vì chỉ nó có giờ thật", () => {
    const r = docStampAt("2026-09-17T00:39:00Z", "2026-09-17")
    expect(r.hasTime).toBe(true)
    expect(stampVN(r.at)).toBe("17/09/2026 07:39")
  })

  it("thiếu created_at thì lùi về ngày chứng từ, và NÓI là không có giờ", () => {
    const r = docStampAt(null, "2026-09-17")
    expect(r.hasTime).toBe(false)
    expect(dateVN(r.at)).toBe("17/09/2026")
  })

  it("created_at hỏng thì vẫn lùi về ngày chứng từ, không trả mốc rác", () => {
    const r = docStampAt("không phải ngày", "2026-09-17")
    expect(r.hasTime).toBe(false)
    expect(dateVN(r.at)).toBe("17/09/2026")
  })

  it("không có gì thì trả null, không trả hôm nay", () => {
    expect(docStampAt(null, null)).toEqual({ at: null, hasTime: false })
  })
})
