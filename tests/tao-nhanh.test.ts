import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { conTroToiDa, dongTaoDangChon, nhanTaoMoi } from "@/lib/ui/tao-moi"
import { chuBanDauKhach } from "@/lib/customers/tao-khach"
import { chuBanDauTuyen } from "@/lib/customers/tuyen"
import { NHAN_TAO_NHANH, duocTaoNhanh } from "@/lib/tao-nhanh/quyen"
import { gopVuaTao } from "@/lib/tao-nhanh/vua-tao"

/**
 * ⚠ CHỦ NHÀ 03/10/2026 (Update 3.10): "list search nào cũng đáp ứng: tìm, danh sách, không có trong danh sách
 *   có nút tạo mới ở cuối. Khi bấm tạo -> sang tạo mới có trường đang search đó luôn" · "Khi tạo xong sản phẩm
 *   hoặc NCC -> bấm xong thì quay về phần đang làm … add luôn khách vừa thêm vào". Bỏ luôn trường nhóm hàng.
 */

/** Bỏ dòng chú thích theo từng dòng (không regex — xem SKILL "Testing UI by reading source"). */
function ma(rel: string): string {
  const out: string[] = []
  let trongKhoi = false
  for (const l of readFileSync(rel, "utf8").split("\n")) {
    const t = l.trim()
    if (trongKhoi) {
      if (t.includes("*/")) trongKhoi = false
      continue
    }
    if (t.startsWith("{/*") || t.startsWith("/*")) {
      if (!t.includes("*/")) trongKhoi = true
      continue
    }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(l)
  }
  return out.join("\n")
}
/** Cắt từ mốc (phải có) tới mốc kết thúc. */
function cat(src: string, tu: string, den?: string): string {
  const i = src.indexOf(tu)
  expect(i, `không thấy mốc ${tu}`).toBeGreaterThan(0)
  const j = den ? src.indexOf(den, i + tu.length) : -1
  return src.slice(i, j > i ? j : undefined)
}

describe("dòng “+ Tạo mới” — luật thuần", () => {
  it("nhãn kèm chữ đang gõ trong ngoặc kép, không có chữ thì chỉ nhãn", () => {
    expect(nhanTaoMoi("Tạo khách hàng mới", "  Cô Ba ")).toBe("Tạo khách hàng mới “Cô Ba”")
    expect(nhanTaoMoi("Tạo khách hàng mới", "   ")).toBe("Tạo khách hàng mới")
  })

  it("mũi tên xuống đi được tới dòng tạo mới (ngay sau kết quả cuối)", () => {
    expect(conTroToiDa(3, true)).toBe(3)
    expect(conTroToiDa(3, false)).toBe(2)
    expect(conTroToiDa(0, true)).toBe(0)
    expect(conTroToiDa(0, false)).toBe(0)
  })

  it("không có kết quả → Enter là tạo mới", () => {
    expect(dongTaoDangChon({ coTaoMoi: true, active: 0, soKetQua: 0, choGoTay: false, chu: "Cô Ba", daBamXuong: false })).toBe(true)
  })

  it("có kết quả → chỉ khi con trỏ đứng ở dòng cuối (sau kết quả)", () => {
    const co = { coTaoMoi: true, soKetQua: 2, choGoTay: false, chu: "a", daBamXuong: true }
    expect(dongTaoDangChon({ ...co, active: 0 })).toBe(false)
    expect(dongTaoDangChon({ ...co, active: 1 })).toBe(false)
    expect(dongTaoDangChon({ ...co, active: 2 })).toBe(true)
    expect(dongTaoDangChon({ ...co, active: 2, coTaoMoi: false })).toBe(false)
  })

  /** ⚠ Ô gõ tự do (NCC ở phiếu nhập kho): Enter vẫn là "dùng chữ gõ tay" cho tới khi bấm mũi tên xuống. */
  it("ô gõ tự do không có kết quả: Enter giữ nghĩa cũ, phải bấm xuống mới tới dòng tạo", () => {
    const o = { coTaoMoi: true, active: 0, soKetQua: 0, choGoTay: true, chu: "NCC lạ" }
    expect(dongTaoDangChon({ ...o, daBamXuong: false })).toBe(false)
    expect(dongTaoDangChon({ ...o, daBamXuong: true })).toBe(true)
    expect(dongTaoDangChon({ ...o, chu: "", daBamXuong: false })).toBe(true)
  })
})

