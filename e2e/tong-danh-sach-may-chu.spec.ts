import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKy, chonKhach, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 01/11/2026: "tìm kiếm trong danh sách (đơn hàng, hóa đơn...) nhiều khi còn chậm hoặc mở đơn hàng, sửa đơn
 *   hàng, hóa đơn... ở pos còn chậm". Đo trên sổ thử 40.000 HĐ: tổng tiền / số theo tuyến của danh sách tải MỌI dòng khớp
 *   bộ lọc về trình duyệt rồi mới cộng (NVBH mở Hoá đơn 86–100 câu, điện thoại ~10 giây); POS đọc tồn từng lô.
 *   Nay gộp TRÊN MÁY CHỦ một câu (mig 257: view `v_hoa_don_con_lai`, `total.sum()`, `count()` theo tuyến; tồn POS một câu
 *   `ton_ban_theo_hang`). Sổ chưa chạy 257 / máy chủ chưa gộp được → lùi về cách cũ — CÙNG con số.
 */
type Luot = { method: string; path: string; query?: string; client?: string }
const tuTrinhDuyet = (x: Luot) => (x.client ?? "").includes("createBrowserClient")
const sau = async (t: number) => ((await nhatKy()) as Luot[]).slice(t).filter(tuTrinhDuyet)
const chon = (x: Luot) => new URLSearchParams(x.query ?? "").get("select") ?? ""
const cau = (bang: string, select: string) => (x: Luot) => x.path === `/rest/v1/${bang}` && chon(x) === select
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
/** Giả sổ chưa chạy mig 257: view / hàm trong danh sách trả 404 như PostgREST. */
const tatRpc = (fn: string[]) =>
  fetch(`${FAKE}/__tat_rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fn }) })
const khoi = (page: Page, nhan: string) =>
  page.locator("div", { has: page.getByText(nhan, { exact: true }) }).filter({ visible: true }).last()

const ORG = "00000000-0000-4000-8000-0000000000a1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const HD1 = "00000000-0000-4000-8000-0000000000f1" // HD-E2E-1 — 900.000
const HD2 = "00000000-0000-4000-8000-0000000000f2" // HD-E2E-2 — 300.000
/** Đủ bốn kiểu phiếu trả của luật `creditCounted` — chỉ phiếu đã trừ vào HĐ mới bớt tiền còn lại. */
const PHIEU = [
  /* Tự lập, Hoàn thành, gắn HĐ1 → trừ 150.000. */
  { id: "r-tong-1", invoice_id: HD1, credit_with_invoice: false, status: "completed", credit_note_amount: 150000 },
  /* Tự lập còn Nháp → CHƯA trừ. */
  { id: "r-tong-2", invoice_id: HD1, credit_with_invoice: false, status: "draft", credit_note_amount: 99000 },
  /* Tự sinh theo HĐ2, Chờ xử lý → đã trừ ngay lúc xuất: 50.000. */
  { id: "r-tong-3", invoice_id: HD2, credit_with_invoice: true, status: "submitted", credit_note_amount: 50000 },
  /* Đã huỷ → không trừ. */
  { id: "r-tong-4", invoice_id: HD2, credit_with_invoice: true, status: "cancelled", credit_note_amount: 70000 },
].map((r) => ({
  ...r, org_id: ORG, customer_id: KHACH, reason: "damaged", created_at: "2026-09-24T08:00:00Z",
  customer: { store_name: "Tạp hoá Cô Ba" }, requester: null, order: null, invoice: null, seller: null, sales_user_id: null,
}))
/** 900.000 − 150.000 + 300.000 − 50.000. */
const TONG_HD = "1.000.000"
const NHAN_TONG_HD = "Tổng tiền (đã trừ hàng trả)"
const DEM_TUYEN = "count(),customer:customers!inner(channel)"
/** Câu tải tiền TỪNG đơn của bộ lọc (đường cũ) — trừ dòng "N đơn hôm nay" đầu trang (`order_date=eq.`, chỉ đơn của một ngày). */
const laTienTungDon = (x: Luot) => cau("sales_orders", "total")(x) && !(x.query ?? "").includes("order_date=eq.")

test.describe("tổng của danh sách gộp trên máy chủ (mig 257)", () => {
  test.afterEach(async () => {
    await tatRpc([])
    for (const r of PHIEU) await api(`returns?id=eq.${r.id}`, "DELETE")
  })

  test("Hoá đơn bán: tổng (đã trừ hàng trả) MỘT câu qua view, đếm theo tuyến một câu; sổ chưa có view → cách cũ, cùng số", async ({ page }) => {
    await api("returns", "POST", PHIEU)
    await dangNhap(page)
    let t = (await nhatKy()).length
    await page.goto("/sales-invoices")
    const k = khoi(page, NHAN_TONG_HD)
    await expect(k).toContainText("2 hóa đơn")
    await expect(k, "tổng = tiền CÒN LẠI sau hàng trả đã trừ vào tờ").toContainText(TONG_HD)
    await expect.poll(async () => (await sau(t)).filter(cau("sales_invoices", DEM_TUYEN)).length, { message: "đếm theo tuyến một câu gộp" }).toBe(1)

    let ds = await sau(t)
    const gop = ds.filter((x) => x.path === "/rest/v1/v_hoa_don_con_lai")
    expect(gop.length, "tổng: một câu gộp").toBe(1)
    expect(gop[0].method).toBe("GET")
    expect(chon(gop[0])).toBe("con_lai.sum()")
    expect(decodeURIComponent(gop[0].query ?? ""), "cùng bộ lọc kỳ với danh sách").toContain("invoice_date=gte.2026-09-01")
    expect(ds.filter(cau("sales_invoices", "id,total")).length, "không tải tiền từng tờ").toBe(0)
    /* Một câu hàng trả là của TRANG đang hiện (số còn lại từng dòng) — tổng không tra thêm. */
    expect(ds.filter((x) => x.path === "/rest/v1/returns").length, "tổng không tra hàng trả từng lô 200 tờ").toBeLessThanOrEqual(1)
    expect(ds.filter(cau("sales_invoices", "id,customer:customers!inner(channel)")).length, "không tải id từng tờ để đếm tuyến").toBe(0)

    /* Sổ chưa chạy mig 257: view chưa có (404) → cộng theo cách cũ — CÙNG con số. */
    await tatRpc(["v_hoa_don_con_lai"])
    t = (await nhatKy()).length
    await page.reload()
    await expect(k).toContainText(TONG_HD)
    ds = await sau(t)
    expect(ds.filter(cau("sales_invoices", "id,total")).length, "đường lùi: tải tiền từng tờ").toBeGreaterThan(0)
    expect(ds.filter((x) => x.path === "/rest/v1/returns").length, "đường lùi: tra hàng trả cho tổng (thêm câu của trang)").toBeGreaterThan(1)
  })

  test("Đơn hàng: tổng MỘT câu `total.sum()` (đơn huỷ không vào), đếm đơn đã duyệt theo tuyến một câu", async ({ page }) => {
    const t = (await nhatKy()).length
    await dangNhap(page)
    await chonKy(page, "Tất cả")
    const k = khoi(page, "Tổng tiền hàng")
    await expect(k).toContainText("4 đơn hàng")
    await expect(k, "DH-0004 huỷ (9.000.000) không vào tổng").toContainText("8.000.000")
    await expect
      .poll(async () => (await sau(t)).some((x) => cau("sales_orders", DEM_TUYEN)(x) && (x.query ?? "").includes("status=eq.submitted")), {
        message: "đếm đơn đã duyệt theo tuyến một câu gộp",
      })
      .toBe(true)

    const ds = await sau(t)
    const tong = ds.filter(cau("sales_orders", "total.sum()"))
    expect(tong.length, "tổng: câu gộp").toBeGreaterThan(0)
    expect(tong.some((x) => (x.query ?? "").includes("status=neq.cancelled")), "tab Tất cả bỏ đơn huỷ khỏi tổng").toBe(true)
    expect(ds.filter(laTienTungDon).length, "không tải tiền từng đơn").toBe(0)
    expect(ds.filter(cau("sales_orders", "id,customer:customers!inner(channel)")).length, "không tải id từng đơn để đếm tuyến").toBe(0)
  })

  test("Đơn hàng: máy chủ chưa gộp được (câu gộp lỗi) → cộng / đếm theo cách cũ, cùng con số", async ({ page }) => {
    await page.route(
      (u) => u.pathname === "/rest/v1/sales_orders",
      (route) => {
        const sel = new URL(route.request().url()).searchParams.get("select") ?? ""
        if (sel.includes(".sum()") || sel === DEM_TUYEN)
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ code: "PGRST123", message: "Use of aggregate functions is not allowed", details: null, hint: null }),
          })
        return route.fallback()
      }
    )
    const t = (await nhatKy()).length
    await dangNhap(page)
    await chonKy(page, "Tất cả")
    const k = khoi(page, "Tổng tiền hàng")
    await expect(k).toContainText("4 đơn hàng")
    await expect(k).toContainText("8.000.000")
    expect((await sau(t)).filter(laTienTungDon).length, "đường lùi: tải tiền từng đơn").toBeGreaterThan(0)
    await expect
      .poll(async () => (await sau(t)).filter(cau("sales_orders", "id,customer:customers!inner(channel)")).length, { message: "đường lùi đếm tuyến" })
      .toBeGreaterThan(0)
  })
})

test.describe("POS: tồn kho bán một câu (mig 257)", () => {
  test.afterEach(async () => {
    await tatRpc([])
  })

  const oTim = (page: Page) => page.getByPlaceholder(/Tên hàng, mã (SKU|hàng)/i).first()
  /** Tồn kho bán của Sữa trên sổ giả lúc chạy (các bài khác có thể đã đổi lô) — định dạng như ô gợi ý. */
  const tonSua = async () => {
    const lo = (await (await api("batches?select=product_id,qty_on_hand,warehouse_zone", "GET")).json()) as Array<{
      product_id: string; qty_on_hand: number; warehouse_zone: string
    }>
    const sl = lo
      .filter((b) => b.product_id === "00000000-0000-4000-8000-0000000000d1" && b.warehouse_zone === "sale" && Number(b.qty_on_hand) > 0)
      .reduce((a, b) => a + Number(b.qty_on_hand), 0)
    return `tồn ${sl.toLocaleString("vi-VN")}`
  }

  test("đơn mới: tồn đọc bằng `ton_ban_theo_hang` (GET), không đọc từng lô; sổ chưa có hàm → đọc lô, cùng số", async ({ page }) => {
    const mong = await tonSua()
    expect(mong, "sổ giả còn tồn Sữa — bài không thử gì nếu 0").not.toBe("tồn 0")
    await dangNhap(page)
    let t = (await nhatKy()).length
    await page.goto("/pos/don-hang/moi")
    await chonKhach(page, "Tạp hoá Cô Ba")
    await oTim(page).fill("Sữa")
    await expect(page.getByText(mong, { exact: true }).first()).toBeVisible()
    let ds = await sau(t)
    const ton = ds.filter((x) => x.path === "/rest/v1/rpc/ton_ban_theo_hang")
    expect(ton.length, "tồn: câu gộp").toBeGreaterThan(0)
    expect(ton.every((x) => x.method === "GET"), "hàm chỉ đọc gọi bằng GET").toBe(true)
    expect(ds.filter((x) => x.path === "/rest/v1/batches").length, "không đọc từng lô").toBe(0)

    /* Sổ chưa chạy mig 257: hàm chưa có (PGRST202) → đọc từng lô như cũ — CÙNG số tồn. */
    await tatRpc(["ton_ban_theo_hang"])
    t = (await nhatKy()).length
    await page.goto("/pos/don-hang/moi")
    await chonKhach(page, "Tạp hoá Cô Ba")
    await oTim(page).fill("Sữa")
    await expect(page.getByText(mong, { exact: true }).first()).toBeVisible()
    ds = await sau(t)
    expect(ds.filter((x) => x.path === "/rest/v1/batches").length, "đường lùi: đọc lô").toBeGreaterThan(0)
  })
})
