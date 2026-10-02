import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 02/10/2026 (mig 223): chưa có chứng từ thì xoá hẳn; đã có chứng từ thì "Cho nghỉ việc" —
 *   "khi nghỉ bàn giao khách hàng và công nợ về npp. Npp sẽ phân phối lại sau".
 */
test.use({ viewport: { width: 1280, height: 800 } })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const CO = { id: "00000000-0000-4000-8000-0000000000e1", org_id: ORG, full_name: "Lê Văn Nghỉ", role: "sales", phone: "0911000001", is_active: true }
const MOI = { id: "00000000-0000-4000-8000-0000000000e2", org_id: ORG, full_name: "Trần Mới Vào", role: "sales", phone: "0911000002", is_active: true }
const NO = { id: "00000000-0000-4000-8000-0000000000e3", org_id: ORG, customer_id: KHACH, sales_user_id: CO.id, amount: 500000, paid: 0, status: "open" }
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })

test.beforeEach(async () => {
  await api("users", { method: "POST", body: JSON.stringify([CO, MOI]) })
  await api("receivables", { method: "POST", body: JSON.stringify([NO]) })
})
test.afterEach(async () => {
  for (const u of [CO, MOI]) await api(`users?id=eq.${u.id}`, { method: "DELETE" })
  await api(`receivables?id=eq.${NO.id}`, { method: "DELETE" })
})

test("đã có chứng từ → không xoá, Cho nghỉ việc: khoá + nợ về NPP; chưa có → Xoá vĩnh viễn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/settings/users")
  const dong = (ten: string) => page.getByRole("row").filter({ hasText: ten })

  // Người chưa có chứng từ: hộp hỏi xoá hẳn.
  await dong(MOI.full_name).getByRole("button", { name: "Xoá / cho nghỉ việc" }).click()
  const hop = page.getByTestId("xoa-nv-dialog")
  await expect(hop.getByRole("heading")).toHaveText(`Xóa vĩnh viễn ${MOI.full_name}?`)
  await expect(hop.getByTestId("xoa-nv-xac-nhan")).toHaveText("Xóa vĩnh viễn")
  await hop.getByRole("button", { name: "Huỷ" }).click()

  // Người đã có công nợ: không xoá được, cho nghỉ việc.
  await dong(CO.full_name).getByRole("button", { name: "Xoá / cho nghỉ việc" }).click()
  await expect(hop.getByRole("heading")).toHaveText(`Cho ${CO.full_name} nghỉ việc?`)
  await expect(hop.getByTestId("xoa-nv-chung-tu")).toContainText("1 công nợ")
  await expect(hop.getByTestId("xoa-nv-no")).toContainText("1 khoản nợ · 500.000")
  await hop.getByTestId("xoa-nv-xac-nhan").click()
  await expect(page.getByText(`${CO.full_name} đã nghỉ việc — 0 khách, 1 khoản nợ về NPP`).first()).toBeVisible()

  const u = (await (await api(`users?id=eq.${CO.id}&select=*`)).json())[0]
  expect(u).toMatchObject({ is_active: false })
  expect(u.left_at).toBeTruthy()
  const r = (await (await api(`receivables?id=eq.${NO.id}&select=*`)).json())[0]
  expect(r.sales_user_id).toBeNull()

  // Danh sách: chip "Đã nghỉ", nhãn riêng, nút Nhận lại, không còn nút xoá.
  await page.getByRole("tab", { name: /Đã nghỉ\s*1/ }).click()
  await expect(page.getByRole("row").filter({ hasText: CO.full_name })).toHaveCount(1)
  await expect(dong(CO.full_name).getByTestId("trang-thai-nv")).toHaveText("Đã nghỉ")
  await expect(dong(CO.full_name).getByRole("button", { name: /Nhận lại/ })).toBeVisible()
  await expect(dong(CO.full_name).getByRole("button", { name: "Xoá / cho nghỉ việc" })).toHaveCount(0)
})

test("NPP phân lại: phân công NV chính cho khách thì giao luôn công nợ NPP đang giữ", async ({ page }) => {
  await api(`receivables?id=eq.${NO.id}`, { method: "PATCH", body: JSON.stringify({ sales_user_id: null, ve_npp_luc: "2026-10-02T03:00:00Z" }) })
  await dangNhap(page)
  await page.goto(`/customers/${KHACH}`)
  await page.getByRole("tab", { name: /Phân công/ }).click()
  const bao = page.getByTestId("giao-no-npp")
  await expect(bao).toContainText("1 khoản nợ · 500.000")
  await expect(bao.getByRole("checkbox")).toBeChecked()
  await page.getByRole("combobox").filter({ hasText: "Chọn NV Sales" }).click()
  await page.getByRole("option", { name: MOI.full_name }).click()
  await page.getByRole("button", { name: "Phân công", exact: true }).last().click()
  await expect(page.getByText("Đã phân công nhân viên").first()).toBeVisible()
  const r = (await (await api(`receivables?id=eq.${NO.id}&select=*`)).json())[0]
  expect(r.sales_user_id).toBe(MOI.id)
  await api(`customer_assignments?user_id=eq.${MOI.id}`, { method: "DELETE" })
})
