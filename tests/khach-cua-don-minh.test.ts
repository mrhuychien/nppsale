import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * NHÂN VIÊN PHẢI ĐỌC ĐƯỢC KHÁCH CỦA ĐƠN ĐỨNG TÊN MÌNH.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "Tạo đơn hàng hộ nhân viên — Nhân viên vào
 * xem ko có tên khách hàng".
 *
 * ⚠ HAI CHÍNH SÁCH RLS DÙNG HAI LUẬT KHÁC NHAU CHO CÙNG MỘT VIỆC.
 * `sales_order_select` cho NVBH thấy đơn khi `sales_user_id = auth.uid()`.
 * `customer_select` thì không có vế ấy — chỉ phân công hoặc tự tạo. Nên
 * NPP lập đơn hộ nhân viên cho một khách chưa giao cho người ấy là:
 * nhân viên thấy ĐƠN, không thấy KHÁCH.
 *
 * ⚠ VÀ NÓ IM LẶNG. Màn đơn đọc khách bằng embed
 * `customer:customers(...)`; PostgREST trả `null` cho phần bị chặn và
 * HTTP vẫn 200. Không có lỗi nào để mà bắt — chỉ có một ô tên trống.
 */

const ROOT = resolve(__dirname, "..")
const DIR = resolve(ROOT, "supabase/migrations")

/**
 * SOI BẢN ĐANG CHẠY: migration SỐ CAO NHẤT có dựng chính sách này.
 *
 * ⚠ Bài học mig 151. Đọc tệp cũ nhất là chốt vẫn xanh trong khi bản
 * thật trên máy chủ đã mất miếng vá từ lâu.
 */
function chinhSachMoiNhat(neo: string): { ten: string; sql: string } {
  const found = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ ten: f, sql: readFileSync(resolve(DIR, f), "utf-8") }))
    .filter((m) => m.sql.includes(neo))
  // ⚠ Chốt mù là chốt nói dối — không thấy gì thì phải ĐỎ.
  expect(found.length, `không migration nào dựng "${neo}"`).toBeGreaterThan(0)
  return found[found.length - 1]
}

const POLICY = chinhSachMoiNhat("CREATE POLICY customer_select ON customers")

/** Chỉ phần thân `USING (...)` của chính sách, không lấy chú thích quanh nó. */
const USING = (() => {
  const i = POLICY.sql.indexOf("CREATE POLICY customer_select ON customers")
  const than = POLICY.sql.slice(i, POLICY.sql.indexOf("\n\n", i))
  return than.replace(/--.*$/gm, "")
})()

describe("khách của đơn đứng tên mình thì đọc được", () => {
  /**
   * ⚠ ĐÚNG LUẬT MÀ `sales_order_select` ĐANG DÙNG để cho nhân viên thấy
   * chính cái đơn đó. Hai bảng phải trả lời cùng một câu hỏi theo cùng
   * một cách, nếu không thì màn hình hiện nửa vời.
   */
  it("chính sách có vế đơn-đứng-tên-tôi", () => {
    expect(
      USING.includes("user_sells_to_customer"),
      `${POLICY.ten}: thiếu vế đơn-đứng-tên-tôi — nhân viên mở đơn NPP giao cho sẽ không thấy tên khách`
    ).toBe(true)
  })

  /**
   * ⚠ PHẢI LÀ HÀM `SECURITY DEFINER`, KHÔNG ĐƯỢC TRUY VẤN THẲNG
   * `sales_orders`. `customers` hỏi `sales_orders`, chính sách của bảng
   * ấy hỏi `customer_assignments`, chính sách của bảng ấy hỏi ngược
   * `customers` → đệ quy vô tận, PostgREST trả 500. Kho mã này đã dính
   * đúng lỗi đó hai lần (mig 005, mig 037).
   */
  it("đi qua hàm SECURITY DEFINER, không truy vấn thẳng sales_orders", () => {
    const dinhNghia = chinhSachMoiNhat("CREATE OR REPLACE FUNCTION public.user_sells_to_customer")
    expect(dinhNghia.sql).toMatch(/SECURITY\s+DEFINER/i)
    expect(
      /FROM\s+(public\.)?sales_orders/i.test(USING),
      `${POLICY.ten}: hỏi thẳng sales_orders trong chính sách của customers — sẽ đệ quy RLS và trả 500`
    ).toBe(false)
  })

  /**
   * ⚠ BỐN VẾ CŨ PHẢI CÒN NGUYÊN. Dựng lại trọn một chính sách là cơ hội
   * đánh rơi vế khác mà không ai thấy — mất vế phân công thì NVBH không
   * còn thấy khách được giao, mất vế quyền thì `customer.view_all` vô
   * tác dụng. Cả hai đều im lặng: danh sách chỉ ngắn đi.
   */
  it.each([
    ["vai trò quản trị", "user_role()"],
    ["quyền customer.view_all", "user_has_permission"],
    ["khách được phân công", "customer_assignments"],
    ["khách do chính mình tạo", "created_by"],
  ])("giữ nguyên vế %s", (_ten, neo) => {
    expect(USING.includes(neo), `${POLICY.ten}: đánh rơi vế này khi dựng lại`).toBe(true)
  })

  /** ⚠ Và vẫn phải đúng đơn vị — vế này mất là lộ khách sang đơn vị khác. */
  it("vẫn chặn theo đơn vị", () => {
    expect(USING).toMatch(/org_id\s*=\s*public\.user_org_id\(\)/)
  })
})
