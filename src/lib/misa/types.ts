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
 * Body /SAInvoice/Insert WebAPI v2 — wrapper MeInvoiceParam:
 *   { data: "<JSON string header>", detail: "<JSON string lines>" }
 * Cả 2 đều là STRING (đã JSON.stringify), không phải object.
 *
 * Field name lấy từ doc + Help/Api: BuyerLegalName/BuyerTaxCode/...
 * TotalSaleAmountOC / TotalAmountWithoutVATOC / TotalVATAmountOC /
 * TotalDiscountAmountOC / TotalAmountOC (OC = Original Currency).
 */
export interface InvoiceHeader {
  RefID: string
  InvSeries?: string
  InvoiceName?: string
  InvDate: string
  CurrencyCode: "VND"
  ExchangeRate: 1
  PaymentMethodName: string
  BuyerLegalName: string
  BuyerTaxCode: string
  BuyerAddress: string
  BuyerEmail?: string
  ContactName?: string
  TotalSaleAmountOC: number
  TotalDiscountAmountOC?: number
  TotalAmountWithoutVATOC: number
  TotalVATAmountOC: number
  TotalAmountOC: number
  CompanyID?: string | null
  OrgUnitID?: string | null
  TemplateID?: string | null
  UserID?: string | null
}

/** Wrapper body POST /SAInvoice/Insert. */
export interface InvoicePayload {
  data: string
  detail: string
  EntityState?: number
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
