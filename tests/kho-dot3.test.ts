import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { ghiSoPhieuNhap, KhongDuyetDuocOday } from "../src/lib/inventory/approve-entry"
import { duocSuaPhieuTra, duocXoaPhieuTra } from "../src/lib/sell/return-roles"
import { lapPhieuTraMotLan } from "../src/lib/sell/create-return"

/**
 * ĐỢT 3 QA — SỔ KHO.
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16 (22/09/2026), sau mig 170 (vai chủ NPP, lệnh
 *   gửi thẳng như PostgREST gửi):
 *     xoá phiếu nhập đã ghi sổ          → SO_KHO_KHOA (trước: dòng mất, lô giữ 50)
 *     UPDATE batches.qty_on_hand        → SO_KHO_KHOA
 *     sửa vị trí / hạn của lô           → được
 *     chèn phiếu không ghi trạng thái   → SO_KHO_KHOA (mặc định 'posted')
 *     "duyệt" bằng UPDATE status=posted → SO_KHO_KHOA (trước: kho đứng yên)
 *     chuyển kho qua post_stock_transfer→ được
 *     thêm dòng vào phiếu đã ghi sổ     → SO_KHO_KHOA
 *     tạo lô rỗng / tạo lô có tồn       → được / SO_KHO_KHOA
 *     quản lý từ chối phiếu kiểm kê nháp→ được (trước: 0 dòng, báo "Đã hủy")
 *   Và các RPC hợp lệ chạy lại y nguyên: nhập kho, xuất hoá đơn, tạo đơn.
 */

function rpcGia(error: unknown = null, data: unknown = [{ posted: true }]) {
  const goi: string[] = []
  return {
    goi,
    rpc: (fn: string) => {
      goi.push(fn)
      return Promise.resolve({ data, error })
    },
    from: () => {
      throw new Error("không được ghi thẳng bảng")
    },
  }
}

