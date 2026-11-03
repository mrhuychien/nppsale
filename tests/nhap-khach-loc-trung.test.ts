/**
 * MỌI LỐI TẠO KHÁCH QUA BƯỚC LỌC TRÙNG — chủ nhà 03/11/2026: "em rà soát luôn tất cả các chỗ tạo khách hàng đều phải qua
 * bước lọc trùng nhé". Phần nhập Excel: `kiemTrungSdtHangLoat` (hỏi sổ từng số, thấy cả khách NV khác), `sdtDeLuu` (số lưu
 * chuẩn hoá như tạo tay). Bấm thật: e2e/nhap-khach-loc-trung.spec.ts.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import type { SupabaseClient } from "@supabase/supabase-js"
import { DONG_THOI_KIEM_TRUNG, kiemTrungSdtHangLoat, sdtDeLuu, trungCuaDong } from "@/lib/customers/kiem-trung-hang-loat"
import { parseCustomerSheet } from "@/lib/customers/import-parse"

/** Sổ giả: `search_customer_dupes` trả khách theo số; đếm số lệnh đang chạy cùng lúc. */
function sbGia(khach: Record<string, { id: string; store_name: string; phone: string }>, loiSo?: string) {
  const goi: Array<{ fn: string; args: Record<string, unknown>; opt: unknown }> = []
  let dangChay = 0
  let nhieuNhat = 0
  const sb = {
    rpc(fn: string, args: Record<string, unknown>, opt?: unknown) {
      goi.push({ fn, args, opt })
      dangChay += 1
      nhieuNhat = Math.max(nhieuNhat, dangChay)
      return new Promise((r) => setTimeout(r, 1)).then(() => {
        dangChay -= 1
        const so = String(args.p_q)
        if (so === loiSo) return { data: null, error: { message: "máy chủ bận" } }
        const k = khach[so]
        return { data: k ? [k] : [], error: null }
      })
    },
  }
  return { sb: sb as unknown as SupabaseClient, goi, nhieuNhat: () => nhieuNhat }
}

describe("kiemTrungSdtHangLoat — hỏi sổ từng số của file nhập", () => {
  it("chuẩn hoá + bỏ trùng trước khi hỏi: '0911.111.111', '+84 911 111 111', '0911111111' là MỘT số; số dở / chữ không hỏi", async () => {
    const { sb, goi } = sbGia({ "0911111111": { id: "k1", store_name: "Tạp hoá Cô Ba", phone: "0911111111" } })
    const kq = await kiemTrungSdtHangLoat(sb, ["0911.111.111", "+84 911 111 111", "0911111111", "0911", "anh Ba", "", "0987 000 111"])
    expect(goi.map((g) => g.args.p_q).sort()).toEqual(["0911111111", "0987000111"])
    // Hàm chỉ đọc (STABLE) → GET, đúng tên hàm của màn "Tìm khách hàng đã có".
    expect(goi.every((g) => g.fn === "search_customer_dupes" && (g.opt as { get?: boolean })?.get === true)).toBe(true)
    expect(Array.from(kq.keys())).toEqual(["0911111111"])
    expect(kq.get("0911111111")?.store_name).toBe("Tạp hoá Cô Ba")
  })

  it("khớp theo CHỮ SỐ của khách trả về (sổ lưu '0911 111 111' vẫn là trùng)", async () => {
    const { sb } = sbGia({ "0911111111": { id: "k1", store_name: "Cô Ba", phone: "0911 111 111" } })
    expect((await kiemTrungSdtHangLoat(sb, ["0911111111"])).get("0911111111")?.id).toBe("k1")
  })

  it("không dồn máy chủ: tối đa DONG_THOI_KIEM_TRUNG lệnh cùng lúc; báo tiến độ tới đủ", async () => {
    const { sb, nhieuNhat } = sbGia({})
    const so = Array.from({ length: 30 }, (_, i) => `09870${String(i).padStart(5, "0")}`)
    const tienDo: Array<[number, number]> = []
    await kiemTrungSdtHangLoat(sb, so, { onTienDo: (x, t) => tienDo.push([x, t]) })
    expect(nhieuNhat()).toBeLessThanOrEqual(DONG_THOI_KIEM_TRUNG)
    expect(nhieuNhat()).toBeGreaterThan(1)
    expect(tienDo[0]).toEqual([0, 30])
    expect(tienDo.at(-1)).toEqual([30, 30])
  })

  it("một lượt hỏi hỏng → NÉM (kiểm thiếu một phần thì nhập tiếp sẽ tạo trùng)", async () => {
    const { sb } = sbGia({}, "0987000002")
    await expect(kiemTrungSdtHangLoat(sb, ["0987000001", "0987000002", "0987000003"])).rejects.toThrow("kiểm trùng số 0987000002: máy chủ bận")
  })
})

describe("sdtDeLuu / trungCuaDong", () => {
  it("số điện thoại thật → chữ số chuẩn như khi tạo tay; ô ghi thứ khác giữ nguyên văn", () => {
    expect(sdtDeLuu("0911.111.111")).toBe("0911111111")
    expect(sdtDeLuu(" +84 911 111 111 ")).toBe("0911111111")
    expect(sdtDeLuu("(0225) 3812 345")).toBe("02253812345")
    expect(sdtDeLuu("0911111111 / 0922222222")).toBe("0911111111 / 0922222222")
    expect(sdtDeLuu("anh Ba")).toBe("anh Ba")
    expect(sdtDeLuu("")).toBe("")
    expect(sdtDeLuu(null)).toBe("")
  })
  it("dòng nào trùng khách đã có — theo số đã chuẩn hoá", () => {
    const m = new Map([["0911111111", { id: "k1", store_name: "Cô Ba" }]])
    expect(trungCuaDong("0911.111.111", m)?.id).toBe("k1")
    expect(trungCuaDong("+84911111111", m)?.id).toBe("k1")
    expect(trungCuaDong("0911", m)).toBeNull()
    expect(trungCuaDong("", m)).toBeNull()
  })
})

describe("parseCustomerSheet — trùng số TRONG file theo số đã chuẩn hoá", () => {
  it("'0911.111.111' và '+84 911 111 111' là cùng một số → dòng sau báo trùng", () => {
    const r = parseCustomerSheet([["Tên cửa hàng", "SĐT"], ["A", "0911.111.111"], ["B", "+84 911 111 111"]])
    expect(r.rows[0].errors).toEqual([])
    expect(r.rows[1].errors).toContain("Trùng SĐT trong file")
  })
})

describe("màn nhập Excel nối đủ bước lọc trùng (đọc mã nguồn — bấm thật ở e2e)", () => {
  const s = readFileSync("src/components/customers/customer-import-dialog.tsx", "utf-8")
  it("đọc file xong là lọc trùng; chưa lọc xong / lọc hỏng thì không cho nhập; không đối chiếu bằng đọc thẳng bảng khách", () => {
    expect(s).toContain("void kiemTrung(result.rows)")
    expect(s).toContain("disabled={importing || !daKiemXong || moiRows.length === 0}")
    expect(s).toContain("if (trungCuaDong(r.phone, trung) || (pk && soTrongLanNay.has(pk))) {")
    expect(s).toContain("phone: pk,")
    // Đọc thẳng `customers.phone` dưới RLS chỉ thấy khách của mình — không dùng làm phép lọc trùng nữa.
    expect(s).not.toContain('.select("phone", { count: "exact" })')
  })
})
