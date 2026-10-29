import { test, expect, type Page, type Route } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 29/10/2026 (Báo cáo tổng hợp › Bán hàng): "sao nó cứ dĩnh lỗi này nhỉ — Không đọc được số liệu · Đọc số bán
 *   hàng hỏng: … đọc số bán: AbortError: Máy chủ chưa trả lời sau 10 giây — thao tác có thể đã được ghi …".
 *   Nay: hàm báo cáo đi bằng GET (câu đọc — không dặn "có thể đã ghi"), chờ 45 giây một lượt: máy chủ chậm vẫn ra số;
 *   quá 45 giây mới báo — câu tiếng Việt, không "AbortError", không "..". Máy chủ chậm dựng bằng cách giữ yêu cầu lại;
 *   đồng hồ giả để khỏi chờ thật.
 */
const KY = "ky=custom&ca=2026-09-01&cb=2026-09-30"
const CAU =
  "Đọc số bán hàng hỏng: Mạng chậm hoặc máy chủ đang bận: đọc số bán: Máy chủ chưa trả lời sau 45 giây. Kiểm tra mạng rồi thử lại. " +
  "Màn này không hiện số 0 thay cho phần lỗi."

/** Giữ câu `bao_cao_so_ban` (không trả lời) khi `treo`; ghi lại phương thức từng lượt. */
async function giuSoBan(page: Page) {
  const tt = { giu: [] as Route[], phuongThuc: [] as string[], treo: true }
  await page.route(/:54321\/rest\/v1\/rpc\/bao_cao_so_ban/, async (route) => {
    tt.phuongThuc.push(route.request().method())
    if (!tt.treo) return route.continue()
    tt.giu.push(route)
  })
  return tt
}

test("máy chủ chậm 30 giây: không bị cắt ở giây 10, không gửi lại — vẫn ra số; hàm báo cáo đi bằng GET", async ({ page }) => {
  await page.clock.install()
  await dangNhap(page)
  const tt = await giuSoBan(page)
  await page.goto(`/bao-cao/ban-hang?${KY}`)
  // Kỳ đang xem + kỳ trước (so sánh) — hai lượt, cùng lúc.
  await expect.poll(() => tt.giu.length).toBe(2)
  expect(tt.phuongThuc).toEqual(["GET", "GET"])

  await page.clock.fastForward("00:12")
  await page.clock.fastForward("00:18")
  await expect(page.getByTestId("bc-loi")).toHaveCount(0)
  expect(tt.giu.length, "không gửi lượt hai").toBe(2)

  for (const r of tt.giu) await r.continue()
  await expect(page.getByTestId("bc-kpi-net")).toContainText("1,2 tr")
  await expect(page.getByTestId("bc-loi")).toHaveCount(0)
})

test("quá 45 giây: báo tiếng Việt — không 'có thể đã được ghi', không AbortError, không '..'; Thử lại là ra số", async ({ page }) => {
  await page.clock.install()
  await dangNhap(page)
  const tt = await giuSoBan(page)
  await page.goto(`/bao-cao/ban-hang?${KY}`)
  await expect.poll(() => tt.giu.length).toBe(2)

  await page.clock.fastForward("00:44")
  await expect(page.getByTestId("bc-loi")).toHaveCount(0)
  await page.clock.fastForward("00:02")
  const loi = page.getByTestId("bc-loi")
  await expect(loi).toContainText(CAU)
  await expect(loi).not.toContainText("có thể đã được ghi")
  await expect(loi).not.toContainText("AbortError")
  await expect(loi).not.toContainText("..")
  // Không gửi lại sau khi hết giờ.
  await page.clock.fastForward("01:00")
  expect(tt.giu.length).toBe(2)

  tt.treo = false
  await loi.getByRole("button", { name: "Thử lại" }).click()
  await expect(page.getByTestId("bc-kpi-net")).toContainText("1,2 tr")
  await expect(page.getByTestId("bc-loi")).toHaveCount(0)
  expect(tt.phuongThuc.every((m) => m === "GET")).toBe(true)
})