describe("gán sẵn chữ đang tìm vào khách mới", () => {
  it("trông như SĐT → ô SĐT (chuẩn hoá), không đụng tên", () => {
    expect(chuBanDauKhach("0912 345 678")).toEqual({ store_name: "", phone: "0912345678" })
    expect(chuBanDauKhach("+84 912.345.678")).toEqual({ store_name: "", phone: "0912345678" })
  })
  it("còn lại → tên cửa hàng", () => {
    expect(chuBanDauKhach("  Tạp hoá Cô Ba ")).toEqual({ store_name: "Tạp hoá Cô Ba", phone: "" })
    expect(chuBanDauKhach("Cô Ba 0912")).toEqual({ store_name: "Cô Ba 0912", phone: "" })
    expect(chuBanDauKhach(undefined)).toEqual({ store_name: "", phone: "" })
  })
  it("tuyến: một từ ngắn → mã (viết hoa), có dấu / dấu cách → tên", () => {
    expect(chuBanDauTuyen("t5")).toEqual({ code: "T5", name: "" })
    expect(chuBanDauTuyen("Thứ Năm")).toEqual({ code: "", name: "Thứ Năm" })
    expect(chuBanDauTuyen("")).toEqual({ code: "", name: "" })
  })
})

describe("quyền tạo nhanh — cùng luật nút Thêm ở màn danh sách", () => {
  it("chủ NPP tạo được mọi thứ; không có vai thì không", () => {
    for (const k of Object.keys(NHAN_TAO_NHANH) as Array<keyof typeof NHAN_TAO_NHANH>) {
      expect(duocTaoNhanh("owner", k)).toBe(true)
      expect(duocTaoNhanh(null, k)).toBe(false)
    }
  })
  it("NVBH tạo khách được, NCC / sản phẩm / tuyến thì không; thủ kho tạo NCC được", () => {
    expect(duocTaoNhanh("sales", "khach")).toBe(true)
    expect(duocTaoNhanh("sales", "ncc")).toBe(false)
    expect(duocTaoNhanh("sales", "san-pham")).toBe(false)
    expect(duocTaoNhanh("sales", "tuyen")).toBe(false)
    expect(duocTaoNhanh("warehouse", "ncc")).toBe(true)
    expect(duocTaoNhanh("warehouse", "khach")).toBe(false)
    expect(duocTaoNhanh("manager", "tuyen")).toBe(true)
  })
})

describe("SearchSelect / ProductPicker có dòng tạo mới", () => {
  const SS = ma("src/components/ui/search-select.tsx")
  const PP = ma("src/components/ui/product-picker.tsx")

  it("SearchSelect: dòng tạo mới vẽ SAU kết quả, kể cả khi rỗng, bấm bằng mousedown", () => {
    const xo = cat(SS, 'data-testid="search-select-xo"')
    const iKetQua = xo.indexOf("results.map((o, i) =>")
    const iTao = xo.indexOf("{taoMoi && (")
    expect(iKetQua).toBeGreaterThan(0)
    expect(iTao).toBeGreaterThan(iKetQua)
    // Nằm ngoài nhánh `results.length === 0 ? … : …` — hiện cả khi không có kết quả.
    expect(xo.slice(0, iTao)).toContain("{footer && ")
    const dong = cat(xo, "{taoMoi && (", "</button>")
    expect(dong).toContain("onMouseDown={(e) => {")
    expect(dong).toContain("tao()")
    expect(dong).toContain("nhanTaoMoi(taoMoi.nhan, term)")
    expect(SS).toContain('? "Không có trong danh sách"')
  })

  it("SearchSelect: bàn phím tới được dòng tạo mới và Enter tạo", () => {
    expect(SS).toContain("setActive((i) => Math.min(i + 1, conTroToiDa(results.length, !!taoMoi)))")
    const enter = cat(SS, 'e.key === "Enter"', 'e.key === "Escape"')
    expect(enter.indexOf("if (taoActive) tao()")).toBeGreaterThan(0)
    expect(enter.indexOf("if (taoActive) tao()")).toBeLessThan(enter.indexOf("choose(results[active])"))
    const tao = cat(SS, "const tao = () => {", "const choose")
    expect(tao).toContain('setTerm("")')
    expect(tao).toContain("setOpen(false)")
    expect(tao).toContain("taoMoi.onTao(chu)")
  })

  it("ProductPicker: cùng dòng tạo mới, cùng bàn phím", () => {
    expect(PP).toContain("setActive((i) => Math.min(i + 1, conTroToiDa(shown.length, !!taoMoi)))")
    const enter = cat(PP, 'e.key === "Enter"', 'e.key === "Escape"')
    expect(enter).toContain("if (taoActive) tao()")
    const dong = cat(PP, "{taoMoi && (", "</button>")
    expect(dong).toContain("nhanTaoMoi(taoMoi.nhan, term)")
    expect(dong).toContain("onMouseDown={(e) => {")
  })
})