describe("duyệt phiếu kho nháp đi đúng RPC", () => {
  it.each([
    [{ id: "1", type: "transfer", warehouse_zone: "sale" }, "post_stock_transfer"],
    [{ id: "2", type: "export", warehouse_zone: "date" }, "post_stock_issue"],
    [{ id: "3", type: "export", warehouse_zone: null }, "post_stock_export"],
  ])("%j → %s", async (e, rpc) => {
    const sb = rpcGia()
    await ghiSoPhieuNhap(sb as never, e)
    expect(sb.goi).toEqual([rpc])
  })

  it.each(["import", "stocktake"])("phiếu %s nháp: nói thẳng, không đổi trạng thái", async (type) => {
    const sb = rpcGia()
    await expect(ghiSoPhieuNhap(sb as never, { id: "x", type })).rejects.toBeInstanceOf(KhongDuyetDuocOday)
    expect(sb.goi).toEqual([])
  })

  it("danh sách phiếu kho không còn UPDATE thẳng trạng thái 'posted'", () => {
    const s = readFileSync(resolve(__dirname, "..", "src/app/(dashboard)/inventory/entries/page.tsx"), "utf-8")
    expect(s).not.toMatch(/\.update\(\{\s*status:\s*"posted"/)
    expect(s).toContain("ghiSoPhieuNhap(supabase, e)")
  })
})

describe("mig 170: trigger khoá sổ kho", () => {
  const dir = resolve(__dirname, "..", "supabase/migrations")
  const M = readFileSync(resolve(dir, readdirSync(dir).find((f) => f.startsWith("170_"))!), "utf-8")

  /**
   * ⚠ TRIGGER PHẢI THẤY ĐÚNG NGƯỜI GỌI. Là SECURITY DEFINER thì
   *   `current_user` luôn là chủ hàm, và trigger chặn luôn cả RPC hợp lệ
   *   — hoặc (nếu viết ngược) không chặn ai. Tự kiểm của migration cũng
   *   đòi điều này; chốt giữ nó khỏi bị "sửa gọn" mất.
   */
  it.each(["_trg_khoa_ghi_thang_lo", "_trg_khoa_ghi_thang_phieu_kho", "_trg_khoa_ghi_thang_dong_kho"])(
    "%s: không SECURITY DEFINER, chỉ can thiệp lệnh gửi thẳng",
    (fn) => {
      const i = M.indexOf(`FUNCTION public.${fn}()`)
      const than = M.slice(i, M.indexOf("$$;", M.indexOf("$$", i) + 2))
      expect(than).not.toMatch(/SECURITY DEFINER/)
      expect(than).toContain("IF current_user NOT IN ('authenticated', 'anon') THEN")
    }
  )

  it("chặn bằng P0001, không bằng 42501 (không phải chuyện thiếu quyền)", () => {
    const chan = Array.from(M.matchAll(/RAISE EXCEPTION 'SO_KHO_KHOA:[\s\S]*?USING ERRCODE = '(\w+)'/g), (m) => m[1])
    expect(chan.length).toBeGreaterThanOrEqual(9)
    expect(new Set(chan)).toEqual(new Set(["P0001"]))
  })
})

describe("màn hình theo đúng luật sổ kho", () => {
  const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

  it("sửa lô không gửi số tồn", () => {
    const s = doc("src/app/(dashboard)/inventory/batches/[id]/page.tsx")
    const i = s.indexOf('.from("batches")\n          .update({')
    expect(i).toBeGreaterThan(-1)
    expect(s.slice(i, i + 600)).not.toContain("qty_on_hand:")
  })

  it("tạo lô chỉ tạo lô rỗng", () => {
    const s = doc("src/app/(dashboard)/inventory/batches/new/page.tsx")
    expect(s).toContain("const qty = 0")
  })

  it("xoá phiếu kho chỉ nhắm phiếu nháp", () => {
    for (const p of ["src/app/(dashboard)/inventory/entries/page.tsx", "src/app/(dashboard)/inventory/entries/[id]/page.tsx"]) {
      expect(doc(p), p).toMatch(/\.delete\(\)\.eq\("id", [a-zA-Z.]+\)\.eq\("status", "draft"\)/)
    }
  })

  it("từ chối phiếu kiểm kê qua RPC, không UPDATE thẳng", () => {
    const s = doc("src/app/(dashboard)/inventory/adjustments/page.tsx")
    expect(s).toContain('rpc("reject_stock_adjustment"')
    expect(s).not.toMatch(/\.update\(\{\s*status:\s*"cancelled"\s*\}\)/)
  })

  /**
   * ⚠ MỘT LỆNH CHO CẢ BỘ DÒNG. Chèn từng dòng thì hỏng giữa chừng là
   *   phiếu thiếu dòng; lưu lại là phiếu trùng; duyệt cả hai là kho bị
   *   cộng / trừ hai lần.
   */
  it("phiếu kiểm kê chèn dòng một lần", () => {
    const s = doc("src/app/(dashboard)/inventory/stocktake-adjust/page.tsx")
    expect(s).not.toMatch(/for \(const r of diffRows\)\s*\{\s*await supabase\.from\("stock_entry_lines"\)\.insert/)
    expect(s).toContain("diffRows.map((r) => ({")
  })
})

describe("sửa / xoá phiếu trả theo đúng RLS", () => {
  const NHAP_CUA_TOI = { status: "draft", sales_user_id: "u1" }
  const NHAP_NGUOI_KHAC = { status: "draft", sales_user_id: "u2" }
  const DA_GUI = { status: "submitted", sales_user_id: "u1" }

  it.each([
    ["owner", DA_GUI, true, false],
    ["manager", NHAP_NGUOI_KHAC, true, true],
    ["sales", NHAP_CUA_TOI, true, true],
    ["sales", NHAP_NGUOI_KHAC, false, false],
    ["sales", DA_GUI, false, false],
    ["warehouse", NHAP_CUA_TOI, false, false],
    ["accountant", NHAP_CUA_TOI, false, false],
  ] as const)("%s trên %j → sửa %s, xoá %s", (vai, r, sua, xoa) => {
    expect(duocSuaPhieuTra(vai, "u1", r)).toBe(sua)
    expect(duocXoaPhieuTra(vai, "u1", r)).toBe(xoa)
  })
})

describe("lập phiếu trả một giao dịch", () => {
  it("máy chủ có hàm → một RPC, trả mã phiếu", async () => {
    const sb = rpcGia(null, "ret-1")
    expect(await lapPhieuTraMotLan(sb as never, {}, [])).toBe("ret-1")
    expect(sb.goi).toEqual(["create_return_with_lines"])
  })

  it("máy chủ chưa có hàm → null (nơi gọi đi đường cũ)", async () => {
    const sb = rpcGia({ code: "PGRST202", message: "Could not find the function public.create_return_with_lines" }, null)
    expect(await lapPhieuTraMotLan(sb as never, {}, [])).toBeNull()
  })

  it("lỗi khác thì ném", async () => {
    const sb = rpcGia({ code: "42501", message: "new row violates row-level security policy" }, null)
    await expect(lapPhieuTraMotLan(sb as never, {}, [])).rejects.toMatchObject({ code: "42501" })
  })
})
