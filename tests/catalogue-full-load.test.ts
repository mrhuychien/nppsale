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
 * cùng một gốc và hỏng trong IM LẶNG. Các màn dưới đây —
 * cấu hình thưởng, và mấy màn luồng cũ — chưa được yêu cầu, nên ghi nợ chứ
 * không sửa lén.
 *
 * ⚠ 23/09/2026: bốn màn Phân tích (Tổng quan kinh doanh, Hàng hóa tổng
 * quan / nhóm hàng / tồn kho) đã đọc đủ theo trang — xoá tên. Chốt chạy
 * mã thật cho chúng ở `tests/phan-tich-doc-du.test.ts`.
 *
 * ⚠ SỬA MÀN NÀO THÌ XOÁ TÊN MÀN ẤY. Chốt ngay dưới đòi mỗi tên ở đây
 * phải THẬT SỰ còn đọc kiểu cũ — nên không nhét được một màn đã sửa
 * vào đây để né, và sửa xong mà quên xoá thì cũng đỏ.
 */
const CON_NO_DOC_DANH_MUC = [
  "src/app/(dashboard)/hr/bonus-config/page.tsx",
  "src/app/(dashboard)/inventory/batches/new/page.tsx",
  "src/app/(dashboard)/inventory/stock-out/page.tsx",
  "src/app/(dashboard)/inventory/stocktake/page.tsx",
  "src/app/(dashboard)/inventory/stocktake-adjust/page.tsx",
]

/**
 * Câu GHI, không phải câu đọc danh mục.
 *
 * ⚠ `.insert(…).select(…)` CHỈ TRẢ VỀ DÒNG VỪA GHI, không trả về cả
 * bảng — nó không hứa hẹn "đây là cả danh mục" nên trần 1.000 dòng
 * không đụng tới nó. Không tách ra thì mọi màn tạo/sửa sản phẩm đều bị
 * báo oan, và cách duy nhất để chốt xanh lại là nhét chúng vào danh
 * sách nợ — tức là tự tay đục một lỗ thật để bịt một báo động giả.
 */
