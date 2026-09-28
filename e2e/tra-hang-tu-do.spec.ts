import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 28/09/2026: "Từ Xem nhanh hoá đơn trên Danh sách hoá đơn ấn phiếu trả -> tạo
 *   phiếu trả hàng, tao muốn cho đổi trả tự do, ko nhất thiết chỉ được trả hàng có trong đơn".
 *   HD-E2E-1 chỉ bán Sữa hộp (Mì tôm là dòng hàng ĐỔI, không phải hàng bán).
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"

test("trả hàng gắn hóa đơn: tìm được và thêm được hàng KHÔNG có trên hóa đơn; hàng trên HĐ có nhãn", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/pos/tra-hang/moi?invoice=${HOA_DON}&customerId=${KHACH}`)
  const dong = page.getByTestId("dong-tra")
  await expect(dong).toHaveCount(1) // nạp sẵn Sữa hộp từ hóa đơn
  const oTim = page.getByPlaceholder(/hàng trên HĐ gốc xếp trước/)
  await oTim.fill("Sữa")
  await expect(page.getByText(/Trên HĐ gốc ·/).first()).toBeVisible()
  await oTim.fill("Mì")
  await oTim.press("Enter")
  await expect(dong).toHaveCount(2)
  await expect(dong.nth(1)).toContainText("Mì tôm")
})
