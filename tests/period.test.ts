import { describe, it, expect, vi, afterEach } from "vitest"
import {
  rangeFromPreset,
  previousRange,
  pctChange,
  formatRangeLabel,
  daysBetween,
  dailyBuckets,
  PERIOD_LABELS,
} from "@/lib/analytics/period"
import type { PeriodPreset } from "@/lib/analytics/period"

/**
 * Khoảng thời gian báo cáo. Mọi trang Báo cáo và Phân tích đều đi qua đây,
 * nên lệch một ngày ở đầu hoặc cuối kỳ là mọi con số doanh thu, giá vốn,
 * chi phí đều lệch theo — mà vẫn trông hợp lý nên rất khó phát hiện.
 *
 * Ngày giờ được ghim cứng bằng fake timer, nếu không test sẽ đỏ ngẫu nhiên
 * tuỳ hôm chạy rơi vào thứ mấy.
 */

/** Ghim "bây giờ" vào một thời điểm cụ thể (giờ địa phương). */
function freezeAt(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}
afterEach(() => vi.useRealTimers())

describe("rangeFromPreset — các mốc thời gian", () => {
  // Thứ Tư, 19/08/2026, 15:30 giờ địa phương.
  const WED = "2026-08-19T15:30:00"

  it("hôm nay: from = to = hôm nay", () => {
    freezeAt(WED)
    expect(rangeFromPreset("today")).toEqual({ from: "2026-08-19", to: "2026-08-19" })
  })

  it("hôm qua: cả from và to đều lùi 1 ngày, KHÔNG kéo sang hôm nay", () => {
    freezeAt(WED)
    expect(rangeFromPreset("yesterday")).toEqual({ from: "2026-08-18", to: "2026-08-18" })
  })

  it("tuần này: bắt đầu từ THỨ HAI, không phải Chủ nhật", () => {
    freezeAt(WED)
    // 19/08/2026 là thứ Tư → thứ Hai của tuần là 17/08.
    expect(rangeFromPreset("this_week")).toEqual({ from: "2026-08-17", to: "2026-08-19" })
  })

  it("Chủ nhật vẫn thuộc tuần BẮT ĐẦU TỪ THỨ HAI trước đó", () => {
    // Đây là chỗ sai kinh điển: getDay() cho Chủ nhật = 0, nếu trừ thẳng
    // thì tuần của Chủ nhật sẽ bắt đầu từ chính hôm đó.
    freezeAt("2026-08-23T10:00:00") // Chủ nhật
    expect(rangeFromPreset("this_week").from).toBe("2026-08-17")
  })

  it("thứ Hai: tuần này bắt đầu từ chính hôm đó", () => {
    freezeAt("2026-08-17T08:00:00")
    expect(rangeFromPreset("this_week").from).toBe("2026-08-17")
  })

  it("tuần trước: trọn 7 ngày, kết thúc vào Chủ nhật liền trước", () => {
    freezeAt(WED)
    const r = rangeFromPreset("last_week")
    expect(r).toEqual({ from: "2026-08-10", to: "2026-08-16" })
    expect(daysBetween(r)).toBe(7)
  })

  it("tháng này: từ ngày 1 đến hôm nay", () => {
    freezeAt(WED)
    expect(rangeFromPreset("this_month")).toEqual({ from: "2026-08-01", to: "2026-08-19" })
  })

  it("tháng trước: trọn tháng, đến ĐÚNG ngày cuối tháng", () => {
    freezeAt(WED)
    expect(rangeFromPreset("last_month")).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })

  it("tháng trước của tháng 3 phải ra tháng 2 đúng số ngày (năm nhuận)", () => {
    freezeAt("2024-03-15T10:00:00") // 2024 nhuận
    expect(rangeFromPreset("last_month")).toEqual({ from: "2024-02-01", to: "2024-02-29" })
  })

  it("tháng trước của tháng 1 phải lùi sang năm trước", () => {
    freezeAt("2026-01-10T10:00:00")
    expect(rangeFromPreset("last_month")).toEqual({ from: "2025-12-01", to: "2025-12-31" })
  })

  it("quý này: đúng mốc đầu quý", () => {
    freezeAt(WED) // tháng 8 → quý 3 → bắt đầu 01/07
    expect(rangeFromPreset("this_quarter").from).toBe("2026-07-01")

    freezeAt("2026-02-10T10:00:00") // quý 1
    expect(rangeFromPreset("this_quarter").from).toBe("2026-01-01")

    freezeAt("2026-11-30T10:00:00") // quý 4
    expect(rangeFromPreset("this_quarter").from).toBe("2026-10-01")
  })

  it("năm nay: từ 01/01", () => {
    freezeAt(WED)
    expect(rangeFromPreset("this_year")).toEqual({ from: "2026-01-01", to: "2026-08-19" })
  })

  it("tuỳ chỉnh: trả nguyên khoảng được truyền vào", () => {
    freezeAt(WED)
    const custom = { from: "2020-01-01", to: "2020-12-31" }
    expect(rangeFromPreset("custom", custom)).toEqual(custom)
  })

  it("tuỳ chỉnh mà KHÔNG truyền khoảng thì suy biến về hôm nay, không vỡ", () => {
    freezeAt(WED)
    expect(rangeFromPreset("custom")).toEqual({ from: "2026-08-19", to: "2026-08-19" })
  })

  it("mọi mốc đều trả về from <= to", () => {
    freezeAt(WED)
    for (const p of Object.keys(PERIOD_LABELS) as PeriodPreset[]) {
      const r = rangeFromPreset(p)
      expect(r.from <= r.to, `mốc "${p}" có from > to`).toBe(true)
    }
  })

  it("mọi mốc đều có nhãn tiếng Việt", () => {
    for (const p of Object.keys(PERIOD_LABELS) as PeriodPreset[]) {
      expect(PERIOD_LABELS[p]).toBeTruthy()
    }
  })
})

