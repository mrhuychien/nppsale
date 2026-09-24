import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { duocGhiMuaHang, VAI_GHI_MUA_HANG } from "../src/lib/purchasing/roles"
import { explainCancelEntryError } from "../src/lib/inventory/cancel-entry"
import type { Role } from "../src/lib/permissions"

/**
 * MIG 166 — VÁ LỖ QUYỀN RPC VÀ QUYỀN RÒ SANG NPP KHÁC.
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16 (22/09/2026), trước và sau 166:
 *
 *     NVBH huỷ phiếu nhập qua cancel_stock_entry   lô 100 → 0   │ FORBIDDEN
 *     kế toán huỷ phiếu nhập                        được         │ FORBIDDEN
 *     thủ kho huỷ phiếu nhập                        được         │ được
 *     quản lý xuất hoá đơn (post_invoice → post_stock_export)  │ được (via_rpc)
 *     huỷ phiếu kho của hoá đơn mua / có công nợ NCC  được     │ ENTRY_HAS_SOURCE
 *     NPP B bật orders.approve → NVBH NPP A          f → t        │ f
 *     quản lý A ghi override lên chủ NPP B           được         │ 42501
 *     anon gọi _apply_return_edits                   được         │ permission denied
 *
 * ⚠ CHỐT CHẠY LUẬT, KHÔNG SOI CHỮ. Vai trong cổng của RPC phải BẰNG vai
 *   trong RLS của bảng mà RPC bỏ qua — chốt lấy cả hai vế từ chính
 *   migration rồi so. Ai đổi RLS mà quên RPC (hay ngược lại) thì đỏ.
 */

const DIR = resolve(__dirname, "..", "supabase/migrations")
const TEP = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
const DOC = (f: string) => readFileSync(resolve(DIR, f), "utf-8")
const M166 = DOC(TEP.find((f) => f.startsWith("166_"))!)

/** Bản CUỐI CÙNG của một chính sách theo tên. */
function chinhSach(ten: string): string {
  const neo = `CREATE POLICY "${ten}"`
  const co = TEP.map(DOC).filter((s) => s.includes(neo))
  expect(co.length, `không migration nào dựng "${ten}"`).toBeGreaterThan(0)
  const s = co[co.length - 1]
  const i = s.indexOf(neo)
  return s.slice(i, s.indexOf(";", i))
}

/** Vai trong `user_role() IN (…)` hoặc `= ANY (ARRAY[…])`. */
function vaiTrong(sql: string): string[] {
  const m =
    sql.match(/user_role\(\)\s+IN\s*\(([^)]*)\)/i) ??
    sql.match(/user_role\(\)\s*=\s*ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]/i)
  expect(m, `không đọc được vai trong:\n${sql}`).toBeTruthy()
  return Array.from(m![1].matchAll(/'([a-z_]+)'/g), (x) => x[1]).sort()
}

/** Bảng (hàm, vai) mà 166 vá vào RPC. */
function congVai166(): Map<string, string[]> {
  const khoi = M166.slice(M166.indexOf("FROM (VALUES"), M166.indexOf(") AS t(fn, vai)"))
  const ra = new Map<string, string[]>()
  for (const m of Array.from(khoi.matchAll(/\('([a-z_]+)\([^)]*\)',\s*'([a-z,]+)'\)/g))) {
    ra.set(m[1], m[2].split(",").sort())
  }
  return ra
}

