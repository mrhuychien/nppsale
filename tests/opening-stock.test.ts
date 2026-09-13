import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  vnToday,
  postedAtFor,
  seedUnitCost,
  resolveUnitCost,
  linesMissingCost,
} from "../src/lib/inventory/opening-stock"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const PAGE = read("src/app/(dashboard)/inventory/stock-in/page.tsx")

/** Ngày theo lịch Việt Nam của một mốc ISO — để khẳng định "rơi đúng ngày". */
const vnDateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })

describe("Ngày ghi sổ của phiếu nhập", () => {
  /**
   * ⚠ Lỗi gốc: ô "Ngày nhập" chỉ đi vào mã phiếu, còn `posted_at` luôn là
   * `now()`. Phiếu tồn ĐẦU KỲ ghi 31/12/2025 vẫn nằm ở ngày bấm nút — mà
   * thẻ kho, báo cáo nhập xuất tồn và giá vốn hàng bán đều gom theo
   * `posted_at`. Toàn bộ tồn đầu kỳ rơi nhầm vào kỳ hiện tại.
   */
  it("phiếu ghi lùi ngày rơi ĐÚNG ngày người dùng chọn", () => {
    const now = new Date("2026-09-13T10:00:00+07:00")
    const iso = postedAtFor("2025-12-31", now)
    expect(vnDateOf(iso)).toBe("2025-12-31")
  })

  /**
   * ⚠ Vì sao 12:00 chứ không phải 00:00Z: 00:00Z là 07:00 sáng giờ Việt —
   * đúng ngày, nhưng chỉ cần một chỗ khác quy đổi lệch là trượt sang ngày
   * trước. Giữa trưa thì cách cả hai biên 12 tiếng.
   */
  it("không nằm sát biên ngày — cách mỗi đầu ít nhất 6 tiếng", () => {
    const now = new Date("2026-09-13T10:00:00+07:00")
    const t = new Date(postedAtFor("2025-12-31", now))
    const vnHour = Number(
      t.toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", hour12: false })
    )
    expect(vnHour).toBeGreaterThanOrEqual(6)
    expect(vnHour).toBeLessThanOrEqual(18)
  })

  /** Phiếu của hôm nay giữ giờ thật, để nhiều phiếu trong ngày đúng thứ tự. */
  it("phiếu của hôm nay dùng đúng thời điểm bấm nút", () => {
    const now = new Date("2026-09-13T16:45:00+07:00")
    expect(postedAtFor(vnToday(now), now)).toBe(now.toISOString())
  })

  /** Hai phiếu cùng ngày hôm nay phải xếp được trước/sau nhau. */
  it("hai phiếu trong cùng hôm nay không trùng mốc", () => {
    const a = new Date("2026-09-13T09:00:00+07:00")
    const b = new Date("2026-09-13T15:00:00+07:00")
    expect(postedAtFor(vnToday(a), a)).not.toBe(postedAtFor(vnToday(b), b))
  })

  /**
   * ⚠ Ô ngày trống hoặc gõ bậy thì thà ghi hôm nay, KHÔNG được ném lỗi —
   * người dùng vừa gõ xong 200 dòng, mất phiếu là mất cả buổi.
   */
  it("ngày không đọc được thì lùi về hôm nay, không nổ", () => {
    const now = new Date("2026-09-13T10:00:00+07:00")
    for (const bad of ["", "  ", "31/12/2025", "2025-13-45", null, undefined]) {
      expect(postedAtFor(bad, now)).toBe(now.toISOString())
    }
  })

  /**
   * ⚠ `new Date().toISOString().slice(0,10)` là ngày UTC. Từ 0h đến 7h
   * sáng giờ Việt Nam nó trả về NGÀY HÔM QUA — ô "Ngày nhập" mặc định sai
   * đúng vào ca nhập hàng sớm.
   */
  it("hôm nay tính theo lịch Việt Nam, không theo UTC", () => {
    // 02:00 sáng 14/09 giờ Việt = 19:00 ngày 13/09 UTC.
    const now = new Date("2026-09-14T02:00:00+07:00")
    expect(now.toISOString().slice(0, 10)).toBe("2026-09-13") // cái sai cũ
    expect(vnToday(now)).toBe("2026-09-14")
  })
})

