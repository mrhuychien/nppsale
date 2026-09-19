import { describe, it, expect, vi, afterEach } from "vitest"
import {
  shortMoney,
  customerInitial,
  daysSinceVN,
  debtText,
  lastOrderText,
  groupByInitial,
  rowAccent,
  todayVN,
  COLD_DAYS,
  QUICK_FILTER_LABEL,
} from "@/lib/customers/list-view"

/**
 * Chốt cho danh sách khách theo mẫu chủ nhà gửi.
 *
 * Bốn nhãn ở đây là thứ NVBH đọc để chọn ghé ai trước, nên sai một chữ là
 * sai một buổi đi tuyến — không phải sai một dòng CSS.
 */

afterEach(() => {
  vi.useRealTimers()
})

/** Ghim đồng hồ vào một mốc GIỜ VIỆT NAM cho trước. */
function freezeVN(isoVN: string) {
  // 2026-09-19T08:00+07:00 → mốc UTC tương ứng.
  vi.useFakeTimers()
  vi.setSystemTime(new Date(isoVN))
}

describe("shortMoney", () => {
  it("rút gọn theo bậc triệu / nghìn", () => {
    expect(shortMoney(12_400_000)).toBe("12 tr")
    expect(shortMoney(4_200_000)).toBe("4,2 tr")
    expect(shortMoney(1_000_000)).toBe("1 tr")
    expect(shortMoney(450_000)).toBe("450k")
    expect(shortMoney(999)).toBe("999")
    expect(shortMoney(0)).toBe("0")
  })

  it("dưới 10 triệu giữ một chữ số lẻ, từ 10 triệu bỏ hẳn", () => {
    expect(shortMoney(9_960_000)).toBe("10 tr")
    expect(shortMoney(9_940_000)).toBe("9,9 tr")
    expect(shortMoney(24_300_000)).toBe("24 tr")
  })

  it("số âm giữ dấu — thu dư là số có thật, không được nuốt", () => {
    expect(shortMoney(-2_500_000)).toBe("-2,5 tr")
  })
})

describe("customerInitial", () => {
  it("bỏ phần loại hình ở đầu tên", () => {
    expect(customerInitial("Tạp hoá Bà Năm")).toBe("B")
    expect(customerInitial("Tạp hóa Hồng Oanh")).toBe("H")
    expect(customerInitial("Siêu thị Mini Thanh Tâm")).toBe("M")
    expect(customerInitial("Cửa hàng Bình An")).toBe("B")
    expect(customerInitial("Chị Duyên")).toBe("D")
  })

  it("tên chỉ có phần loại hình thì vẫn ra chữ, không ra rỗng", () => {
    expect(customerInitial("Tạp hoá")).toBe("T")
  })

  it("tên trống trả '?' chứ không trả chuỗi rỗng", () => {
    expect(customerInitial("")).toBe("?")
    expect(customerInitial(null)).toBe("?")
  })
})

describe("daysSinceVN + lastOrderText", () => {
  it("đầu ngày giờ Việt Nam vẫn là 'Đặt hôm nay' (máy chủ chạy UTC)", () => {
    // 01:00 ngày 19/09 giờ VN = 18:00 ngày 18/09 UTC. Tính theo giờ máy
    // chủ thì hôm nay là 18/09 và đơn ngày 19/09 hoá ra "ngày mai".
    freezeVN("2026-09-18T18:00:00Z")
    expect(todayVN()).toBe("2026-09-19")
    expect(daysSinceVN("2026-09-19")).toBe(0)
    expect(lastOrderText("2026-09-19")).toBe("Đặt hôm nay")
  })

  it("hôm qua và N ngày trước", () => {
    freezeVN("2026-09-19T03:00:00Z")
    expect(lastOrderText("2026-09-18")).toBe("Hôm qua")
    expect(lastOrderText("2026-08-20")).toBe("30 ngày trước")
  })

  it("chưa từng đặt KHÁC với đặt hôm nay", () => {
    freezeVN("2026-09-19T03:00:00Z")
    expect(lastOrderText(null)).toBe("Chưa đặt đơn")
    expect(lastOrderText(null)).not.toBe(lastOrderText("2026-09-19"))
  })

  it("ngày tương lai không ra số âm", () => {
    freezeVN("2026-09-19T03:00:00Z")
    expect(daysSinceVN("2026-09-25")).toBe(0)
  })
})

