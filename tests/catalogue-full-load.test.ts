import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * NẠP DANH MỤC HÀNG PHẢI KÉO ĐỦ, KHÔNG DỪNG Ở 1.000 MÃ.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "Sao đề xuất đặt hàng lại ra toàn Sản phẩm
 * đã xóa là sao?". Màn ấy đọc `products` bằng một `.select()` trơn.
 * PostgREST cắt ở 1.000 dòng, nên với danh mục 1.700 mã thì 700 mã
 * cuối không có trong bộ nhớ — và mọi dòng đơn trỏ tới chúng bị gán
 * nhãn "Sản phẩm đã xoá".
 *
 * ⚠ CÙNG CÂU ẤY CÒN Ở SÁU MÀN PHIẾU, và ở đó nó KHÓ THẤY HƠN: người
 * nhập gõ đúng tên một mặt hàng có thật, ô tìm im lặng trả rỗng, và họ
 * kết luận danh mục thiếu mã rồi đi tạo một mã trùng.
 *
 * ⚠ CHỐT CŨ ĐÃ NÓI DỐI ĐÚNG CHỖ NÀY. Nó đếm số lần xuất hiện của CHUỖI
 * `fetchAllForAggregate` và đòi ≥ 3 — mà dòng `import` cũng là một lần
 * xuất hiện. Hai câu đọc thật cộng một dòng import là vừa đủ 3. Bài
 * học: đếm LỜI GỌI, đừng đếm chuỗi.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const LIB = strip(read("src/lib/products/load-catalogue.ts"))

describe("chỗ nạp danh mục dùng chung", () => {
  /** ⚠ Kéo đủ theo trang, không đặt một giới hạn cứng rồi im lặng cắt. */
  it("kéo đủ theo trang qua fetchAllForAggregate", () => {
    expect(LIB).toContain("fetchAllForAggregate<T>(")
    expect(LIB, "đặt giới hạn cứng chỉ đẩy ngưỡng đi xa rồi cắt ở chỗ mới")
      .not.toMatch(/\.limit\(\d+\)/)
  })

  /**
   * ⚠ MỐC CHIA TRANG PHẢI DUY NHẤT. `.order("name")` là hai mặt hàng
   * trùng tên làm các trang lặp/sót nhau — mất mã mà không ai biết.
   */
  it("phân trang theo id, sắp xếp theo tên sau khi đã kéo đủ", () => {
    expect(LIB).toContain('.order("id")')
    expect(LIB, "đang phân trang theo tên — mốc không duy nhất")
      .not.toContain('.order("name")')
    expect(LIB, "kéo xong không sắp lại theo tên thì danh sách xổ ra lộn xộn")
      .toContain("localeCompare")
  })

  /** ⚠ Đọc chưa hết thì phải ngấm cờ ra ngoài cho màn hình nói được. */
  it("trả về cờ đọc-chưa-hết", () => {
    expect(LIB).toContain("truncated: res.truncated")
  })
})

/**
 * QUÉT CẢ KHO MÃ — còn màn nào đọc `products` bằng `.select()` trơn
 * rồi giữ cả danh sách trong bộ nhớ nữa không.
 *
 * ⚠ CHỈ BẮT CÂU ĐỌC CẢ DANH MỤC. Đọc MỘT mặt hàng theo `id`, hay đọc
 * kèm `.limit(n)` có chủ ý, đều lành — chúng không hứa hẹn "đây là cả
 * danh mục".
 */
const MIEN_TRU = [
  /* Màn danh sách sản phẩm tự phân trang và tự hiện tổng số — nó
     KHÔNG giữ cả danh mục trong bộ nhớ để tra cứu. */
  "src/app/(dashboard)/products/page.tsx",
]

/**
 * DANH SÁCH NỢ — màn còn đọc `products` bằng `.select()` trơn.
 *
 * ⚠ CÓ TÊN, KHÔNG GIẤU. Chủ nhà báo lỗi ở màn Đề xuất đặt hàng
 * (21/09/2026); tôi sửa nốt sáu màn phiếu và màn Tra soát vì chúng
 * cùng một gốc và hỏng trong IM LẶNG. Mười bảy màn dưới đây — báo cáo, phân tích,
 * cấu hình thưởng, và mấy màn luồng cũ — chưa được yêu cầu, nên ghi nợ chứ
 * không sửa lén.
 *
 * ⚠ SỬA MÀN NÀO THÌ XOÁ TÊN MÀN ẤY. Chốt ngay dưới đòi mỗi tên ở đây
 * phải THẬT SỰ còn đọc kiểu cũ — nên không nhét được một màn đã sửa
 * vào đây để né, và sửa xong mà quên xoá thì cũng đỏ.
 */
