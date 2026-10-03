import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ RÀ SOÁT 03/10/2026: chip tuổi nợ ở màn Công nợ (điện thoại). Bản cũ tải 20 khoản (hạn cũ nhất trước) rồi lọc
 *   tuổi nợ TRONG 20 khoản ấy — 25 khoản Khẩn cấp chiếm hết trang đầu, bấm "Trong hạn" ra trống. Nay lọc trên máy
 *   chủ theo khoảng `due_date` (`src/lib/receivables/tuoi-no.ts`); số trên chip đếm trên máy chủ cùng bộ lọc.
 * Ngày e2e: 30/09/2026 (helpers.HOM_NAY_E2E).
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const NO = [
  // 25 khoản quá hạn > 60 ngày (Khẩn cấp) — hạn cũ nhất, đứng đầu danh sách.
  ...Array.from({ length: 25 }, (_, i) => ({ id: `tn-cu-${i}`, due_date: "2026-06-01", amount: 100_000 + i })),
  // 3 khoản chưa tới hạn — xếp CUỐI (sau 25 khoản trên).
  ...Array.from({ length: 3 }, (_, i) => ({ id: `tn-moi-${i}`, due_date: "2026-10-20", amount: 777_000 + i })),
  // 1 khoản quá hạn 10 ngày (Cảnh báo) + 1 khoản đã thu xong (không thuộc nhóm tuổi nợ nào).
  { id: "tn-canh-bao", due_date: "2026-09-20", amount: 555_000 },
  { id: "tn-da-thu", due_date: "2026-10-20", amount: 333_000, paid: 333_000, status: "paid" },
].map((r) => ({ org_id: ORG, customer_id: KHACH, paid: 0, status: "open", invoice_id: null, opening_balance: true, customer: { store_name: "Tạp hoá Cô Ba" }, ...r }))
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })

test.beforeEach(async () => {
  await api("receivables", { method: "POST", body: JSON.stringify(NO) })
})
test.afterEach(async () => {
  for (const n of NO) await api(`receivables?id=eq.${n.id}`, { method: "DELETE" })
})

test("điện thoại: chip tuổi nợ lọc cả sổ, số trên chip = số khoản hiện ra", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/receivables")
  const the = (so: RegExp) => page.getByRole("link", { name: so }).filter({ visible: true })
  const tab = (ten: string) => page.getByRole("tab", { name: new RegExp(`^${ten}`) }).filter({ visible: true })
  await expect(tab("Tất cả")).toContainText("30")
  await expect(tab("Trong hạn")).toContainText("3")
  await expect(tab("Cảnh báo")).toContainText("1")
  await expect(tab("Khẩn cấp")).toContainText("25")

  // Bản cũ: trang đầu là 20 khoản Khẩn cấp → lọc "Trong hạn" trong đó ra trống.
  await tab("Trong hạn").click()
  await expect(the(/ 777\.0\d\dđ/)).toHaveCount(3)
  await expect(the(/ 100\.0\d\dđ/)).toHaveCount(0)
  await expect(the(/ 333\.0\d\dđ/)).toHaveCount(0) // đã thu xong
  // "Tất cả" không đổi theo chip đang chọn.
  await expect(tab("Tất cả")).toContainText("30")

  await tab("Cảnh báo").click()
  await expect(the(/ 555\.0\d\dđ/)).toHaveCount(1)
  await expect(the(/ 777\.0\d\dđ/)).toHaveCount(0)

  // Gửi xuống máy chủ khoảng hạn, không lọc ở trình duyệt.
  const log: Array<{ method: string; path: string; query: string }> = await (await fetch(`${FAKE}/__log`)).json()
  const q = (r: { query: string }) => decodeURIComponent(r.query || "")
  expect(log.some((r) => r.path.endsWith("/receivables") && q(r).includes("due_date=gte.2026-08-31") && q(r).includes("due_date=lte.2026-09-29"))).toBe(true)
})
