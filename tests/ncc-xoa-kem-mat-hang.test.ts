import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  buocXoaNcc, duocQuyenXoaNcc, loiNcc, moTaKetQuaXoaNcc, soMatHangNcc, VAI_TRO_XOA_NCC,
} from "@/lib/suppliers/chi-tiet"
import { hrefPhieuNhapMoi, hrefTraNccMoi, nccTuLink } from "@/lib/purchasing/ncc-tu-link"
import { posNewPurchaseHref, posNewSupplierReturnHref, posTargetFor } from "@/lib/nav/pos-preview"

/**
 * Chủ nhà 05/10/2026 (mig 233): "Hỏi lại có muốn xoá mặt hàng kèm ncc không? Nếu có xoá luôn cả mặt hàng. Nếu mặt
 * hàng có trong các phiếu -> đổi về ngừng bán." · "Chỉ NPP được xoá" · nút Tạo phiếu nhập / Trả hàng NCC chọn sẵn NCC.
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
/** Bỏ dòng chú thích (quét từng dòng — xem SKILL "Testing UI by reading source"). */
function code(src: string): string {
  const out: string[] = []
  let trongKhoi = false
  for (const line of src.split("\n")) {
    const t = line.trim()
    if (trongKhoi) {
      if (t.includes("*/")) trongKhoi = false
      continue
    }
    if (t.startsWith("{/*") || t.startsWith("/*")) {
      if (!t.includes("*/")) trongKhoi = true
      continue
    }
    if (t.startsWith("*") || t.startsWith("//") || t.startsWith("--")) continue
    out.push(line)
  }
  return out.join("\n")
}
const cat = (s: string, dau: string, cuoi: string) => {
  const i = s.indexOf(dau)
  expect(i, `không thấy mốc ${dau}`).toBeGreaterThan(-1)
  const j = s.indexOf(cuoi, i + dau.length)
  expect(j, `không thấy mốc ${cuoi}`).toBeGreaterThan(i)
  return s.slice(i, j)
}

describe("buocXoaNcc — xoá ngay / hỏi xoá kèm mặt hàng / không xoá được", () => {
  it("không có gì → xoá (xác nhận đơn giản)", () => {
    expect(buocXoaNcc({ tong: 0, chi_tiet: [] })).toBe("xoa")
  })
  it("chỉ còn mặt hàng → hỏi xoá kèm mặt hàng, đếm đúng số mặt hàng", () => {
    const so = { tong: 3, chi_tiet: [{ bang: "products", cot: "primary_supplier_id", so: 3 }] }
    expect(buocXoaNcc(so)).toBe("hoi-mat-hang")
    expect(soMatHangNcc(so)).toBe(3)
  })
  it("có chứng từ (kể cả kèm mặt hàng) → không xoá được", () => {
    expect(buocXoaNcc({ tong: 2, chi_tiet: [{ bang: "products", so: 1 }, { bang: "payables", so: 1 }] })).toBe("co-chung-tu")
    expect(buocXoaNcc({ tong: 1, chi_tiet: [{ bang: "stock_entries", so: 1 }] })).toBe("co-chung-tu")
    expect(buocXoaNcc(null)).toBe("co-chung-tu")
  })
  it("dòng chứng từ 0 phiếu không tính là chứng từ", () => {
    expect(buocXoaNcc({ tong: 2, chi_tiet: [{ bang: "products", so: 2 }, { bang: "payables", so: 0 }] })).toBe("hoi-mat-hang")
  })
})