function laCauGhi(stmt: string): boolean {
  const sel = stmt.indexOf(".select(")
  const write = stmt.search(/\.(insert|upsert|update|delete)\(/)
  if (write === -1) return false
  return sel === -1 || write < sel
}

/** Câu đọc `products` ở `at` có bị cắt ở 1.000 dòng không. */
function docBiCat(src: string, at: number): boolean {
  /**
   * ⚠ CỬA SỔ PHẢI DỪNG Ở CÂU TRUY VẤN KẾ TIẾP, KHÔNG CHẠY ĐỦ 420 KÝ TỰ.
   *
   *   Đo được 22/09/2026: `reports/customers` có một câu đọc danh mục
   *   trơn, và ngay dòng dưới là một `fetchAllForAggregate(… .range(from,
   *   to))` mới thêm cho bảng KHÁC. Cửa sổ 420 ký tự trùm sang đó, thấy
   *   `.range(`, và kết luận câu đọc danh mục "đã an toàn" — chốt chuyển
   *   sang đòi xoá tên tệp khỏi danh sách nợ, trong khi món nợ còn
   *   nguyên. Một chốt báo xanh cho chỗ vẫn sai thì tệ hơn không có chốt.
   *
   *   Cắt ở `.from("` kế tiếp: mỗi câu truy vấn Supabase bắt đầu bằng
   *   đúng chuỗi ấy, nên đó là ranh giới rẻ và đúng.
   */
  const ketTiep = src.indexOf('.from("', at + 7)
  const het = ketTiep === -1 ? at + 420 : Math.min(ketTiep, at + 420)
  const stmt = src.slice(at, het)
  const before = src.slice(Math.max(0, at - 300), at)
  if (laCauGhi(stmt)) return false
  const safe =
    /\.eq\("id",/.test(stmt) ||
    /\.in\("id",/.test(stmt) ||
    /\.range\(/.test(stmt) ||
    /\.limit\(/.test(stmt) ||
    /\.maybeSingle\(\)/.test(stmt) ||
    /* `head: true` chỉ ĐẾM, không trả dòng nào — không có danh mục nào
       để bị cắt (vd. `reports/page.tsx` đếm số mã đang bán). */
    /head: true/.test(stmt) ||
    before.includes("fetchAllForAggregate")
  return !safe
}

/**
 * ⚠ QUÉT CẢ `src/components`, KHÔNG CHỈ `page.tsx`. Bản đầu của chốt
 * này chỉ soi các tệp tên `page.tsx` — và ĐÚNG VÌ THẾ nó bỏ lọt
 * `src/components/orders/invoice-editor.tsx`, nơi màn Sửa hóa đơn đọc
 * cả danh mục bằng một `.select()` trơn. Chủ nhà phát hiện thay nó,
 * 21/09/2026: "Thêm mã hàng không có trong đơn tại sao gõ ko ra mã
 * hàng?".
 *
 * Một màn hình không dừng ở tệp `page.tsx` của nó. Phép quét nào dừng
 * ở đó thì canh được cái vỏ chứ không canh được chỗ thật sự hỏi máy
 * chủ.
 */
function allSources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) allSources(p, acc)
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) acc.push(p)
  }
  return acc
}

function allScanned(): string[] {
  return [
    ...allSources(resolve(ROOT, "src/app/(dashboard)")),
    ...allSources(resolve(ROOT, "src/components")),
  ]
}

describe("không màn nào nạp danh mục kiểu bị cắt", () => {
  /** ⚠ Phép quét phải còn nhận ra mẫu — và không báo oan câu chỉ đếm. */
  it("phép quét phân biệt đọc trơn với câu chỉ đếm", () => {
    const tron = 'supabase.from("products").select("id, name").eq("org_id", o)'
    expect(docBiCat(tron, tron.indexOf(".from("))).toBe(true)
    const dem = 'supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "active")'
    expect(docBiCat(dem, dem.indexOf(".from("))).toBe(false)
  })

  it("mọi câu đọc cả danh mục đều đi qua loadCatalogue", () => {
    const bad: string[] = []
    for (const abs of allScanned()) {
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

/**
 * KÉO ĐỦ LÀ MỘT NỬA; NỬA CÒN LẠI LÀ NÓI RA KHI KÉO CHƯA ĐỦ.
 *
 * ⚠ `loadCatalogue` trả về cờ `truncated` CHÍNH VÌ CÓ LÚC NÓ KÉO KHÔNG
 * ĐỦ — chạm trần `AGGREGATE_ROW_CAP`, hoặc câu truy vấn lỗi. Nơi gọi mà
 * vứt cờ ấy đi thì màn hình quay lại đúng hình dạng của lỗi 21/09/2026:
 * gõ đúng tên hàng, ô tìm im lặng trả về rỗng, người dùng kết luận danh
 * mục thiếu mã rồi đi tạo một mã trùng. Kéo đủ mà không báo được là mới
 * dời cái bẫy đi xa hơn, không phải gỡ nó.
 */
/**
 * ⚠ DANH SÁCH NAY RỖNG (chủ nhà chốt 21/09/2026: "làm nốt màn 7 phiếu").
 * Bảy màn từng nằm đây — phiếu nhập hàng tạo/sửa, phiếu trả NCC
 * tạo/sửa, phiếu xuất kho, phiếu nhập kho, màn tra soát — nay đều nói
 * ra khi danh mục đọc chưa hết.
 *
 * ⚠ GIỮ MẢNG LẠI DÙ RỖNG, ĐỪNG XOÁ. Nó là chỗ DUY NHẤT hợp lệ để ghi
 * một màn còn nuốt cờ, và chốt ngay dưới đòi mỗi tên trong đó phải
 * THẬT SỰ còn nuốt — nên không ai nhét được một màn đã sửa vào đây để
 * né. Xoá mảng đi thì lần sau người ta lại nới chính chốt quét.
 */
const CON_NO_NUOT_CO_THIEU: string[] = []

/**
 * Màn này có NÓI RA cho người dùng không.
 *
 * ⚠ ĐÒI THỨ NGƯỜI DÙNG NHÌN THẤY, KHÔNG ĐÒI MỘT BIẾN. Bản đầu của chốt
 * này chỉ tìm chữ `truncated` ở đâu đó trong tệp — `const x =
 * res.truncated` rồi vứt đi cũng qua được, mà đó CHÍNH LÀ lỗi cần
 * chặn. Thứ thật sự quan trọng là câu chữ có tới mắt người nhập không,
 * nên mốc là `CatalogueShortNote` (màn tự vẽ) hoặc `catalogueTruncated=`
 * (màn chuyền cờ xuống một component vẽ hộ).
 */
function coNoiRa(src: string): boolean {
  return /CatalogueShortNote/.test(src) || /catalogueTruncated=/.test(src)
}

describe("đọc thiếu danh mục thì màn hình phải nói ra", () => {
  it("mọi nơi gọi loadCatalogue đều nói ra khi đọc thiếu", () => {
    const bad: string[] = []
    for (const abs of allScanned()) {
      const rel = abs.slice(ROOT.length + 1)
      if (CON_NO_NUOT_CO_THIEU.includes(rel)) continue
      const src = strip(readFileSync(abs, "utf-8"))
      if (!src.includes("loadCatalogue<")) continue
      if (!coNoiRa(src)) bad.push(rel)
    }
    expect(
      bad,
      "nạp danh mục qua loadCatalogue nhưng không nói gì khi đọc thiếu — " +
        "người nhập gõ đúng tên một mã có thật, ô tìm im lặng trả về rỗng, " +
        "rồi họ đi tạo một mã trùng:\n  " + bad.join("\n  ")
    ).toEqual([])
  })

  /** ⚠ Sửa màn nào thì xoá tên màn ấy — nếu không cái lỗ vẫn mở. */
  it("mỗi màn trong danh sách nợ đều thật sự còn im lặng", () => {
    for (const rel of CON_NO_NUOT_CO_THIEU) {
      const src = strip(read(rel))
      expect(src, `${rel} không còn gọi loadCatalogue — xem lại danh sách nợ`)
        .toContain("loadCatalogue<")
      expect(
        coNoiRa(src),
        `${rel} đã nói ra khi đọc thiếu — xoá tên nó khỏi CON_NO_NUOT_CO_THIEU`
      ).toBe(false)
    }
  })

  /**
   * ⚠ PHÉP QUÉT PHẢI NHÌN THẤY GÌ ĐÓ. `allScanned()` hỏng, hay
   * `loadCatalogue<` đổi cách viết, thì `bad` rỗng và chốt trên XANH
   * vĩnh viễn — đúng kiểu chốt nói dối đã để lọt lỗi 21/09/2026. Chín
   * màn đang nạp danh mục qua đường chung; nếu không thấy chúng nữa
   * thì phép quét hỏng, không phải kho mã sạch.
   */
  it("phép quét thật sự nhìn thấy các màn nạp danh mục", () => {
    const thay = allScanned().filter((abs) =>
      strip(readFileSync(abs, "utf-8")).includes("loadCatalogue<")
    )
    expect(thay.length, "phép quét hỏng — không thấy màn nào gọi loadCatalogue")
      .toBeGreaterThanOrEqual(9)
  })

  /**
   * ⚠ CÂU CHỮ NẰM MỘT CHỖ. Chép ra từng màn là chín lần phải nhớ sửa,
   * và màn nào quên thì lại im lặng — đúng thứ cờ `truncated` sinh ra
   * để chặn. Ai dựng lại câu ấy bằng JSX viết thẳng thì chốt này đỏ.
   */
  it("không màn nào tự chép lại câu cảnh báo", () => {
    const bad: string[] = []
    for (const abs of allScanned()) {
      const rel = abs.slice(ROOT.length + 1)
      if (rel === "src/components/ui/catalogue-short-note.tsx") continue
      const src = strip(readFileSync(abs, "utf-8"))
      if (/Danh mục đọc chưa hết/.test(src)) bad.push(rel)
    }
    expect(
      bad,
      "viết thẳng câu cảnh báo thay vì dùng <CatalogueShortNote>:\n  " + bad.join("\n  ")
    ).toEqual([])
  })

  /**
   * ⚠ ĐỌC HỎNG CŨNG PHẢI GẮN CỜ. `fetchAllForAggregate` trả
   * `truncated: false` kèm `error` khi câu truy vấn lỗi — chuyển tiếp
   * thẳng `res.truncated` là một lần đọc hỏng ra đúng hình dạng của
   * "danh mục trống": không dòng nào, không cờ nào, không một câu nào.
   */
  it("loadCatalogue coi câu truy vấn lỗi là đọc thiếu", () => {
    const src = strip(read("src/lib/products/load-catalogue.ts"))
    expect(
      /truncated:\s*res\.truncated\s*\|\|\s*res\.error\s*!==\s*null/.test(src),
      "loadCatalogue bỏ qua `error` — đọc hỏng sẽ im lặng trông như danh mục rỗng"
    ).toBe(true)
  })
})
