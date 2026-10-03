import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { conTroToiDa, dongTaoDangChon, nhanTaoMoi } from "@/lib/ui/tao-moi"
import { chuBanDauKhach } from "@/lib/customers/tao-khach"
import { chuBanDauTuyen } from "@/lib/customers/tuyen"
import { NHAN_TAO_NHANH, duocTaoNhanh } from "@/lib/tao-nhanh/quyen"

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