const CON_NO_DOC_DANH_MUC = [
  "src/app/(dashboard)/analytics/business/overview/page.tsx",
  "src/app/(dashboard)/analytics/products/categories/page.tsx",
  "src/app/(dashboard)/analytics/products/overview/page.tsx",
  "src/app/(dashboard)/analytics/products/stock/page.tsx",
  "src/app/(dashboard)/hr/bonus-config/page.tsx",
  "src/app/(dashboard)/inventory/batches/new/page.tsx",
  "src/app/(dashboard)/inventory/stock-out/page.tsx",
  "src/app/(dashboard)/inventory/stocktake/page.tsx",
  "src/app/(dashboard)/inventory/stocktake-adjust/page.tsx",
  "src/app/(dashboard)/orders/[id]/page.tsx",
  "src/app/(dashboard)/reports/page.tsx",
  "src/app/(dashboard)/reports/customers/page.tsx",
  "src/app/(dashboard)/reports/employees/page.tsx",
  "src/app/(dashboard)/reports/orders/page.tsx",
  "src/app/(dashboard)/reports/products/page.tsx",
  "src/app/(dashboard)/reports/sales/page.tsx",
  "src/app/(dashboard)/reports/suppliers/page.tsx",
]

/** Câu đọc `products` ở `at` có bị cắt ở 1.000 dòng không. */
function docBiCat(src: string, at: number): boolean {
  const stmt = src.slice(at, at + 420)
  const before = src.slice(Math.max(0, at - 300), at)
  const safe =
    /\.eq\("id",/.test(stmt) ||
    /\.in\("id",/.test(stmt) ||
    /\.range\(/.test(stmt) ||
    /\.limit\(/.test(stmt) ||
    /\.maybeSingle\(\)/.test(stmt) ||
    before.includes("fetchAllForAggregate")
  return !safe
}

function allPages(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) allPages(p, acc)
    else if (name === "page.tsx") acc.push(p)
  }
  return acc
}

describe("không màn nào nạp danh mục kiểu bị cắt", () => {
  it("mọi câu đọc cả danh mục đều đi qua loadCatalogue", () => {
    const bad: string[] = []
    for (const abs of allPages(resolve(ROOT, "src/app/(dashboard)"))) {
      const rel = abs.slice(ROOT.length + 1)
      if (MIEN_TRU.includes(rel)) continue
      if (CON_NO_DOC_DANH_MUC.includes(rel)) continue
      const src = strip(readFileSync(abs, "utf-8"))
      let at = src.indexOf('.from("products")')
      while (at !== -1) {
        if (docBiCat(src, at)) bad.push(`${rel} (vị trí ${at})`)
        at = src.indexOf('.from("products")', at + 1)
      }
    }
    expect(
      bad,
      "đọc cả danh mục bằng `.select()` trơn — PostgREST cắt ở 1.000 dòng, " +
        "và 700 mã cuối biến mất trong im lặng:\n  " + bad.join("\n  ")
    ).toEqual([])
  })

  /**
   * ⚠ MỖI TÊN TRONG DANH SÁCH NỢ PHẢI THẬT SỰ CÒN MẮC LỖI. Không kiểm
   * thì danh sách ấy biến thành chỗ nhét mọi màn để né — đúng thứ chốt
   * quét sinh ra để chặn.
   */
  it("mỗi màn trong danh sách nợ đều thật sự còn đọc kiểu cũ", () => {
    for (const rel of CON_NO_DOC_DANH_MUC) {
      const src = strip(read(rel))
      let con = false
      let at = src.indexOf('.from("products")')
      while (at !== -1) {
        if (docBiCat(src, at)) { con = true; break }
        at = src.indexOf('.from("products")', at + 1)
      }
      expect(con, `${rel} đã hết đọc kiểu cũ — xoá tên nó khỏi CON_NO_DOC_DANH_MUC`).toBe(true)
    }
  })

  /** ⚠ Sáu màn phiếu và màn tra soát phải dùng đúng chỗ nạp chung. */
  it("sáu màn phiếu đều nạp danh mục qua loadCatalogue", () => {
    for (const rel of [
      "src/app/(dashboard)/purchasing/receipts/new/page.tsx",
      "src/app/(dashboard)/purchasing/receipts/[id]/edit/page.tsx",
      "src/app/(dashboard)/purchase-returns/new/page.tsx",
      "src/app/(dashboard)/purchase-returns/[id]/edit/page.tsx",
      "src/app/(dashboard)/inventory/stock-issue/page.tsx",
      "src/app/(dashboard)/inventory/stock-in/page.tsx",
      "src/app/(dashboard)/inventory/audit/page.tsx",
    ]) {
      expect(strip(read(rel)), `${rel} không nạp danh mục qua loadCatalogue`)
        .toContain("loadCatalogue<")
    }
  })
})