describe("kết quả / lỗi / quyền", () => {
  it("moTaKetQuaXoaNcc kể số xoá / ngừng bán / gỡ, bỏ số 0", () => {
    expect(moTaKetQuaXoaNcc({ mat_hang_da_xoa: 2, mat_hang_ngung_ban: 1, mat_hang_go: 0 }))
      .toBe("Đã xoá 2 mặt hàng · 1 mặt hàng đã có trong phiếu chuyển Ngừng bán")
    expect(moTaKetQuaXoaNcc({ mat_hang_go: 3 })).toBe("3 mặt hàng giữ lại, bỏ trống NCC chính")
    expect(moTaKetQuaXoaNcc({})).toBe("")
    expect(moTaKetQuaXoaNcc(null)).toBe("")
  })
  it("chỉ Chủ NPP xoá được NCC", () => {
    expect(duocQuyenXoaNcc("owner")).toBe(true)
    for (const r of ["manager", "accountant", "warehouse", "sales", null, undefined]) expect(duocQuyenXoaNcc(r)).toBe(false)
  })
  it("loiNcc: mã quyền xoá NCC → câu riêng (không lẫn câu quyền gộp)", () => {
    expect(loiNcc("KHONG_DU_QUYEN_XOA_NCC: chỉ Chủ NPP được xoá nhà cung cấp")).toBe("Chỉ Chủ NPP được xoá nhà cung cấp.")
    expect(loiNcc("KHONG_DU_QUYEN: x")).toMatch(/gộp NCC/)
  })
})

describe("NCC đi kèm đường dẫn", () => {
  it("điện thoại: ?ncc=<id>; không id thì đường cũ", () => {
    expect(hrefPhieuNhapMoi("n 1")).toBe("/purchasing/receipts/new?ncc=n%201")
    expect(hrefTraNccMoi("n1")).toBe("/purchase-returns/new?ncc=n1")
    expect(hrefPhieuNhapMoi("")).toBe("/purchasing/receipts/new")
    expect(hrefTraNccMoi(null)).toBe("/purchase-returns/new")
  })
  it("máy tính: cửa POS mang tiếp ?ncc", () => {
    expect(posTargetFor(hrefPhieuNhapMoi("n1"))).toBe("/pos/nhap-hang/moi?ncc=n1")
    expect(posTargetFor(hrefTraNccMoi("n1"))).toBe("/pos/tra-ncc/moi?ncc=n1")
    expect(posNewPurchaseHref()).toBe("/pos/nhap-hang/moi")
    expect(posNewSupplierReturnHref("  ")).toBe("/pos/tra-ncc/moi")
  })
  it("nccTuLink: chỉ chọn NCC có trong danh sách đã nạp", () => {
    const ds = [{ id: "a" }, { id: "b" }]
    expect(nccTuLink("b", ds)).toBe("b")
    expect(nccTuLink(" b ", ds)).toBe("b")
    expect(nccTuLink("x", ds)).toBe("")
    expect(nccTuLink(null, ds)).toBe("")
    expect(nccTuLink("a", [])).toBe("")
  })
})

