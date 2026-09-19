import { describe, it, expect, vi, afterEach } from "vitest"
import {
  debtBuckets,
  frequentProducts,
  revenueCompareText,
  customerTodos,
  mergeActivity,
} from "@/lib/customers/profile-stats"

afterEach(() => {
  vi.useRealTimers()
})

function freezeVN(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

describe("debtBuckets", () => {
  it("chia đúng ba ô theo tuổi nợ", () => {
    freezeVN("2026-09-19T03:00:00Z")
    const b = debtBuckets([
      { amount: 8_200_000, paid: 0, due_date: "2026-10-01" }, // chưa tới hạn
      { amount: 5_000_000, paid: 800_000, due_date: "2026-09-05" }, // quá hạn 14 ngày
      { amount: 3_000_000, paid: 0, due_date: "2026-06-01" }, // quá hạn 110 ngày
    ])
    expect(b.map((x) => x.amount)).toEqual([8_200_000, 4_200_000, 3_000_000])
  })

  it("mốc 30 ngày nằm đúng chỗ — 30 ngày vào ô giữa, 31 ngày sang ô cuối", () => {
    freezeVN("2026-09-19T03:00:00Z")
    const b = debtBuckets([
      { amount: 1_000_000, paid: 0, due_date: "2026-08-20" }, // quá hạn đúng 30
      { amount: 2_000_000, paid: 0, due_date: "2026-08-19" }, // quá hạn 31
    ])
    expect(b[1].amount).toBe(1_000_000)
    expect(b[2].amount).toBe(2_000_000)
  })

  it("khoản đã thu đủ không rơi vào ô nào", () => {
    freezeVN("2026-09-19T03:00:00Z")
    const b = debtBuckets([{ amount: 1_000_000, paid: 1_000_000, due_date: "2026-01-01" }])
    expect(b.every((x) => x.amount === 0)).toBe(true)
  })

  it("thu dư (còn lại âm) KHÔNG được trừ vào ô trong hạn", () => {
    freezeVN("2026-09-19T03:00:00Z")
    const b = debtBuckets([
      { amount: 1_000_000, paid: 3_000_000, due_date: "2026-10-01" },
      { amount: 5_000_000, paid: 0, due_date: "2026-10-01" },
    ])
    expect(b[0].amount).toBe(5_000_000)
  })

  it("không có hạn thanh toán thì tính là trong hạn, không phải quá hạn", () => {
    freezeVN("2026-09-19T03:00:00Z")
    const b = debtBuckets([{ amount: 2_000_000, paid: 0, due_date: null }])
    expect(b[0].amount).toBe(2_000_000)
    expect(b[1].amount + b[2].amount).toBe(0)
  })

  it("nhãn ô thứ ba nói 'trên 30', không mượn nhãn '31-60' của thang bốn bậc", () => {
    const labels = debtBuckets([]).map((b) => b.label)
    expect(labels[2]).toBe("Quá hạn trên 30 ngày")
    expect(labels.join(" ")).not.toContain("60")
  })
})

describe("frequentProducts", () => {
  it("đếm số ĐƠN, không đếm số dòng", () => {
    const out = frequentProducts([
      // Cùng một đơn, hai dòng cùng mặt hàng (khác đơn vị) → vẫn là 1 lần.
      { order_id: "o1", product_id: "p1", product_name: "Mì Hảo Hảo" },
      { order_id: "o1", product_id: "p1", product_name: "Mì Hảo Hảo" },
      { order_id: "o2", product_id: "p2", product_name: "Dầu Simply" },
      { order_id: "o3", product_id: "p2", product_name: "Dầu Simply" },
    ])
    expect(out.map((p) => [p.name, p.orders])).toEqual([
      ["Dầu Simply", 2],
      ["Mì Hảo Hảo", 1],
    ])
  })

  it("phần trăm tính theo mặt hàng đứng đầu", () => {
    const out = frequentProducts([
      { order_id: "o1", product_id: "p1", product_name: "A" },
      { order_id: "o2", product_id: "p1", product_name: "A" },
      { order_id: "o3", product_id: "p1", product_name: "A" },
      { order_id: "o1", product_id: "p2", product_name: "B" },
    ])
    expect(out[0].pct).toBe(100)
    expect(out[1].pct).toBe(33)
  })

  it("đồng hạng thì thứ tự ổn định theo tên", () => {
    const out = frequentProducts([
      { order_id: "o1", product_id: "p2", product_name: "Bánh" },
      { order_id: "o1", product_id: "p1", product_name: "Aji" },
    ])
    expect(out.map((p) => p.name)).toEqual(["Aji", "Bánh"])
  })

  it("cắt đúng số lượng yêu cầu", () => {
    const lines = ["p1", "p2", "p3", "p4"].map((p, i) => ({
      order_id: "o" + i,
      product_id: p,
      product_name: p,
    }))
    expect(frequentProducts(lines, 2)).toHaveLength(2)
  })
})

describe("revenueCompareText", () => {
  it("giảm thì có dấu trừ, tăng thì có dấu cộng", () => {
    expect(revenueCompareText(18_600_000, 21_200_000)).toBe("Tháng trước 21 tr · −12%")
    expect(revenueCompareText(24_000_000, 20_000_000)).toBe("Tháng trước 20 tr · +20%")
  })

  it("tháng trước bằng 0 thì KHÔNG in phần trăm", () => {
    const t = revenueCompareText(5_000_000, 0)
    expect(t).toBe("Tháng trước chưa có doanh thu")
    expect(t).not.toContain("%")
    expect(revenueCompareText(0, 0)).toBe("Chưa có doanh thu")
  })

  it("bằng nhau thì không có dấu", () => {
    expect(revenueCompareText(10_000_000, 10_000_000)).toBe("Tháng trước 10 tr · 0%")
  })
})

describe("customerTodos", () => {
  const ok = {
    photoCount: 3,
    maxPhotos: 3,
    taxCode: "0312345678",
    hasGps: true,
    overdueAmount: 0,
    assigneeCount: 1,
  }

  it("điểm bán đủ mọi thứ thì danh sách rỗng", () => {
    expect(customerTodos(ok)).toEqual([])
  })

  it("nợ quá hạn và chưa phân công đứng trước, và mang màu đỏ", () => {
    const todos = customerTodos({ ...ok, overdueAmount: 4_200_000, assigneeCount: 0, taxCode: null })
    expect(todos[0].key).toBe("overdue")
    expect(todos[0].tone).toBe("danger")
    expect(todos[1].key).toBe("no_assignee")
    expect(todos[todos.length - 1].key).toBe("tax_code")
  })

  it("thiếu ảnh nói rõ đang có mấy trên mấy", () => {
    expect(customerTodos({ ...ok, photoCount: 1 })[0].label).toBe("Mới có 1/3 ảnh điểm bán")
  })

  it("mã số thuế rỗng cũng là chưa có", () => {
    expect(customerTodos({ ...ok, taxCode: "" }).map((t) => t.key)).toContain("tax_code")
  })
})

describe("mergeActivity", () => {
  it("sắp giảm dần theo mốc thời gian thật, không theo thứ tự truyền vào", () => {
    const out = mergeActivity([
      { id: "a", kind: "order", label: "Đơn", at: "2026-09-10T02:00:00Z", who: null },
      { id: "b", kind: "visit", label: "Ghé", at: "2026-09-17T01:00:00Z", who: null },
      { id: "c", kind: "payment", label: "Thu", at: "2026-09-12T09:00:00Z", who: null },
    ])
    expect(out.map((i) => i.id)).toEqual(["b", "c", "a"])
  })

  it("bỏ mục không có mốc thời gian thay vì đẩy nó lên đầu", () => {
    const out = mergeActivity([
      { id: "x", kind: "order", label: "Đơn", at: "", who: null },
      { id: "y", kind: "visit", label: "Ghé", at: "2026-09-17T01:00:00Z", who: null },
    ])
    expect(out.map((i) => i.id)).toEqual(["y"])
  })

  it("cắt đúng số dòng yêu cầu", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      kind: "order" as const,
      label: "Đơn",
      at: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      who: null,
    }))
    expect(mergeActivity(items, 3).map((i) => i.id)).toEqual(["9", "8", "7"])
  })
})
