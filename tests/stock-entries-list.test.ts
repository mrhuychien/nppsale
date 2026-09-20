import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { STOCK_ENTRY_TYPES } from "../src/lib/constants"

/**
 * MÀN PHIẾU KHO — DẢI VIÊN THUỐC THEO LOẠI PHIẾU.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "Thống kê các loại phiếu ở đầu cho nhỏ gọn
 * như ở danh sách Đơn hàng (bấm được vào từng loại)".
 *
 * ⚠ BÀI HỌC ĐẮT CỦA KHO MÃ NÀY, LẶP LẠI LẦN THỨ BA. Màn đơn hàng từng
 * có SÁU trạng thái nhưng chỉ BỐN tab, nên đơn `partially_invoiced`
 * biến mất khỏi mọi tab — chủ nhà báo "đơn hoàn thành xong thấy biến
 * mất luôn". Màn phiếu kho vừa mắc đúng kiểu ấy ở dạng nhẹ hơn: bốn thẻ
 * số gõ tay đếm nhập / xuất / kiểm kê / nháp, và `transfer` không được
 * thẻ nào — phiếu chuyển kho không xuất hiện trong bất kỳ con số nào
 * trên màn.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const PAGE = strip(read("src/app/(dashboard)/inventory/entries/page.tsx"))
const SCHEMA = read("supabase/schema_full.sql")

describe("dải loại phiếu phủ hết tập giá trị thật của cột", () => {
  /**
   * ⚠ ĐỐI CHIẾU VỚI CHECK CONSTRAINT THẬT, không với trí nhớ. Đây là
   * chỗ duy nhất biết cột `stock_entries.type` nhận những gì.
   */
  it("STOCK_ENTRY_TYPES khớp CHECK constraint của stock_entries.type", () => {
    const m = /type text NOT NULL CHECK \(type IN \(([^)]+)\)\)/.exec(SCHEMA)
    expect(m, "không tìm thấy CHECK constraint của stock_entries.type").toBeTruthy()
    const fromSql = m![1].split(",").map((x) => x.trim().replace(/'/g, "")).sort()
    expect(fromSql).toEqual(STOCK_ENTRY_TYPES.map((t) => t.value).slice().sort())
  })

  /**
   * ⚠ DỰNG DẢI TỪ `STOCK_ENTRY_TYPES`, KHÔNG GÕ TAY TỪNG VIÊN. Gõ tay
   * là mở lại đúng cái khe đã làm mất phiếu `transfer`: thêm một loại
   * vào cột mà quên thêm một viên thì loại đó không hiện ở đâu cả.
   */
  it("dải viên thuốc dựng từ danh sách loại, không gõ tay", () => {
    expect(PAGE).toContain("STOCK_ENTRY_TYPES.map((t) => ({")
    for (const t of STOCK_ENTRY_TYPES) {
      expect(
        PAGE,
        `loại "${t.label}" đang được gõ tay vào màn — dựng từ STOCK_ENTRY_TYPES đi`
      ).not.toContain(`>${t.label}</p>`)
    }
  })

  /** ⚠ Không có viên "Tất cả" thì bấm vào một loại rồi không có đường về. */
  it("có viên Tất cả đứng đầu", () => {
    const i = PAGE.indexOf('key: "all"')
    const j = PAGE.indexOf("STOCK_ENTRY_TYPES.map((t) => ({")
    expect(i, "thiếu viên Tất cả").toBeGreaterThan(-1)
    expect(i, "viên Tất cả không đứng đầu dải").toBeLessThan(j)
  })

  /**
   * ⚠ DÙNG CHUNG `StatusChips` VỚI MÀN ĐƠN HÀNG. Dựng bản thứ hai là
   * chỗ để một bên được sửa còn bên kia thì không — và chủ nhà đã chỉ
   * đích danh màn đơn hàng làm mẫu.
   */
  it("dùng chung component của màn đơn hàng", () => {
    expect(PAGE).toContain('from "@/components/ui/status-chips"')
    expect(PAGE).toContain("<StatusChips")
    expect(PAGE, "dựng lại dải bằng thẻ số to như cũ").not.toContain("text-2xl font-black")
  })

  /**
   * ⚠ MỘT Ô NHỚ, KHÔNG PHẢI HAI. Dải viên thuốc và ô chọn "Tất cả loại"
   * phải điều khiển CÙNG một `typeFilter`; cho dải một ô nhớ riêng là
   * hai thứ trên cùng màn nói hai chuyện khác nhau về cùng một bộ lọc.
   */
  it("dải và ô chọn loại dùng chung một ô nhớ", () => {
    expect(PAGE).toContain("active={typeFilter} onPick={setTypeFilter}")
  })

  /**
   * ⚠ DẢI LUÔN HIỆN THÌ PHẢI LUÔN LỌC. Gác phép lọc theo loại sau ô
   * bật/tắt của `FilterPicker` là người dùng tắt bộ lọc "Loại" đi rồi
   * bấm một viên và KHÔNG có gì xảy ra, không lời giải thích nào.
   */
  it("bấm viên thuốc luôn lọc, kể cả khi đã tắt bộ lọc Loại", () => {
    expect(PAGE).toContain('if (typeFilter !== "all" && e.type !== typeFilter) return false')
    expect(PAGE, "phép lọc theo loại vẫn bị gác sau FilterPicker")
      .not.toContain('filterActive("type") && typeFilter !== "all"')
  })
})

describe("nút Tạo phiếu ở màn Phiếu kho", () => {
  /** ⚠ Chủ nhà chốt: "Nút tạo phiếu ở màn Phiếu kho thêm phần Phiếu xuất kho". */
  it("có đủ nhập kho, xuất kho, kiểm kê", () => {
    expect(PAGE).toContain('router.push("/inventory/stock-in")')
    expect(PAGE).toContain('router.push("/inventory/stock-issue")')
    expect(PAGE).toContain('router.push("/inventory/stocktake-adjust")')
  })

  /**
   * ⚠ KHÔNG DẪN VỀ MÀN SOẠN HÀNG CŨ. `/inventory/stock-out` đã khoá ghi
   * ở P7 — bấm vào chỉ nhận một dòng từ chối, ở một màn không ai giải
   * thích vì sao lại mở ra được.
   */
  it("không dẫn về màn soạn hàng đã khoá ghi", () => {
    expect(PAGE).not.toContain('router.push("/inventory/stock-out")')
  })
})
