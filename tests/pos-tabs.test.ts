import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import {
  openTab, closeTab, nextNewLabel, posHref, POS_TAB_MAX, POS_DOT,
  type PosTab,
} from "../src/lib/pos/tabs"

/**
 * TAB CHỨNG TỪ — spec chốt 21/09/2026 §3.
 *
 * ⚠ TAB THAY CƠ CHẾ MỘT GIỎ TOÀN CỤC, và câu chốt quan trọng nhất của
 * cả mục là: "Xoá màn hỏi Thay giỏ / Giữ giỏ".
 */

const tab = (o: Partial<PosTab> & Pick<PosTab, "key" | "docType">): PosTab => ({
  docId: null,
  label: o.key,
  dirty: false,
  count: 0,
  ...o,
})

describe("mở chứng từ vào bộ tab", () => {
  /**
   * ⚠ ĐÂY LÀ LUẬT CHÍNH. Hai tab cho cùng một tờ chứng từ là hai bản
   * nháp khác nhau của cùng một tờ: người dùng sửa ở tab này, lưu ở
   * tab kia, và phần sửa biến mất mà không có lỗi nào.
   */
  it("mở chứng từ đã có tab thì nhảy về tab đó, không mở thêm", () => {
    const tabs = [
      tab({ key: "t1", docType: "RET", docId: "r9", label: "PT-0031" }),
      tab({ key: "t2", docType: "SO", docId: "o1", label: "DH-0154" }),
    ]
    const r = openTab(tabs, { docType: "SO", docId: "o1", label: "DH-0154" }, "t3")
    expect(r.tabs, "số tab không được tăng").toHaveLength(2)
    expect(r.activeKey).toBe("t2")
    expect(r.notice).toContain("DH-0154")
    expect(r.notice, "phải nói tab số mấy").toContain("tab 2")
    expect(r.notice, "phải trấn an là nháp còn nguyên").toContain("giữ nguyên")
  })

  /**
   * ⚠ KHOÁ SO TRÙNG LÀ `docType + docId`, KHÔNG PHẢI `docId` TRẦN. Mã
   * đơn và mã hóa đơn là hai dãy khoá riêng; so bằng mỗi `docId` là
   * một hôm nào đó mở hóa đơn lại nhảy về tab đơn hàng.
   */
  it("cùng mã nhưng khác loại chứng từ thì vẫn là hai tab", () => {
    const tabs = [tab({ key: "t1", docType: "SO", docId: "x", label: "DH-0154" })]
    const r = openTab(tabs, { docType: "INV", docId: "x", label: "HD-0143" }, "t2")
    expect(r.tabs).toHaveLength(2)
    expect(r.notice).toBeNull()
  })

  /**
   * ⚠ CHỨNG TỪ MỚI KHÔNG BAO GIỜ TRÙNG NHAU. Hai đơn mới là hai đơn
   * cho hai khách khác nhau — gộp lại là mất một đơn.
   */
  it("hai chứng từ mới không gộp vào nhau", () => {
    const tabs = [tab({ key: "t1", docType: "SO", docId: null, label: "Đơn mới 1" })]
    const r = openTab(tabs, { docType: "SO", docId: null, label: "Đơn mới 2" }, "t2")
    expect(r.tabs).toHaveLength(2)
    expect(r.activeKey).toBe("t2")
  })

  /** ⚠ Trần 8 tab — và KHÔNG tự đóng tab nào để lấy chỗ. */
  it("chạm trần thì từ chối và nói ra, không đóng giúp tab nào", () => {
    const tabs = Array.from({ length: POS_TAB_MAX }, (_, i) =>
      tab({ key: `t${i}`, docType: "SO", docId: `o${i}`, label: `DH-${i}` })
    )
    const r = openTab(tabs, { docType: "SO", docId: "moi", label: "DH-9" }, "tx")
    expect(r.refused).toBe(true)
    expect(r.tabs, "đã tự đóng tab của người ta").toHaveLength(POS_TAB_MAX)
    expect(r.notice).toContain("Đóng bớt tab")
  })

  /**
   * ⚠ CHẠM TRẦN VẪN PHẢI NHẢY VỀ TAB CŨ NẾU CHỨNG TỪ ĐÓ ĐANG MỞ. Phép
   * so trùng phải chạy TRƯỚC phép kiểm trần, nếu không thì đủ 8 tab là
   * không mở lại được chính tờ đang nằm trong tab thứ ba.
   */
  it("đủ 8 tab vẫn mở lại được chứng từ đang có tab", () => {
    const tabs = Array.from({ length: POS_TAB_MAX }, (_, i) =>
      tab({ key: `t${i}`, docType: "SO", docId: `o${i}`, label: `DH-${i}` })
    )
    const r = openTab(tabs, { docType: "SO", docId: "o3", label: "DH-3" }, "tx")
    expect(r.refused).toBe(false)
    expect(r.activeKey).toBe("t3")
  })
})

