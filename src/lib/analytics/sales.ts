import type { SupabaseClient } from "@supabase/supabase-js"
import {
  fetchAllForAggregate,
  docDuHoacNem,
  docTheoLoId,
  truncationWarning,
} from "@/lib/supabase/aggregate"
import type { DateRange } from "./period"

/**
 * Đổi một khoảng NGÀY (theo lịch Việt Nam) thành khoảng thời điểm để so với
 * các cột timestamptz.
 *
 * VÌ SAO KHÔNG DÙNG "Z"
 * Ba hàm dưới đây từng ghép `${range.from}T00:00:00Z`. Database chạy UTC còn
 * người dùng ở múi giờ +07, nên mốc đó là 07:00 sáng giờ Việt Nam: mọi phiếu
 * trả hoặc phiếu xuất kho tạo từ 0h đến 7h sáng ngày đầu kỳ bị đẩy sang KỲ
 * TRƯỚC. Với báo cáo tháng thì đó là hàng trả của tháng này bị trừ vào doanh
 * thu tháng trước — và tháng trước có thể đã chốt sổ.
 *
 * Cùng lỗi này đã sửa ở phía SQL trong migration 095 (AT TIME ZONE
 * 'Asia/Ho_Chi_Minh'). Hai bên phải dùng chung một mốc thì số mới khớp.
 */
const VN_OFFSET = "+07:00"

export function vnDayRange(range: DateRange): { fromIso: string; toIso: string } {
  return {
    fromIso: `${range.from}T00:00:00${VN_OFFSET}`,
    toIso: `${range.to}T23:59:59.999${VN_OFFSET}`,
  }
}

/**
 * Cột dùng để xếp phiếu trả vào kỳ.
 *
 * `credited_at` (mig 097) là thời điểm phiếu được DUYỆT, khác `created_at`
 * là thời điểm LẬP. Phiếu lập 28/09 duyệt 03/10 phải trừ vào kỳ tháng 10 —
 * gom theo ngày lập thì nó rơi vào khoảng trống giữa hai kỳ và mất hẳn.
 * Bảng lương đã gom theo mốc này, báo cáo phải theo cùng thì hai màn hình
 * mới ra một số.
 *
 * Dữ liệu cũ đã được migration bù `credited_at = created_at` nên số của các
 * kỳ đã chốt KHÔNG đổi.
 */
const RETURN_PERIOD_COL = "credited_at"

/**
 * Mã lỗi PostgREST khi câu truy vấn nhắc tới một cột không tồn tại.
 * Xảy ra đúng một trường hợp: mã nguồn đã deploy mà migration chưa chạy
 * — `credited_at` là mig 097, `sales_user_id` là mig 160. Khi đó lùi về
 * câu hỏi hẹp hơn để trang báo cáo vẫn xem được thay vì trắng màn hình.
 */
function isMissingColumn(err: string | null | undefined): boolean {
  if (!err) return false
  return (
    err.includes("42703") ||
    err.includes(RETURN_PERIOD_COL) ||
    err.includes("sales_user_id")
  )
}

export interface SalesAggregates {
  invoiceCount: number       // số hóa đơn (đơn đã giao)
  revenue: number            // doanh thu (subtotal-ish gross)
  returnsValue: number       // giá trị trả
  netRevenue: number         // doanh thu thuần = revenue - returnsValue
  cogs: number               // tổng giá vốn
  grossProfit: number        // lợi nhuận gộp
}

export interface SalesOrderRow {
  id: string
  order_code: string
  order_date: string
  status: string
  total: number
  subtotal: number
  discount: number
  vat: number
  customer_id: string
  sales_user_id: string
}

export interface SalesOrderLineRow {
  id: string
  order_id: string
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_total: number
}

export interface ReturnRow {
  id: string
  return_date?: string | null
  created_at: string
  total_value?: number | null
  total?: number | null
  status: string
}

export interface StockExportLineRow {
  entry_id: string
  product_id: string
  quantity: number
  unit_cost: number
  posted_at: string
}

/**
 * Kết quả một phép đọc ĐỦ: các dòng, kèm cờ chạm trần `AGGREGATE_ROW_CAP`.
 *
 * ⚠ VÌ SAO CÓ BIẾN THỂ `…Du` BÊN CẠNH HÀM CŨ. Hàm cũ trả mảng trần và
 *   nhiều màn ngoài báo cáo đang gọi nó — đổi kiểu trả về là vỡ họ. Màn
 *   báo cáo gọi bản `…Du` để lấy được cờ `truncated` và NÓI RA; hàm cũ
 *   chỉ còn `console.warn` khi chạm trần. Cả hai đều NÉM khi đọc hỏng.
 */
