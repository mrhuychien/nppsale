/**
 * MISA meInvoice WebAPI v2 — kiểu dữ liệu theo doc HDGTGT.html.
 *
 * Endpoint: POST {apiBase}/v3sainvoice (không mã CQT)
 *         hoặc /v3sainvoice/Code (có mã CQT)
 * Header:   Authorization: Bearer <token>, TaxCode: <MST>, Content-Type: application/json
 * Body:     [ { ...InvoiceHeader, InvoiceDetails: [...] } ]  ← MẢNG 1 phần tử
 */

export interface MisaConfig {
  apiBase: string
  taxCode: string
  username: string
  password: string
  /** Path lấy token, WebAPI v2 = '/oauth'. */
  tokenPath?: string | null
  /** Path đẩy HĐ nháp, WebAPI v2 = '/v3sainvoice' (không mã) hoặc '/v3sainvoice/Code'. */
  publishPath?: string | null
  /** CompanyID — lấy từ response /oauth (int). */
  companyId?: string | null
  /** OrganizationUnitID — lấy từ response /oauth (GUID). */
  orgUnitId?: string | null
  /** InvoiceTemplateID — lấy từ "Lấy danh sách mẫu HD" (GUID). */
  templateId?: string | null
  /** UserID — lấy từ response /oauth (GUID). */
  userId?: string | null
  /** Kí hiệu hoá đơn vd '1K23TCB'. */
  invSeries?: string | null
  /** Mẫu số vd '1'. */
  invTemplateNo?: string | null
  /** InvoiceType (int): 1 = HĐ GTGT bán hàng (default). */
  invoiceType?: number | null
  /** IsInheritFromOldTemplate (bool): theo response API lấy mẫu HD. */
  isInheritFromOldTemplate?: boolean | null
  sandbox?: boolean
}

export interface SellerInfo {
  name: string
  taxCode: string
  address: string
}

/** 1 dòng InvoiceDetails — schema theo doc 6.2. */
export interface InvoiceDetailLine {
  RefDetailID: string
  RefID: string
  /** 1=Product, 2=Promotion, 3=Description, 4=Discount. */
  InventoryItemType: number
  InventoryItemCode?: string
  /** Tên hàng hoá. */
  Description: string
  UnitName: string
  Quantity: number
  UnitPrice: number
  /** = Quantity * UnitPrice. */
  AmountOC: number
  /** = AmountOC * ExchangeRate. */
  Amount: number
  DiscountRate: number
  DiscountAmountOC: number
  DiscountAmount: number
  VATRate: number
  /** = AmountOC * VATRate / 100. */
  VATAmountOC: number
  /** = VATAmountOC * ExchangeRate. */
  VATAmount: number
  SortOrder: number
  /** null nếu InventoryItemType ∈ {3,4}. */
  SortOrderView: number | null
  IsPromotion?: boolean
}

/** Einvoice Master object — theo doc 6.1. */
export interface InvoiceHeader {
  RefID: string
  CompanyID: number | string
  OrganizationUnitID: string
  UserID: string
  InvoiceType: number
  InvSeries: string
  InvTemplateNo: string
  InvoiceTemplateID: string
  IsInheritFromOldTemplate: boolean
  InvDate: string
  /** Mặc định "<Chưa cấp số>". */
  InvNo: string
  /** Mặc định 0. */
  SourceType: number
  SendInvoiceStatus: number
  SendNumber: number
  CurrencyCode: string
  CurrencyID: string
  ExchangeRate: number
  ExchangeRateOperation: number
  /** 0=không CK, 1=CK dòng, 2=CK tổng. */
  TypeDiscount: number
  DiscountRate: number
  IsMoreVATRate: boolean
  VATRate: number
  EInvoiceStatus: number
  PaymentStatus: number
  PaymentRule: number
  ApproveStep: number
  CreatedDate: string
  ModifiedDate: string
  EditVersion: number
  OrgInvoiceType: number
  TotalSaleAmountOC: number
  TotalSaleAmount: number
  TotalAmountWithoutVAT: number
  TotalAmountWithoutVATOC: number
  TotalVATAmountOC: number
  TotalVATAmount: number
  TotalDiscountAmountOC: number
  TotalDiscountAmount: number
  TotalAmountOC: number
  TotalAmount: number
  // Người mua (optional)
  AccountObjectTaxCode?: string
  AccountObjectName?: string
  AccountObjectAddress?: string
  AccountObjectCode?: string
  ContactName?: string
  ReceiverEmail?: string
  ReceiverName?: string
  ReceiverMobile?: string
  PaymentMethod: string
  /** true nếu HĐ có thuế suất 8%. */
  IsTaxReduction43: boolean
  InvoiceDetails: InvoiceDetailLine[]
}

/** Body POST /v3sainvoice — mảng 1+ HĐ. */
export type InvoicePayload = InvoiceHeader[]

/** Response /oauth — token nằm trực tiếp. */
export interface MisaTokenResponse {
  access_token?: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  [k: string]: unknown
}

export interface MisaPublishResponse {
  lookup_code?: string | null
  inv_no?: string | null
  raw: unknown
  ok: boolean
  error?: string
}