describe("đóng tab", () => {
  const tabs = [
    tab({ key: "a", docType: "SO" }),
    tab({ key: "b", docType: "SO" }),
    tab({ key: "c", docType: "SO" }),
  ]

  /** ⚠ Nhảy về đầu danh sách là ném người dùng đi xa chỗ đang làm. */
  it("đóng tab đang đứng thì sang tab bên trái", () => {
    const r = closeTab(tabs, "b", "b")
    expect(r.tabs.map((t) => t.key)).toEqual(["a", "c"])
    expect(r.activeKey).toBe("a")
  })

  it("đóng tab khác thì không đổi tab đang đứng", () => {
    const r = closeTab(tabs, "a", "c")
    expect(r.activeKey).toBe("c")
  })

  it("đóng tab đầu tiên thì sang tab còn lại", () => {
    const r = closeTab(tabs, "a", "a")
    expect(r.activeKey).toBe("b")
  })

  it("đóng tab cuối cùng thì không còn tab nào", () => {
    const r = closeTab([tab({ key: "a", docType: "SO" })], "a", "a")
    expect(r.tabs).toHaveLength(0)
    expect(r.activeKey).toBe("")
  })
})

describe("tên mặc định của chứng từ mới", () => {
  /**
   * ⚠ ĐÁNH SỐ THEO SỐ TAB MỚI CÙNG LOẠI. Đánh theo tổng số tab thì ba
   * đơn mới cạnh một hóa đơn hiện thành "Đơn mới 4".
   */
  it("đếm theo loại, không đếm cả bộ tab", () => {
    const tabs = [
      tab({ key: "a", docType: "INV", docId: "i1" }),
      tab({ key: "b", docType: "SO", docId: null }),
    ]
    expect(nextNewLabel(tabs, "SO")).toBe("Đơn mới 2")
  })

  /** ⚠ Chứng từ ĐÃ LƯU không tính vào số "mới". */
  it("chứng từ đã lưu không tính", () => {
    const tabs = [tab({ key: "a", docType: "SO", docId: "o1", label: "DH-0154" })]
    expect(nextNewLabel(tabs, "SO")).toBe("Đơn mới 1")
  })
})

describe("đường dẫn và màu tab", () => {
  it("mỗi loại chứng từ một tuyến đường", () => {
    expect(posHref({ docType: "SO", docId: "x" })).toBe("/pos/don-hang/x")
    expect(posHref({ docType: "INV", docId: "x" })).toBe("/pos/hoa-don/x")
    expect(posHref({ docType: "RET", docId: "x" })).toBe("/pos/tra-hang/x")
    expect(posHref({ docType: "PUR", docId: "x" })).toBe("/pos/nhap-hang/x")
    expect(posHref({ docType: "PRET", docId: "x" })).toBe("/pos/tra-ncc/x")
  })

  /** ⚠ Chứng từ mới đi vào `/moi`, không đi vào `/null`. */
  it("chứng từ mới có đường dẫn riêng", () => {
    expect(posHref({ docType: "SO", docId: null })).toBe("/pos/don-hang/moi")
  })

  /** ⚠ Spec §3 mục 5 chốt đúng 5 màu này. */
  it("màu chấm đúng spec", () => {
    expect(POS_DOT).toEqual({
      SO: "#2563eb", INV: "#22c55e", RET: "#f59e0b", PUR: "#2563eb", PRET: "#f59e0b",
    })
  })
})

/**
 * ⚠ "XOÁ MÀN HỎI THAY GIỎ / GIỮ GIỎ" — spec §3 và §12 đều chốt riêng
 * một dòng cho việc này. Tab sinh ra để thay nó; để nó nằm lại là có
 * hai cơ chế cùng tranh nhau một việc.
 */
describe("không còn chỗ nào hỏi Thay giỏ / Giữ giỏ", () => {
  const ROOT = resolve(__dirname, "..")
  const files: string[] = []
  const quet = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = resolve(d, e)
      if (statSync(p).isDirectory()) quet(p)
      else if (/\.tsx?$/.test(e)) files.push(p)
    }
  }
  quet(resolve(ROOT, "src"))

  it("quét được cả cây nguồn", () => {
    // ⚠ Chốt mù là chốt nói dối — 0 tệp thì mọi phép kiểm dưới đều xanh.
    expect(files.length).toBeGreaterThan(100)
  })

  /**
   * ⚠ BỎ CHÚ THÍCH TRƯỚC KHI QUÉT. Chính tệp `tabs.ts` TRÍCH câu spec
   * ấy trong phần giải thích vì sao tab tồn tại — chốt đọc cả chú
   * thích thì nó bắt chính lời văn của mình, đỏ vì một lý do không
   * liên quan gì tới giao diện. Đây là cái bẫy đã sập ở chốt "miếng
   * vá mig 128"; lần này bỏ chú thích ngay từ đầu.
   */
  const code = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

  it("/pos không có màn hỏi thay giỏ", () => {
    const pham = files
      .filter((f) => f.includes("/pos/") || f.includes("/pos."))
      .filter((f) => /Thay giỏ|Giữ giỏ/.test(code(readFileSync(f, "utf-8"))))
    expect(pham.map((f) => f.slice(ROOT.length))).toEqual([])
  })
})