describe("tạo xong ở lại trang đang làm", () => {
  it("CustomerForm: có onDaTao thì trả khách, KHÔNG router.push", () => {
    const F = ma("src/components/customers/customer-form.tsx")
    const nhanh = cat(F, "if (onDaTao && !customer) {", "if (nextHref && newId)")
    expect(nhanh).toContain("onDaTao({")
    expect(nhanh).toContain("return")
    expect(F).toContain("store_name: customer?.store_name || initialName ||")
  })

  it("TaoKhachDienThoai: có onDaTao thì trả khách trước mọi điều hướng", () => {
    const F = ma("src/components/customers/tao-khach-dien-thoai.tsx")
    const luu = cat(F, "const kq = await taoKhach(supabase, user, payload)", "const r = tuyen.find")
    expect(luu.indexOf("if (onDaTao) {")).toBeGreaterThan(0)
    expect(luu.indexOf("if (onDaTao) {")).toBeLessThan(luu.indexOf("router.push("))
    expect(F).toContain('store_name: tenBanDau ?? ""')
  })

  it("SupplierForm: có onDaTao thì không về /suppliers; trang /suppliers/new vẫn về như cũ", () => {
    const F = ma("src/components/suppliers/supplier-form.tsx")
    const nhanh = cat(F, "if (onDaTao) {", 'router.push("/suppliers")')
    expect(nhanh).toContain("onDaTao({ id: r.id")
    expect(nhanh).toContain("return")
    expect(F).toContain('.select("id, code, name").single()')
    const P = ma("src/app/(dashboard)/suppliers/new/page.tsx")
    expect(P).toContain("<SupplierForm />")
  })

  it("Khung tạo nhanh: điện thoại = tấm trượt kín màn, máy tính = hộp thoại cuộn được", () => {
    const K = ma("src/components/ui/khung-tao-nhanh.tsx")
    expect(K).toContain("if (laMay === false) {")
    expect(cat(K, "<SheetContent", ">")).toContain('side="bottom"')
    expect(K).toContain("h-[100dvh] max-h-[100dvh]")
    expect(K).toContain('className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"')
    expect(K).toContain("onSubmit={(e) => e.stopPropagation()}")
  })
})

describe("thí điểm: phiếu thu (khách) + phiếu nhập kho (NCC, sản phẩm)", () => {
  it("phiếu thu: ô khách có taoMoi, tạo xong chọn luôn", () => {
    const P = ma("src/app/(dashboard)/finance/cash-receipts/new/page.tsx")
    expect(P).toContain('duocTaoNhanh(user.role, "khach")')
    const xong = cat(P, "<TaoNhanhKhach", "/>")
    expect(P.slice(P.indexOf("<TaoNhanhKhach"))).toContain("setCustomerId(k.id)")
    expect(xong).toContain("chuBanDau={taoKhach?.chu}")
  })

  it("nhập kho: bỏ link mở tab mới, NCC + sản phẩm tạo tại chỗ", () => {
    const P = ma("src/app/(dashboard)/inventory/stock-in/page.tsx")
    expect(P).not.toContain('href="/suppliers/new"')
    expect(P).not.toContain("<ProductForm")
    expect(cat(P, "const nccField", "const nccHint")).toContain("taoMoi={coQuyenTaoNcc ?")
    expect(cat(P, "const productPicker", "return (")).toContain("taoMoi={coQuyenTaoSp ?")
    const ncc = cat(P, "<TaoNhanhNcc", "/>\n")
    expect(ncc).toContain("setSupplierId(n.id)")
  })

  /** ⚠ Bản cũ tra mã mới trong `productMap` CŨ (chưa có mã vừa tạo) — không thêm được dòng nào. */
  it("nhập kho: thêm đúng sản phẩm vừa tạo, lấy từ danh sách vừa đọc", () => {
    const P = ma("src/app/(dashboard)/inventory/stock-in/page.tsx")
    const f = cat(P, "const refetchProductsAndPick = async (vuaTaoId: string)", "useEffect(")
    expect(f).toContain("list.find((p) => p.id === vuaTaoId)")
    expect(f).toContain("addProductLine(moi.id, moi)")
    expect(P).toContain("const product = coSan ?? productMap.get(productId)")
  })
})

