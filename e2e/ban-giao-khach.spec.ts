import { test, expect, type Page } from "@playwright/test"
import * as XLSX from "xlsx"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 15/10/2026 (mig 246): "Gán cho toàn bộ khách hàng của nv A cho nv B (làm chung khách hàng) Hoặc là như kiểu
 *   bàn giao lại khách hàng … dskh tuyến đó, đã lấy hàng gì, số lượng, hàng cty nào mà nv đó làm … thể hiện luôn trên
 *   máy của nv". Chốt: cả hai kiểu; toàn bộ / tuyến / công ty; mốc 3 / 6 / 12 tháng / tất cả; chuyển hẳn → nợ theo NV nhận.
 *   Máy chủ giả làm theo luật mig 246 (e2e/fixture.mjs: banGiaoKhach / hangKhachDaLay). Tài khoản e2e đổi vai bằng PATCH users.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const SUA = "00000000-0000-4000-8000-0000000000d1"
const MI = "00000000-0000-4000-8000-0000000000d2"
const NCC_X = "00000000-0000-4000-8000-0000000000e1" // Vinamilk (có sẵn trong dữ liệu giả)
const NCC_Y = "00000000-0000-4000-8000-000000246e02"
const A = { id: "00000000-0000-4000-8000-000000246a01", org_id: ORG, full_name: "NV Giao An", role: "sales", phone: "0912460101", is_active: true }
const B = { id: "00000000-0000-4000-8000-000000246b01", org_id: ORG, full_name: "NV Nhận Bình", role: "sales", phone: "0912460102", is_active: true }
const K1 = "00000000-0000-4000-8000-000000246c01"
const K2 = "00000000-0000-4000-8000-000000246c02"
const K3 = "00000000-0000-4000-8000-000000246c03"
const K4 = "00000000-0000-4000-8000-000000246c04"
const KHACH = [
  { id: K1, org_id: ORG, store_name: "Thử246 Tạp hoá Một", owner_name: "Chị Một", phone: "0912461001", address: "1 Hàng Bài", channel: "T2", status: "active" },
  { id: K2, org_id: ORG, store_name: "Thử246 Đại lý Hai", owner_name: "Anh Hai", phone: "0912461002", address: "2 Hàng Bông", channel: "T3", status: "active" },
  { id: K3, org_id: ORG, store_name: "Thử246 Quán Ba", owner_name: "Cô Ba", phone: "0912461003", address: "3 Hàng Gai", channel: "T2", status: "active" },
  { id: K4, org_id: ORG, store_name: "Thử246 Nhà hàng Bốn", owner_name: "Chú Bốn", phone: "0912461004", address: "4 Hàng Đào", channel: "HORECA", status: "active" },
]
const TUYEN = [
  { id: "00000000-0000-4000-8000-000000246f01", org_id: ORG, code: "T2", name: "Thứ hai", sort_order: 1, is_active: true },
  { id: "00000000-0000-4000-8000-000000246f02", org_id: ORG, code: "T3", name: "Thứ ba", sort_order: 2, is_active: true },
  { id: "00000000-0000-4000-8000-000000246f03", org_id: ORG, code: "HORECA", name: "Nhà hàng", sort_order: 3, is_active: true },
]
const HD = "00000000-0000-4000-8000-000000246d01"
const TRA = "00000000-0000-4000-8000-000000246d11"
const TRA_NHAP = "00000000-0000-4000-8000-000000246d12"

const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })
const doc = async (p: string) => (await (await api(p)).json()) as Array<Record<string, unknown>>
const them = (bang: string, rows: unknown[]) => api(bang, { method: "POST", body: JSON.stringify(rows) })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, { method: "PATCH", body: JSON.stringify({ role }) })
const goiBanGiao = async () =>
  (await nhatKy()).filter((r) => r.path.endsWith("/rpc/ban_giao_khach")).map((r) => r.body as Record<string, unknown>)
const goiHang = async () =>
  (await nhatKy()).filter((r) => r.path.endsWith("/rpc/hang_khach_da_lay")).map((r) => r.body as Record<string, unknown>)

