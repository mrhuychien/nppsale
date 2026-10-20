/**
 * Ô QUYỀN RIÊNG — chủ nhà 20/10/2026: "Kiểm tra lại sao tk nhân viên bán hàng lại có bàn giao khách nhỉ".
 * "Bàn giao khách" (`customers.handover`, mig 246) khai `defaultRoles: owner, manager` — ô riêng, không thừa hưởng mô-đun
 * Khách hàng. Màn Phân quyền lúc nạp lại chép dòng của mô-đun Khách hàng sang mọi tính năng con, kể cả ô riêng ⇒ bảng vẽ
 * NVBH như đã cấp, bấm Lưu là ghi thật xuống ⇒ menu NVBH có "Bàn giao khách". Một luật `laORieng` / `macDinhTinhNang`
 * cho lúc chạy + hai màn phân quyền; mig 248 trả dòng đã ghi lỡ. Bấm thật: e2e/quyen-ban-giao-nvbh.spec.ts.
 */
import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { canSeeHref } from "@/lib/nav/nav-permission"
import {
  DEFAULT_PERMISSION_MAP, laORieng, macDinhTinhNang, rowsToCache, setPermissionsCache, setUserOverrides,
  type Action, type Role,
} from "@/lib/permissions"
import { FEATURES, getFeature } from "@/lib/permissions-features"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const BG = getFeature("customers.handover")!
const dong = (role: Role, module: string, actions: Action[], allowed = true) =>
  actions.map((action) => ({ role, module, action, allowed }))

afterEach(() => {
  setPermissionsCache(null)
  setUserOverrides(null)
})

describe("mặc định của tính năng — một luật", () => {
  it("Bàn giao khách: ô riêng; NVBH / kế toán / thủ kho rỗng, chủ NPP / quản lý theo mô-đun Khách hàng", () => {
    expect(laORieng(BG)).toBe(true)
    for (const r of ["sales", "accountant", "warehouse"] as Role[]) expect(macDinhTinhNang(r, BG), r).toEqual([])
    expect(macDinhTinhNang("manager", BG)).toEqual(DEFAULT_PERMISSION_MAP.manager!.customers)
  })
  it("ô riêng có `macDinhVai` thì vai trong danh sách lấy đúng phần riêng ấy; tính năng thừa hưởng theo mô-đun cha", () => {
    const f = FEATURES.find((x) => x.defaultRoles && x.macDinhVai)!
    const [vai, viec] = Object.entries(f.macDinhVai!)[0] as [Role, Action[]]
    expect(macDinhTinhNang(vai, f)).toEqual(viec)
    const thuaHuong = getFeature("customers.visits")!
    expect(laORieng(thuaHuong)).toBe(false)
    expect(macDinhTinhNang("sales", thuaHuong)).toEqual(DEFAULT_PERMISSION_MAP.sales!.customers)
  })
})

describe("lúc chạy: dòng / quyền riêng của mô-đun cha không mở ô riêng", () => {
  it("mặc định: NVBH không thấy Bàn giao khách; quản lý thấy", () => {
    expect(canSeeHref("sales", "/customers/ban-giao")).toBe(false)
    expect(canSeeHref("manager", "/customers/ban-giao")).toBe(true)
  })
  it("dòng mô-đun Khách hàng (NVBH được Sửa) không mở; dòng RIÊNG của ô thì mở (chủ NPP cố ý cấp vẫn được)", () => {
    setPermissionsCache(rowsToCache(dong("sales", "customers", ["read", "create", "update", "delete"])))
    expect(canSeeHref("sales", "/customers/ban-giao")).toBe(false)
    setPermissionsCache(rowsToCache([...dong("sales", "customers", ["update"]), ...dong("sales", "customers.handover", ["update"])]))
    expect(canSeeHref("sales", "/customers/ban-giao")).toBe(true)
  })
  it("quyền riêng từng người ở mô-đun cha không kéo theo ô riêng; quyền riêng của chính ô thì có", () => {
    setUserOverrides({ "customers.update": true })
    expect(canSeeHref("accountant", "/customers/ban-giao")).toBe(false)
    setUserOverrides({ "customers.handover.update": true })
    expect(canSeeHref("accountant", "/customers/ban-giao")).toBe(true)
    setUserOverrides({ "customers.handover.update": false })
    expect(canSeeHref("manager", "/customers/ban-giao")).toBe(false)
    // Chiều THU thì vẫn lan: thu cả mô-đun Khách hàng của một quản lý là mất cả ô con.
    setUserOverrides({ "customers.update": false })
    expect(canSeeHref("manager", "/customers/ban-giao")).toBe(false)
  })
  it("tính năng THỪA HƯỞNG vẫn theo quyền riêng ở mô-đun cha như cũ (Lịch sử đi tuyến)", () => {
    expect(canSeeHref("sales", "/sales/visits")).toBe(true)
    setUserOverrides({ "customers.read": false })
    expect(canSeeHref("sales", "/sales/visits")).toBe(false)
  })
})