describe("bỏ trường Nhóm hàng ở biểu mẫu sản phẩm", () => {
  const F = ma("src/components/products/product-form.tsx")
  it("không còn ô, không còn đọc danh sách nhóm", () => {
    expect(F).not.toContain("Nhóm hàng")
    expect(F).not.toContain("categorySuggest")
    expect(F).not.toContain("showNewCategory")
    expect(F).not.toContain('.select("id, category"')
  })
  /** ⚠ Sửa hàng cũ KHÔNG được xoá trắng nhóm đang có — không gửi `category` lúc lưu. */
  it("không gửi category lúc lưu", () => {
    const payload = cat(F, "const payload = {", "}\n")
    expect(payload).not.toContain("category")
  })
  it("gán sẵn tên hàng từ ô tìm, ẩn “Lưu & Tạo thêm” trong khung tạo nhanh", () => {
    expect(F).toContain('name: product?.name || tenBanDau?.trim() || ""')
    expect(F).toContain("{!isEdit && !anTaoThem ? (")
  })
})

/* ------------------------------------------------------------------------------------------------------------
 * ĐỢT 2 — mọi ô chọn có tìm còn lại (trừ bán hàng / POS). Chủ nhà 03/10/2026, Update 3.10 mục 1.
 * ---------------------------------------------------------------------------------------------------------- */

describe("ghép bản ghi vừa tạo vào danh mục màn đang làm", () => {
  it("thêm vào cuối; đã có cùng id thì giữ nguyên mảng (không nhân đôi, không vẽ lại)", () => {
    const ds = [{ id: "a", t: 1 }, { id: "b", t: 2 }]
    expect(gopVuaTao(ds, [{ id: "c", t: 3 }])).toEqual([...ds, { id: "c", t: 3 }])
    expect(gopVuaTao(ds, [{ id: "b", t: 9 }])).toBe(ds)
    expect(gopVuaTao(ds, [])).toBe(ds)
    expect(gopVuaTao(ds, [{ id: "c", t: 3 }, { id: "a", t: 0 }])).toEqual([...ds, { id: "c", t: 3 }])
  })

  it("đọc lại sản phẩm vừa tạo đúng câu select của màn gọi", () => {
    const L = ma("src/lib/tao-nhanh/vua-tao.ts")
    const f = cat(L, "export async function docSanPhamVuaTao", "\n}\n")
    expect(f).toContain('.from("products").select(select).eq("id", id).maybeSingle()')
  })

  it("dòng tạo mới tự vẽ: cùng nhãn, mousedown không cướp tiêu điểm, trao chữ đã trim", () => {
    const D = ma("src/components/ui/dong-tao-moi.tsx")
    expect(D).toContain("onMouseDown={(e) => e.preventDefault()}")
    expect(D).toContain("onClick={() => onTao(chu.trim())}")
    expect(D).toContain("{nhanTaoMoi(nhan, chu)}")
  })
})

/**
 * Quét MỌI `<SearchSelect>` / `<ProductPicker>` ngoài bán hàng / POS: có `taoMoi`, hoặc nằm trong danh sách
 * miễn có lý do. Cắt mỗi phần tử từ dòng mở tới dòng `/>` CÙNG THỤT LỀ (prop có JSX con như
 * `hint={<CatalogueShortNote />}` nên không lấy `/>` đầu tiên).
 */
