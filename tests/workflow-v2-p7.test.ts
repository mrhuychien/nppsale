import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  canSeeHref,
  canEnterHref,
  LEGACY_V2_HREFS,
  NAV_PERMISSION,
} from "../src/lib/nav/nav-permission"
import { LEGACY_FLOW_WRITES_LOCKED, LEGACY_LOCK_HINT } from "../src/lib/nav/legacy-flow"

/**
 * P7 — ẩn module luồng cũ, KHÔNG xoá mã.
 *
 * Ba việc khác nhau, phải không lẫn vào nhau:
 *   1. ẨN khỏi menu — `canSeeHref`;
 *   2. vẫn VÀO XEM được chứng từ cũ — `canEnterHref`;
 *   3. KHOÁ các nút GHI — `LEGACY_FLOW_WRITES_LOCKED`.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const STOCK_OUT = read("src/app/(dashboard)/inventory/stock-out/page.tsx")
const ENTRIES = read("src/app/(dashboard)/inventory/entries/[id]/page.tsx")
const COLLECT = read("src/app/(dashboard)/inventory/stock-out/collect/[entryId]/page.tsx")
const HANDOVER = read("src/app/(dashboard)/deliveries/[id]/handover/page.tsx")
const PENDING = read("src/app/(dashboard)/inventory/pending/page.tsx")
const HUB = read("src/app/(dashboard)/inventory/page.tsx")

/**
 * Cắt đúng THÂN của khối `if (…) { … }` bắt đầu tại `from`, bằng cách đếm
 * ngoặc.
 *
 * ⚠ ĐỪNG THAY BẰNG `slice(from, from + N).toContain("return")`. Đã thử:
 * chốt vẫn xanh sau khi bỏ hẳn `return` khỏi guard, vì trong cửa sổ đó
 * còn một `return` khác của hàm (`if (!user?.org_id) return`). Chốt hỏi
 * "có chữ return quanh đây không" là chốt không hỏi gì cả.
 */
function braceBlock(src: string, from: number): string {
  const open = src.indexOf("{", from)
  if (open < 0) return ""
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1)
  }
  return ""
}

describe("Ẩn khỏi menu, nhưng vẫn mở được chứng từ cũ", () => {
  it("ba màn luồng cũ nằm trong danh sách ẩn", () => {
    for (const h of ["/deliveries", "/inventory/stock-out", "/inventory/pending"]) {
      expect(LEGACY_V2_HREFS.has(h), `${h} chưa được ẩn`).toBe(true)
    }
  })

  /**
   * ⚠ GÀI BẰNG QUYỀN LÀ KHÔNG GIẤU ĐƯỢC. `canAccessFeature` trả true vô
   * điều kiện cho `owner`, mà chủ nhà đúng là người dùng chính của những
   * màn này — nên phải là một danh sách riêng, xét TRƯỚC mọi phép kiểm.
   */
  it("ẩn với MỌI vai trò, kể cả chủ", () => {
    for (const role of ["owner", "manager", "warehouse", "driver", "accountant"] as const) {
      expect(canSeeHref(role, "/deliveries"), `${role} vẫn thấy`).toBe(false)
    }
  })

  /**
   * ⚠ ẨN ≠ CHẶN. Dữ liệu luồng cũ là CHỨNG TỪ. Chặn luôn cửa vào là xoá
   * lịch sử khỏi tầm với, mà ta chỉ định thôi dùng chứ không định vứt.
   */
  it("vẫn vào xem được, không bị đá về trang chủ", () => {
    expect(NAV_PERMISSION["/deliveries"]).toBeTruthy()
    expect(canEnterHref("owner", "/deliveries")).toBe(true)
    expect(canEnterHref("driver", "/deliveries")).toBe(true)
  })

  /** Ẩn khỏi menu mà để lại ô trên màn kho thì vẫn bấm tới được. */
  it("màn kho không còn ô bấm sang hai màn đã ẩn", () => {
    expect(HUB).toContain('LEGACY_V2_HREFS.has("/inventory/stock-out")')
    expect(HUB).toContain('LEGACY_V2_HREFS.has("/inventory/pending")')
  })
})

