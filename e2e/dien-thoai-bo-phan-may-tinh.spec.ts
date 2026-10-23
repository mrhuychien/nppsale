import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026: "tốc độ load trang chậm lắm". Điện thoại KHÔNG dựng phần chỉ máy tính mới hiện — thẻ danh sách
 *   máy tính (thanh công cụ + mọi dòng của lưới) và menu trái. Ẩn bằng CSS mà vẫn vẽ đủ là gấp đôi việc cho thứ không
 *   ai thấy. Tải cứng: HTML máy chủ có sẵn (máy chủ chưa biết khổ), vẽ xong lượt đầu thì gỡ. Đi trong app: biết khổ ngay
 *   lượt vẽ đầu (`useKhoMay`) — phần ấy không được dựng dù chỉ một lượt.
 */
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })
const PHAN_MAY = '[data-doc-list="desktop"], aside[data-menu-trai]'
type CuaSo = { __phanMay: string[] }

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("NVBH: không dựng thẻ danh sách máy tính / menu trái — đi trong app không dựng lượt nào", async ({ page }) => {
    /* Ghi lại MỌI lần phần máy tính được gắn VÀ gỡ. Gắn rồi gỡ ngay trong cùng một nhịp (kiểu `useState` + `useEffect`
       cũ) thì lúc bộ theo dõi chạy, phần ấy đã rời khối vừa gắn — chỉ còn thấy lượt GỠ, nên phải ghi cả lượt gỡ. */
    await page.addInitScript((sel) => {
      const w = window as unknown as CuaSo
      w.__phanMay = []
      const ghi = (dau: string, nodes: NodeList) => {
        for (const n of Array.from(nodes)) {
          if (!(n instanceof Element)) continue
          for (const k of n.matches(sel) ? [n] : Array.from(n.querySelectorAll(sel))) {
            w.__phanMay.push(dau + (k.getAttribute("data-doc-list") ?? "menu-trai"))
          }
        }
      }
      new MutationObserver((ds) => {
        for (const d of ds) {
          ghi("+", d.addedNodes)
          ghi("-", d.removedNodes)
        }
      }).observe(document, { childList: true, subtree: true })
    }, PHAN_MAY)
    await dangNhap(page)
    await doiVai("sales")
    try {
      await page.goto("/home")
      await expect(page.getByTestId("trang-chu-nvbh")).toBeVisible()
      await expect(page.locator(PHAN_MAY)).toHaveCount(0)
      await page.evaluate(() => { (window as unknown as CuaSo).__phanMay = [] })

      const nav = page.getByRole("navigation", { name: "Điều hướng chính" })
      await nav.getByRole("link", { name: "Khách" }).click()
      await expect(page).toHaveURL(/\/customers$/)
      await expect(page.getByTestId("kh-mobile").getByTestId("the-khach").first()).toBeVisible()
      await nav.getByRole("link", { name: "Đơn hàng" }).click()
      await expect(page).toHaveURL(/\/orders/)
      await expect(page.getByTestId("don-mobile")).toBeVisible()
      expect(await page.evaluate(() => (window as unknown as CuaSo).__phanMay)).toEqual([])

      // Tải cứng màn danh sách: thẻ máy tính có trong HTML máy chủ, vẽ xong thì gỡ — danh sách điện thoại vẫn đủ.
      await page.goto("/customers")
      await expect(page.getByTestId("kh-mobile").getByTestId("the-khach").first()).toBeVisible()
      await expect(page.locator(PHAN_MAY)).toHaveCount(0)
    } finally {
      await doiVai("owner")
    }
  })
})

test("máy tính: thẻ danh sách + menu trái vẫn đủ (Khách hàng, Đơn hàng, Hoá đơn bán)", async ({ page }) => {
  await dangNhap(page)
  for (const duong of ["/customers", "/orders", "/sales-invoices"]) {
    await page.goto(duong)
    await expect(page.locator('[data-doc-list="desktop"]'), duong).toBeVisible()
    await expect(page.locator("aside[data-menu-trai]"), duong).toBeVisible()
  }
})
