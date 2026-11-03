import { test, expect } from "@playwright/test"
import * as XLSX from "xlsx"
import { dangNhap, FAKE, mocDonDep, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 03/11/2026: "em rà soát luôn tất cả các chỗ tạo khách hàng đều phải qua bước lọc trùng nhé".
 *   Nhập khách từ Excel cũ đối chiếu với `customers.phone` đọc thẳng (RLS: NVBH chỉ thấy khách của mình) và chỉ bỏ khoảng
 *   trắng — "0911.111.111" / "+84 922 222 222" thành khách thứ hai cùng số. Nay: đọc file xong là LỌC TRÙNG từng số qua
 *   `search_customer_dupes` (thấy cả khách NV khác, so bằng chữ số), dòng trùng hiện ra và bị bỏ qua; số lưu chuẩn hoá.
 *   Dữ liệu mẫu: "Tạp hoá Cô Ba" 0911111111, "Đại lý Minh" 0922222222.
 */
test.use({ viewport: { width: 1440, height: 900 } })

/** Tệp .xlsx thật (như người dùng tải lên). */
function tepXlsx(dong: string[][]): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dong), "Khach hang")
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

const chuSo = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "").replace(/^84/, "0")

test("nhập Excel: lọc trùng SĐT với mọi khách đã có (cả số viết khác: chấm, +84) TRƯỚC khi nhập — chỉ nhập khách mới, số lưu chuẩn hoá", async ({ page }) => {
  const donDep = await mocDonDep("customers")
  try {
    await dangNhap(page)
    await page.goto("/customers")
    await page.getByRole("button", { name: "Nhập Excel" }).click()
    const hop = page.getByRole("dialog").filter({ hasText: "Nhập khách hàng từ Excel" })
    await expect(hop).toBeVisible()

    const goc = (await nhatKy()).filter((r) => r.path.endsWith("/rpc/search_customer_dupes")).length
    await hop.locator('input[type="file"]').setInputFiles({
      name: "khach.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: tepXlsx([
        ["Tên cửa hàng", "SĐT", "Địa chỉ"],
        ["Tạp hoá Nhập Mới", "0987 000 111", "9 Lê Lợi"],
        ["Cô Ba ghi lại", "0911.111.111", "1 Lê Lợi"],
        ["Minh ghi lại", "+84 922 222 222", "2 Trần Phú"],
      ]),
    })

    // Bước lọc trùng: hai dòng trùng khách đã có — hiện ra trước khi nhập, nói rõ trùng ai.
    await expect(hop.getByTestId("nhap-khach-so-trung")).toHaveText(/2 trùng SĐT — bỏ qua/)
    const trung = hop.getByTestId("nhap-khach-dong-trung")
    await expect(trung).toHaveCount(2)
    await expect(trung.filter({ hasText: "Cô Ba ghi lại" })).toContainText("Trùng SĐT: đã có “Tạp hoá Cô Ba”")
    await expect(trung.filter({ hasText: "Minh ghi lại" })).toContainText("Trùng SĐT: đã có “Đại lý Minh”")
    const nut = hop.getByTestId("nhap-khach-nut")
    await expect(nut).toHaveText("Nhập 1 khách hàng")
    // Hỏi sổ bằng hàm dò trùng (SECURITY DEFINER — thấy cả khách NV khác), bằng GET (hàm chỉ đọc).
    const hoi = (await nhatKy()).filter((r) => r.path.endsWith("/rpc/search_customer_dupes")).slice(goc)
    expect(hoi.length).toBe(3)
    expect(hoi.every((r) => r.method === "GET")).toBe(true)

    await nut.click()
    await expect(page.getByText("Đã nhập 1 khách hàng", { exact: true })).toBeVisible()
    await expect(page.getByText("Bỏ qua 2 KH đã tồn tại (trùng SĐT).", { exact: true })).toBeVisible()

    const ds = (await (await fetch(`${FAKE}/rest/v1/customers?select=id,store_name,phone`)).json()) as Array<{ store_name: string; phone: string }>
    expect(ds.filter((c) => chuSo(c.phone) === "0911111111"), "khách thứ hai cùng số 0911111111").toHaveLength(1)
    expect(ds.filter((c) => chuSo(c.phone) === "0922222222"), "khách thứ hai cùng số 0922222222").toHaveLength(1)
    // Số lưu chuẩn hoá như khi tạo tay — UNIQUE(org_id, phone) so nguyên văn.
    expect(ds.find((c) => c.store_name === "Tạp hoá Nhập Mới")?.phone).toBe("0987000111")
  } finally {
    await donDep()
  }
})

test("nhập Excel: chưa lọc được trùng (máy chủ lỗi) → không cho nhập, có nút Kiểm lại", async ({ page }) => {
  const donDep = await mocDonDep("customers")
  try {
    await dangNhap(page)
    let hong = true
    await page.route(/:54321\/rest\/v1\/rpc\/search_customer_dupes/, (route) =>
      hong
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "máy chủ bận", details: null, hint: null }) })
        : route.continue()
    )
    await page.goto("/customers")
    await page.getByRole("button", { name: "Nhập Excel" }).click()
    const hop = page.getByRole("dialog").filter({ hasText: "Nhập khách hàng từ Excel" })
    await hop.locator('input[type="file"]').setInputFiles({
      name: "khach.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: tepXlsx([["Tên cửa hàng", "SĐT"], ["Tạp hoá Lỗi Mạng", "0987 000 222"]]),
    })
    const loi = hop.getByTestId("nhap-khach-loi-kiem")
    await expect(loi).toContainText("Chưa lọc được trùng số điện thoại")
    await expect(hop.getByTestId("nhap-khach-nut")).toBeDisabled()

    hong = false
    await loi.getByRole("button", { name: "Kiểm lại" }).click()
    await expect(loi).toHaveCount(0)
    await expect(hop.getByTestId("nhap-khach-nut")).toHaveText("Nhập 1 khách hàng")
    await expect(hop.getByTestId("nhap-khach-nut")).toBeEnabled()
  } finally {
    await donDep()
  }
})
