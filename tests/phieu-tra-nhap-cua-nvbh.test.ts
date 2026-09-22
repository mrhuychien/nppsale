import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * NVBH SỬA / XOÁ ĐƯỢC PHIẾU TRẢ NHÁP CỦA CHÍNH MÌNH — VÀ CHỈ THẾ.
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16 (22/09/2026), đăng nhập bằng NVBH, đi đúng
 *   đường sửa đơn kèm hàng trả:
 *
 *     trước mig 165                        sau mig 165
 *     sửa lý do phiếu của mình:  0 dòng    1 dòng
 *     bỏ hết dòng trả:           1 dòng    1 dòng
 *     xoá phiếu rỗng của mình:   0 dòng    1 dòng
 *
 *   Trước 165, bước giữa ghi xong còn bước cuối bị chặn → một PHIẾU TRẢ
 *   RỖNG nằm lại trong sổ.
 *
 *   Và các ranh giới, đo sau 165:
 *     tự đẩy phiếu sang completed:       bị chặn (42501)
 *     chuyển phiếu sang tên người khác:  bị chặn (P0001, trigger mig 160)
 *     sửa / xoá phiếu nháp NGƯỜI KHÁC:   0 dòng
 */

const DIR = resolve(__dirname, "..", "supabase/migrations")

/** Bản CUỐI CÙNG của một chính sách — migration sau ghi đè migration trước. */
function chinhSach(ten: string): string {
  const neo = `CREATE POLICY "${ten}"`
  const tep = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(resolve(DIR, f), "utf-8"))
    .filter((s) => s.includes(neo))
  expect(tep.length, `không migration nào dựng "${ten}" — chốt soi chỗ trống`).toBeGreaterThan(0)
  const s = tep[tep.length - 1]
  const i = s.indexOf(neo)
  return s.slice(i, s.indexOf(";", i))
}

describe("chính sách phiếu trả nháp của NVBH", () => {
  const SUA = chinhSach("Sales can update own draft returns")
  const XOA = chinhSach("Sales can delete own draft returns")

  it("đúng phép: một UPDATE, một DELETE", () => {
    expect(SUA).toMatch(/FOR UPDATE/)
    expect(XOA).toMatch(/FOR DELETE/)
  })

  /**
   * ⚠ BỐN VẾ, KHÔNG THIẾU VẾ NÀO. Thiếu `org_id` là sửa được phiếu của
   *   NPP khác; thiếu `sales` là mọi vai đều lọt qua cửa này; thiếu
   *   `auth.uid()` là sửa được phiếu của đồng nghiệp; thiếu `draft` là
   *   sửa được phiếu đã ghi sổ.
   */
  it.each([
    ["org_id = public.user_org_id()", "cùng NPP"],
    ["public.user_role() = 'sales'", "chỉ NVBH"],
    ["sales_user_id = auth.uid()", "của chính mình"],
    ["status = 'draft'", "chỉ phiếu nháp"],
  ])("cả hai chính sách đều đòi %s (%s)", (ve) => {
    const u = SUA.slice(SUA.indexOf("USING"), SUA.indexOf("WITH CHECK"))
    expect(u, `UPDATE thiếu vế ${ve}`).toContain(ve)
    expect(XOA, `DELETE thiếu vế ${ve}`).toContain(ve)
  })

  /**
   * ⚠ `WITH CHECK` CŨNG PHẢI ĐÒI NHÁP VÀ ĐÒI CHÍNH MÌNH. Thiếu nháp là
   *   NVBH tự đẩy phiếu sang `completed`, né phép hoàn kho và ghi công nợ
   *   của RPC `complete_return`. Thiếu chính mình là chuyển phiếu sang
   *   tên đồng nghiệp — hoa hồng trừ hàng trả rơi vào người khác.
   */
  it("cổng ghi (WITH CHECK) đòi nháp và đòi chính mình", () => {
    const c = SUA.slice(SUA.indexOf("WITH CHECK"))
    expect(c, "không có WITH CHECK").toContain("WITH CHECK")
    expect(c, "tự đẩy được phiếu sang completed").toContain("status = 'draft'")
    expect(c, "chuyển được phiếu sang tên người khác").toContain("sales_user_id = auth.uid()")
  })

  /**
   * ⚠ Phiếu trả kèm đơn phải được TẠO ở `draft` — cả luật này dựa trên
   *   điều ấy. Đổi chỗ tạo sang trạng thái khác là NVBH mất quyền sửa
   *   chính phiếu mình vừa lập.
   */
  it("phiếu trả kèm đơn vẫn được tạo ở trạng thái nháp", () => {
    const s = readFileSync(resolve(__dirname, "..", "src/lib/orders/create.ts"), "utf-8")
    const i = s.indexOf('.from("returns")')
    expect(i, "không còn chỗ tạo phiếu trả kèm đơn").toBeGreaterThan(-1)
    expect(s.slice(i, i + 600), "phiếu trả kèm đơn không còn tạo ở draft").toContain(
      'status: "draft"'
    )
  })
})
