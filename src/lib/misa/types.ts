/**
 * MISA meInvoice — kiểu dữ liệu cho payload & response.
 *
 * Dựa trên doc Integration API (https://doc.meinvoice.vn/itg):
 * - Token body: appid, taxcode, username, password (lowercase).
 * - Response wrap: { Success, Data: {...}, ErrorCode, Errors }.
 * - Publish wrap: { SignType, InvoiceData: [...], PublishInvoiceData: [...] }.
 */

export interface MisaConfig {
  apiBase: string
  taxCode: string
  username: string
  password: string
  /** AppID do MISA cấp — gửi trong body lấy token. */
  appId?: string | null
  /** Path lấy access_token, vd '/api/integration/auth/token'. */
  tokenPath?: string | null
  /** Path phát hành hoá đơn, vd '/api/integration/invoice/publish'. */
  publishPath?: string | null
  /** 1=USB/file, 2=HSM, 3=HSM async, 4=vé không ký, 5=POS không ký. */
  signType?: number | null
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

/** 1 dòng InvoiceData trong publish payload — schema MISA Integration API. */
export interface InvoiceDataItem {
  /** UUID duy nhất cho hoá đơn (RefID) — dùng cho idempotency phía MISA. */
  RefID: string
  InvSeries?: string
  InvTemplateNo?: string
  InvoiceDate: string // ISO 8601 + TZ
  CurrencyCode: "VND"
  ExchangeRate: 1
  PaymentMethodName: string
  // Người mua
  AccountObjectName: string
  AccountObjectTaxCode: string // "" nếu khách lẻ
  AccountObjectAddress: string
  ContactName?: string // tên người liên hệ / chuỗi MT + PO
  AccountObjectEmail?: string
  // Tổng tiền
  TotalSaleAmount: number // = sum(round(line.Amount))
  TotalVATAmount: number
  TotalAmount: number
  // Định danh org/template MISA
  CompanyID?: string | null
  OrgUnitID?: string | null
  TemplateID?: string | null
  UserID?: string | null
  // Chi tiết
  OriginalInvoiceDetail: InvoiceDetailLine[]
}

/** Wrapper publish payload theo doc MISA Integration API. */
export interface InvoicePayload {
  SignType: number
  InvoiceData: InvoiceDataItem[]
  PublishInvoiceData: Array<Record<string, unknown>>
}

export interface MisaTokenResponse {
  Success?: boolean
  Data?: {
    access_token?: string
    token_type?: string
    expires_in?: number
    refresh_token?: string
    [k: string]: unknown
  }
  ErrorCode?: string | null
  Errors?: string | null
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
