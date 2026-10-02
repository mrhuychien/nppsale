import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Phần Soạn hàng làm riêng 1 trang bên Kho vận > Soạn hàng > mở ra chọn danh sách Hoá
 *   đơn chứ ko phải đơn hàng. -> tổng hợp lại thành đơn tổng."
 * ⚠ CHỦ NHÀ 02/10/2026: bộ lọc + đánh dấu đã soạn (mig 224); "thiết kế màn soạn hàng các tính năng kiểu như giao
 *   diện mẫu này" — chọn hoá đơn → nhặt tổng theo kệ → chia rổ A, B… → Hoàn tất soạn (mig 225, lưu máy chủ);
 *   thiếu hàng: ghi thiếu, báo để sửa HĐ. Lõi: tests/luot-soan.test.ts; máy chủ: scripts/sql/thu-225-luot-soan.sql.
 * Mẫu: HD-E2E-1 = 2 thùng Sữa (hệ số 24) + 1 gói Mì (hàng đổi); thêm cho HD-E2E-2 5 hộp Sữa
 *   → Sữa tổng 53 hộp = 2 thùng + 5 hộp (rổ A 48 · B 5), Mì 1 gói (rổ A).
 */
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
const HD1 = "00000000-0000-4000-8000-0000000000f1"
const HD2 = "00000000-0000-4000-8000-0000000000f2"
const SUA = { name: "Sữa hộp", sku: "SUA1", base_unit: "hộp", shelf_location: "A1-03", units: [{ unit_name: "thùng", conversion: 24 }] }
const MI = { name: "Mì tôm", sku: "MI1", base_unit: "gói", shelf_location: "B2-01", units: [{ unit_name: "thùng", conversion: 30 }] }

test.beforeAll(async () => {
  await api("sales_invoice_lines?id=eq.sil1", "PATCH", { product: SUA })
  await api("sales_invoice_lines?id=eq.sil2", "PATCH", { product: MI })
  await api("sales_invoice_lines", "POST", [{
    id: "sil-soan", invoice_id: HD2, product_id: "00000000-0000-4000-8000-0000000000d1", quantity: 5, unit_name: "hộp",
    conversion_factor: 1, is_exchange: false, product: SUA, sort_order: 0,
  }])
})
test.afterAll(async () => {
  await api("sales_invoice_lines?id=eq.sil-soan", "DELETE")
  await api("sales_invoice_lines?id=eq.sil1", "PATCH", { product: { name: "Sữa hộp", sku: "SUA1" } })
  await api("sales_invoice_lines?id=eq.sil2", "PATCH", { product: { name: "Mì tôm", sku: "MI1" } })
})
test.afterEach(async () => {
  for (const id of [HD1, HD2]) await api(`sales_invoices?id=eq.${id}`, "PATCH", { soan_luc: null, soan_boi: null })
  const ds = await (await api("luot_soan?select=id", "GET")).json()
  for (const l of ds as { id: string }[]) await api(`luot_soan?id=eq.${l.id}`, "DELETE")
})
const luot = async () => ((await (await api("luot_soan?select=*", "GET")).json()) as Array<{ trang_thai: string; tien_do: { nhat: Record<string, number> } }>)[0]