describe("Khoá nút GHI của luồng cũ", () => {
  /**
   * ⚠ ĐỂ NGUYÊN THÌ TỆ HƠN LÀ BÁO LỖI. Ba màn này ghi theo NHIỀU BƯỚC
   * rời nhau và bước đổi trạng thái đơn nằm ở CUỐI — mà migration 119 nay
   * từ chối trạng thái đó. Người dùng không nhận được "bấm vào thì báo
   * lỗi", họ nhận được GHI DỞ: kho đã trừ hoặc tiền đã ghi, đơn thì
   * không đổi, không giao dịch nào cuộn lại.
   */
  it("năm hàm ghi đều chặn ở ĐẦU, trước khi ghi gì", () => {
    const CASES: Array<[string, string, string]> = [
      ["soạn hàng", STOCK_OUT, "const handleMerge = async () => {"],
      ["phiếu kho", ENTRIES, "const handleSelfDeliver = async () => {"],
      ["thu theo phiếu xuất", COLLECT, "const handleSubmit = async () => {"],
      ["bàn giao", HANDOVER, "const handleSubmit = async () => {"],
      ["hàng chờ", PENDING, "const handleRestock = async () => {"],
    ]
    for (const [name, src, anchor] of CASES) {
      const i = src.indexOf(anchor)
      expect(i, `không tìm thấy hàm ghi của ${name}`).toBeGreaterThan(0)
      const head = src.slice(i, i + 1400)
      expect(head, `${name}: chưa chặn`).toContain("if (LEGACY_FLOW_WRITES_LOCKED) {")
      const guardAt = head.indexOf("if (LEGACY_FLOW_WRITES_LOCKED)")
      // ⚠ Phải `return` — cảnh báo rồi chạy tiếp thì vẫn ghi dở. Và phải
      //   là lệnh CUỐI của guard, không phải một chữ `return` nào đó ở
      //   gần đấy.
      expect(braceBlock(head, guardAt), `${name}: cảnh báo nhưng không dừng`).toMatch(
        /\breturn\b\s*\}$/
      )
      // Và phải nằm TRƯỚC mọi lệnh ghi của hàm.
      const writeAt = head.search(/\.(insert|update|delete)\(/)
      if (writeAt >= 0) {
        expect(guardAt, `${name}: chặn nằm SAU lệnh ghi`).toBeLessThan(writeAt)
      }
    }
  })

  it("khoá đang bật, và mỗi màn có câu chỉ đường thay thế", () => {
    expect(LEGACY_FLOW_WRITES_LOCKED).toBe(true)
    for (const k of ["stock-out", "entries", "collect", "handover", "pending"]) {
      expect(LEGACY_LOCK_HINT[k], `thiếu câu chỉ đường cho ${k}`).toBeTruthy()
      // ⚠ Nói THAY BẰNG GÌ, không chỉ nói "không dùng được nữa" — người
      // dùng đang có việc cần làm.
      expect(LEGACY_LOCK_HINT[k].length).toBeGreaterThan(40)
    }
  })

  /**
   * ⚠ HAI MÀN NÀY LÀ CHỖ GIAO DIỆN LÀ LỚP CHẶN DUY NHẤT. Bảng `returns`
   * không có trigger chặn chuyển trạng thái, và mig 120 đã gỡ trigger
   * nhập kho tự động — nên lệnh đẩy phiếu trả vào 'completed' VẪN CHẠY
   * THÀNH CÔNG mà hàng không vào kho. Cơ sở dữ liệu không cãi.
   */
  it("hai màn ghi thẳng phiếu trả nói rõ vì sao giao diện phải chặn", () => {
    for (const src of [HANDOVER, PENDING]) {
      expect(src).toContain("GIAO DIỆN LÀ LỚP CHẶN DUY")
    }
  })
})
