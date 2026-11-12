/**
 * TÁC VỤ ĐƠN Ở POS — chủ nhà 04/11/2026: "sau khi hoàn thành 1 đơn thì tự đóng pos, cần thì mở lại sau"; 05/11/2026 (chốt
 * sau khi trao đổi ưu / nhược điểm): "In xong đóng luôn". Luật: src/lib/pos/tac-vu-don.ts; nối dây: src/store/pos/tabs.tsx
 * (`ketThuc`); bấm thật: e2e/pos-tac-vu-don.spec.ts.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  CHO_DONG_MS, HAN_LOI_BAO_MS, KHOA_XONG_POS, docLoiBao, dongCuaSo, dongGi, goiLoiBao, ketThucTacVu,
} from "../src/lib/pos/tac-vu-don"
import { inTaiCho, KHUNG_IN_ID } from "../src/lib/pos/print-window"
import { IN_XONG } from "../src/hooks/use-leave-after-print"
import { POS_SETTINGS_DEFAULT } from "../src/store/pos/settings"
import type { PosTab } from "../src/lib/pos/tabs"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const tab = (key: string, docType: PosTab["docType"], docId: string | null): PosTab =>
  ({ key, docType, docId, label: key, dirty: false, count: 0 })

describe("ketThucTacVu — xong việc thì in (loại có mẫu in) rồi đóng", () => {
  it("bật: hoá đơn / phiếu trả in trước rồi đóng; phiếu nhập / trả NCC chưa có mẫu in thì đóng ngay", () => {
    expect(ketThucTacVu(true, { docType: "INV", docId: "i1" })).toEqual({ dong: true, trangIn: "/in/hoa-don/i1" })
    expect(ketThucTacVu(true, { docType: "RET", docId: "r1" })).toEqual({ dong: true, trangIn: "/in/tra-hang/r1" })
    expect(ketThucTacVu(true, { docType: "PUR", docId: "p1" })).toEqual({ dong: true, trangIn: null })
    expect(ketThucTacVu(true, { docType: "PRET", docId: "n1" })).toEqual({ dong: true, trangIn: null })
  })
  /* Chủ nhà 09/11/2026: "Sửa để khi đặt đơn hàng k hiện ra màn in đơn đặt hàng nữa". */
  it("đặt đơn (gửi đơn / lưu đơn đã gửi): KHÔNG in phiếu đặt — đóng POS ngay; nút In ở màn đơn vẫn in", () => {
    expect(ketThucTacVu(true, { docType: "SO", docId: "o1" })).toEqual({ dong: true, trangIn: null })
    expect(ketThucTacVu(false, { docType: "SO", docId: "o1" })).toEqual({ dong: false })
    const man = read("src/components/pos/order-screen.tsx")
    expect(man).toContain("onClick={() => { if (orderId) inTaiCho(`/in/don-hang/${orderId}`) }}")
  })
  it("tắt công tắc, hoặc có cảnh báo phải đọc (xuất thiếu, chưa gán người phụ trách) → ở lại như cũ", () => {
    expect(ketThucTacVu(false, { docType: "INV", docId: "i1" })).toEqual({ dong: false })
    expect(ketThucTacVu(true, { docType: "INV", docId: "i1", coCanhBao: true })).toEqual({ dong: false })
  })
  it("công tắc mặc định BẬT (chủ nhà chốt 05/11/2026); bản lưu cũ không có khoá thì trộn ra bật", () => {
    expect(POS_SETTINGS_DEFAULT.tacVuDon).toBe(true)
    expect({ ...POS_SETTINGS_DEFAULT, ...JSON.parse('{"colSku":false}') }.tacVuDon).toBe(true)
  })
})

describe("dongGi — đóng cả cửa sổ hay chỉ tab con", () => {
  it("chứng từ xong là tab duy nhất → đóng cửa sổ", () => {
    expect(dongGi([tab("a", "INV", "i1")], { docType: "INV", docId: "i1" }, "a")).toEqual({ loai: "cua-so", key: "a" })
  })
  it("cửa sổ còn tab con khác → chỉ đóng tab con vừa xong", () => {
    const t = [tab("a", "SO", null), tab("b", "INV", "i1")]
    expect(dongGi(t, { docType: "INV", docId: "i1" }, "b")).toEqual({ loai: "tab", key: "b" })
  })
  it("tìm theo chứng từ trước, theo tab đang đứng sau (URL đã replace sang mã thật hay chưa đều đúng)", () => {
    const t = [tab("a", "SO", "o9"), tab("b", "INV", null)]
    expect(dongGi(t, { docType: "INV", docId: "i1" }, "b")).toEqual({ loai: "tab", key: "b" })
    expect(dongGi([], { docType: "INV", docId: "i1" }, "")).toEqual({ loai: "cua-so", key: null })
  })
})