test.describe("máy tính", () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test("chọn HĐ → nhặt tổng theo kệ (thiếu hàng) → lưu máy chủ, tải lại còn → chia rổ → Hoàn tất soạn", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/inventory")
    await page.getByRole("link", { name: "Soạn hàng" }).first().click()
    const man = page.getByTestId("soan-hang-may-tinh")
    await expect(man.getByText("Chưa chọn hóa đơn nào")).toBeVisible()

    const kq = page.getByTestId("ket-qua-hoa-don")
    await kq.filter({ hasText: "HD-E2E-1" }).click()
    await kq.filter({ hasText: "HD-E2E-2" }).click()
    await expect(kq.filter({ hasText: "HD-E2E-1" }).getByTestId("nhan-ro")).toHaveText("Rổ A")
    await expect(kq.filter({ hasText: "HD-E2E-2" }).getByTestId("nhan-ro")).toHaveText("Rổ B")

    // Nhặt tổng: nhóm theo kệ, quy về đơn vị cơ sở, phần từng rổ.
    await expect(page.getByTestId("nhom-nhat")).toHaveText([/Kệ A/, /Kệ B/])
    const sua = page.getByTestId("dong-nhat").filter({ hasText: "Sữa hộp" })
    await expect(sua.getByTestId("sl-nhat")).toHaveText("2 thùng + 5 hộp")
    await expect(sua).toContainText("= 53 hộp")
    await expect(sua.getByTestId("phan-ro")).toHaveText(["A48", "B5"])
    await expect(page.getByTestId("dong-nhat").filter({ hasText: "Mì tôm" })).toContainText("có hàng đổi")

    await sua.getByRole("button", { name: "Đã nhặt Sữa hộp" }).click()
    await expect(page.getByTestId("tien-do-nhat")).toHaveText("Đã nhặt 1/2 mặt hàng")
    await expect(page.getByTestId("ds-luot")).toContainText("SH-02/10-01 · 2 HĐ")
    await expect(page).toHaveURL(/\?luot=/)
    await expect.poll(async () => (await luot())?.tien_do.nhat).toEqual({ "00000000-0000-4000-8000-0000000000d1": 53 })

    // Thiếu hàng: Mì nhặt được 0 → nhặt xong hết → tự sang bước chia.
    const mi = page.getByTestId("dong-nhat").filter({ hasText: "Mì tôm" })
    await mi.getByRole("button", { name: "Thiếu hàng" }).click()
    await mi.getByLabel("Số nhặt được Mì tôm").fill("0")
    await mi.getByRole("button", { name: "Lưu" }).click()
    await expect(page.getByTestId("tien-do-chia")).toHaveText("0/2 phần")

    // Tải lại: tiến độ nằm trên máy chủ.
    await page.reload()
    await expect(page.getByTestId("tien-do-chia")).toHaveText("0/2 phần")

    // Chia: Mì rổ A hết hàng; báo hoá đơn thiếu để sửa.
    const o = page.getByTestId("o-chia")
    await expect(o).toHaveText(["48 hộp", "5 hộp", "Hết hàng"])
    await expect(o.nth(2)).toBeDisabled()
    await expect(page.getByTestId("ds-thieu")).toContainText("Rổ A · HD-E2E-1")
    await expect(page.getByTestId("ds-thieu")).toContainText("Thiếu 1 gói · Mì tôm")
    await expect(page.getByTestId("ds-thieu").getByRole("link", { name: "Mở hóa đơn" })).toHaveAttribute("href", `/sales-invoices/${HD1}`)

    await expect(page.getByTestId("hoan-tat-soan")).toBeDisabled()
    await page.getByTestId("cot-ro").first().click()
    await expect(page.getByTestId("cot-ro").first()).toContainText("Đủ hàng")
    await o.nth(1).click()
    await expect(page.getByTestId("ghi-chu-chia")).toHaveText("Tất cả rổ đã đủ hàng")
    await page.getByTestId("hoan-tat-soan").click()
    await expect(page.getByText("Đã hoàn tất soạn 2 hóa đơn").first()).toBeVisible()
    await expect.poll(async () => (await luot())?.trang_thai).toBe("xong")
    const hd = (await (await api(`sales_invoices?id=eq.${HD1}&select=*`, "GET")).json())[0]
    expect(hd.soan_luc).toBeTruthy()
    // Mặc định Chưa soạn: hai HĐ vừa soạn rời danh sách.
    await expect(kq.filter({ hasText: "HD-E2E-1" })).toHaveCount(0)

    const to = page.getByTestId("to-in-soan-hang")
    await expect(to).toContainText("PHIẾU NHẶT HÀNG")
  })

  test("bộ lọc: chip tuyến, Đã soạn / Tất cả, nhân viên", async ({ page }) => {
    await api("sales_routes", "POST", [{ id: "tuyen-t9", org_id: "00000000-0000-4000-8000-0000000000a1", code: "T9", name: "Thứ Chín", is_active: true, sort_order: 9 }])
    await api(`sales_invoices?id=eq.${HD1}`, "PATCH", { customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", channel: "T9" }, soan_luc: "2026-10-02T01:15:00Z" })
    try {
      await dangNhap(page)
      await page.goto("/inventory/soan-hang")
      const kq = page.getByTestId("ket-qua-hoa-don")
      await expect(kq.filter({ hasText: "HD-E2E-2" })).toBeVisible()
      await expect(kq.filter({ hasText: "HD-E2E-1" })).toHaveCount(0)
      await page.getByRole("button", { name: "Lọc thêm" }).click()
      const tt = page.getByRole("group", { name: "Trạng thái soạn" })
      await tt.getByRole("button", { name: "Đã soạn" }).click()
      await expect(kq).toHaveCount(1)
      await expect(kq.first().getByTestId("da-soan")).toContainText("Đã soạn 08:15 02/10")
      await tt.getByRole("button", { name: "Tất cả" }).click()
      await expect(kq).toHaveCount(2)
      await page.getByRole("group", { name: "Tuyến" }).getByRole("button", { name: "Tuyến T9" }).click()
      await expect(kq).toHaveCount(1)
      await expect(kq.first()).toContainText("Tuyến T9")
      await page.getByRole("group", { name: "Tuyến" }).getByRole("button", { name: "Tất cả" }).click()
      await page.getByRole("combobox", { name: "Nhân viên bán" }).click()
      await page.getByRole("option", { name: "Chủ NPP" }).click()
      await expect(kq).toHaveCount(1)
      await expect(kq.first()).toContainText("HD-E2E-1")
    } finally {
      await api("sales_routes?id=eq.tuyen-t9", "DELETE")
      await api(`sales_invoices?id=eq.${HD1}`, "PATCH", { customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi" } })
    }
  })
})

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  const bam = (page: Page, id: string) => page.getByTestId(id).click()

  test("tạo lượt → chuẩn bị rổ → nhặt lần lượt (thiếu hàng) → chia rổ → kiểm tra → Hoàn tất soạn", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/inventory/soan-hang")
    const man = page.getByTestId("soan-hang-dien-thoai")
    await expect(man.getByText("Chưa có lượt soạn nào đang dở.")).toBeVisible()
    await man.getByRole("button", { name: "Tạo lượt soạn mới" }).click()
    await page.getByTestId("ket-qua-hoa-don").filter({ hasText: "HD-E2E-1" }).click()
    await page.getByTestId("ket-qua-hoa-don").filter({ hasText: "HD-E2E-2" }).click()
    await bam(page, "tao-luot")

    // Chuẩn bị rổ.
    await expect(man.getByRole("heading", { name: "SH-02/10-01" })).toBeVisible()
    await expect(page.getByTestId("ds-ro")).toContainText("HD-E2E-1")
    await expect(page.getByTestId("ds-ro")).toContainText("HD-E2E-2")
    await bam(page, "bat-dau-nhat")

    // Nhặt lần lượt: Sữa (kệ A) trước.
    await expect(page.getByTestId("the-nhat")).toContainText("A1-03")
    await expect(page.getByTestId("sl-nhat")).toHaveText("2 thùng + 5 hộp")
    await expect(man.getByText("Tiếp theo")).toBeVisible()
    await bam(page, "nhat-du")
    await expect(page.getByTestId("the-nhat")).toContainText("Mì tôm")
    // Mặt hàng cuối: không còn khối "Tiếp theo" rỗng.
    await expect(man.getByText("Tiếp theo")).toHaveCount(0)
    await man.getByRole("button", { name: "Thiếu hàng" }).click()
    await expect(page.getByTestId("sheet-thieu")).toContainText("Thiếu ở rổ A (1)")
    await bam(page, "luu-thieu")
    await expect(page.getByTestId("nhat-xong")).toContainText("1 mặt hàng thiếu")
    await bam(page, "sang-chia")

    // Chia rổ Sữa: A 48, B 5.
    const o = page.getByTestId("o-chia")
    await expect(o).toHaveCount(2)
    await o.first().click()
    await o.nth(1).click()
    await expect(page.getByTestId("chia-chinh")).toHaveText("Kiểm tra rổ")
    await bam(page, "chia-chinh")

    await expect(page.getByTestId("ghi-chu-xong")).toContainText("1 rổ thiếu hàng")
    await expect(page.getByTestId("the-ro-xong").first()).toContainText("Thiếu 1 gói · Mì tôm")
    await bam(page, "hoan-tat-soan")
    await expect.poll(async () => (await luot())?.trang_thai).toBe("xong")
    await expect(man.getByText("Chưa có lượt soạn nào đang dở.")).toBeVisible()
  })
})