describe("debtText", () => {
  it("không nợ nói rõ là không nợ, không in '0'", () => {
    expect(debtText(0)).toBe("Không nợ")
    expect(debtText(12_400_000)).toBe("Nợ 12 tr")
  })
})

describe("groupByInitial", () => {
  it("gộp theo chữ cái đầu và xếp theo thứ tự tiếng Việt", () => {
    const rows = [
      { id: "1", store_name: "Đồng Nhất" },
      { id: "2", store_name: "Tạp hoá Bà Năm" },
      { id: "3", store_name: "Chị Duyên" },
      { id: "4", store_name: "Bảo Ân 105" },
      // ⚠ Â PHẢI ĐỨNG TRƯỚC B. Sắp bằng `.sort()` thô thì Â (U+00C2) rơi
      //   xuống tận sau Z — chốt chỉ có B/D/Đ không bắt được lỗi đó vì ba
      //   chữ ấy xếp giống nhau ở cả hai cách.
      { id: "5", store_name: "Ân Thi Mart" },
    ]
    const groups = groupByInitial(rows)
    expect(groups.map((g) => g.label)).toEqual(["Â", "B", "D", "Đ"])
    expect(groups[1].items.map((i) => i.id)).toEqual(["2", "4"])
  })

  it("giữ nguyên thứ tự bên trong nhóm (đã sắp theo tên từ server)", () => {
    const rows = [
      { id: "a", store_name: "An Bình" },
      { id: "b", store_name: "Án Khê" },
    ]
    const groups = groupByInitial(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"])
  })

  it("dấu THANH không tách nhóm, dấu CHỮ thì có", () => {
    // Á/À/Ả/Ã/Ạ chỉ là thanh điệu của A. Ă/Â/Đ là chữ riêng trong bảng
    // chữ cái tiếng Việt, tách nhóm mới đúng danh bạ.
    expect(customerInitial("Án Khê")).toBe("A")
    expect(customerInitial("Ân Bảo")).toBe("Â")
    expect(customerInitial("Ấm Áp")).toBe("Â")
    expect(customerInitial("Đồng Nhất")).toBe("Đ")
    const groups = groupByInitial([
      { id: "1", store_name: "Án Khê" },
      { id: "2", store_name: "Ân Bảo" },
    ])
    expect(groups.map((g) => g.label)).toEqual(["A", "Â"])
  })
})

describe("rowAccent", () => {
  const base = {
    visitedToday: false,
    routeMode: false,
    overdue: false,
    onTodayRoute: false,
    coldDays: null as number | null,
  }

  it("nợ quá hạn thắng tuyến hôm nay", () => {
    expect(rowAccent({ ...base, overdue: true, onTodayRoute: true })).toBe("overdue")
  })

  it("đã ghé chỉ thắng khi đang ở chế độ đi tuyến", () => {
    expect(rowAccent({ ...base, visitedToday: true, routeMode: true, overdue: true })).toBe("visited")
    expect(rowAccent({ ...base, visitedToday: true, routeMode: false, overdue: true })).toBe("overdue")
  })

  it("ngủ đông đúng từ mốc COLD_DAYS", () => {
    expect(rowAccent({ ...base, coldDays: COLD_DAYS - 1 })).toBe("none")
    expect(rowAccent({ ...base, coldDays: COLD_DAYS })).toBe("cold")
  })
})

describe("nhãn bộ lọc nhanh", () => {
  it("nhãn 'chưa đặt' khớp với mốc COLD_DAYS — hai chỗ không được lệch", () => {
    expect(QUICK_FILTER_LABEL.cold).toBe(`Chưa đặt ${COLD_DAYS} ngày`)
  })
})