function oChonTrongTep(rel: string): Array<{ key: string; body: string }> {
  const lines = ma(rel).split("\n")
  const out: Array<{ key: string; body: string }> = []
  lines.forEach((l, i) => {
    const m = l.match(/^(\s*)<(SearchSelect|ProductPicker)\b/)
    if (!m) return
    let j = i + 1
    while (j < lines.length && !(lines[j].trim() === "/>" && lines[j].startsWith(m[1]) && !lines[j].startsWith(m[1] + " "))) j++
    const body = lines.slice(i, j + 1).join("\n")
    const id = body.match(/\bid=(?:"([^"]+)"|\{`([^`]+)`\}|\{(\w+)\})/)
    out.push({ key: `${rel}#${id ? id[1] ?? id[2] ?? id[3] : "?"}`, body })
  })
  return out
}
function tepTsx(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) tepTsx(p, acc)
    else if (n.endsWith(".tsx")) acc.push(p)
  }
  return acc
}
/** Ô KHÔNG có dòng tạo mới — mỗi ô một lý do. Lọc danh sách không tạo mới (chủ nhà: chỉ ô chọn để làm việc). */
const KHONG_TAO_MOI: Record<string, string> = {
  "src/app/(dashboard)/orders/page.tsx#ord-customer": "lọc danh sách",
  "src/app/(dashboard)/sales-invoices/page.tsx#inv-customer": "lọc danh sách",
  "src/app/(dashboard)/receivables/aging/page.tsx#aging-customer": "tra cứu tuổi nợ — khách mới không có nợ",
  "src/app/(dashboard)/returns/[id]/page.tsx#ret-seller": "nhân viên — không có form tạo",
  "src/components/customers/customer-form.tsx#customer-ward": "danh mục phường / xã cố định",
  "src/components/customers/tao-khach-dien-thoai.tsx#tk-ward": "danh mục phường / xã cố định",
  "src/components/customers/tao-khach-dien-thoai.tsx#tk-group": "nhóm khách — không có form tạo nhanh",
  "src/components/suppliers/merge-supplier-dialog.tsx#gop-ncc-vao": "gộp vào NCC ĐÃ CÓ — tạo NCC mới để gộp là vô nghĩa",
  "src/components/finance/phieu-chi-ncc.tsx#pc-ncc": "phiếu chi trả nợ NCC ĐÃ CÓ (mig 242) — NCC vừa tạo chưa nợ đồng nào",
}

