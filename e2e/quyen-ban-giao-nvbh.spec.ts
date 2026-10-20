import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 20/10/2026: "Kiểm tra lại sao tk nhân viên bán hàng lại có bàn giao khách nhỉ".
 *   Gốc: màn Phân quyền lúc nạp chép dòng của mô-đun Khách hàng sang MỌI tính năng con, kể cả ô riêng "Bàn giao khách"
 *   (customers.handover — chỉ chủ NPP / quản lý). Ô mới chưa có dòng riêng nên bảng vẽ NVBH như đã cấp (NVBH có Khách
 *   hàng · Sửa), và bấm Lưu (vì bất cứ thay đổi nào khác) là ghi thật xuống → menu NVBH có "Bàn giao khách".
 *   Dựng lại: sổ có dòng mô-đun Khách hàng của NVBH (như sau một lần Lưu trước khi có ô Bàn giao khách), chưa có dòng
 *   customers.handover. Luật: src/lib/permissions.ts (`laORieng`, `macDinhTinhNang`) · tests/quyen-o-rieng.test.ts.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, { method: "PATCH", body: JSON.stringify({ role }) })
type Dong = { role: string; module: string; action: string; allowed: boolean }
const dongQuyen = async (): Promise<Dong[]> => (await api(`role_permissions?org_id=eq.${ORG}&select=*`)).json()

test.beforeEach(async () => {
  await api("role_permissions", {
    method: "POST",
    body: JSON.stringify(["read", "create", "update", "delete", "approve", "export"].map((action) => ({
      org_id: ORG, role: "sales", module: "customers", action, allowed: ["read", "create", "update", "export"].includes(action),
    }))),
  })
})
test.afterEach(async () => {
  await doiVai("owner")
  await api(`role_permissions?org_id=eq.${ORG}`, { method: "DELETE" })
})

test("màn Phân quyền: ô Bàn giao khách của NVBH KHÔNG tick theo quyền Khách hàng; Lưu không ghi cấp; NVBH không thấy mục", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/settings/permissions")
  await page.getByRole("button", { name: /NV Bán hàng/ }).first().click()
  const dongBg = page.locator("tr", { hasText: "customers.handover" })
  await expect(dongBg).toContainText("Bàn giao khách giữa nhân viên")
  await expect(dongBg.locator('input[type="checkbox"]')).toHaveCount(6)
  await expect(dongBg.locator('input[type="checkbox"]:checked')).toHaveCount(0)
  // Ô thừa hưởng vẫn theo dòng mô-đun như cũ: Lịch sử đi tuyến của NVBH có Xem.
  await expect(page.locator("tr", { hasText: "customers.visits" }).locator('input[type="checkbox"]').first()).toBeChecked()

  // Chủ NPP đổi MỘT ô khác (Khuyến mãi · Xuất) rồi Lưu — trước đây chính lần Lưu này ghi Bàn giao khách cho NVBH.
  await page.locator("tr", { hasText: "promotions" }).first().locator('input[type="checkbox"]').last().click()
  await page.getByRole("button", { name: "Lưu", exact: true }).click()
  await expect(page.getByText("Đã lưu phân quyền").first()).toBeVisible()
  const ghi = (await dongQuyen()).filter((r) => r.role === "sales" && r.module === "customers.handover")
  expect(ghi.length, "Lưu ghi đủ ô Bàn giao khách của NVBH").toBe(6)
  expect(ghi.filter((r) => r.allowed), "không ô nào được cấp").toEqual([])

  // NVBH (bảng quyền nạp từ sổ vừa lưu): menu không có mục, mở thẳng đường dẫn thì bị đẩy về trang chủ.
  await doiVai("sales")
  await page.goto("/customers")
  await expect(page.locator('a[href="/customers/routes"]').first()).toBeAttached()
  await expect(page.locator('a[href="/customers/ban-giao"]')).toHaveCount(0)
  await page.goto("/customers/ban-giao")
  await page.waitForURL(/\/home/)
})
