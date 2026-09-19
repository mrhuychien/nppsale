import { describe, it, expect, vi, afterEach } from "vitest"
import {
  periodFrom,
  nextPeriod,
  LIST_PERIODS,
  LIST_PERIOD_LABEL,
  summariseDocLines,
  docSummaryText,
  docQtyText,
  shortTermLabel,
  isCreditTerm,
} from "@/lib/orders/list-summary"

/**
 * Chốt cho danh sách đơn / hóa đơn trên điện thoại (mẫu chủ nhà gửi).
 */

afterEach(() => {
  vi.useRealTimers()
})

describe("periodFrom", () => {
  /** 18:00 UTC ngày 17/09 = 01:00 ngày 18/09 giờ Việt Nam. */
  const lateNight = new Date("2026-09-17T18:00:00Z")

  it("Hôm nay lấy theo ngày VIỆT NAM, không theo ngày máy chủ", () => {
    expect(periodFrom("today", lateNight)).toBe("2026-09-18")
  })

  it("7 ngày qua GỒM cả hôm nay — hôm nay và sáu ngày trước", () => {
    expect(periodFrom("week", new Date("2026-09-17T05:00:00Z"))).toBe("2026-09-11")
  })

  it("Tháng này bắt đầu từ mùng 1 của tháng VIỆT NAM", () => {
    // 01/10 lúc 00:30 giờ VN vẫn là 30/09 theo UTC.
    expect(periodFrom("month", new Date("2026-09-30T17:30:00Z"))).toBe("2026-10-01")
  })

  it("Tất cả thì không giới hạn", () => {
    expect(periodFrom("all", lateNight)).toBeNull()
  })

  it("qua tháng và qua năm vẫn ra mốc đúng", () => {
    expect(periodFrom("week", new Date("2026-01-03T05:00:00Z"))).toBe("2025-12-28")
  })
})

describe("nextPeriod", () => {
  it("quay vòng đủ bốn khoảng rồi về đầu", () => {
    let p = LIST_PERIODS[0]
    const seen = [p]
    for (let i = 0; i < 3; i++) {
      p = nextPeriod(p)
      seen.push(p)
    }
    expect(seen).toEqual(["today", "week", "month", "all"])
    expect(nextPeriod("all")).toBe("today")
  })

  it("mỗi khoảng đều có nhãn tiếng Việt", () => {
    for (const p of LIST_PERIODS) {
      expect(LIST_PERIOD_LABEL[p], `thiếu nhãn ${p}`).toBeTruthy()
    }
  })
})