describe("previousRange — kỳ liền trước để so sánh", () => {
  it("cùng độ dài với kỳ hiện tại", () => {
    const cur = { from: "2026-08-01", to: "2026-08-31" } // 31 ngày
    const prev = previousRange(cur)
    expect(daysBetween(prev)).toBe(31)
  })

  it("kết thúc đúng ngày liền trước kỳ hiện tại, không chồng lấn", () => {
    // Chồng lấn một ngày là doanh thu ngày đó bị đếm ở cả hai kỳ.
    const prev = previousRange({ from: "2026-08-01", to: "2026-08-31" })
    expect(prev.to).toBe("2026-07-31")
    expect(prev.from).toBe("2026-07-01")
  })

  it("kỳ một ngày → kỳ trước cũng một ngày", () => {
    const prev = previousRange({ from: "2026-08-19", to: "2026-08-19" })
    expect(prev).toEqual({ from: "2026-08-18", to: "2026-08-18" })
  })

  it("bắc qua ranh giới năm", () => {
    // Tháng 1 có 31 ngày → kỳ trước cũng 31 ngày → trọn tháng 12.
    const prev = previousRange({ from: "2026-01-01", to: "2026-01-31" })
    expect(prev).toEqual({ from: "2025-12-01", to: "2025-12-31" })
    expect(daysBetween(prev)).toBe(31)
  })

  it("from > to (dữ liệu bẩn) vẫn không sinh khoảng âm", () => {
    const prev = previousRange({ from: "2026-08-31", to: "2026-08-01" })
    expect(daysBetween(prev)).toBeGreaterThanOrEqual(1)
  })
})

describe("pctChange — phần trăm thay đổi", () => {
  it("tăng và giảm thông thường", () => {
    expect(pctChange(150, 100)).toBe(50)
    expect(pctChange(50, 100)).toBe(-50)
    expect(pctChange(100, 100)).toBe(0)
  })

  it("kỳ trước bằng 0: có doanh thu → 100%, không có → null (không hiện gì)", () => {
    // Trả null chứ không phải Infinity — giao diện không thể in "∞%".
    expect(pctChange(500, 0)).toBe(100)
    expect(pctChange(0, 0)).toBeNull()
  })

  it("kỳ trước ÂM: dùng trị tuyệt đối làm mẫu số", () => {
    // Lỗ 100 → lãi 50 là cải thiện, phải ra số DƯƠNG.
    expect(pctChange(50, -100)).toBe(150)
  })

  it("không bao giờ trả về NaN hay Infinity", () => {
    for (const [c, p] of [[0, 0], [1, 0], [-1, 0], [0, 1], [5, -5]] as const) {
      const v = pctChange(c, p)
      if (v !== null) {
        expect(Number.isFinite(v), `pctChange(${c}, ${p}) = ${v}`).toBe(true)
      }
    }
  })
})

describe("daysBetween", () => {
  it("tính CẢ hai đầu mút", () => {
    // 01 đến 31 tháng 8 là 31 ngày, không phải 30.
    expect(daysBetween({ from: "2026-08-01", to: "2026-08-31" })).toBe(31)
    expect(daysBetween({ from: "2026-08-19", to: "2026-08-19" })).toBe(1)
  })

  it("tối thiểu là 1, không trả 0 hay số âm", () => {
    expect(daysBetween({ from: "2026-08-31", to: "2026-08-01" })).toBeGreaterThanOrEqual(1)
  })
})

describe("dailyBuckets — trục ngày cho biểu đồ", () => {
  it("sinh đủ số ngày, kể cả ngày cuối", () => {
    const b = dailyBuckets({ from: "2026-08-01", to: "2026-08-05" })
    expect(b).toHaveLength(5)
    expect(b[0].date).toBe("2026-08-01")
    expect(b[4].date).toBe("2026-08-05")
  })

  it("một ngày thì ra đúng một mốc", () => {
    expect(dailyBuckets({ from: "2026-08-19", to: "2026-08-19" })).toHaveLength(1)
  })

  it("bắc qua ranh giới tháng", () => {
    const b = dailyBuckets({ from: "2026-07-30", to: "2026-08-02" })
    expect(b.map((x) => x.date)).toEqual([
      "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02",
    ])
  })

  it("nhãn dạng dd/mm", () => {
    expect(dailyBuckets({ from: "2026-08-01", to: "2026-08-01" })[0].label).toBe("01/08")
  })

  it("khoảng ngược (from > to) trả mảng rỗng, không lặp vô hạn", () => {
    expect(dailyBuckets({ from: "2026-08-05", to: "2026-08-01" })).toEqual([])
  })
})

describe("formatRangeLabel", () => {
  it("hiển thị dd/mm/yyyy - dd/mm/yyyy", () => {
    expect(formatRangeLabel({ from: "2026-08-01", to: "2026-08-31" })).toBe(
      "01/08/2026 - 31/08/2026"
    )
  })
})