describe("dongCuaSo — đóng được mới báo tab danh sách; trình duyệt chặn thì chạy đường lùi", () => {
  const hen = () => {
    const viec: Array<{ fn: () => void; ms: number }> = []
    return { viec, hen: (fn: () => void, ms: number) => viec.push({ fn, ms }) }
  }
  it("đóng được (Chromium: `closed` thành true NGAY trong lượt gọi): ghi lời báo, không đường lùi, không hẹn giờ", () => {
    const h = hen()
    const win = { closed: false, close() { this.closed = true } }
    const khiDong = vi.fn()
    const duongLui = vi.fn()
    dongCuaSo(win, { khiDong, duongLui }, h.hen)
    expect(khiDong).toHaveBeenCalledTimes(1)
    expect(duongLui).not.toHaveBeenCalled()
    expect(h.viec).toEqual([])
  })
  it("tab mở bằng tay (close bị lờ đi, closed vẫn false): KHÔNG báo 'đã tự đóng'; hết giờ chạy đường lùi", () => {
    const h = hen()
    const win = { closed: false, close: vi.fn() }
    const khiDong = vi.fn()
    const duongLui = vi.fn()
    dongCuaSo(win, { khiDong, duongLui }, h.hen)
    expect(win.close).toHaveBeenCalledTimes(1)
    expect(khiDong).not.toHaveBeenCalled()
    expect(h.viec[0].ms).toBe(CHO_DONG_MS)
    h.viec[0].fn()
    expect(duongLui).toHaveBeenCalledTimes(1)
  })
  it("trình duyệt đóng trễ (lúc gọi chưa, lúc hết giờ đã đóng): không chạy đường lùi", () => {
    const h = hen()
    const win = { closed: false, close: vi.fn() }
    const duongLui = vi.fn()
    dongCuaSo(win, { duongLui }, h.hen)
    win.closed = true
    h.viec[0].fn()
    expect(duongLui).not.toHaveBeenCalled()
  })
})

describe("lời báo gửi tab danh sách", () => {
  it("đọc lại đúng câu + đã in hay chưa; quá hạn / hỏng / rỗng thì bỏ", () => {
    const now = 1_000_000
    expect(docLoiBao(goiLoiBao("Đã xuất hóa đơn HD-0123", true, now), now + 500)).toEqual({ text: "Đã xuất hóa đơn HD-0123", daIn: true })
    expect(docLoiBao(goiLoiBao("Đã ghi nhận phiếu trả NCC", false, now), now)).toEqual({ text: "Đã ghi nhận phiếu trả NCC", daIn: false })
    expect(docLoiBao(goiLoiBao("cũ", true, now), now + HAN_LOI_BAO_MS + 1)).toBeNull()
    expect(docLoiBao("{hỏng", now)).toBeNull()
    expect(docLoiBao(JSON.stringify({ text: "", at: now }), now)).toBeNull()
    expect(docLoiBao(null, now)).toBeNull()
    expect(KHOA_XONG_POS).toBe("npp.pos.xong")
  })
})

describe("inTaiCho — việc chạy SAU khi hộp in đóng", () => {
  /* Không có jsdom — dựng đủ phần DOM mà `inTaiCho` chạm tới (như tests/pos-tra-hang-luu.test.ts). */
  const dom = () => {
    const nghe: Array<(e: MessageEvent) => void> = []
    const f = { id: "", title: "", src: "", style: { cssText: "" }, contentWindow: {} as Window, setAttribute: vi.fn(), remove: vi.fn() }
    const doc = {
      getElementById: vi.fn((id: string) => (id === KHUNG_IN_ID ? null : null)),
      createElement: vi.fn(() => f),
      body: { appendChild: vi.fn() },
      defaultView: { addEventListener: (_: string, h: (e: MessageEvent) => void) => nghe.push(h), removeEventListener: vi.fn() },
    }
    return { doc: doc as unknown as Document, f, nghe }
  }
  it("chưa in xong thì chưa chạy; tin của khung khác không tính; in xong (hoặc huỷ) thì gỡ khung rồi chạy MỘT lần", async () => {
    const d = dom()
    const xong = vi.fn()
    inTaiCho("/in/hoa-don/i1", d.doc, xong)
    expect(d.f.src).toBe("/in/hoa-don/i1?auto=1")
    expect(xong).not.toHaveBeenCalled()
    d.nghe[0]({ source: {}, data: { type: IN_XONG } } as unknown as MessageEvent)
    await new Promise((r) => setTimeout(r, 0))
    expect(xong).not.toHaveBeenCalled()
    d.nghe[0]({ source: d.f.contentWindow, data: { type: IN_XONG } } as unknown as MessageEvent)
    await new Promise((r) => setTimeout(r, 0))
    expect(d.f.remove).toHaveBeenCalled()
    expect(xong).toHaveBeenCalledTimes(1)
  })
})

