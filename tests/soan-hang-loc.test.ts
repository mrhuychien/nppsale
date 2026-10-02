/**
 * Chủ nhà 02/10/2026: "phần soạn đơn, thêm các bộ lọc vào đơn. thêm đánh dấu đơn nào đã soạn vào" · "đã soạn chỉ
 * xuất hiện ở màn soạn đơn thôi". Bấm thật: e2e/soan-hang.spec.ts. Máy chủ: scripts/sql/thu-224-soan-hang.sql.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  LOC_SOAN_MAC_DINH, apLocSoan, cotHoaDonSoan, duocDanhDauSoan, khoaCuaTuyen, nhanDaSoan, soLocDangBat, thieuCotSoan,
  type TruyVanLoc,
} from "@/lib/orders/soan-hang-loc"

class Ghi implements TruyVanLoc<Ghi> {
  g: string[] = []
  private them(s: string) { this.g.push(s); return this }
  gte(c: string, v: string) { return this.them(`${c}>=${v}`) }
  lte(c: string, v: string) { return this.them(`${c}<=${v}`) }
  eq(c: string, v: string) { return this.them(`${c}=${v}`) }
  in(c: string, v: string[]) { return this.them(`${c} in ${v.join("|")}`) }
  is(c: string) { return this.them(`${c} is null`) }
  not(c: string) { return this.them(`${c} not null`) }
}

describe("bộ lọc màn Soạn hàng", () => {
  it("mặc định chỉ hoá đơn CHƯA soạn, không chặn ngày / NV / tuyến", () => {
    expect(apLocSoan(new Ghi(), LOC_SOAN_MAC_DINH, true).g).toEqual(["soan_luc is null"])
    expect(soLocDangBat(LOC_SOAN_MAC_DINH)).toBe(0)
  })
  it("ngày HĐ, nhân viên, tuyến (khớp id · mã · tên), đã soạn", () => {
    const l = { tu: "2026-10-01", den: "2026-10-02", nv: "nv1", tuyen: "r1", soan: "da" as const }
    const k = khoaCuaTuyen({ id: "r1", code: "T2", name: "Thứ Hai" })
    expect(apLocSoan(new Ghi(), l, true, k).g).toEqual([
      "invoice_date>=2026-10-01", "invoice_date<=2026-10-02", "sales_user_id=nv1", "customer.channel in r1|T2|Thứ Hai", "soan_luc not null",
    ])
    expect(soLocDangBat(l)).toBe(5)
    expect(apLocSoan(new Ghi(), { ...l, soan: "tat" }, true, k).g).not.toContain("soan_luc not null")
  })
  it("lọc tuyến thì nhúng khách !inner; sổ chưa chạy mig 224 thì không đọc / lọc cột soạn", () => {
    expect(cotHoaDonSoan({ ...LOC_SOAN_MAC_DINH, tuyen: "r1" }, true)).toContain("customers!inner")
    expect(cotHoaDonSoan(LOC_SOAN_MAC_DINH, true)).not.toContain("!inner")
    expect(cotHoaDonSoan(LOC_SOAN_MAC_DINH, false)).not.toContain("soan_luc")
    expect(apLocSoan(new Ghi(), LOC_SOAN_MAC_DINH, false).g).toEqual([])
    expect(thieuCotSoan("column sales_invoices.soan_luc does not exist")).toBe(true)
  })
  it("nhãn đã soạn + vai được đánh dấu (khớp RPC mig 224)", () => {
    expect(nhanDaSoan("2026-10-02T01:15:00Z", "Hoàng Văn Em")).toBe("Đã soạn 08:15 02/10 · Hoàng Văn Em")
    expect(nhanDaSoan(null)).toBe("")
    expect(["owner", "manager", "warehouse", "accountant"].every(duocDanhDauSoan)).toBe(true)
    expect(duocDanhDauSoan("sales")).toBe(false)
    const sql = readFileSync("supabase/migrations/224_danh_dau_da_soan_hang.sql", "utf8")
    expect(sql).toContain("NOT IN ('owner', 'manager', 'warehouse', 'accountant')")
  })
  it("dấu đã soạn chỉ ở màn Soạn hàng (chủ nhà: \"đã soạn chỉ xuất hiện ở màn soạn đơn thôi\")", () => {
    const tep = (d: string): string[] => readdirSync(d).flatMap((f) => {
      const p = join(d, f)
      return statSync(p).isDirectory() ? tep(p) : /\.tsx?$/.test(f) ? [p] : []
    })
    const co = tep("src").filter((f) => /soan_luc|danh_dau_soan_hang/.test(readFileSync(f, "utf8")))
    expect(co.sort()).toEqual(["src/app/(dashboard)/inventory/soan-hang/page.tsx", "src/lib/orders/soan-hang-loc.ts"])
  })
})
