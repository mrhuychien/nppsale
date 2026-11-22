import { test, expect, type Page } from "@playwright/test"
import { dangNhap, mocDonDep, nhatKy, FAKE } from "./helpers"

/**
 * CHỦ NHÀ 22/11/2026 (ảnh màn tạo NCC trên điện thoại): "Kiểm tra lại phần tạo nhà cung cấp mới bị lỗi" — "Dữ liệu này đã tồn
 * tại — duplicate key value violates unique constraint "suppliers_org_id_code_key" (mã 23505)".
 * Bản cũ đánh mã "NCC-" + (số NCC + 1): xoá một NCC / mã nhập Excel lệch thứ tự là số ấy trùng một mã đã có, và lần nào bấm
 * cũng trùng đúng mã ấy. Luật mới: `@/lib/suppliers/ma-ncc` (lớn nhất + 1, máy chủ báo trùng thì đánh tiếp). Sổ giả chặn
 * UNIQUE(org_id, code) như sổ thật (409 + 23505).
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })
const maCua = async (): Promise<string[]> =>
  ((await (await api("suppliers?select=code")).json()) as Array<{ code: string | null }>).map((r) => r.code ?? "")
const soDuoi = (c: string) => Number(/^NCC-(\d+)$/i.exec(c)?.[1] ?? 0)
const ma = (n: number) => `NCC-${String(n).padStart(4, "0")}`

let donDep: () => Promise<void>
test.beforeEach(async () => {
  donDep = await mocDonDep("suppliers")
})
test.afterEach(async () => {
  await donDep()
})

async function moFormTao(page: Page, ten: string) {
  await page.goto("/suppliers/new")
  await page.getByPlaceholder("VD: Công ty TNHH ABC").fill(ten)
}

test("điện thoại: đã xoá bớt NCC (số NCC + 1 trùng mã đang có) — để trống Mã NCC vẫn tạo được, mã = lớn nhất + 1", async ({ browser }) => {
  // Tái hiện: "số NCC sau khi thêm + 1" đúng bằng một mã đang dùng — như sổ đã xoá bớt NCC ở giữa.
  const truoc = await maCua()
  const trungCu = ma(truoc.length + 2)
  await api("suppliers", { method: "POST", body: JSON.stringify([{ org_id: ORG, code: trungCu, name: "NCC Còn Lại", is_active: true }]) })
  const lonNhat = Math.max(0, ...(await maCua()).map(soDuoi))

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await dangNhap(page)
  await moFormTao(page, "NCC Tạo Sau Khi Xoá")
  await page.getByRole("button", { name: "Tạo mới" }).click()
  await expect(page.getByText("Đã tạo nhà cung cấp mới").first()).toBeVisible()
  await expect(page.getByText("Không tạo được nhà cung cấp")).toHaveCount(0)

  const moi = (await (await api(`suppliers?select=code,name&name=eq.${encodeURIComponent("NCC Tạo Sau Khi Xoá")}`)).json()) as Array<{ code: string }>
  expect(moi).toHaveLength(1)
  expect(moi[0].code, `mã cũ "số NCC + 1" là ${trungCu} — trùng`).toBe(ma(lonNhat + 1))
  // Lần ghi ĐẦU đã đúng mã — không dựa vào máy chủ báo trùng rồi đánh lại (vòng ấy chỉ để đỡ hai máy tạo cùng lúc).
  const ghi = (await nhatKy()).filter((r) => r.method === "POST" && r.path === "/rest/v1/suppliers" && (r.body as { name?: string })?.name === "NCC Tạo Sau Khi Xoá")
  expect(ghi.map((r) => (r.body as { code: string }).code)).toEqual([ma(lonNhat + 1)])
  await ctx.close()
})

test("gõ tay một Mã NCC đã có → báo rõ mã nào trùng, không đẩy câu lỗi Postgres; không tạo dòng nào", async ({ page }) => {
  await api("suppliers", { method: "POST", body: JSON.stringify([{ org_id: ORG, code: "NCC-GOTAY", name: "NCC Mã Gõ Tay", is_active: true }]) })
  await dangNhap(page)
  await moFormTao(page, "NCC Trùng Mã Gõ Tay")
  await page.getByPlaceholder("Tự động: NCC-0001").fill("NCC-GOTAY")
  await page.getByRole("button", { name: "Tạo mới" }).click()
  await expect(page.getByText("Không tạo được nhà cung cấp").first()).toBeVisible()
  await expect(page.getByText("Mã NCC “NCC-GOTAY” đã có — đổi mã khác, hoặc để trống ô Mã NCC để hệ thống tự đánh mã.").first()).toBeVisible()
  await expect(page.getByText("duplicate key value")).toHaveCount(0)
  await expect(page).toHaveURL(/\/suppliers\/new$/)
  const moi = (await (await api(`suppliers?select=id&name=eq.${encodeURIComponent("NCC Trùng Mã Gõ Tay")}`)).json()) as unknown[]
  expect(moi).toHaveLength(0)
})

test("mã tự đánh bị máy khác chiếm trước (đọc mã xong, chưa kịp ghi) → máy chủ báo trùng thì đánh mã kế tiếp", async ({ page }) => {
  const dau = Math.max(0, ...(await maCua()).map(soDuoi)) + 50
  await api("suppliers", {
    method: "POST",
    body: JSON.stringify([
      { org_id: ORG, code: ma(dau), name: "NCC Chiếm A", is_active: true },
      { org_id: ORG, code: ma(dau + 1), name: "NCC Chiếm B", is_active: true },
    ]),
  })
  await dangNhap(page)
  // Câu đọc mã trả bản CŨ (chưa thấy mã dau + 1 — như NCC vừa được tạo ở máy khác sau lúc đọc).
  await page.route(/\/rest\/v1\/suppliers\?select=code&/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1", "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" },
      body: JSON.stringify([{ code: ma(dau) }]),
    })
  )
  await moFormTao(page, "NCC Đánh Lại Mã")
  await page.getByRole("button", { name: "Tạo mới" }).click()
  await expect(page.getByText("Đã tạo nhà cung cấp mới").first()).toBeVisible()
  const moi = (await (await api(`suppliers?select=code&name=eq.${encodeURIComponent("NCC Đánh Lại Mã")}`)).json()) as Array<{ code: string }>
  expect(moi.map((r) => r.code)).toEqual([ma(dau + 2)])
  const ghi = (await nhatKy()).filter((r) => r.method === "POST" && r.path === "/rest/v1/suppliers" && (r.body as { name?: string })?.name === "NCC Đánh Lại Mã")
  expect(ghi.map((r) => (r.body as { code: string }).code), "lần ghi đầu phải trùng, lần sau đánh tiếp").toEqual([ma(dau + 1), ma(dau + 2)])
})