describe("nguồn: vùng nguy hiểm / chi tiết / màn lập phiếu / POS", () => {
  const DZ = code(doc("src/components/suppliers/supplier-danger-zone.tsx"))
  const P = code(doc("src/app/(dashboard)/suppliers/[id]/page.tsx"))

  it("vùng nguy hiểm: chỉ còn mặt hàng → hỏi 'Xoá luôn N mặt hàng' với ba lựa chọn đúng tham số", () => {
    expect(cat(DZ, "const hoiXoa = async", "const xoa = async")).toContain(
      'buoc === "hoi-mat-hang" ? { b: "hoi-mat-hang", soHang: soMatHangNcc(so) }'
    )
    const khoi = cat(DZ, 'tt.b === "hoi-mat-hang" ? (', 'tt.b === "co-chung-tu" ?')
    expect(khoi).toContain("Xoá luôn {tt.soHang} mặt hàng của nhà cung cấp này?")
    expect(cat(khoi, "onClick={() => xoa(true)}", "</Button>")).toContain("Xoá NCC và mặt hàng")
    expect(cat(khoi, "onClick={() => xoa(false)}", "</Button>")).toContain("Chỉ xoá NCC, giữ mặt hàng")
    expect(cat(khoi, 'onClick={() => setTt({ b: "nghi" })}', "</Button>")).toContain("Hủy")
    expect(khoi).toContain("Mặt hàng đã có trong phiếu sẽ chuyển Ngừng bán")
  })
  it("vùng nguy hiểm: xác nhận đơn giản xoá KHÔNG kèm hàng", () => {
    expect(cat(DZ, 'tt.b === "xac-nhan" ? (', 'tt.b === "hoi-mat-hang" ? (')).toContain("onClick={() => xoa(false)}")
  })
  it("chi tiết: nút xoá chỉ Chủ NPP; Tạo phiếu nhập / Trả hàng NCC mang NCC theo, máy tính mở POS", () => {
    expect(P).toContain("const canDelete = duocQuyenXoaNcc(user?.role)")
    expect(P).toContain("diHoacMoPos(router.push, hrefPhieuNhapMoi(supplier.id))")
    expect(P).toContain("diHoacMoPos(router.push, hrefTraNccMoi(supplier.id))")
    expect(P).not.toContain('router.push("/purchase-returns/new")')
  })
  it("màn lập phiếu điện thoại: đọc ?ncc, chuyển POS mang tiếp, chọn sẵn chỉ khi có trong danh sách và chưa chọn", () => {
    for (const [f, fn] of [
      ["src/app/(dashboard)/purchasing/receipts/new/page.tsx", "posNewPurchaseHref"],
      ["src/app/(dashboard)/purchase-returns/new/page.tsx", "posNewSupplierReturnHref"],
    ] as const) {
      const S = code(doc(f))
      expect(S, f).toContain("const nccLink = useSearchParams().get(THAM_SO_NCC)")
      expect(S, f).toContain(`usePosDesktopRedirect(${fn}(nccLink))`)
      expect(S, f).toContain("const chonSan = nccTuLink(nccLink, dsNcc)")
      expect(S, f).toContain("if (chonSan) setForm((f) => (f.supplierId ? f : { ...f, supplierId: chonSan }))")
    }
  })
  it("POS nhập hàng / trả NCC: chọn sẵn NCC theo ?ncc chỉ cho phiếu mới, một lần, sau khi có danh mục NCC", () => {
    for (const [f, idv] of [
      ["src/components/pos/purchase-screen.tsx", "receiptId"],
      ["src/components/pos/supplier-return-screen.tsx", "returnId"],
    ] as const) {
      const S = code(doc(f))
      const k = cat(S, "const daChonNccTheoLink = useRef(false)", `}, [${idv}, suppliers, thamSo])`)
      expect(k, f).toContain(`if (daChonNccTheoLink.current || ${idv} || suppliers.length === 0) return`)
      expect(k, f).toContain("nccTuLink(thamSo.get(THAM_SO_NCC), suppliers)")
      expect(k, f).toContain("daChonNccTheoLink.current = true")
      expect(k, f).toContain("setNcc({ id: s.id, name: s.name,")
    }
  })
})

