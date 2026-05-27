import crypto from "node:crypto"
import type { InvoiceDetailLine, InvoiceHeader, InvoicePayload, SellerInfo } from "./types"

/**
 * Layer 2 — Mapper.
 *
 * Convert đơn hàng npp.sale → InvoicePayload theo schema doc HDGTGT.html
 * (MISA WebAPI v2 /v3sainvoice). Output là mảng 1 master object có
 * field InvoiceDetails lồng trong.
 */

export type ExportMode = "as_sold" | "box"

export interface MapperLine {
  product_name: string
  sku?: string | null
  unit_name: string
  base_unit?: string | null
  quantity: number
  unit_price: number
  conversion_factor?: number | null
  vat_rate?: number | null
  line_discount?: number | null
}

export interface MapperBuyer {
  name: string
  tax_code?: string | null
  address?: string | null
  email?: string | null
  channel?: string | null
  payment_method_label?: string | null
}

export interface MapperOptions {
  buyer: MapperBuyer
  seller: SellerInfo
  lines: MapperLine[]
  mode?: ExportMode
  poNote?: string | null
  invoiceDate?: string
  invSeries?: string | null
  invTemplateNo?: string | null
  companyId?: string | null
  orgUnitId?: string | null
  templateId?: string | null
  userId?: string | null
  invoiceType?: number | null
  isInheritFromOldTemplate?: boolean | null
}

function roundVnd(n: number): number {
  return Math.round((Number(n) || 0))
}

export function vnInvoiceDate(d: Date = new Date()): string {
  const tzOffsetMin = 7 * 60
  const local = new Date(d.getTime() + tzOffsetMin * 60_000)
  const yyyy = local.getUTCFullYear()
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(local.getUTCDate()).padStart(2, "0")
  const hh = String(local.getUTCHours()).padStart(2, "0")
  const mi = String(local.getUTCMinutes()).padStart(2, "0")
  const ss = String(local.getUTCSeconds()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+07:00`
}

function buildContactName(buyer: MapperBuyer, poNote?: string | null): string | undefined {
  const isMt = (buyer.channel || "").toUpperCase() === "MT"
  const po = (poNote || "").trim()
  if (isMt && po) return `${buyer.name}, ${po}`
  if (po) return `${buyer.name}, ${po}`
  return undefined
}

export function invoiceToMisaPayload(opts: MapperOptions): InvoicePayload {
  const mode: ExportMode = opts.mode ?? "as_sold"
  const refId = crypto.randomUUID()
  const exchangeRate = 1
  const now = vnInvoiceDate()

  const detail: InvoiceDetailLine[] = opts.lines.map((l, idx) => {
    const cf = Number(l.conversion_factor || 1) || 1
    let unitName = l.unit_name
    let quantity = Number(l.quantity || 0)
    let unitPrice = Number(l.unit_price || 0)
    if (mode === "box" && cf > 1) {
      unitName = l.base_unit || unitName
      quantity = quantity * cf
      unitPrice = unitPrice / cf
    }

    const vatRate = l.vat_rate == null ? 10 : Number(l.vat_rate)
    const discountOC = roundVnd(l.line_discount || 0)
    const amountOC = roundVnd(quantity * unitPrice)
    const vatAmountOC = roundVnd(((amountOC - discountOC) * vatRate) / 100)

    return {
      RefDetailID: crypto.randomUUID(),
      RefID: refId,
      InventoryItemType: 1, // 1=Product
      InventoryItemCode: l.sku || "",
      Description: l.product_name,
      UnitName: unitName,
      Quantity: quantity,
      UnitPrice: roundVnd(unitPrice),
      AmountOC: amountOC,
      Amount: amountOC * exchangeRate,
      DiscountRate: 0,
      DiscountAmountOC: discountOC,
      DiscountAmount: discountOC * exchangeRate,
      VATRate: vatRate,
      VATAmountOC: vatAmountOC,
      VATAmount: vatAmountOC * exchangeRate,
      SortOrder: idx + 1,
      SortOrderView: idx + 1,
      IsPromotion: false,
    }
  })

  // Tổng theo công thức doc 6.1.
  const totalSaleOC = detail.reduce((s, d) => s + d.AmountOC, 0)
  const totalDiscountOC = detail.reduce((s, d) => s + d.DiscountAmountOC, 0)
  const totalVATOC = detail.reduce((s, d) => s + d.VATAmountOC, 0)
  const totalWithoutVATOC = totalSaleOC - totalDiscountOC
  const totalOC = totalWithoutVATOC + totalVATOC

  // VATRate ở master = thuế suất chung nếu chỉ 1 mức, 0 nếu nhiều mức.
  const vatRates = new Set(detail.map((d) => d.VATRate))
  const isMore = vatRates.size > 1
  const masterVATRate = isMore ? 0 : (detail[0]?.VATRate ?? 10)
  const isTaxReduction43 = vatRates.has(8)

  const header: InvoiceHeader = {
    RefID: refId,
    CompanyID: opts.companyId || "",
    OrganizationUnitID: opts.orgUnitId || "",
    UserID: opts.userId || "",
    InvoiceType: opts.invoiceType ?? 1, // 1 = HĐ GTGT bán hàng
    InvSeries: opts.invSeries || "",
    InvTemplateNo: opts.invTemplateNo || "1",
    InvoiceTemplateID: opts.templateId || "",
    IsInheritFromOldTemplate: opts.isInheritFromOldTemplate ?? false,
    InvDate: opts.invoiceDate || now,
    InvNo: "<Chưa cấp số>",
    SourceType: 0,
    SendInvoiceStatus: 0,
    SendNumber: 0,
    CurrencyCode: "VND",
    CurrencyID: "VND",
    ExchangeRate: exchangeRate,
    ExchangeRateOperation: 0,
    TypeDiscount: totalDiscountOC > 0 ? 1 : 0, // 1 = CK dòng
    DiscountRate: 0,
    IsMoreVATRate: isMore,
    VATRate: masterVATRate,
    EInvoiceStatus: 0,
    PaymentStatus: 0,
    PaymentRule: 0,
    ApproveStep: -3,
    CreatedDate: now,
    ModifiedDate: now,
    EditVersion: 0,
    OrgInvoiceType: 1,
    TotalSaleAmountOC: totalSaleOC,
    TotalSaleAmount: totalSaleOC * exchangeRate,
    TotalAmountWithoutVATOC: totalWithoutVATOC,
    TotalAmountWithoutVAT: totalWithoutVATOC * exchangeRate,
    TotalVATAmountOC: totalVATOC,
    TotalVATAmount: totalVATOC * exchangeRate,
    TotalDiscountAmountOC: totalDiscountOC,
    TotalDiscountAmount: totalDiscountOC * exchangeRate,
    TotalAmountOC: totalOC,
    TotalAmount: totalOC * exchangeRate,
    AccountObjectTaxCode: opts.buyer.tax_code || "",
    AccountObjectName: opts.buyer.name,
    AccountObjectAddress: opts.buyer.address || "",
    AccountObjectCode: "",
    ContactName: buildContactName(opts.buyer, opts.poNote) || opts.buyer.name,
    ReceiverEmail: opts.buyer.email || "",
    ReceiverName: "",
    ReceiverMobile: "",
    PaymentMethod: opts.buyer.payment_method_label || "TM/CK",
    IsTaxReduction43: isTaxReduction43,
    InvoiceDetails: detail,
  }

  return [header]
}
