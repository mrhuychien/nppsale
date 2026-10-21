/**
 * MODAL THÔNG TIN ĐỐI TÁC Ở POS — chủ nhà 21/10/2026: "Phần tạo đơn POS : phần Khách hàng / NCC khi ấn vào hiện modal
 * xem thông tin đầy đủ và sửa các thông tin".
 *
 * Luật thuần (`@/lib/pos/doi-tac`), đường lưu NCC dùng chung (`luuHoSoNcc`), biểu mẫu khách khi sửa trong hộp thoại, và
 * chốt nối: MỌI thẻ đối tác ở POS mở được modal. Bấm thật: e2e/pos-thong-tin-doi-tac.spec.ts.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { doiTacSauSua, gopTheoId, metaKhach, metaNcc } from "@/lib/pos/doi-tac"
import { luuHoSoNcc, LoiNhapNcc } from "@/lib/suppliers/luu-ho-so"
import { nccFormRong } from "@/lib/suppliers/form"
import { GHI_BI_TU_CHOI } from "@/lib/db/must-write"
import type { SupabaseClient } from "@supabase/supabase-js"

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

describe("dòng phụ thẻ đối tác", () => {
  it("khách: SĐT · địa chỉ; NCC: mã · SĐT · địa chỉ — bỏ ô trống", () => {
    expect(metaKhach({ phone: "0911", address: "1 Lê Lợi" })).toBe("0911 · 1 Lê Lợi")
    expect(metaKhach({ phone: " ", address: "1 Lê Lợi" })).toBe("1 Lê Lợi")
    expect(metaNcc({ code: "NCC1", phone: null, address: "KCN" })).toBe("NCC1 · KCN")
    expect(metaNcc({})).toBe("")
  })
})

describe("gopTheoId — danh mục POS theo bản vừa sửa", () => {
  const ds = [
    { id: "a", store_name: "Cô Ba", group_id: null as string | null, credit_limit: 0 },
    { id: "b", store_name: "Minh", group_id: "g1" as string | null, credit_limit: 5 },
  ]
  it("gộp đúng dòng (nhóm giá + hạn mức mới), dòng khác giữ nguyên", () => {
    const moi = gopTheoId(ds, { id: "a", store_name: "Cô Ba Mới", group_id: "g1", credit_limit: 100 })
    expect(moi[0]).toEqual({ id: "a", store_name: "Cô Ba Mới", group_id: "g1", credit_limit: 100 })
    expect(moi[1]).toBe(ds[1])
    expect(ds[0].store_name).toBe("Cô Ba") // không sửa mảng cũ (state React)
  })
  it("không có trong danh mục (khách Tạm ngưng / Khoá) thì KHÔNG chèn thêm", () => {
    expect(gopTheoId(ds, { id: "zzz", store_name: "Lạ" })).toBe(ds)
  })
})

describe("doiTacSauSua — thẻ của chứng từ đang mở", () => {
  const the = { id: "a", name: "Cô Ba", meta: "0911", debt: 250000 }
  it("đổi tên + dòng phụ, GIỮ công nợ đã đọc", () => {
    expect(doiTacSauSua(the, "a", "Cô Ba Mới", "0911 · 1 Lê Lợi")).toEqual({ id: "a", name: "Cô Ba Mới", meta: "0911 · 1 Lê Lợi", debt: 250000 })
  })
  it("thẻ đã đổi sang đối tác khác / chưa chọn thì để nguyên; tên rỗng giữ tên cũ", () => {
    expect(doiTacSauSua(the, "b", "Khác", "")).toBe(the)
    expect(doiTacSauSua(null, "a", "X", "")).toBeNull()
    expect(doiTacSauSua(the, "a", "  ", "m")?.name).toBe("Cô Ba")
  })
})

describe("luuHoSoNcc — một đường lưu NCC cho chi tiết NCC + POS", () => {
  const sbGia = (tra: { data: unknown; error: unknown }) => {
    const ghi: Array<{ payload: unknown; id: unknown }> = []
    const sb = {
      from: (bang: string) => ({
        update: (payload: unknown) => ({
          eq: (_c: string, id: unknown) => ({
            select: async () => {
              ghi.push({ payload, id })
              expect(bang).toBe("suppliers")
              return tra
            },
          }),
        }),
      }),
    }
    return { sb: sb as unknown as SupabaseClient, ghi }
  }
  const f = { ...nccFormRong("Vinamilk"), code: "NCC1", phone: "0933" }

  it("ghi đúng NCC, trả tải trọng đã ghi", async () => {
    const { sb, ghi } = sbGia({ data: [{ id: "n1" }], error: null })
    const p = await luuHoSoNcc(sb, "n1", f, { ...f, phone: "" })
    expect(ghi).toHaveLength(1)
    expect(ghi[0].id).toBe("n1")
    expect(p).toMatchObject({ name: "Vinamilk", phone: "0933", code: "NCC1" })
  })
  it("lỗi nhập (tên trống) → LoiNhapNcc, KHÔNG gửi gì đi", async () => {
    const { sb, ghi } = sbGia({ data: [], error: null })
    await expect(luuHoSoNcc(sb, "n1", { ...f, name: "  " }, f)).rejects.toBeInstanceOf(LoiNhapNcc)
    expect(ghi).toHaveLength(0)
  })
  it("database từ chối trong im lặng (RLS, 0 dòng) → NÉM, không báo 'Đã cập nhật'", async () => {
    const { sb } = sbGia({ data: [], error: null })
    await expect(luuHoSoNcc(sb, "n1", f, f)).rejects.toThrow(GHI_BI_TU_CHOI)
  })
  it("tấm Sửa ở chi tiết NCC cũng đi qua luuHoSoNcc (không tự ghi riêng)", () => {
    const s = read("src/components/suppliers/supplier-edit-sheet.tsx")
    expect(s).toContain("await luuHoSoNcc(createClient(), supplier.id, form, goc.current)")
    expect(s).not.toMatch(/from\("suppliers"\)\.update/)
  })
})

describe("CustomerForm sửa trong hộp thoại (onDaSua)", () => {
  const F = read("src/components/customers/customer-form.tsx")
  const luu = F.slice(F.indexOf("const handleSubmit"), F.indexOf("const hasGps"))
  it("lưu xong trả bản đã ghi cho nơi gọi rồi DỪNG — trước mọi router.push (chứng từ POS không mất)", () => {
    const nhanh = luu.indexOf("if (onDaSua && customer) {")
    expect(nhanh).toBeGreaterThan(0)
    expect(luu.slice(nhanh, nhanh + 120)).toMatch(/onDaSua\(\{ \.\.\.customer, \.\.\.payload \} as Customer\)\s*return/)
    expect(nhanh).toBeLessThan(luu.indexOf("router.push("))
    // Danh mục /sell + ô lọc khách vẫn được báo cũ TRƯỚC khi trả về.
    expect(luu.indexOf("lamCuDanhMucBan()")).toBeLessThan(nhanh)
  })
  it("sửa khách: RLS 0 dòng là lỗi (ghiPhaiTrungDong), toạ độ vẫn không gửi lại", () => {
    expect(luu).toContain('await ghiPhaiTrungDong(supabase.from("customers").update(payload).eq("id", customer.id))')
    expect(luu).toContain("if (!customer && form.gps_lat && form.gps_lng) {")
  })
  it("trong hộp thoại: không khung thẻ, không link rời trang, không nút Định vị (máy POS ở văn phòng)", () => {
    expect(F).toContain("const trongHop = !!onDaTao || !!onDaSua")
    expect(F).toContain("if (trongHop) return <>{bieuMau}{khungTuyen}</>")
    expect(F.match(/\{!trongHop && /g) ?? []).toHaveLength(2)
    expect(F).toMatch(/\{onDaSua \? \(\s*<span[^>]*>Vị trí điểm bán dời ở hồ sơ khách<\/span>\s*\) : \(\s*<Button/)
  })
})

describe("modal: quyền, tab mới, phím tắt", () => {
  const M = read("src/components/pos/partner-info-modal.tsx")
  it("Sửa khách theo customers.update (như hồ sơ khách), sửa NCC theo inventory.update (như chi tiết NCC)", () => {
    expect(M).toContain('hasPermission(user.role, "customers", "update")')
    expect(M).toContain('hasPermission(user.role, "inventory", "update")')
    expect(read("src/app/(dashboard)/customers/[id]/page.tsx")).toContain('hasPermission(user.role, "customers", "update")')
    expect(read("src/app/(dashboard)/suppliers/[id]/page.tsx")).toContain('hasPermission(user.role, "inventory", "update")')
  })
  it("dùng lại biểu mẫu đang có — không có form thứ hai", () => {
    expect(M).toContain("<CustomerForm customer={row} groups={groups} onDaSua={xongSua}")
    expect(M).toContain("<SupplierFields form={form}")
    expect(M).toContain("await luuHoSoNcc(createClient(), row.id, form, goc)")
  })
  it("'Mở hồ sơ' mở tab mới (rời tab POS là mất chứng từ); phím tắt POS bị chặn trong hộp", () => {
    expect(M).toContain("<NewTabLink href={`/customers/${row.id}`}")
    expect(M).toContain("<NewTabLink href={`/suppliers/${row.id}`}")
    expect(M.match(/onKeyDown=\{chanPhimPos\}/g) ?? []).toHaveLength(2)
    expect(M).toContain("if (posKeyOf(e.key)) e.stopPropagation()")
  })
  it("công nợ đọc bằng hàm chung, chưa đọc được thì không hiện 0", () => {
    expect(M).toContain("loadCustomerDebt(sb, customerId)")
    expect(M).toContain("loadSupplierDebt(sb, supplierId)")
    expect(M).toContain('if (no === null) return <span className="font-normal text-muted-foreground">chưa đọc được</span>')
  })
})

describe("chốt nối: MỌI thẻ đối tác ở POS mở được modal", () => {
  const dung = moiTep("src").filter((p) => read(p).includes("<PartnerCard"))
  it("đủ sáu màn (đơn, hoá đơn, xem hoá đơn, trả hàng, nhập hàng, trả NCC)", () => {
    expect(dung.sort()).toEqual(
      [
        "src/app/pos/hoa-don/[id]/page.tsx",
        "src/components/pos/invoice-screen.tsx",
        "src/components/pos/order-screen.tsx",
        "src/components/pos/purchase-screen.tsx",
        "src/components/pos/return-screen.tsx",
        "src/components/pos/supplier-return-screen.tsx",
      ].sort()
    )
  })
  it.each(dung)("%s: thẻ có onOpen, vẽ modal đúng loại, sửa xong cập nhật danh mục", (p) => {
    const s = read(p)
    const the = s.slice(s.indexOf("<PartnerCard"), s.indexOf("/>", s.indexOf("<PartnerCard")))
    expect(the).toMatch(/onOpen=\{\(\) => setXem(Khach|Ncc)\(true\)\}/)
    const laNcc = the.includes('label="nhà cung cấp"')
    if (laNcc) {
      expect(s).toContain("<NccPosModal")
      expect(s).toContain("capNhatNcc(s)")
    } else {
      expect(s).toContain("<KhachPosModal")
      expect(s).toContain("capNhatKhach(c)")
    }
  })
})

describe("PartnerCard", () => {
  const C = read("src/components/pos/partner-card.tsx")
  it("onOpen biến tên + dòng phụ thành MỘT nút; nút Đổi / × nằm ngoài nút ấy", () => {
    const nut = C.slice(C.indexOf("{onOpen ? ("), C.indexOf(") : (", C.indexOf("{onOpen ? (")))
    expect(nut).toContain("onClick={onOpen}")
    expect(nut).toContain("aria-label={`Xem thông tin ${label}: ${partner.name}`}")
    expect(nut).not.toContain("onPick")
    expect(nut).not.toContain("onClear")
  })
  it("store POS có capNhatKhach / capNhatNcc gộp qua gopTheoId", () => {
    const S = read("src/store/pos/ref-data.tsx")
    expect(S).toContain("setCustomers((ds) => gopTheoId(ds, c))")
    expect(S).toContain("setSuppliers((ds) => gopTheoId(ds, s))")
  })
})