describe("hai màn phân quyền dùng cùng luật", () => {
  const VAI = read("src/app/(dashboard)/settings/permissions/page.tsx")
  const NGUOI = read("src/components/settings/permission-matrix.tsx")
  it("màn theo vai: nền theo `macDinhTinhNang`; nạp dòng DB thì ô riêng KHÔNG nhận dòng mô-đun cha", () => {
    expect(VAI).toContain("return macDinhTinhNang(role, feature)")
    expect(VAI).toContain("const modOverride = laORieng(f) ? undefined : moduleOverrides[role][f.module]")
    expect(VAI).not.toContain("DEFAULT_PERMISSION_MAP[role]?.[feature.module]")
  })
  it("màn từng người: 'theo vai trò' của ô riêng không lấy dòng mô-đun cha; mặc định theo `macDinhTinhNang`", () => {
    expect(NGUOI).toMatch(/if \(!laORieng\(feature\)\) \{\s*const rpByModule = rolePerms\.get\(`\$\{feature\.module\}::\$\{action\}`\)/)
    expect(NGUOI).toContain("return macDinhTinhNang(role, feature).includes(action)")
    expect(NGUOI).not.toContain("DEFAULT_PERMISSION_MAP")
  })
})

describe("mig 248: trả dòng đã ghi lỡ", () => {
  const MIG = read("supabase/migrations/248_ban_giao_khach_tra_quyen.sql")
  it("VÌ SAO trích lời chủ nhà; chỉ đổi ô Bàn giao khách của vai ngoài chủ NPP / quản lý; NOTIFY + câu tóm tắt", () => {
    expect(MIG).toContain('chủ nhà 20/10/2026: "Kiểm tra lại sao tk nhân viên bán hàng lại có bàn giao khách nhỉ"')
    expect(MIG).toMatch(/UPDATE public\.role_permissions\s+SET allowed = false,[\s\S]*?WHERE module = 'customers\.handover'\s+AND role NOT IN \('owner', 'manager'\)\s+AND allowed;/)
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG).toMatch(/AS nguoi_duoc_cap_rieng_ban_giao;\s*$/)
  })
  it("khám sổ có dòng 87; luật ghi ở CLAUDE.md", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 87, 'Mig 248 (Bàn giao khách — trả quyền về mặc định)'")
    expect(read("CLAUDE.md")).toContain("**Ô quyền riêng** (chủ nhà 20/10/2026")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(__dirname, "..", tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-248-ban-giao-khach-tra-quyen.sql")
describe.skipIf(!BO_THU)("mig 248 trên Postgres thử", () => {
  it("8/8 bước đạt (NVBH / kế toán / thủ kho hết Bàn giao khách; quản lý, chủ NPP, dòng mô-đun cha giữ nguyên; chạy lại vô hại)", () => {
    const dongKq = BO_THU!.trim().split("\n")
    expect(dongKq.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dongKq.at(-1)).toBe("8|8|0")
  })
})
