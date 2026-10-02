import { test, expect } from "@playwright/test"
import * as XLSX from "xlsx"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 02/10/2026: "phần báo cáo xuất excel cần xuất chi tiết các dòng hơn để xử lý thông tin. VD báo cáo
 *   bán hàng theo nhân viên -> chi tiết dòng hàng, bán cho ai, giá bao nhiêu...". Logic: tests/bao-cao-xuat-chi-tiet.test.ts.
 */
const KY = "ky=custom&ca=2026-09-01&cb=2026-09-30"

test("Bán hàng theo nhân viên → Xuất Excel có sheet Chi tiết dòng: khách, mặt hàng, ĐVT, SL, đơn giá", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/bao-cao/ban-hang?${KY}&xem=staff`)
  await expect(page.getByTestId("bc-kpi-net")).toContainText("1,2 tr")
  const [tai] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bc-xuat").first().click()])
  const wb = XLSX.read(await (await tai.createReadStream()).toArray().then((c) => Buffer.concat(c as Buffer[])))
  expect(wb.SheetNames).toEqual(["Tổng hợp", "Chi tiết dòng"])
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets["Chi tiết dòng"])
  const sua = rows.find((r) => r["Số chứng từ"] === "HD-E2E-1")
  expect(sua).toMatchObject({
    Loại: "Bán", "Nhân viên": "Chủ NPP", "Khách hàng": "Tạp hoá Cô Ba", "Tên hàng": "Sữa hộp",
    ĐVT: "thùng", SL: 2, "Đơn giá": 450000, "SL quy đổi": 48, "DT thuần (phân bổ)": 900000,
  })
  // Σ cột DT thuần của sheet chi tiết = thẻ Doanh thu thuần.
  expect(rows.reduce((s, r) => s + Number(r["DT thuần (phân bổ)"] || 0), 0)).toBe(1200000)
})