/** Hoá đơn K1 (20/09): 2 thùng Sữa (24 hộp/thùng, công ty X) + 1 thùng Mì (30 gói, công ty Y) + 1 hộp Sữa hàng ĐỔI.
 *  Phiếu trả đã trừ (25/09): 1 hộp Sữa; phiếu trả NHÁP: 5 hộp Sữa (không trừ). */
async function dungHang() {
  await api(`products?id=eq.${SUA}`, { method: "PATCH", body: JSON.stringify({ primary_supplier_id: NCC_X }) })
  await api(`products?id=eq.${MI}`, { method: "PATCH", body: JSON.stringify({ primary_supplier_id: NCC_Y }) })
  await them("sales_invoices", [{
    id: HD, org_id: ORG, invoice_code: "HD-246-1", order_id: null, customer_id: K1, status: "posted", subtotal: 1040000,
    vat: 0, total: 1040000, invoice_date: "2026-09-20", created_at: "2026-09-20T08:00:00Z", sales_user_id: A.id,
  }])
  await them("sales_invoice_lines", [
    { id: "246-l1", invoice_id: HD, product_id: SUA, unit_name: "thùng", conversion_factor: 24, quantity: 2, unit_price: 450000, line_total: 900000, is_exchange: false, sort_order: 0 },
    { id: "246-l2", invoice_id: HD, product_id: MI, unit_name: "thùng", conversion_factor: 30, quantity: 1, unit_price: 140000, line_total: 140000, is_exchange: false, sort_order: 1 },
    { id: "246-l3", invoice_id: HD, product_id: SUA, unit_name: "hộp", conversion_factor: 1, quantity: 1, unit_price: 0, line_total: 0, is_exchange: true, sort_order: 2 },
  ])
  await them("returns", [
    { id: TRA, org_id: ORG, customer_id: K1, status: "completed", reason: "damaged", credit_note_amount: 20000, revenue_date: "2026-09-25", created_at: "2026-09-25T08:00:00Z" },
    { id: TRA_NHAP, org_id: ORG, customer_id: K1, status: "draft", reason: "damaged", credit_note_amount: 100000, revenue_date: null, created_at: "2026-09-26T08:00:00Z" },
  ])
  await them("return_lines", [
    { id: "246-rl1", return_id: TRA, product_id: SUA, unit_name: "hộp", quantity: 1, unit_price: 20000, line_total: 20000, is_exchange: false },
    { id: "246-rl2", return_id: TRA_NHAP, product_id: SUA, unit_name: "hộp", quantity: 5, unit_price: 20000, line_total: 100000, is_exchange: false },
  ])
}

test.beforeEach(async () => {
  await them("users", [A, B])
  await them("customers", KHACH)
  await them("sales_routes", TUYEN)
  await them("suppliers", [{ id: NCC_Y, org_id: ORG, code: "NCCY", name: "Acecook", status: "active", is_active: true }])
})
test.afterEach(async () => {
  await doiVai("owner")
  for (const k of [K1, K2, K3, K4]) {
    await api(`customer_assignments?customer_id=eq.${k}`, { method: "DELETE" })
    await api(`receivables?customer_id=eq.${k}`, { method: "DELETE" })
    await api(`customers?id=eq.${k}`, { method: "DELETE" })
  }
  for (const u of [A.id, B.id, OWNER]) {
    await api(`pjp_routes?sales_user_id=eq.${u}`, { method: "DELETE" })
    await api(`user_suppliers?user_id=eq.${u}`, { method: "DELETE" })
  }
  for (const u of [A, B]) await api(`users?id=eq.${u.id}`, { method: "DELETE" })
  for (const t of TUYEN) await api(`sales_routes?id=eq.${t.id}`, { method: "DELETE" })
  await api(`suppliers?id=eq.${NCC_Y}`, { method: "DELETE" })
  await api(`sales_invoice_lines?invoice_id=eq.${HD}`, { method: "DELETE" })
  await api(`sales_invoices?id=eq.${HD}`, { method: "DELETE" })
  for (const r of [TRA, TRA_NHAP]) {
    await api(`return_lines?return_id=eq.${r}`, { method: "DELETE" })
    await api(`returns?id=eq.${r}`, { method: "DELETE" })
  }
  await api(`ban_giao_khach_log?org_id=eq.${ORG}`, { method: "DELETE" })
  for (const p of [SUA, MI]) await api(`products?id=eq.${p}`, { method: "PATCH", body: JSON.stringify({ primary_supplier_id: null }) })
})