export interface DocDu<T> {
  rows: T[]
  truncated: boolean
}

/**
 * ⚠ NÉM, KHÔNG `console.error` RỒI TRẢ `data || []`. Đó từng là cách cả
 *   tệp này xử lý lỗi — và một lần rớt mạng thành "doanh thu 0", "giá
 *   vốn 0, lãi 100%" trên màn hình, không có gì đỏ lên.
 */
function nemNeuLoi(error: string | null, ten: string): void {
  if (error) throw new Error(`${ten}: ${error}`)
}

function canhBaoTran(truncated: boolean, ten: string): void {
  if (truncated) console.warn(`[analytics/sales] ${ten}: ${truncationWarning()}`)
}

const COT_DON = "id, order_code, order_date, status, total, subtotal, discount, vat, customer_id, sales_user_id"

/**
 * Đơn đã giao trong kỳ (theo `order_date`, tính cả hai đầu).
 *
 * ⚠ `.order("id")` SAU `order_date`. Các trang chạy SONG SONG; nhiều đơn
 *   cùng một ngày mà không có mốc duy nhất thì mỗi trang được Postgres xếp
 *   một kiểu — đơn lặp ở hai trang, đơn khác không ở trang nào.
 */
export async function fetchDeliveredOrdersDu(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<DocDu<SalesOrderRow>> {
  const res = await fetchAllForAggregate<SalesOrderRow>((from, to) =>
    supabase
      .from("sales_orders")
      .select(COT_DON, { count: "exact" })
      .eq("org_id", orgId)
      .eq("status", "completed")
      .gte("order_date", range.from)
      .lte("order_date", range.to)
      .order("order_date", { ascending: false })
      .order("id")
      .range(from, to)
  )
  nemNeuLoi(res.error, "đọc đơn đã giao")
  return { rows: res.rows, truncated: res.truncated }
}

/** Fetch delivered sales orders within a range (inclusive, by order_date). */
export async function fetchDeliveredOrders(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<SalesOrderRow[]> {
  const r = await fetchDeliveredOrdersDu(supabase, orgId, range)
  canhBaoTran(r.truncated, "đơn đã giao")
  return r.rows
}

/** Mọi đơn trong kỳ, không kể trạng thái — cùng luật với hàm trên. */
export async function fetchAllOrdersDu(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<DocDu<SalesOrderRow>> {
  const res = await fetchAllForAggregate<SalesOrderRow>((from, to) =>
    supabase
      .from("sales_orders")
      .select(COT_DON, { count: "exact" })
      .eq("org_id", orgId)
      .gte("order_date", range.from)
      .lte("order_date", range.to)
      .order("order_date", { ascending: false })
      .order("id")
      .range(from, to)
  )
  nemNeuLoi(res.error, "đọc đơn hàng")
  return { rows: res.rows, truncated: res.truncated }
}

/** Fetch all sales orders within range regardless of status (for order analytics). */
export async function fetchAllOrders(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<SalesOrderRow[]> {
  const r = await fetchAllOrdersDu(supabase, orgId, range)
  canhBaoTran(r.truncated, "đơn hàng")
  return r.rows
}

/**
 * Đọc ĐỦ một bảng tra cứu của NPP (khách, mặt hàng, người dùng, NCC).
 *
 * ⚠ BẢNG TRA CỨU CŨNG BỊ CẮT Ở 1.000 DÒNG, VÀ NÓ SAI THEO KIỂU KHÓ THẤY
 *   HƠN. Không phải con số thiếu mà là con số ĐỔI CHỖ: khách thứ 1.001
 *   không có trong map nên đơn của họ rơi vào kênh mặc định "Bán trực
 *   tiếp", hoặc bị bộ lọc bảng giá / tuyến bỏ ra ngoài.
 */
export async function fetchOrgRows<T>(
  supabase: SupabaseClient,
  table: string,
  orgId: string,
  cols: string,
  ten: string
): Promise<DocDu<T>> {
  return docDuHoacNem<T>(
    (from, to) =>
      supabase
        .from(table)
        .select(cols, { count: "exact" })
        .eq("org_id", orgId)
        .order("id")
        .range(from, to),
    ten
  )
}

export interface PostedStockEntryRow {
  id: string
  type: "import" | "export" | "stocktake" | "transfer"
  status: string
  posted_at: string | null
  entry_code: string
  supplier_id: string | null
}

/**
 * Phiếu kho ĐÃ GHI SỔ trong kỳ (theo `posted_at`, mốc giờ Việt Nam).
 *
 * ⚠ MỘT HÀM CHO NĂM MÀN. Trước đây mỗi màn báo cáo tự viết câu này — có
 *   màn đọc trần (1.000 dòng), có màn mốc "Z" (lệch 7 tiếng), có màn chỉ
 *   `console.error` khi hỏng → giá vốn 0 → lãi 100%, hoa hồng phồng.
 */
export async function fetchPostedStockEntries(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange,
  type: PostedStockEntryRow["type"] | null
): Promise<DocDu<PostedStockEntryRow>> {
  const { fromIso, toIso } = vnDayRange(range)
  return docDuHoacNem<PostedStockEntryRow>((from, to) => {
    let q = supabase
      .from("stock_entries")
      .select("id, type, status, posted_at, entry_code, supplier_id", { count: "exact" })
      .eq("org_id", orgId)
      .eq("status", "posted")
      .gte("posted_at", fromIso)
      .lte("posted_at", toIso)
    if (type) q = q.eq("type", type)
    return q.order("id").range(from, to)
  }, "đọc phiếu kho đã ghi sổ")
}

/**
 * Ngày lịch Việt Nam (YYYY-MM-DD) của một mốc timestamptz.
 *
 * ⚠ `posted_at.slice(0, 10)` LÀ NGÀY UTC: phiếu xuất 00:30 sáng mùng 1
 *   giờ Việt Nam rơi vào cột ngày cuối tháng trước — một ngày NẰM NGOÀI
 *   kỳ đang xem, vì kỳ đã đọc theo mốc +07 (`vnDayRange`).
 */
export function vnDateOf(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso.slice(0, 10)
  return new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

/** Fetch order lines for the given order ids. */
export async function fetchOrderLines(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<SalesOrderLineRow[]> {
  if (orderIds.length === 0) return []
  /* ⚠ CHIA LÔ NHƯ HAI HÀM DƯỚI. Hàm này nhận id từ một phép đọc ĐÃ
     phân trang từ lâu, nên nó mang cái lỗ URL quá dài còn sớm hơn. */
  return docTheoLoId<SalesOrderLineRow>(
    orderIds,
    (lo, from, to) =>
      supabase
        .from("sales_order_lines")
        .select("id, order_id, product_id, unit_name, quantity, unit_price, line_total", { count: "exact" })
        .in("order_id", lo)
        .order("id")
        .range(from, to),
    "đọc dòng đơn hàng"
  )
}

export interface StockEntryLineRow {
  entry_id: string
  product_id: string
  quantity: number
  /** ⚠ `NOT NULL` dưới database — đo bằng `pg_attribute`, không đoán. */
  unit_cost: number
}

export interface ReturnLineRow {
  return_id: string
  product_id: string
  quantity: number
  line_total: number
}

/**
 * Dòng phiếu kho của các phiếu đã chọn — PHÂN TRANG.
 *
 * ⚠ VÌ SAO PHẢI CÓ HÀM NÀY. Ba màn báo cáo (nhân viên, khách hàng, nhà
 *   cung cấp) đọc bảng này bằng `.in("entry_id", …)` TRẦN, không phân
 *   trang. `db.max_rows` của dự án là 1.000, và khi vượt trần API trả
 *   200 kèm đúng 1.000 dòng, KHÔNG lỗi — xem `@/lib/supabase/aggregate`.
 *   Một tháng của một NPP thật vượt 1.000 dòng phiếu kho rất dễ.
 *
 * ⚠ VÀ ĐÂY LÀ GIÁ VỐN. Thiếu dòng thì giá vốn thiếu → lợi nhuận cao giả
 *   → hoa hồng tính trên một con số không có thật. Không có gì đỏ lên.
 *
 * ⚠ TRONG CHÍNH MỘT `Promise.all` CỦA `reports/employees`, dòng đơn đi
 *   qua `fetchOrderLines` (có phân trang) còn dòng kho và dòng trả nằm
 *   ngay cạnh thì không. Ba bảng, một chỗ, hai luật.
 */
export async function fetchStockEntryLines(
  supabase: SupabaseClient,
  entryIds: string[]
): Promise<StockEntryLineRow[]> {
  if (entryIds.length === 0) return []
  return docTheoLoId<StockEntryLineRow>(
    entryIds,
    (lo, from, to) =>
      supabase
        .from("stock_entry_lines")
        .select("entry_id, product_id, quantity, unit_cost", { count: "exact" })
        .in("entry_id", lo)
        .order("id")
        .range(from, to),
    "đọc dòng phiếu kho"
  )
}

/** Dòng hàng trả của các phiếu đã chọn — PHÂN TRANG, cùng lý do trên. */
export async function fetchReturnLines(
  supabase: SupabaseClient,
  returnIds: string[]
): Promise<ReturnLineRow[]> {
  if (returnIds.length === 0) return []
  return docTheoLoId<ReturnLineRow>(
    returnIds,
    (lo, from, to) =>
      supabase
        .from("return_lines")
        .select("return_id, product_id, quantity, line_total", { count: "exact" })
        .in("return_id", lo)
        .order("id")
        .range(from, to),
    "đọc dòng hàng trả"
  )
}

/**
 * Tổng giá trị trả (đã duyệt/hoàn tất) trong kỳ, kèm cờ chạm trần.
 *
 * ⚠ `.order("id")`: không có thứ tự thì các trang song song của
 *   `fetchAllForAggregate` được phép trùng/sót nhau — tổng trả hàng lệch.
 */
export async function fetchReturnsValueDu(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<{ total: number; truncated: boolean }> {
  const { fromIso, toIso } = vnDayRange(range)
  const load = (col: string) =>
    fetchAllForAggregate((from, to) =>
      supabase
        .from("returns")
        .select(`id, status, ${col}, credit_note_amount`, { count: "exact" })
        .eq("org_id", orgId)
        .in("status", ["approved", "completed"])
        .gte(col, fromIso)
        .lte(col, toIso)
        .order("id")
        .range(from, to)
    )
  let dataRes = await load(RETURN_PERIOD_COL)
  if (isMissingColumn(dataRes.error)) dataRes = await load("created_at")
  nemNeuLoi(dataRes.error, "đọc phiếu trả")
  let total = 0
  for (const r of dataRes.rows as Array<{ credit_note_amount?: number | null }>) {
    total += Math.abs(Number(r.credit_note_amount || 0))
  }
  return { total, truncated: dataRes.truncated }
}

/** Sum of approved/completed returns within the range. */
export async function fetchReturnsValue(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<number> {
  const r = await fetchReturnsValueDu(supabase, orgId, range)
  canhBaoTran(r.truncated, "phiếu trả")
  return r.total
}

export interface ReturnSummaryRow {
  id: string
  status: string
  customer_id: string
  credit_note_amount: number
  created_at: string
  /**
   * Nhân viên phiếu trả này tính cho (mig 160). `null` nghĩa là CHƯA
   * GÁN — phiếu lập trước migration ấy — chứ không phải "không ai".
   * Báo cáo phải đọc đúng nghĩa đó, đừng bỏ phiếu ra khỏi sổ.
   */
  sales_user_id: string | null
}

export async function fetchReturnsRowsDu(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<DocDu<ReturnSummaryRow>> {
  const { fromIso, toIso } = vnDayRange(range)
  const load = (col: string, nguoiDungTen: boolean) =>
    fetchAllForAggregate((from, to) =>
      supabase
        .from("returns")
        .select(
          `id, status, customer_id, credit_note_amount, created_at, ${col}` +
            (nguoiDungTen ? ", sales_user_id" : ""),
          { count: "exact" }
        )
        .eq("org_id", orgId)
        .in("status", ["approved", "completed"])
        .gte(col, fromIso)
        .lte(col, toIso)
        .order("id")
        .range(from, to)
    )
  /**
   * ⚠ HAI CỘT CÓ THỂ THIẾU, ĐỘC LẬP NHAU: `credited_at` (mig 097) và
   *   `sales_user_id` (mig 160). Lỗi cột thiếu không nói cột nào thiếu,
   *   nên lùi lần lượt qua đủ bốn tổ hợp thay vì đoán. Mỗi bước chỉ chạy
   *   khi bước trước đúng là lỗi cột thiếu — không phải lỗi khác.
   */
  let dataRes = await load(RETURN_PERIOD_COL, true)
  if (isMissingColumn(dataRes.error)) dataRes = await load("created_at", true)
  if (isMissingColumn(dataRes.error)) dataRes = await load(RETURN_PERIOD_COL, false)
  if (isMissingColumn(dataRes.error)) dataRes = await load("created_at", false)
  nemNeuLoi(dataRes.error, "đọc phiếu trả")
  const data = dataRes.rows as Array<{ id: string; status: string; customer_id: string; credit_note_amount: number | null; created_at: string; credited_at?: string | null; sales_user_id?: string | null }>
  const rows = data.map((r) => ({
    id: r.id,
    status: r.status,
    customer_id: r.customer_id,
    credit_note_amount: Number(r.credit_note_amount || 0),
    // Ngày dùng để xếp vào cột thời gian trên báo cáo phải là ngày DUYỆT,
    // khớp với cách bảng lương gom (mig 097). Chưa chạy 097 thì không có
    // credited_at và lùi về created_at như cũ.
    created_at: r.credited_at || r.created_at,
    sales_user_id: r.sales_user_id ?? null,
  }))
  return { rows, truncated: dataRes.truncated }
}

export async function fetchReturnsRows(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<ReturnSummaryRow[]> {
  const r = await fetchReturnsRowsDu(supabase, orgId, range)
  canhBaoTran(r.truncated, "phiếu trả")
  return r.rows
}

/**
 * Giá vốn từ các phiếu XUẤT đã ghi sổ trong kỳ.
 *
 * ⚠ `truncated` LÀ TRƯỜNG MỚI, THÊM VÀO CHỨ KHÔNG ĐỔI KIỂU CŨ — nơi gọi cũ
 *   đọc `cogs`/`lines` vẫn chạy. Phiếu chạm trần thì giá vốn THIẾU, lãi
 *   cao giả; màn nào có chỗ nói thì phải nói.
 * ⚠ Đọc phiếu hỏng thì NÉM — trước đây nó thành "không có phiếu nào",
 *   tức giá vốn 0, lãi gộp 100%.
 */
export async function fetchCogsForRange(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<{ cogs: number; lines: StockExportLineRow[]; truncated: boolean }> {
  const entriesRes = await fetchPostedStockEntries(supabase, orgId, range, "export")
  canhBaoTran(entriesRes.truncated, "phiếu xuất tính giá vốn")
  const entries = entriesRes.rows
  const ids = entries.map((e) => e.id)
  if (ids.length === 0) return { cogs: 0, lines: [], truncated: entriesRes.truncated }

  const postedAtMap = new Map<string, string>()
  for (const e of entries) {
    postedAtMap.set(e.id, e.posted_at || "")
  }

  /* ⚠ CHIA LÔ. `ids` đi ra từ một phép đọc đã phân trang nên nó có thể
     tới 20.000 uuid — nhét cả vào một `.in(...)` là URL vài trăm KB. */
  const lines = await docTheoLoId<{
    entry_id: string
    product_id: string
    quantity: number
    unit_cost: number
  }>(
    ids,
    (lo, from, to) =>
      supabase
        .from("stock_entry_lines")
        .select("entry_id, product_id, quantity, unit_cost", { count: "exact" })
        .in("entry_id", lo)
        .order("id")
        .range(from, to),
    "đọc dòng phiếu xuất để tính giá vốn"
  )
  let cogs = 0
  const enriched: StockExportLineRow[] = []
  for (const l of lines) {
    const q = Math.abs(Number(l.quantity))
    const c = Number(l.unit_cost || 0)
    cogs += q * c
    enriched.push({
      entry_id: l.entry_id,
      product_id: l.product_id,
      quantity: q,
      unit_cost: c,
      posted_at: postedAtMap.get(l.entry_id) || "",
    })
  }
  return { cogs, lines: enriched, truncated: entriesRes.truncated }
}

export function summariseSales(
  orders: SalesOrderRow[],
  returnsValue: number,
  cogs: number
): SalesAggregates {
  const revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0)
  const netRevenue = revenue - returnsValue
  const grossProfit = netRevenue - cogs
  return {
    invoiceCount: orders.length,
    revenue,
    returnsValue,
    netRevenue,
    cogs,
    grossProfit,
  }
}
