import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"

/**
 * Chủ nhà 15/11/2026: "Kiểm tra lại quyền xem, sao nhân viên này lại xem được đơn hàng của nhân viên kia" — mig 262.
 * Chính sách đọc đơn từng cho NVBH thấy đơn của NGƯỜI KHÁC khi khách đang phân công cho mình (khách làm chung, khách vừa bàn
 * giao, đơn chủ NPP bán cho khách của NV) hoặc khi có quyền "Xem tất cả KH". Nay NVBH chỉ đơn đứng tên mình.
 */
const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const MIG = read("supabase/migrations/262_nvbh_chi_xem_don_cua_minh.sql")

/** Phần thân của một câu ALTER POLICY trong migration (tới dấu `);` đầu tiên ở đầu dòng). */
function thanChinhSach(ten: string): string {
  const i = MIG.indexOf(`ALTER POLICY ${ten} ON`)
  expect(i, `thiếu ALTER POLICY ${ten}`).toBeGreaterThan(-1)
  const j = MIG.indexOf("\n);", i)
  return MIG.slice(i, j)
}
/** Bỏ chú thích `--` để soát mã, không soát lời giải thích. */
const boChuThich = (s: string) => s.replace(/--[^\n]*/g, "")

describe("mig 262 — chính sách đọc đơn", () => {
  it("có khối VÌ SAO trích lời chủ nhà + ngày", () => {
    expect(MIG).toContain("VÌ SAO — chủ nhà 15/11/2026")
    expect(MIG).toContain("sao nhân viên này lại xem được đơn hàng của nhân viên kia")
  })
  it("ALTER tại chỗ, không DROP + CREATE (không có lúc nào bảng đơn thiếu chính sách đọc)", () => {
    expect(MIG).not.toMatch(/DROP\s+POLICY[^;]*sales_order_select/i)
    expect(MIG).toContain("ALTER POLICY sales_order_select ON public.sales_orders USING (")
  })
  it("NVBH chỉ đơn đứng tên mình: KHÔNG còn nhánh khách phân công / quyền Xem tất cả KH", () => {
    const p = boChuThich(thanChinhSach("sales_order_select"))
    expect(p).not.toContain("customer_assignments")
    expect(p).not.toContain("customer.view_all")
    expect(p).not.toContain("user_has_permission")
    expect(p).toContain("sales_user_id = (SELECT auth.uid())")
  })
  it("giữ nguyên: văn phòng thấy mọi đơn, luật nháp riêng, tài xế đơn trong chuyến; hàm quyền bọc (SELECT …) (mig 250)", () => {
    const p = boChuThich(thanChinhSach("sales_order_select"))
    expect(p).toContain("(SELECT public.user_role()) IN ('owner', 'manager', 'accountant', 'warehouse')")
    expect(p).toContain("AND (status <> 'draft' OR sales_user_id = (SELECT auth.uid()))")
    expect(p).toContain("WHERE d.driver_id = (SELECT auth.uid())")
    expect(p).toContain("org_id = (SELECT public.user_org_id())")
    // mọi auth.uid() / user_role() đều nằm trong (SELECT …) — gọi thẳng là Postgres gọi lại cho TỪNG dòng
    expect(p.split("auth.uid()").length).toBe(p.split("(SELECT auth.uid())").length)
    expect(p.split("public.user_role()").length).toBe(p.split("(SELECT public.user_role())").length)
  })
  it("nhật ký đơn theo quyền xem đơn (EXISTS trên sales_orders — chạy dưới RLS của người hỏi)", () => {
    const p = boChuThich(thanChinhSach("org_iso_oal"))
    expect(p).toContain("EXISTS (SELECT 1 FROM public.sales_orders so WHERE so.id = order_activity_log.order_id)")
  })
  it("get_invoiceable_lines: vá chuỗi có kiểm 1/1/1, đúng biểu thức chính sách (COALESCE … false, có nhánh tài xế), lỗi ORDER_NOT_FOUND", () => {
    expect(MIG).toContain("IF n1 <> 1 OR n2 <> 1 OR n3 <> 1 THEN")
    expect(MIG).toContain("IF position('(mig 262)' IN v_def) > 0 THEN")
    expect(MIG).toContain("IF v_toi IS NOT NULL AND NOT COALESCE(")
    expect(MIG).toContain("OR (public.user_role() = 'driver' AND p_order_id IN (")
    expect(MIG).toContain("RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';\n  END IF;$s$;")
  })
  it("kết thúc bằng NOTIFY + một câu SELECT tóm tắt", () => {
    const sau = MIG.slice(MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';"))
    expect(sau).toMatch(/^NOTIFY pgrst, 'reload schema';\s+SELECT hang_muc, ket_qua FROM \(/)
    expect((sau.match(/;\s*$/gm) ?? []).length).toBe(2)
  })
  it("câu khám sổ thật có dòng 101 cho mig 262; tệp gộp đã dựng lại", () => {
    const kham = read("scripts/sql/kham-so-that.sql")
    expect(kham).toContain("SELECT 101, 'Mig 262 (NVBH chỉ xem đơn của chính mình)'")
    expect(read("supabase/schema_full.sql")).toContain("ALTER POLICY org_iso_oal ON public.order_activity_log USING (")
  })
})

describe("màn Phân quyền nói rõ: Xem tất cả KH không mở đơn hàng của NV khác", () => {
  it("nhãn + lời dặn", () => {
    const m = read("src/components/settings/permission-matrix.tsx")
    expect(m).toContain('label: "Xem tất cả KH — chỉ khách, không mở đơn hàng của NV khác"')
    expect(m).toContain("ai cần xem đơn của mọi người thì đặt vai Quản lý")
  })
})

const KET_NOI = ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
  "-d", process.env.PG_THU_DB || "npp_tong"]
/**
 * ⚠ CHỈ BỎ QUA KHI MÁY KHÔNG CÓ POSTGRES THỬ. Bộ thử chạy hỏng (migration ném lỗi — như "chỗ vá 1/1/0" của mig 262 trên sổ
 *   thật 15/11/2026) phải ĐỎ: gộp hai ca vào một `null` thì migration hỏng trông y như máy thiếu Postgres, bài lặng lẽ bỏ qua.
 */
function coPgThu(): boolean {
  try {
    execFileSync("psql", [...KET_NOI, "-At", "-c", "select 1"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 })
    return true
  } catch {
    return false
  }
}
function chayBoThu(tep: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync("psql", [...KET_NOI, "-q", "-At", "-f", resolve(ROOT, tep)], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000,
      env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" },
    })
    return { ok: true, out }
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, out: `${x.stdout ?? ""}\n${x.stderr ?? x.message ?? ""}` }
  }
}
const PG_THU = coPgThu()
const BO_THU = PG_THU ? chayBoThu("scripts/sql/thu-262-nvbh-chi-xem-don-cua-minh.sql") : null
describe.skipIf(!PG_THU)("mig 262 trên Postgres thử", () => {
  it("18/18 dòng đạt (tái hiện lỗi trên bản cũ → chạy 262 hai lần → NVBH chỉ đơn mình; văn phòng / tài xế giữ nguyên; dòng đơn, nhật ký, lịch sử, get_invoiceable_lines theo đúng quyền xem đơn; thân hàm xuống dòng kiểu Windows vẫn vá được)", () => {
    expect(BO_THU!.ok, `bộ thử chạy hỏng (migration ném lỗi?):\n${BO_THU!.out}`).toBe(true)
    const dong = BO_THU!.out.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!.out).toEqual([])
    expect(dong.at(-1)).toBe("18|18|0")
  })
})