async function chon(page: Page, o: string, ten: string) {
  await page.getByRole("combobox", { name: o }).click()
  await page.getByRole("option", { name: ten, exact: true }).click()
}

test.describe("máy tính — chủ NPP", () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test("Chuyển hẳn khách của A cho B: xem trước, bỏ chọn 1 khách, xác nhận → B thay vai A, nợ chưa thu theo B; danh sách bàn giao của B chỉ hàng công ty B làm, xuất Excel", async ({ page }) => {
    await them("customer_assignments", [K1, K2, K3].map((k, i) => ({ id: `246-pc-${i}`, customer_id: k, user_id: A.id, role: "primary", status: "active", org_id: ORG })))
    await them("receivables", [
      { id: "00000000-0000-4000-8000-000000246r01", org_id: ORG, customer_id: K1, sales_user_id: A.id, amount: 500000, paid: 0, status: "open" },
      { id: "00000000-0000-4000-8000-000000246r02", org_id: ORG, customer_id: K2, sales_user_id: A.id, amount: 200000, paid: 200000, status: "paid" },
    ])
    await them("pjp_routes", [{ id: "246-pjp-1", org_id: ORG, sales_user_id: A.id, day_of_week: 0, customer_id: K1, visit_order: 1, is_active: true }])
    await them("user_suppliers", [{ user_id: B.id, supplier_id: NCC_X, org_id: ORG }])
    await dungHang()

    await dangNhap(page)
    await page.goto("/customers/ban-giao")
    await chon(page, "Nhân viên giao", A.full_name)
    await chon(page, "Nhân viên nhận", B.full_name)
    await page.getByTestId("kieu-chuyen").click()
    await page.getByTestId("xem-truoc").click()

    const dong = page.getByTestId("dong-xem-truoc")
    await expect(dong).toHaveCount(3)
    // Xem trước KHÔNG ghi gì.
    expect((await goiBanGiao()).at(-1)).toMatchObject({ p_thuc_hien: false, p_kieu: "chuyen", p_nguon: "nv", p_tu_nv: A.id, p_den_nv: B.id })
    await expect(dong.filter({ hasText: "Thử246 Tạp hoá Một" })).toContainText("Chính")
    await dong.filter({ hasText: "Thử246 Quán Ba" }).getByRole("checkbox").click()
    await expect(page.getByTestId("tt-so-khach")).toHaveText("2")
    await expect(page.getByTestId("tt-no-chuyen")).toContainText("500.000")

    await page.getByTestId("nut-ban-giao").click()
    const hop = page.getByRole("dialog")
    await expect(hop.getByRole("heading")).toHaveText(`Chuyển hẳn 2 khách cho ${B.full_name}?`)
    await expect(hop).toContainText(`${A.full_name} thôi phụ trách 2 khách`)
    await expect(hop).toContainText(`1 khoản nợ chưa thu (500.000đ) chuyển sang ${B.full_name}`)
    await expect(hop).toContainText(`Doanh số các hoá đơn cũ vẫn của ${A.full_name}`)
    await hop.getByRole("button", { name: "Chuyển hẳn" }).click()
    await expect(page.getByTestId("ket-qua")).toContainText(`Đã giao 2 khách cho ${B.full_name}`)

    // Chỉ đúng hai khách đã chọn được gửi đi.
    const lan = (await goiBanGiao()).at(-1)!
    expect(lan).toMatchObject({ p_thuc_hien: true, p_kieu: "chuyen" })
    expect([...(lan.p_khach as string[])].sort()).toEqual([K1, K2].sort())

    const pc = await doc(`customer_assignments?select=*`)
    const vai = (k: string, u: string) => pc.find((a) => a.customer_id === k && a.user_id === u)?.role ?? null
    expect([vai(K1, B.id), vai(K2, B.id), vai(K3, B.id)]).toEqual(["primary", "primary", null])
    expect([vai(K1, A.id), vai(K2, A.id), vai(K3, A.id)]).toEqual([null, null, "primary"])
    const no = await doc(`receivables?select=*`)
    expect(no.find((r) => r.customer_id === K1)).toMatchObject({ sales_user_id: B.id, giao_tu_nv: A.id })
    expect(no.find((r) => r.customer_id === K2)).toMatchObject({ sales_user_id: A.id })
    await expect(page.getByTestId("nhat-ky")).toContainText(`Chuyển hẳn · 2 khách → ${B.full_name}`)

    // Danh sách bàn giao của B: theo tuyến, chỉ hàng công ty X (Sữa), không có Mì (công ty Y).
    await page.getByRole("link", { name: `Danh sách bàn giao của ${B.full_name}` }).click()
    await expect(page).toHaveURL(new RegExp(`/customers/hang-da-lay\\?nv=${B.id}`))
    const nhom = page.getByTestId("nhom-tuyen")
    await expect(nhom).toHaveCount(2)
    await expect(nhom.first()).toContainText("T2 — Thứ hai · 1 khách")
    const the1 = page.getByTestId("the-khach").filter({ hasText: "Thử246 Tạp hoá Một" })
    await expect(the1.getByTestId("dong-hang")).toHaveCount(1)
    await expect(the1).toContainText("Sữa hộp")
    await expect(the1).toContainText("47 hộp")
    await expect(the1).not.toContainText("Mì tôm")
    await expect(page.getByTestId("the-khach").filter({ hasText: "Thử246 Đại lý Hai" }).getByTestId("chua-lay")).toBeVisible()
    await expect(page.getByTestId("cong-ty-nv")).toContainText("Vinamilk")

    const [tai] = await Promise.all([page.waitForEvent("download"), page.getByTestId("xuat-excel").click()])
    const wb = XLSX.read(await (await tai.createReadStream()).toArray().then((c) => Buffer.concat(c as Buffer[])))
    expect(wb.SheetNames).toEqual(["Hàng đã lấy", "Khách"])
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets["Hàng đã lấy"])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ "Tuyến": "T2 — Thứ hai", "Cửa hàng": "Thử246 Tạp hoá Một", "SĐT": "0912461001", "Công ty": "Vinamilk", "Tên hàng": "Sữa hộp", "SL đã lấy (đơn vị cơ sở)": 47, "Đơn vị": "hộp", "Đã trả lại": 1, "Số lần lấy": 1, "Lần lấy cuối": "20/09/2026" })
    expect(rows[1]).toMatchObject({ "Tuyến": "T3 — Thứ ba", "Cửa hàng": "Thử246 Đại lý Hai", "Tên hàng": "(chưa lấy hàng trong kỳ)" })
  })

  test("Khách chưa ai phụ trách (tuyến HORECA) → NV nhận làm CHÍNH, nhận luôn nợ NPP đang giữ; chuyển hẳn bị khoá với nguồn này", async ({ page }) => {
    await them("receivables", [{ id: "00000000-0000-4000-8000-000000246r04", org_id: ORG, customer_id: K4, sales_user_id: null, ve_npp_luc: "2026-09-01T00:00:00Z", amount: 300000, paid: 0, status: "open" }])
    await dangNhap(page)
    await page.goto("/customers/ban-giao")
    await page.getByTestId("nguon-chua_ai").click()
    await expect(page.getByTestId("kieu-chuyen")).toBeDisabled()
    await page.getByTestId("chon-tuyen").getByRole("button", { name: "HORECA — Nhà hàng" }).click()
    await chon(page, "Nhân viên nhận", B.full_name)
    await page.getByTestId("xem-truoc").click()
    const dong = page.getByTestId("dong-xem-truoc")
    await expect(dong).toHaveCount(1)
    await expect(dong).toContainText("Thử246 Nhà hàng Bốn")
    await expect(dong).toContainText("Chính")
    await expect(page.getByTestId("tom-tat")).toContainText("300.000")
    await page.getByTestId("nut-ban-giao").click()
    await expect(page.getByRole("dialog").getByRole("heading")).toHaveText(`Giao 1 khách cho ${B.full_name} (làm chung)?`)
    await page.getByRole("dialog").getByRole("button", { name: "Giao khách" }).click()
    await expect(page.getByTestId("ket-qua")).toContainText(`Đã giao 1 khách cho ${B.full_name}`)
    expect((await goiBanGiao()).at(-1)).toMatchObject({ p_nguon: "chua_ai", p_kieu: "chung", p_tuyen: ["HORECA"], p_giao_no_npp: true })
    const pc = await doc(`customer_assignments?customer_id=eq.${K4}&select=*`)
    expect(pc).toEqual([expect.objectContaining({ user_id: B.id, role: "primary", status: "active" })])
    const no = (await doc(`receivables?customer_id=eq.${K4}&select=*`))[0]
    expect(no).toMatchObject({ sales_user_id: B.id, ve_npp_luc: null })
  })
})

