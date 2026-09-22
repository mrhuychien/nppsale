import { describe, it, expect } from "vitest"
import { savePosPurchase, savePosSupplierReturn } from "../src/lib/pos/save"
import { donViNapLai } from "../src/lib/pos/units"
import type { PosLine } from "../src/lib/pos/types"

/**
 * POS — SỬA PHIẾU NHẬP / PHIẾU TRẢ NCC ĐÃ HOÀN THÀNH, VÀ HỆ SỐ KHI NẠP LẠI.
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16 (22/09/2026), bản cũ:
 *     phiếu completed 2 thùng×24, tồn 48, công nợ 96.000
 *     sửa trên POS thành 10 thùng, bấm Hoàn thành →
 *       phiếu vẫn completed, total 500.000, dòng "10 thùng ×1"
 *       tồn VẪN 48, công nợ VẪN 96.000 — màn báo "Đã hoàn thành"
 *   Và mở lại phiếu lưu tạm 2 thùng (×24) → dòng nạp với hệ số 1 → hoàn
 *   thành thì kho nhận 2 thay vì 48.
 */

function db(trangThai: string | null, loiHuy: unknown = null) {
  const log: string[] = []
  const chain = (ten: string, kq: unknown) => {
    const c: Record<string, unknown> = {}
    for (const k of ["eq", "select", "order"]) c[k] = () => c
    c.maybeSingle = () => Promise.resolve(kq)
    c.then = (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => Promise.resolve(kq).then(a, b)
    log.push(ten)
    return c
  }
  return {
    log,
    rpc(fn: string) {
      log.push(`rpc:${fn}`)
      return Promise.resolve({ data: null, error: fn.startsWith("cancel_") ? loiHuy : null })
    },
    from(t: string) {
      return {
        select: () => chain(`select:${t}`, { data: trangThai ? { status: trangThai } : null, error: null }),
        update: (v: Record<string, unknown>) => chain(`update:${t}:${v.status ?? "-"}`, { data: [{ id: "x" }], error: null }),
        insert: () => chain(`insert:${t}`, { data: [{ id: "x" }], error: null }),
        delete: () => chain(`delete:${t}`, { data: null, error: null }),
      }
    },
  }
}

const LINE: PosLine = {
  key: "k", productId: "p1", sku: "S", name: "Mì", unit: "thùng",
  units: [{ unit_name: "thùng", conversion: 24 }], qty: 2, price: 1000,
  discount: { value: 0, unit: "vnd" },
}
const CHUNG = {
  orgId: "g", userId: "u", supplierId: "s", zone: "sale", discount: 0, notes: "",
  lines: [LINE], complete: true, subtotal: 2000, vat: 0, total: 2000,
}

describe("sửa phiếu nhập đã hoàn thành trên POS", () => {
  it("huỷ phiếu cũ TRƯỚC, rồi mới ghi lại và hoàn thành", async () => {
    const sb = db("completed")
    await savePosPurchase(sb as never, { ...CHUNG, receiptId: "r1", invoiceNumber: "", invoiceDate: "2026-09-22" })
    const iHuy = sb.log.indexOf("rpc:cancel_purchase_invoice")
    const iSua = sb.log.indexOf("update:purchase_invoices:draft")
    const iXong = sb.log.indexOf("rpc:complete_purchase_invoice")
    expect(iHuy, "không huỷ phiếu cũ").toBeGreaterThan(-1)
    expect(iSua, "không đưa phiếu về nháp").toBeGreaterThan(iHuy)
    expect(iXong).toBeGreaterThan(iSua)
  })

  it("huỷ hỏng thì DỪNG — không ghi đè dòng hàng", async () => {
    const sb = db("completed", { message: "SUPPLIER_PAID: …" })
    await expect(
      savePosPurchase(sb as never, { ...CHUNG, receiptId: "r1", invoiceNumber: "", invoiceDate: "2026-09-22" })
    ).rejects.toBeTruthy()
    expect(sb.log.some((x) => x.startsWith("update:") || x.startsWith("delete:"))).toBe(false)
  })

  it("phiếu đã huỷ thì không sửa", async () => {
    const sb = db("cancelled")
    await expect(
      savePosPurchase(sb as never, { ...CHUNG, receiptId: "r1", invoiceNumber: "", invoiceDate: "2026-09-22" })
    ).rejects.toThrow(/đã huỷ/)
  })

  it("phiếu nháp thì không huỷ gì", async () => {
    const sb = db("draft")
    await savePosPurchase(sb as never, { ...CHUNG, receiptId: "r1", invoiceNumber: "", invoiceDate: "2026-09-22" })
    expect(sb.log.some((x) => x.startsWith("rpc:cancel_"))).toBe(false)
  })
})

describe("sửa phiếu trả NCC đã gửi trên POS", () => {
  it("huỷ phiếu cũ TRƯỚC", async () => {
    const sb = db("completed")
    await savePosSupplierReturn(sb as never, { ...CHUNG, returnId: "t1", returnDate: "2026-09-22", reason: "" })
    const iHuy = sb.log.indexOf("rpc:cancel_supplier_return")
    expect(iHuy).toBeGreaterThan(-1)
    expect(sb.log.indexOf("update:supplier_returns:draft")).toBeGreaterThan(iHuy)
  })
})

describe("hệ số khi nạp lại dòng đã lưu", () => {
  it("hệ số trên dòng thắng — 2 thùng vẫn là ×24", () => {
    expect(donViNapLai("thùng", 24)).toEqual([{ unit_name: "thùng", conversion: 24 }])
  })

  it("ghép các đơn vị khác của danh mục, hệ số dòng vẫn thắng", () => {
    const ds = donViNapLai("thùng", 24, [
      { unit_name: "hộp", conversion: 1 },
      { unit_name: "thùng", conversion: 20 },
    ])
    expect(ds).toEqual([
      { unit_name: "hộp", conversion: 1 },
      { unit_name: "thùng", conversion: 24 },
    ])
  })

  it("dòng cũ không có hệ số thì coi là 1", () => {
    expect(donViNapLai("hộp", null)).toEqual([{ unit_name: "hộp", conversion: 1 }])
  })
})

describe("hai màn POS nạp lại dòng bằng donViNapLai", async () => {
  const { readFileSync } = await import("node:fs")
  const { resolve } = await import("node:path")
  it.each(["src/components/pos/purchase-screen.tsx", "src/components/pos/supplier-return-screen.tsx"])("%s", (p) => {
    const s = readFileSync(resolve(__dirname, "..", p), "utf-8")
    expect(s, "còn dựng đơn vị hệ số 1 cứng").not.toMatch(/units:\s*\[\{\s*unit_name:[^}]*conversion:\s*1\s*\}\]/)
    expect(s).toContain("donViNapLai(")
  })
})