describe("nối dây ở các màn POS + kho tab", () => {
  const sau = (src: string, moc: string, dai = 900) => {
    const i = src.indexOf(moc)
    expect(i, moc).toBeGreaterThan(0)
    return src.slice(i, i + dai)
  }
  it("đơn hàng: gửi đơn / lưu đơn đã gửi xong mới gọi ketThuc (lưu nháp thì return trước)", () => {
    const s = read("src/components/pos/order-screen.tsx")
    const nhap = sau(s, "if (asDraft) {", 300)
    expect(nhap).toContain("return")
    expect(nhap).not.toContain("ketThuc(")
    expect(sau(s, "toast({ title: `Đã gửi đơn ${r.orderCode}`")).toContain('ketThuc({ docType: "SO", docId: r.orderId, loiBao: `Đã gửi đơn ${r.orderCode}` })')
  })
  it("hoá đơn: ketThuc nhận việc in; không nhận (tắt / có cảnh báo) thì in như cũ — cảnh báo gồm xuất thiếu + gán hỏng", () => {
    const s = read("src/components/pos/invoice-screen.tsx")
    expect(s).toContain('if (!ketThuc({ docType: "INV", docId: r.invoiceId, loiBao: tieuDe, coCanhBao: !!w || ganLoi || !!r.canhBaoKhach })) {\n            inTaiCho(trangInHoaDon(r.invoiceId))')
    expect(sau(s, "} catch (e) {\n            ganLoi = true", 200)).toContain("chưa gán được người phụ trách")
    /* Lần bấm TRƯỚC đã ghi (dải nhắc In) — không phải xong việc ở cửa sổ này. */
    expect(sau(s, "router.replace(duongTaiHoaDonDaCo(hd.id))", 10)).not.toContain("ketThuc")
  })
  it("phiếu trả / phiếu nhập / trả NCC: chỉ khi hoàn thành (complete)", () => {
    expect(read("src/components/pos/return-screen.tsx")).toContain(
      'if (complete) {\n          ketThuc({ docType: "RET", docId: r.returnId, loiBao: `Đã ghi nhận phiếu trả — hàng vào ${tenKhoNhan}`, coCanhBao: ganLoi })'
    )
    expect(read("src/components/pos/purchase-screen.tsx")).toContain('if (complete) ketThuc({ docType: "PUR", docId: r.receiptId,')
    expect(read("src/components/pos/supplier-return-screen.tsx")).toContain('if (complete) ketThuc({ docType: "PRET", docId: r.returnId,')
  })
  it("kho tab: bật tác vụ đơn thì không khôi phục / không ghi bản lưu chung; chờ đọc xong cài đặt", () => {
    const s = read("src/store/pos/tabs.tsx")
    expect(s).toContain("if (!caiDatSan || daKhoiPhuc.current) return")
    expect(sau(s, "if (settings.tacVuDon) {", 200)).toContain("setReady(true)\n      return")
    expect(s).toContain("if (tacVuDonRef.current) return\n    try {\n      window.localStorage.setItem(KEY,")
    /* In xong mới đóng — đóng trước là cắt ngang lệnh in. */
    expect(s).toContain("if (kt.trangIn) inTaiCho(kt.trangIn, document, () => dongSauKhiXong(x, true))")
    /* Lời báo chỉ ghi khi tab ĐÓNG ĐƯỢC — tab mở bằng tay không được báo "POS đã tự đóng" ở tab danh sách. */
    expect(sau(s, "khiDong: () => {", 200)).toContain("window.localStorage.setItem(KHOA_XONG_POS, goiLoiBao(x.loiBao, daIn, Date.now()))")
  })
  it("công tắc ở Thiết lập hiển thị; tab danh sách nghe lời báo", () => {
    expect(read("src/components/pos/display-settings-drawer.tsx")).toContain('label="Tác vụ đơn — in xong tự đóng POS"')
    const shell = read("src/components/layout/dashboard-shell.tsx")
    expect(shell.match(/<ThongBaoTuPos \/>/g)).toHaveLength(2)
    expect(read("src/components/sell/thong-bao-tu-pos.tsx")).toContain('window.addEventListener("storage", onStorage)')
  })
  it("CLAUDE.md ghi luật tác vụ đơn", () => {
    expect(read("CLAUDE.md")).toContain("### POS tác vụ đơn: in xong đóng luôn")
  })
})
