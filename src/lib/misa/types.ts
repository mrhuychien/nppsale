/**
 * MISA meInvoice — kiểu dữ liệu cho payload & response.
 *
 * LƯU Ý (doc Step 6): schema response thật của MISA cần verify bằng tay
 * lần đầu chạy với sandbox/production. Các field response dưới đây để
 * optional + client log full response → cập nhật khi biết chính xác.
 */

export interface MisaConfig {
  apiBase: string
  taxCode: string
  username: string
  password: string
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

export interface InvoicePayload {
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

export interface MisaTokenResponse {
  access_token?: string
  token?: string
  expires_in?: number
  [k: string]: unknown
}

export interface MisaPublishResponse {
  /** Mã tra cứu (field thật cần verify — có thể là LookupCode / Code). */
  lookup_code?: string | null
  /** Số hoá đơn được cấp (InvNo / InvoiceNumber). */
  inv_no?: string | null
  /** Response thô đầy đủ — luôn lưu để debug. */
  raw: unknown
  ok: boolean
  error?: string
}