describe("Giá vốn đầu kỳ", () => {
  /**
   * ⚠ Lỗi gốc: ô "Giá vốn" được mồi bằng GIÁ BÁN, và lúc lưu ô trống cũng
   * lùi về giá bán. Giá vốn = giá bán nghĩa là lãi gộp bằng 0, nhưng
   * không có cảnh báo nào — con số vẫn trông như số thật.
   */
  it("không lấy giá bán làm giá vốn", () => {
    expect(seedUnitCost(0, 1)).toBe("")
    expect(seedUnitCost(null, 1)).toBe("")
    expect(seedUnitCost(undefined, 12)).toBe("")
  })

  it("mồi từ giá vốn của sản phẩm khi có", () => {
    expect(seedUnitCost(12000, 1)).toBe("12000")
  })

  /**
   * ⚠ `products.cost_price` tính theo ĐƠN VỊ CƠ BẢN, ô nhập theo đơn vị
   * của dòng. Lúc lưu, mã nguồn CHIA lại cho hệ số quy đổi — nên nếu mồi
   * thẳng giá theo hộp vào dòng đang tính theo thùng thì giá vốn ghi
   * xuống nhỏ đi đúng bằng hệ số đó.
   */
  it("nhân hệ số quy đổi, để lúc lưu chia lại ra đúng số cũ", () => {
    const conv = 24
    const seeded = seedUnitCost(12000, conv)
    expect(seeded).toBe("288000")
    // Đúng phép mà màn nhập kho làm lúc lưu: baseCost = txCost / conv.
    expect(resolveUnitCost(seeded).cost / conv).toBe(12000)
  })

  it("hệ số quy đổi vô nghĩa thì giữ nguyên giá gốc, không nhân bừa", () => {
    for (const bad of [0, -1, NaN]) {
      expect(seedUnitCost(12000, bad)).toBe("12000")
    }
  })

  /**
   * Giá vốn 0 = CHƯA BIẾT, không phải "hàng không có giá trị" — migration
   * 098 đã chốt cách hiểu đó. Ghi 0 là ghi đúng sự thật; cái không được
   * làm là lặng lẽ điền giá bán vào.
   */
  it("trống hoặc 0 đều là chưa biết, và nói ra là chưa biết", () => {
    expect(resolveUnitCost("")).toEqual({ cost: 0, known: false })
    expect(resolveUnitCost("0")).toEqual({ cost: 0, known: false })
    expect(resolveUnitCost(null)).toEqual({ cost: 0, known: false })
    expect(resolveUnitCost("abc")).toEqual({ cost: 0, known: false })
    expect(resolveUnitCost("-5")).toEqual({ cost: 0, known: false })
    expect(resolveUnitCost("12000")).toEqual({ cost: 12000, known: true })
  })

  /** Cảnh báo phải chỉ đúng số dòng người dùng nhìn thấy trên màn hình. */
  it("chỉ ra đúng số thứ tự dòng thiếu giá vốn", () => {
    const l = (product_id: string, quantity: string, unit_cost: string) => ({
      product_id,
      quantity,
      unit_cost,
    })
    expect(
      linesMissingCost([
        l("p1", "10", "12000"), // #1 đủ
        l("p2", "5", ""), // #2 thiếu
        l("", "", ""), // #3 dòng trống — không tính
        l("p3", "2", "0"), // #4 thiếu
      ])
    ).toEqual([2, 4])
  })

  /** Dòng số lượng 0 không được lưu, nên cũng không đáng cảnh báo. */
  it("bỏ qua dòng không có hàng", () => {
    expect(linesMissingCost([{ product_id: "p1", quantity: "0", unit_cost: "" }])).toEqual([])
  })
})

describe("Màn nhập kho có dùng đúng các hàm trên", () => {
  /**
   * ⚠ Hàm đúng mà màn hình không gọi thì vẫn sai y như cũ. Bộ test thuần
   * ở trên không bắt được chuyện đó, nên phải soi thẳng mã nguồn màn hình.
   */
  it("posted_at lấy từ ngày người dùng chọn, không phải now()", () => {
    expect(PAGE).toContain("postedAtFor(entryDate")
    expect(PAGE).not.toContain("posted_at: new Date().toISOString()")
  })

  it("không còn lùi về giá bán khi thiếu giá vốn", () => {
    expect(PAGE).not.toMatch(/parseFloat\(l\.unit_cost\)\s*\|\|\s*parseFloat\(l\.unit_price\)/)
    expect(PAGE).toContain("resolveUnitCost(")
  })

  /** Mồi giá vốn thì phải đọc cột giá vốn của sản phẩm về đã. */
  it("có lấy cost_price của sản phẩm về", () => {
    expect(PAGE).toContain("cost_price")
    expect(PAGE).toContain("seedUnitCost(")
  })

  /** Ngày mặc định theo lịch Việt Nam, không phải ngày UTC. */
  it("ngày mặc định dùng lịch Việt Nam", () => {
    expect(PAGE).toContain("vnToday(")
  })

  /** Thiếu giá vốn thì phải NÓI RA, không lặng lẽ ghi 0. */
  it("cảnh báo dòng thiếu giá vốn", () => {
    expect(PAGE).toContain("linesMissingCost(")
  })
})