describe("summariseDocLines", () => {
  const line = (
    doc_id: string,
    name: string,
    line_total: number,
    quantity = 1,
    unit_name = "thùng"
  ) => ({ doc_id, unit_name, quantity, line_total, product: { name } })

  it("đếm đủ số dòng của từng chứng từ", () => {
    const m = summariseDocLines([
      line("o1", "A", 10),
      line("o1", "B", 20),
      line("o2", "C", 5),
    ])
    expect(m.o1.count).toBe(2)
    expect(m.o2.count).toBe(1)
  })

  /**
   * ⚠ ĐÂY LÀ LÝ DO KHÔNG LẤY "DÒNG ĐẦU". `sales_order_lines` không có cột
   * thứ tự, nên thứ tự Postgres trả về đổi giữa hai lần đọc; chọn theo
   * thành tiền thì kết quả không đổi.
   */
  it("chọn mặt hàng có THÀNH TIỀN lớn nhất, không phụ thuộc thứ tự đầu vào", () => {
    const rows = [line("o1", "Nhỏ", 10, 1), line("o1", "To", 900, 7, "gói")]
    const a = summariseDocLines(rows)
    const b = summariseDocLines([...rows].reverse())
    expect(a.o1.name).toBe("To")
    expect(a.o1.unit).toBe("gói")
    expect(a.o1.qty).toBe(7)
    expect(b.o1).toEqual(a.o1)
  })

  it("hoà thành tiền thì so tiếp theo tên, kết quả vẫn ổn định", () => {
    const rows = [line("o1", "Bánh", 100), line("o1", "Ao", 100)]
    expect(summariseDocLines(rows).o1.name).toBe("Ao")
    expect(summariseDocLines([...rows].reverse()).o1.name).toBe("Ao")
  })

  it("bỏ dòng không có mã chứng từ thay vì tạo khoá rỗng", () => {
    expect(summariseDocLines([{ doc_id: "", line_total: 5 }])).toEqual({})
  })

  /**
   * ⚠ PostgREST TRẢ `numeric` DƯỚI DẠNG CHUỖI, và `>` trên chuỗi so theo
   * BẢNG CHỮ CÁI: "100" < "90". Không ép về số thì dòng 100.000đ thua
   * dòng 90.000đ, và thẻ hiện sai mặt hàng đại diện.
   *
   * ⚠ Cặp số phải chọn cho LỆCH giữa hai cách so. Bản đầu của chốt này
   * dùng "900" và "50" — so kiểu nào cũng ra cùng kết quả, nên bỏ hẳn
   * `Number()` mà chốt vẫn xanh. Đã thử phá đúng như vậy và nó lọt.
   */
  it("số về dưới dạng chuỗi vẫn so theo GIÁ TRỊ, không theo bảng chữ cái", () => {
    const m = summariseDocLines([
      { doc_id: "o1", line_total: "90", quantity: "2", unit_name: "lon", product: { name: "X" } },
      { doc_id: "o1", line_total: "100", quantity: "3", unit_name: "thùng", product: { name: "Y" } },
    ])
    expect(m.o1.name).toBe("Y")
    expect(m.o1.unit).toBe("thùng")
    // Và số lượng phải là SỐ, không phải chuỗi "3".
    expect(m.o1.qty).toBe(3)
    expect(typeof m.o1.qty).toBe("number")
  })
})

describe("docSummaryText / docQtyText", () => {
  it("có tên hàng thì in tên kèm đơn vị", () => {
    const s = { count: 4, name: "Mì Hảo Hảo", unit: "thùng", qty: 2 }
    expect(docSummaryText(s)).toBe("Mì Hảo Hảo (thùng)")
    expect(docQtyText(s)).toBe("x2 +3 SP")
  })

  it("đơn một dòng thì không có phần '+N SP'", () => {
    expect(docQtyText({ count: 1, name: "A", unit: "gói", qty: 5 })).toBe("x5")
  })

  /**
   * ⚠ CHƯA ĐỌC ĐƯỢC DÒNG HÀNG THÌ IM, đừng in "0 mặt hàng" — đó là câu
   * trả lời sai cho một câu hỏi chưa có đáp án.
   */
  it("chưa có dữ liệu dòng hàng thì trả chuỗi rỗng", () => {
    expect(docSummaryText(undefined)).toBe("")
    expect(docQtyText(undefined)).toBe("")
  })

  it("đọc được dòng nhưng mất tên sản phẩm thì lùi về đếm mặt hàng", () => {
    const s = { count: 3, name: null, unit: null, qty: 0 }
    expect(docSummaryText(s)).toBe("3 mặt hàng")
    expect(docQtyText(s)).toBe("")
  })
})

describe("shortTermLabel", () => {
  it("rút gọn đủ cho một góc thẻ hẹp", () => {
    expect(shortTermLabel("COD")).toBe("Tiền mặt")
    expect(shortTermLabel("NET15")).toBe("Nợ 15 ngày")
    expect(shortTermLabel("NET30")).toBe("Nợ 30 ngày")
  })

  /** ⚠ Mã lạ in NGUYÊN MÃ — giấu đi là giấu luôn manh mối. */
  it("mã ngoài bảng vẫn in ra, không thành dấu gạch", () => {
    expect(shortTermLabel("TRA_GOP_6T")).toBe("TRA_GOP_6T")
    expect(shortTermLabel(null)).toBe("")
  })

  it("chỉ COD mới là trả ngay", () => {
    expect(isCreditTerm("COD")).toBe(false)
    expect(isCreditTerm("NET15")).toBe(true)
    expect(isCreditTerm(null)).toBe(false)
  })
})