describe("166: cổng vai của RPC bằng đúng RLS của bảng nó bỏ qua", () => {
  const cong = congVai166()
  const KHO = vaiTrong(chinhSach("Owner/Warehouse can manage stock entries"))
  const MUA = vaiTrong(chinhSach("Manage purchase invoices"))
  const TRA_NCC = vaiTrong(chinhSach("Manage supplier returns"))

  it("vá đủ tám hàm", () => {
    expect(Array.from(cong.keys()).sort()).toEqual([
      "cancel_purchase_invoice", "cancel_stock_entry", "cancel_supplier_return",
      "complete_purchase_invoice", "complete_supplier_return",
      "post_stock_export", "post_stock_issue", "post_stock_transfer",
    ])
  })

  it.each(["cancel_stock_entry", "post_stock_export", "post_stock_issue", "post_stock_transfer"])(
    "%s: vai = RLS của stock_entries",
    (fn) => expect(cong.get(fn)).toEqual(KHO)
  )

  it.each(["complete_purchase_invoice", "cancel_purchase_invoice"])(
    "%s: vai = RLS của purchase_invoices",
    (fn) => expect(cong.get(fn)).toEqual(MUA)
  )

  it.each(["complete_supplier_return", "cancel_supplier_return"])(
    "%s: vai = RLS của supplier_returns",
    (fn) => expect(cong.get(fn)).toEqual(TRA_NCC)
  )

  /**
   * ⚠ `post_stock_export` được gọi TỪ TRONG `post_invoice`, mà người xuất
   *   hoá đơn là kế toán / quản lý. Mất lối tắt `npp.via_rpc` là không ai
   *   ngoài chủ và thủ kho xuất được hoá đơn nữa — đo được, chứ không
   *   phải đoán.
   */
  it("cổng vai chừa lối cho RPC gọi RPC (npp.via_rpc)", () => {
    expect(M166).toMatch(/current_setting\(''npp\.via_rpc'', true\) IS DISTINCT FROM ''on''/)
  })
})

describe("166: nút mua hàng trên giao diện khớp RLS", () => {
  const MUA = vaiTrong(chinhSach("Manage purchase invoices"))
  const TAT_CA: Role[] = ["owner", "manager", "accountant", "sales", "warehouse", "driver"]

  it.each(TAT_CA)("%s", (vai) => {
    expect(duocGhiMuaHang(vai), `${vai}: giao diện và RLS nói khác nhau`).toBe(MUA.includes(vai))
  })

  it("danh sách vai là một bản chép, không thừa không thiếu", () => {
    expect([...VAI_GHI_MUA_HANG].sort()).toEqual(MUA)
  })
})

describe("166: quyền không rò sang NPP khác", () => {
  /** Bản cuối của `user_has_permission`. */
  const HAM = (() => {
    const neo = "FUNCTION public.user_has_permission("
    const co = TEP.map(DOC).filter((s) => s.includes("CREATE OR REPLACE " + neo))
    const s = co[co.length - 1]
    const i = s.indexOf("CREATE OR REPLACE " + neo)
    return s.slice(i, s.indexOf("$$;", s.indexOf("$$", i) + 2))
  })()

  it("override đọc theo đúng NPP của người được hỏi", () => {
    const i = HAM.indexOf("FROM user_permission_overrides")
    expect(HAM.slice(i, i + 200)).toMatch(/org_id = v_org/)
  })

  it("role_permissions đọc theo đúng NPP", () => {
    const i = HAM.indexOf("FROM role_permissions")
    expect(HAM.slice(i, i + 200)).toMatch(/rp\.org_id = v_org/)
  })

  /**
   * ⚠ LỌC THEO NPP THÌ NPP TẠO VỀ SAU MẤT CÁC Ô QUYỀN MẶC ĐỊNH — trước
   *   đây nó vô tình mượn của NPP khác. 166 gieo cho NPP mới qua trigger.
   */
  it("NPP mới được gieo quyền mặc định", () => {
    expect(M166).toMatch(/AFTER INSERT ON organizations/)
  })

  it("override: người bị gán phải cùng NPP, quản lý không đụng chủ", () => {
    const neo = "CREATE POLICY org_iso_upo_write"
    const co = TEP.map(DOC).filter((s) => s.includes(neo))
    const s = co[co.length - 1]
    const i = s.indexOf(neo)
    const p = s.slice(i, s.indexOf(";", i))
    const u = p.slice(p.indexOf("USING"), p.indexOf("WITH CHECK"))
    const c = p.slice(p.indexOf("WITH CHECK"))
    for (const [ten, ve] of [["USING", u], ["WITH CHECK", c]] as const) {
      expect(ve, `${ten}: không kiểm người bị gán cùng NPP`).toMatch(/u\.org_id = public\.user_org_id\(\)/)
      expect(ve, `${ten}: quản lý đụng được quyền của chủ`).toMatch(/u\.role <> 'owner'/)
    }
  })
})

