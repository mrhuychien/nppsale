/**
 * MISA meInvoice — kiểu dữ liệu cho payload & response.
 *
 * Mặc định dùng WebAPI v2 (đơn giản — không cần AppID, không cần ký):
 * - Token: POST /api/v2/oauth (form-encoded, taxcode ở header)
 * - Insert nháp: POST /api/v2/SAInvoice/Insert (Bearer + taxcode header)
 *
 * Schema dựa trên: doc.meinvoice.vn/webapi & testapp.meinvoice.vn/api/v2.
 */

export interface MisaConfig {
  apiBase: string
  taxCode: string
  username: string
  password: string
  /** Path lấy token, WebAPI v2 = '/oauth'. */
  tokenPath?: string | null
  /** Path tạo HĐ nháp, WebAPI v2 = '/SAInvoice/Insert'. */
  publishPath?: string | null
  companyId?: string | null
  orgUnitId?: string | null
  templateId?: string | null
  userId?: string | null
  invSeries?: string | null
  invTemplateNo?: string | null
  sandbox?: boolean
}

/** Thông tin người bán in trên hoá đơn. */
export interface SellerInfo {
  name: string
  taxCode: string
  address: string
}

export interface InvoiceDetailLine {
  /** UUID duy nhất cho dòng (RefDetailID). */
  RefDetailID: string
  ItemCode?: string
  ItemName: string
  UnitName: string
  Quantity: number
  UnitPrice: number
  /** Thành tiền chưa thuế = round(Quantity × UnitPrice). */
  Amount: number
  /** Tỷ lệ thuế GTGT (%) — vd 10, 8, 5, 0. */
  VATRate: number
  /** Tiền thuế của dòng = round(Amount × VATRate/100). */
  VATAmount: number
  DiscountAmount?: number
}

/**
 * Body /SAInvoice/Insert (WebAPI v2) — flat 1 hoá đơn, không wrap.
 * Field name lấy từ doc + example MISA: BuyerLegalName/BuyerTaxCode/...
 */
export interface InvoicePayload {
  RefID: string
  InvSeries?: string
  InvoiceName?: string
  InvDate: string
  CurrencyCode: "VND"
  ExchangeRate: 1
  PaymentMethodName: string
  // Người mua (WebAPI v2 dùng Buyer*; Integration API dùng AccountObject*).
  BuyerLegalName: string
  BuyerTaxCode: string
  BuyerAddress: string
  BuyerEmail?: string
  ContactName?: string
  // Tổng tiền (suffix OC = Original Currency).
  TotalAmountOC: number
  TotalVATAmountOC: number
  TotalDiscountAmountOC?: number
  TotalAmountWithVATOC: number
  // Định danh org/template MISA.
  CompanyID?: string | null
  OrgUnitID?: string | null
  TemplateID?: string | null
  UserID?: string | null
  // Chi tiết.
  OriginalInvoiceDetail: InvoiceDetailLine[]
}

/** Response /oauth — token nằm trực tiếp (không wrap Success/Data). */
export interface MisaTokenResponse {
  access_token?: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  [k: string]: unknown
}

export interface MisaPublishResponse {
  /** Mã tra cứu (TransactionID trong MISA). */
  lookup_code?: string | null
  /** Số hoá đơn được cấp (InvoiceNumber/InvNo). */
  inv_no?: string | null
  /** Response thô đầy đủ — luôn lưu để debug. */
  raw: unknown
  ok: boolean
  error?: string
}
