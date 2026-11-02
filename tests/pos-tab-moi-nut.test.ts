/**
 * NÚT ĐI BẰNG `router.push` VÀO LỐI POS PHẢI MỞ TAB MỚI — chủ nhà 21/10/2026: "nút tạo đơn khoanh đỏ ở phần danh sách
 * đơn hàng khi ấn vào chưa mở tab mới" (luật gốc 23/09/2026: "Mỗi khi mở pos bật tab mới đi").
 *
 * Bộ bắt `PosNewTab` chỉ thấy cú bấm vào thẻ `<a>`; nút `<Button onClick={() => router.push(…)}>` lọt qua nó, đi `/sell`
 * cùng tab rồi bị `PosDesktopRedirect` đẩy sang POS — tab danh sách mất. Nút kiểu ấy phải gọi `diHoacMoPos`.
 * Bấm thật: e2e/pos-tab-moi.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { diHoacMoPos } from "@/components/sell/pos-new-tab"
import { openInNewTab } from "@/components/ui/new-tab-link"

const goc = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(goc, p), "utf-8")

function moiTep(thuMuc: string): string[] {
  const out: string[] = []
  for (const ten of readdirSync(resolve(goc, thuMuc))) {
    const p = join(thuMuc, ten)
    if (statSync(resolve(goc, p)).isDirectory()) out.push(...moiTep(p))
    else if (/\.tsx?$/.test(ten)) out.push(p)
  }
  return out
}

describe("diHoacMoPos", () => {
  afterEach(() => vi.unstubAllGlobals())

  const mayTinh = () => {
    const open = vi.fn((_duong: string, _dich?: string) => ({ opener: {} }))
    vi.stubGlobal("window", { innerWidth: 1440, open, location: { href: "/orders" } })
    return open
  }

  it("máy tính + lối POS (/sell): mở THẲNG màn POS ở tab mới, tab cũ không chuyển", () => {
    const open = mayTinh()
    const push = vi.fn()
    diHoacMoPos(push, "/sell")
    expect(open).toHaveBeenCalledWith("/pos/don-hang/moi", "_blank")
    expect(push).not.toHaveBeenCalled()
  })

  it("máy tính: mang theo khách (`?customerId=`) và mở đúng màn sửa đơn", () => {
    const open = mayTinh()
    const push = vi.fn()
    diHoacMoPos(push, "/sell?customerId=kh-1")
    diHoacMoPos(push, "/sell/edit/don-9")
    expect(open.mock.calls.map((c) => c[0])).toEqual(["/pos/don-hang/moi?customerId=kh-1", "/pos/don-hang/don-9/sua"])
    expect(push).not.toHaveBeenCalled()
  })

  it("máy tính + đích không phải POS: đi như cũ (cùng tab)", () => {
    const open = mayTinh()
    const push = vi.fn()
    diHoacMoPos(push, "/sell/drafts")
    expect(push).toHaveBeenCalledWith("/sell/drafts")
    expect(open).not.toHaveBeenCalled()
  })

  it("điện thoại: /sell cùng tab như cũ", () => {
    const open = vi.fn()
    vi.stubGlobal("window", { innerWidth: 390, open, location: { href: "/orders" } })
    const push = vi.fn()
    diHoacMoPos(push, "/sell")
    expect(push).toHaveBeenCalledWith("/sell")
    expect(open).not.toHaveBeenCalled()
  })
})

/**
 * ⚠ CHỦ NHÀ 02/11/2026: "dường như trễ 1 nhịp để nhận diện là phải load pos". Nút "Xuất hàng" (danh sách đơn + khung xem
 *   nhanh) gọi `openInNewTab("/sales-invoices/new?order=…")`: tab mới tải màn cũ rồi mới tự chuyển sang POS (production:
 *   1,1–2,7 giây thừa mỗi lần). `openInNewTab` nay tự đổi lối vào POS cũ thành đích POS trên máy tính.
 */
describe("openInNewTab: lối vào POS cũ mở thẳng đích POS (máy tính)", () => {
  afterEach(() => vi.unstubAllGlobals())
  const cua = (innerWidth: number) => {
    const open = vi.fn((_duong: string, _dich?: string) => ({ opener: {} }))
    const location = { href: "/orders" }
    vi.stubGlobal("window", { innerWidth, open, location })
    return { open, location }
  }

  it("máy tính: Xuất hàng (/sales-invoices/new?order=) → /pos/hoa-don/moi?order= — không qua màn cũ", () => {
    const { open } = cua(1440)
    openInNewTab("/sales-invoices/new?order=don-7")
    expect(open).toHaveBeenCalledWith("/pos/hoa-don/moi?order=don-7", "_blank")
  })
  it("máy tính: các lối khác cũng đổi (đơn mới, sửa hoá đơn, phiếu trả, nhập hàng); đường thường giữ nguyên", () => {
    const { open } = cua(1440)
    for (const d of ["/sell", "/sales-invoices/hd-1/edit", "/returns/new", "/purchasing/receipts/new", "/sales-invoices/hd-1"]) openInNewTab(d)
    expect(open.mock.calls.map((c) => c[0])).toEqual([
      "/pos/don-hang/moi", "/pos/hoa-don/hd-1/sua", "/pos/tra-hang/moi", "/pos/nhap-hang/moi", "/sales-invoices/hd-1",
    ])
  })
  it("điện thoại: mở đúng đường được đưa (POS không dùng được trên điện thoại)", () => {
    const { open } = cua(390)
    openInNewTab("/sales-invoices/new?order=don-7")
    expect(open).toHaveBeenCalledWith("/sales-invoices/new?order=don-7", "_blank")
  })
  it("luật ghi ở CLAUDE.md (mục Mở POS ở tab mới)", () => {
    expect(read("CLAUDE.md")).toContain("**Mở THẲNG đích POS, không qua màn cũ** (chủ nhà 02/11/2026")
  })
  it("trình duyệt chặn cửa sổ mới: chuyển cùng tab — cũng tới THẲNG POS", () => {
    const open = vi.fn(() => null)
    const location = { href: "/orders" }
    vi.stubGlobal("window", { innerWidth: 1440, open, location })
    openInNewTab("/sales-invoices/new?order=don-7")
    expect(location.href).toBe("/pos/hoa-don/moi?order=don-7")
  })
})

describe("ba nút đã đi qua diHoacMoPos", () => {
  it("danh sách đơn: nút Tạo đơn (góc phải)", () => {
    expect(read("src/app/(dashboard)/orders/page.tsx")).toContain("onClick={() => diHoacMoPos(router.push, newOrderHref())}")
  })
  it("chi tiết khách: nút Tạo đơn", () => {
    expect(read("src/app/(dashboard)/customers/[id]/page.tsx")).toContain(
      "onClick={() => diHoacMoPos(router.push, newOrderHref(customer.id))}"
    )
  })
  it("đơn nháp: nút Sửa đơn", () => {
    expect(read("src/app/(dashboard)/sell/drafts/page.tsx")).toContain("onClick={() => diHoacMoPos(router.push, `/sell/edit/${o.id}`)}")
  })
  it("không còn chỗ nào router.push thẳng vào lối POS (tạo đơn / sửa đơn)", () => {
    const sai = moiTep("src").filter((p) => /router\.(push|replace)\(\s*(newOrderHref\(|`\/sell\/edit\/)/.test(read(p)))
    expect(sai).toEqual([])
  })
})