describe("166: order_status_history không còn USING (true)", () => {
  it("lần cuối nhắc tới chính sách cũ là DROP", () => {
    const tat = TEP.map(DOC).join("\n")
    const lanCuoiTao = tat.lastIndexOf('CREATE POLICY "View order history"')
    const lanCuoiXoa = tat.lastIndexOf('DROP POLICY IF EXISTS "View order history"')
    expect(lanCuoiXoa, "chính sách USING (true) vẫn còn sống").toBeGreaterThan(lanCuoiTao)
  })
})

/**
 * ⚠ HÀM NỘI BỘ (tên `_…`) SECURITY DEFINER KHÔNG ĐƯỢC GỌI THẲNG.
 *   166 thu hết những hàm đã có. Chốt này canh những hàm VIẾT SAU 166:
 *   Supabase cấp EXECUTE thẳng cho `anon` + `authenticated`, nên
 *   `REVOKE … FROM PUBLIC` một mình là KHÔNG ĐỦ — phải kể tên hai vai ấy.
 */
describe("hàm nội bộ viết sau 166 phải tự thu quyền", () => {
  const SAU = TEP.filter((f) => Number(f.slice(0, 3)) > 166)
  const ca: Array<[string, string]> = []
  for (const f of SAU) {
    const s = DOC(f)
    for (const m of Array.from(s.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(_[a-z0-9_]+)\(/g))) {
      /* ⚠ Cắt đúng thân: tới THẺ ĐÔ-LA CỦA CHÍNH HÀM (`$$`, `$fn$`…), không tới
         `$$;` đầu tiên — hàm viết bằng `$fn$` mà cắt theo `$$;` là ăn sang
         cả hàm SECURITY DEFINER phía sau và báo oan (gặp ở mig 183). */
      const the = /AS\s+(\$[a-zA-Z0-9_]*\$)/.exec(s.slice(m.index!))
      const moThe = the ? m.index! + the.index + the[0].length : m.index!
      const than = s.slice(m.index!, the ? s.indexOf(the[1], moThe) : s.indexOf("$$;", m.index!))
      if (/SECURITY DEFINER/i.test(than)) ca.push([f, m[1]])
    }
  }

  it("có danh sách (rỗng cũng được)", () => expect(Array.isArray(ca)).toBe(true))

  it.each(ca.length ? ca : [["(chưa có)", ""]])("%s: %s", (f, ten) => {
    if (!ten) return
    const s = DOC(f)
    const re = new RegExp(`REVOKE[^;]*FUNCTION public\\.${ten}\\([^;]*anon[^;]*authenticated|REVOKE[^;]*FUNCTION public\\.${ten}\\([^;]*authenticated[^;]*anon`)
    expect(s, `${ten} chưa REVOKE khỏi anon và authenticated`).toMatch(re)
  })
})

describe("câu báo lỗi huỷ phiếu kho", () => {
  it.each([
    ["ENTRY_HAS_SOURCE: phiếu NK-1 thuộc một hoá đơn nhập mua. Huỷ hoá đơn nhập đó thay vì huỷ riêng phiếu kho.", "phiếu NK-1 thuộc một hoá đơn nhập mua"],
    ["FORBIDDEN: vai trò của bạn không được làm thao tác kho / mua hàng này.", "vai trò của bạn không được"],
  ])("cắt tiền tố kỹ thuật: %s", (raw, can) => {
    const ra = explainCancelEntryError(raw)
    expect(ra.startsWith(can)).toBe(true)
  })
})