test.describe("điện thoại — NVBH", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("Hàng khách đã lấy: chỉ khách của mình theo tuyến, chỉ hàng công ty mình làm, SL đơn vị cơ sở (trừ hàng trả đã trừ, bỏ hàng đổi); đổi mốc; chi tiết khách có khối Hàng đã lấy; không vào được màn bàn giao", async ({ page }) => {
    await them("customer_assignments", [
      { id: "246-pc-m1", customer_id: K1, user_id: OWNER, role: "primary", status: "active", org_id: ORG },
      { id: "246-pc-m2", customer_id: K2, user_id: OWNER, role: "primary", status: "active", org_id: ORG },
    ])
    await them("user_suppliers", [{ user_id: OWNER, supplier_id: NCC_X, org_id: ORG }])
    await dungHang()
    await dangNhap(page)
    await doiVai("sales")
    await page.goto("/customers/hang-da-lay")

    // Mô tả trang: điện thoại hiện dòng riêng (khối tiêu đề máy tính bị ẩn) — chỉ đếm dòng đang thấy.
    await expect(page.locator("p:visible", { hasText: "Khách bạn đang phụ trách · hàng các công ty bạn làm: Vinamilk" })).toHaveCount(1)
    const the = page.getByTestId("the-khach")
    await expect(the).toHaveCount(2)
    const the1 = the.filter({ hasText: "Thử246 Tạp hoá Một" })
    await expect(the1.getByTestId("dong-hang")).toHaveCount(1)
    await expect(the1).toContainText("Sữa hộp")
    await expect(the1).toContainText("47 hộp")
    await expect(the1).not.toContainText("Mì tôm")
    // Mặc định 6 tháng (đồng hồ ghim 30/09/2026) → từ 30/03; bấm 3 tháng → từ 30/06.
    expect((await goiHang()).at(-1)).toMatchObject({ p_tu: "2026-03-30", p_nv: null })
    await page.getByTestId("moc-3t").click()
    await expect.poll(async () => (await goiHang()).at(-1)?.p_tu).toBe("2026-06-30")
    await expect(the1).toContainText("47 hộp")

    // Lọc tuyến T3 → chỉ còn khách tuyến ấy.
    await page.getByRole("group", { name: "Lọc theo tuyến" }).getByRole("button", { name: /T3 — Thứ ba/ }).click()
    await expect(the).toHaveCount(1)
    await expect(the).toContainText("Thử246 Đại lý Hai")
    await expect(the.getByTestId("chua-lay")).toContainText("Chưa lấy hàng trong 3 tháng qua")

    // Chi tiết khách: khối "Hàng đã lấy" ngay trên máy.
    await page.goto(`/customers/${K1}`)
    const khoi = page.getByTestId("hang-da-lay-khach")
    await expect(khoi).toContainText("Hàng các công ty bạn làm: Vinamilk")
    await expect(khoi.getByTestId("hang-dong")).toHaveCount(1)
    await expect(khoi.getByTestId("hang-sl")).toHaveText("47 hộp")
    await expect(khoi).toContainText("trả 1 hộp")
    await expect(khoi).toContainText("1 lần · lần cuối 20/09/2026")

    // NVBH không vào được màn bàn giao.
    await page.goto("/customers/ban-giao")
    await page.waitForURL(/\/home/)
  })
})
