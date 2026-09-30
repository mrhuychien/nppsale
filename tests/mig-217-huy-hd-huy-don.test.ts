/**
 * Chủ nhà 30/09/2026: "Khi hủy hóa đơn -> coi như đóng đơn hàng -> Chuyển luôn đơn hàng về trạng
 * thái Đã hủy · Nhà phân phối không dùng chức năng xuất 1 phần đơn, đơn nào xuất xong coi như xong
 * (hoàn thành) -> ko còn trạng thái Xuất 1 phần và đã đóng · Vì hủy hóa đơn -> hủy luôn đơn hàng
 * nên trả hàng cũng hủy theo luôn ko cần nháp." · "Giao thiếu a) xuất xong coi như xong".
 * Kịch bản chạy trên Postgres: scripts/sql/thu-217-huy-hd-huy-don.sql.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { baoDaHuyHoaDon, explainInvoiceError, MO_TA_HUY_HOA_DON } from "@/lib/orders/post-invoice"
import * as postInvoice from "@/lib/orders/post-invoice"

const MIG = readFileSync("supabase/migrations/217_huy_hd_huy_don_mot_don_mot_hd.sql", "utf8")
const than = (ten: string) => {
  const i = MIG.indexOf(`CREATE OR REPLACE FUNCTION public.${ten}(`)
  expect(i, `thiếu hàm ${ten}`).toBeGreaterThan(0)
  return MIG.slice(i, MIG.indexOf("$fn$;", i))
}

describe("mig 217 — máy chủ", () => {
  it("có hóa đơn ghi sổ là Hoàn thành, xuất thiếu cũng vậy", () => {
    const f = than("_wf2b_sync_order_status")
    expect(f).toContain("v_new := CASE WHEN v_inv = 0 THEN 'submitted' ELSE 'completed' END;")
    expect(f).not.toContain("partially_invoiced")
  })

  it("huỷ HĐ huỷ đơn + phiếu trả Nháp/Chờ xử lý, NHƯNG Sửa HĐ (cờ lập lại) thì không", () => {
    const f = than("_huy_don_theo_hoa_don")
    const co = f.indexOf("current_setting('npp.reissue_chuyen_thu', true), '') = 'on' THEN\n    RETURN p_status;")
    expect(co, "thiếu chốt Sửa HĐ không huỷ đơn").toBeGreaterThan(0)
    expect(co).toBeLessThan(f.indexOf("UPDATE sales_orders"))
    expect(f).toContain("WHERE order_id = p_order_id AND status IN ('draft', 'submitted');")
    expect(f).toMatch(/SET status = 'cancelled', cancelled_at = now\(\), cancelled_by = auth\.uid\(\)/)
    expect(MIG).toContain("v_status := public._huy_don_theo_hoa_don(v.order_id, v.invoice_code, p_reason, v_status);")
  })

  it("một đơn một HĐ ghi sổ; không còn đóng đơn; dữ liệu cũ về Hoàn thành", () => {
    expect(MIG).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoices_mot_don_mot_hd\n      ON sales_invoices (order_id) WHERE status = 'posted';")
    expect(than("close_order")).toContain("ORDER_CLOSE_REMOVED")
    expect(MIG).toMatch(/SET status = 'completed',[\s\S]*WHERE status IN \('partially_invoiced', 'closed'\);/)
  })

  it("luật mig 166 + khám sổ", () => {
    for (const sig of ["_wf2b_sync_order_status(uuid)", "_huy_don_theo_hoa_don(uuid, text, text, text)"]) {
      expect(MIG).toContain(`REVOKE EXECUTE ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`)
    }
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(readFileSync("scripts/sql/kham-so-that.sql", "utf8")).toContain("Mig 217")
  })
})

describe("mig 217 — giao diện", () => {
  it("hộp huỷ HĐ nói rõ đơn và phiếu trả huỷ theo, ở cả hai màn", () => {
    expect(MO_TA_HUY_HOA_DON).toContain("Đơn hàng của hóa đơn")
    expect(MO_TA_HUY_HOA_DON).toContain("phiếu trả")
    for (const f of ["src/components/sales-invoices/invoice-drawer.tsx", "src/app/(dashboard)/sales-invoices/[id]/page.tsx"]) {
      const s = readFileSync(f, "utf8")
      expect(s, f).toContain("description={MO_TA_HUY_HOA_DON}")
      expect(s, f).toContain("baoDaHuyHoaDon(")
    }
  })

  it("lời báo sau huỷ theo trạng thái đơn máy chủ trả về", () => {
    expect(baoDaHuyHoaDon("HD-0001", "cancelled")).toBe("Đã huỷ hóa đơn HD-0001 và đơn hàng của nó")
    expect(baoDaHuyHoaDon("HD-0001", "completed")).toBe("Đã huỷ hóa đơn HD-0001")
  })

  it("không còn nút / hàm Đóng đơn", () => {
    expect("closeOrder" in postInvoice).toBe(false)
    expect(readFileSync("src/app/(dashboard)/orders/[id]/page.tsx", "utf8")).not.toContain("close_order")
    expect(explainInvoiceError("ORDER_CLOSE_REMOVED: không còn đóng đơn")).toBe(
      "Không còn đóng đơn — đơn xuất hóa đơn xong là Hoàn thành."
    )
  })
})