describe("migration 233", () => {
  const M = doc("supabase/migrations/233_xoa_ncc_kem_mat_hang.sql")
  const MC = code(M)
  const rpc = cat(MC, "CREATE OR REPLACE FUNCTION public.xoa_nha_cung_cap", "$fn$;")

  it("VÌ SAO trích lời chủ nhà, thẻ dollar ASCII, NOTIFY + SELECT tóm tắt", () => {
    expect(M).toMatch(/VÌ SAO — chủ nhà 05\/10\/2026/)
    expect(M).toContain("Hỏi lại có muốn xoá mặt hàng kèm ncc không?")
    expect(M).not.toMatch(/\$\$/)
    expect(M).toContain("NOTIFY pgrst, 'reload schema';")
    expect(M.slice(M.indexOf("NOTIFY pgrst"))).toMatch(/\nSELECT 'mig 233/)
  })
  it("hàm nội bộ REVOKE khỏi authenticated; RPC chỉ authenticated", () => {
    for (const fn of ["_mat_hang_co_chung_tu(uuid)", "_ncc_xoa_qua_rpc()"]) {
      expect(M).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`)
    }
    expect(M).toContain("REVOKE EXECUTE ON FUNCTION public.xoa_nha_cung_cap(uuid, boolean) FROM PUBLIC, anon;")
    expect(M).toContain("GRANT EXECUTE ON FUNCTION public.xoa_nha_cung_cap(uuid, boolean) TO authenticated;")
  })
  it("RPC: chỉ Chủ NPP — cùng danh sách vai với màn hình", () => {
    expect(rpc).toContain("SECURITY DEFINER")
    const vai = /public\.user_role\(\) IS DISTINCT FROM '([a-z]+)'/.exec(rpc)?.[1]
    expect([vai]).toEqual([...VAI_TRO_XOA_NCC])
  })
  it("RPC: còn chứng từ ngoài mặt hàng → NCC_CO_CHUNG_TU trước khi đụng mặt hàng", () => {
    const i = rpc.indexOf("RAISE EXCEPTION 'NCC_CO_CHUNG_TU")
    expect(i).toBeGreaterThan(0)
    expect(rpc).toContain("WHERE e->>'bang' <> 'products'")
    expect(i).toBeLessThan(rpc.indexOf("FROM products p WHERE p.primary_supplier_id = p_id"))
  })
  it("RPC: không xoá hàng → gỡ; mặt hàng đã có chứng từ → Ngừng bán + gỡ; còn lại xoá (vấp khoá ngoại → Ngừng bán)", () => {
    const vong = cat(rpc, "FROM products p WHERE p.primary_supplier_id = p_id", "END LOOP;")
    expect(vong).toContain("IF NOT p_xoa_hang OR r.org_id IS DISTINCT FROM v_org THEN\n      UPDATE products SET primary_supplier_id = NULL WHERE id = r.id;")
    expect(vong).toContain("ELSIF public._mat_hang_co_chung_tu(r.id) THEN\n      UPDATE products SET status = 'inactive', primary_supplier_id = NULL WHERE id = r.id;")
    const xoa = cat(vong, "DELETE FROM products WHERE id = r.id;", "END;")
    expect(xoa).toContain("EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN")
    expect(xoa).toContain("UPDATE products SET status = 'inactive', primary_supplier_id = NULL WHERE id = r.id;")
    expect(rpc.indexOf("DELETE FROM suppliers WHERE id = p_id;")).toBeGreaterThan(rpc.indexOf("END LOOP;"))
  })
  it("đã dùng = khoá ngoại không CASCADE trỏ vào products, hoặc lô còn tồn", () => {
    const f = cat(MC, "CREATE OR REPLACE FUNCTION public._mat_hang_co_chung_tu", "$fn$;")
    expect(f).toContain("k.confdeltype <> 'c'")
    expect(f).toContain("k.confrelid = 'public.products'::regclass")
    expect(f).toContain("FROM batches WHERE product_id = p_product_id AND COALESCE(qty_on_hand, 0) <> 0")
  })
  it("trigger chặn trình duyệt xoá thẳng NCC: BEFORE DELETE, KHÔNG definer (đọc current_user)", () => {
    expect(cat(MC, "CREATE TRIGGER trg_ncc_xoa_qua_rpc", ";")).toContain("BEFORE DELETE ON suppliers")
    const f = cat(MC, "CREATE OR REPLACE FUNCTION public._ncc_xoa_qua_rpc()", "$fn$;")
    expect(f).not.toContain("SECURITY DEFINER")
    expect(f).toContain("IF public._la_trinh_duyet() AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN")
  })
  it("khám sổ có dòng 72; danh sách RPC đã rà có xoa_nha_cung_cap", () => {
    expect(doc("scripts/sql/kham-so-that.sql")).toMatch(/SELECT 72, 'Mig 233/)
    expect(doc("scripts/sql/doi-test/danh-muc-rpc-nghi-viec.sql")).toContain("'xoa_nha_cung_cap'")
  })
})
