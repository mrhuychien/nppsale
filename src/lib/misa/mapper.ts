import crypto from "node:crypto"
import type { InvoiceDataItem, InvoiceDetailLine, InvoicePayload, SellerInfo } from "./types"

/**
 * Layer 2 — Mapper (pure, no I/O).
 *
 * Convert đơn hàng npp.sale → InvoicePayload MISA. Chứa toàn bộ business
 * logic: tính VAT, quy đổi hộp, append PO cho chuỗi MT, chọn UoM.
 */

export type ExportMode = "as_sold" | "box"

export interface MapperLine {
  product_name: string
  sku?: string | null
  unit_name: string
  base_unit?: string | null
  quantity: number
  unit_price: number
  /** 1 đơn vị bán = conversion_factor đơn vị cơ sở (hộp). */
  conversion_factor?: number | null
  /** % VAT (0,5,8,10). Nếu null → mặc định 10. */
  vat_rate?: number | null
  line_discount?: number | null
}

export interface MapperBuyer {
  name: string
  tax_code?: string | null
  address?: string | null
  email?: string | null
  /** 'MT' (modern trade) cần ContactName + PO. */
  channel?: string | null
  payment_method_label?: string | null
}

export interface MapperOptions {
  buyer: MapperBuyer
  seller: SellerInfo
  lines: MapperLine[]
  mode?: ExportMode
  /** Số PO (đơn đặt hàng của chuỗi MT) — append vào ContactName. */
  poNote?: string | null
  invoiceDate?: string // ISO; mặc định now() +07:00
  invSeries?: string | null
  invTemplateNo?: string | null
  companyId?: string | null
  orgUnitId?: string | null
  templateId?: string | null
  userId?: string | null
  /** SignType MISA: 1=USB/file (default), 2=HSM, 3=HSM async, 4/5=không ký. */
  signType?: number | null
}

/** VND: làm tròn về số nguyên đồng. */
function roundVnd(n: number): number {
  return Math.round((Number(n) || 0))
}

/** ISO 8601 + +07:00 cho ngày hoá đơn (giờ VN). */
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

  const detail: InvoiceDetailLine[] = opts.lines.map((l) => {
    const cf = Number(l.conversion_factor || 1) || 1
    let unitName = l.unit_name
    let quantity = Number(l.quantity || 0)
    let unitPrice = Number(l.unit_price || 0)

    if (mode === "box" && cf > 1) {
      // Quy về đơn vị cơ sở (hộp): SL × cf, đơn giá ÷ cf.
      unitName = l.base_unit || unitName
      quantity = quantity * cf
      unitPrice = unitPrice / cf
    }

    const vatRate = l.vat_rate == null ? 10 : Number(l.vat_rate)
    const discount = roundVnd(l.line_discount || 0)
    const amount = roundVnd(quantity * unitPrice) - discount
    const vatAmount = roundVnd((amount * vatRate) / 100)

    return {
      RefDetailID: crypto.randomUUID(),
      ItemCode: l.sku || undefined,
      ItemName: l.product_name,
      UnitName: unitName,
      Quantity: quantity,
      UnitPrice: roundVnd(unitPrice),
      Amount: amount,
      VATRate: vatRate,
      VATAmount: vatAmount,
      DiscountAmount: discount || undefined,
    }
  })

  // Tổng = sum(round(line)) — KHÔNG round(sum) → khớp đến từng đồng.
  const totalSale = detail.reduce((s, d) => s + d.Amount, 0)
  const totalVat = detail.reduce((s, d) => s + d.VATAmount, 0)

  const invoiceItem: InvoiceDataItem = {
    RefID: crypto.randomUUID(),
    InvSeries: opts.invSeries || undefined,
    InvTemplateNo: opts.invTemplateNo || undefined,
    InvoiceDate: opts.invoiceDate || vnInvoiceDate(),
    CurrencyCode: "VND",
    ExchangeRate: 1,
    PaymentMethodName: opts.buyer.payment_method_label || "Chuyển khoản",
    AccountObjectName: opts.buyer.name,
    AccountObjectTaxCode: opts.buyer.tax_code || "", // khách lẻ → ""
    AccountObjectAddress: opts.buyer.address || "",
    ContactName: buildContactName(opts.buyer, opts.poNote),
    AccountObjectEmail: opts.buyer.email || undefined,
    TotalSaleAmount: totalSale,
    TotalVATAmount: totalVat,
    TotalAmount: totalSale + totalVat,
    CompanyID: opts.companyId,
    OrgUnitID: opts.orgUnitId,
    TemplateID: opts.templateId,
    UserID: opts.userId,
    OriginalInvoiceDetail: detail,
  }

  return {
    SignType: opts.signType ?? 1,
    InvoiceData: [invoiceItem],
    PublishInvoiceData: [],
  }
}