describe("mọi ô chọn có tìm (trừ bán hàng / POS) có dòng “+ Tạo mới”, gác theo quyền", () => {
  const files = [...tepTsx("src/app"), ...tepTsx("src/components")]
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !/^src\/app\/\(dashboard\)\/sell\/|^src\/components\/sell\/|^src\/app\/pos|^src\/components\/pos|^src\/components\/ui\//.test(p))
  const oChon = files.flatMap(oChonTrongTep)

  it("phép quét thấy đủ các ô đã nối (không âm thầm quét rỗng)", () => {
    const co = new Set(oChon.map((o) => o.key))
    for (const k of [
      "src/components/purchasing/purchase-receipt-form.tsx#pr-supplier",
      "src/components/purchasing/purchase-return-form.tsx#pr-supplier",
      "src/components/purchasing/purchasing-lines-editor.tsx#pr-find",
      "src/app/(dashboard)/payables/new/page.tsx#payable-supplier",
      "src/components/products/product-form.tsx#primary_supplier",
      "src/app/(dashboard)/inventory/stock-issue/page.tsx#si-find",
      /* `/returns/new` (07/10/2026) là màn kiểu /sell — tạo nhanh khách / SP ở khung chọn khách và ô tìm hàng
         (`onTaoKhach`, `onTaoSp`), chốt riêng ở dưới. */
      "src/components/orders/invoice-editor.tsx#inv-add-find",
      "src/components/orders/invoice-editor.tsx#inv-add-return",
      "src/app/(dashboard)/inventory/batches/new/page.tsx#batch-product",
      "src/app/(dashboard)/hr/bonus-config/page.tsx#bonus-product-${idx}",
      "src/app/(dashboard)/sales/pjp/page.tsx#pjp-add-customer",
      "src/components/customers/tao-khach-dien-thoai.tsx#tk-route",
      "src/components/customers/customer-form.tsx#customer-route",
    ]) expect(co.has(k), `không thấy ô ${k}`).toBe(true)
  })

  it("ô nào cũng có taoMoi, trừ danh sách miễn — và danh sách miễn không thừa tên", () => {
    const thieu = oChon.filter((o) => !o.body.includes("taoMoi=") && !(o.key in KHONG_TAO_MOI)).map((o) => o.key)
    expect(thieu, "ô chọn có tìm chưa có dòng tạo mới:\n  " + thieu.join("\n  ")).toEqual([])
    const keys = new Set(oChon.map((o) => o.key))
    for (const k of Object.keys(KHONG_TAO_MOI)) {
      expect(keys.has(k), `${k} không còn — xoá khỏi KHONG_TAO_MOI`).toBe(true)
      expect(oChon.find((o) => o.key === k)!.body, `${k} đã có taoMoi — xoá khỏi KHONG_TAO_MOI`).not.toContain("taoMoi=")
    }
  })

  /** ⚠ Không quyền thì KHÔNG truyền `taoMoi` (dòng không hiện), chứ không hiện rồi báo lỗi lúc lưu. */
  it("taoMoi luôn gác theo quyền (duocTaoNhanh / cờ quyền), không truyền trơn", () => {
    for (const o of oChon) {
      const i = o.body.indexOf("taoMoi=")
      if (i < 0) continue
      const gt = o.body.slice(i, i + 160)
      expect(/duocTaoNhanh\(|coQuyen\w*\s*\n?\s*\?|coQuyen\w* \?/.test(gt), `${o.key}: taoMoi không gác quyền`).toBe(true)
    }
  })
})

describe("tạo xong: chọn luôn / thêm luôn dòng ở đúng chỗ", () => {
  it("phiếu nhập hàng / trả NCC: NCC vừa tạo ghép vào ô và được chọn", () => {
    for (const rel of ["src/components/purchasing/purchase-receipt-form.tsx", "src/components/purchasing/purchase-return-form.tsx"]) {
      const F = ma(rel)
      expect(F).toContain('duocTaoNhanh(user?.role, "ncc")')
      expect(F).toContain("gopVuaTao(suppliers, nccMoi).map(")
      const xong = cat(F, "<TaoNhanhNcc", "/>\n")
      expect(xong).toContain("setNccMoi((ds) => gopVuaTao(ds,")
      expect(xong).toContain("onChange({ supplierId: n.id })")
    }
  })

  /** ⚠ Bản ghi `ProductForm` trả về chưa có đơn vị quy đổi — đọc lại đúng câu select rồi mới thêm dòng. */
  it("bảng hàng mua: SP vừa tạo đọc lại kèm đơn vị, ghép vào danh mục, thêm một dòng", () => {
    const F = ma("src/components/purchasing/purchasing-lines-editor.tsx")
    expect(F).toContain('const coQuyenTaoSp = duocTaoNhanh(user?.role, "san-pham")')
    expect(F).toContain("const products = useMemo(() => gopVuaTao(danhMuc, spMoi), [danhMuc, spMoi])")
    const f = cat(F, "const daTaoSanPham = async", "const toggleDiscountMode")
    expect(f).toContain("docSanPhamVuaTao<ReceiptProduct>(createClient(), p.id, COT_SAN_PHAM_MUA)")
    expect(f).toContain("setSpMoi((ds) => gopVuaTao(ds, [moi]))")
    expect(f).toContain("addProduct(moi)")
    expect(cat(F, "<TaoNhanhSanPham", "/>")).toContain("daTaoSanPham(p as ReceiptProduct)")
  })

  it("công nợ NCC: bỏ <Select> + link “Tạo NCC mới”, ô tìm có tạo mới, tạo xong chọn luôn", () => {
    const P = ma("src/app/(dashboard)/payables/new/page.tsx")
    expect(P).not.toContain('href="/suppliers/new"')
    expect(P).not.toContain("value={form.supplier_id}\n")
    expect(P).toContain('duocTaoNhanh(user?.role, "ncc")')
    const xong = cat(P, "<TaoNhanhNcc", "/>\n")
    expect(xong).toContain("supplier_id: n.id")
    expect(xong).toContain("setSuppliers((ds) => gopVuaTao(ds,")
  })

  /** ⚠ Khung NCC LỒNG trong khung tạo sản phẩm (hộp thoại chồng hộp thoại) — gắn luôn NCC vào SP đang tạo. */
  it("biểu mẫu SP: NCC là ô tìm có tạo mới, tạo xong gắn luôn vào SP", () => {
    const F = ma("src/components/products/product-form.tsx")
    expect(F).not.toContain('<SelectTrigger id="primary_supplier">')
    expect(cat(F, '<SearchSelect\n                id="primary_supplier"', "/>")).toContain('duocTaoNhanh(user?.role, "ncc")')
    const xong = cat(F, "<TaoNhanhNcc", "/>")
    expect(xong).toContain("onNccVuaTao({ id: n.id, name: n.name })")
    expect(xong).toContain("primary_supplier_id: n.id")
    expect(F).toContain("onNccVuaTao={(n) => setSuppliers((ds) => gopVuaTao(ds, [n]))}")
  })

  it("phiếu xuất kho: SP vừa tạo đọc lại, ghép, thêm dòng", () => {
    const P = ma("src/app/(dashboard)/inventory/stock-issue/page.tsx")
    const xong = cat(P, "<TaoNhanhSanPham", "/>")
    expect(xong).toContain("docSanPhamVuaTao<IssueProduct>(supabase, sp.id, COT_SP_XUAT)")
    expect(xong).toContain("setProducts((ds) => gopVuaTao(ds, [moi]))")
    expect(xong).toContain("addProduct(moi)")
  })

  it("phiếu trả hàng: khách vừa tạo được chọn; SP vừa tạo ghép (productById tra ở đó) rồi thêm dòng", () => {
    const P = ma("src/app/(dashboard)/returns/new/page.tsx")
    const kh = cat(P, "<TaoNhanhKhach", "/>\n")
    expect(kh).toContain("setCustomerId(k.id)")
    expect(kh).toContain("setCustomers((ds) =>")
    const sp = cat(P, "<TaoNhanhSanPham", "/>\n")
    expect(sp).toContain("setProducts((ds) => gopVuaTao(ds, [moi]))")
    expect(sp).toContain("addReturnLine(prev, {")
    /* Màn kiểu /sell: nút tạo nhanh có ở khung chọn khách và khi tìm hàng không ra — gác theo quyền. */
    expect(P).toContain('onTaoKhach={duocTaoNhanh(user?.role, "khach") ?')
    expect(P).toContain('onTaoSp={duocTaoNhanh(user?.role, "san-pham") ?')
  })

  it("hóa đơn: hai ô (hàng bán / hàng đổi trả) mở chung một khung, thêm đúng vào ô đã mở", () => {
    const F = ma("src/components/orders/invoice-editor.tsx")
    expect(F).toContain('setTaoSp({ chu, dich: "ban" })')
    expect(F).toContain('setTaoSp({ chu, dich: "tra" })')
    const f = cat(F, "const daTaoSanPham = async", "const submit = async")
    expect(f).toContain("docSanPhamVuaTao<PricedProduct>(supabase, sp.id, COT_DANH_MUC_HD)")
    expect(f).toContain("setCatalog((ds) => gopVuaTao(ds, [moi]))")
    expect(f).toContain('if (dich === "ban") void addProduct(moi)')
    expect(f).toContain("else addReturn(moi)")
    expect(cat(F, '<ProductPicker\n                    closeOnPick\n                    id="inv-add-return"', "/>")).toContain("onPick={(p) => addReturn(p)}")
  })

  it("tạo lô: SP là ô tìm trên CẢ danh mục, tạo xong chọn luôn", () => {
    const P = ma("src/app/(dashboard)/inventory/batches/new/page.tsx")
    expect(P).toContain('loadCatalogue<Product>(supabase, "id, sku, name, barcode", { activeOnly: true })')
    expect(P).not.toContain("<SelectTrigger>")
    expect(cat(P, "<TaoNhanhSanPham", "/>")).toContain("setProductId(sp.id)")
  })

  it("cấu hình thưởng: SP là ô tìm (giữ “Mọi sản phẩm”), tạo xong gán cho đúng dòng thưởng", () => {
    const P = ma("src/app/(dashboard)/hr/bonus-config/page.tsx")
    expect(P).toContain('{ id: "_all", label: "— Mọi sản phẩm —" }')
    expect(P).toContain('onPick={(o) => ganSanPham(idx, !o || o.id === "_all" ? null : o.id)}')
    expect(P).toContain("setTaoSp({ chu, idx })")
    expect(cat(P, "<TaoNhanhSanPham", "/>")).toContain("ganSanPham(taoSp.idx, moi.id, ds)")
    /* Đổi SP → ĐVT về đơn vị cơ sở của SP mới (luật cũ giữ nguyên). */
    expect(cat(P, "const ganSanPham =", "})\n")).toContain("if (newProd) newUnit = newProd.base_unit")
  })

  it("xuất kho theo đơn: hộp chọn SP đổi dự phòng có dòng tạo, tạo xong thêm dòng đổi", () => {
    const P = ma("src/app/(dashboard)/inventory/stock-out/page.tsx")
    expect(P).toContain('const coQuyenTaoSp = duocTaoNhanh(user?.role, "san-pham")')
    expect(cat(P, "{coQuyenTaoSp && (", "/>")).toContain("<DongTaoMoi")
    const xong = cat(P, "<TaoNhanhSanPham", "/>\n")
    expect(xong).toContain("setProductCatalog((ds) => gopVuaTao(ds,")
    expect(xong).toContain("addSwapItem(")
  })

  it("sửa đơn: hộp Đổi SP và hộp Thêm SP đều có dòng tạo; tạo xong làm đúng việc của hộp đã mở", () => {
    const P = ma("src/app/(dashboard)/orders/[id]/page.tsx")
    expect(P).toContain('setTaoSp({ chu, dich: "doi", lineId: swapDialogFor })')
    expect(P).toContain('setTaoSp({ chu, dich: "them" })')
    expect(P.split('duocTaoNhanh(user?.role, "san-pham") &&').length - 1).toBe(2)
    const xong = cat(P, "<TaoNhanhSanPham", "/>\n")
    expect(xong).toContain("setSwapCatalog((ds) => gopVuaTao(ds, [moi]))")
    expect(xong).toContain('if (taoSp?.dich === "doi") applySwap(taoSp.lineId, moi)')
    expect(xong).toContain("else appendAddedLine(moi)")
  })

  it("kiểm kê (máy tính + điện thoại): danh sách gợi ý có dòng tạo kể cả khi rỗng, tạo xong thêm dòng", () => {
    const P = ma("src/app/(dashboard)/inventory/stocktake-adjust/page.tsx")
    expect(P).toContain('const taoMoiSp = duocTaoNhanh(user?.role, "san-pham")')
    expect(P).toContain("{searchOpen && (matches.length > 0 || taoMoiSp) && (")
    expect(P).toContain("taoMoi={taoMoiSp}")
    expect(cat(P, "<TaoNhanhSanPham", "/>")).toContain("addRow({ ...sp, batches: [] })")
    const M = ma("src/components/inventory/kiem-ke-mobile.tsx")
    expect(M).toContain("{searchOpen && (matches.length > 0 || taoMoi) && (")
    const xo = cat(M, 'data-testid="kiem-ke-goi-y"', "Tải toàn bộ tồn kho")
    expect(xo.indexOf("<DongTaoMoi")).toBeGreaterThan(xo.indexOf("matches.map("))
  })

  it("tuyến viếng thăm: đọc ĐỦ khách (không .limit(500)), ô tìm có tạo mới, tạo xong thêm luôn vào ngày", () => {
    const P = ma("src/app/(dashboard)/sales/pjp/page.tsx")
    expect(P).not.toContain(".limit(500)")
    expect(cat(P, "const fetchCustomers = useCallback", "}, [user")).toContain("fetchAllForAggregate<")
    expect(P).toContain('duocTaoNhanh(user?.role, "khach")')
    expect(cat(P, "<TaoNhanhKhach", "/>")).toContain("addCustomerToDay(k.id, moi)")
    expect(P).toContain("const cust = coSan ?? customers.find((c) => c.id === customerId)")
  })
})
