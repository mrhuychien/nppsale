import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { cacheOrderRefData, getCachedOrderRefData } from "@/lib/offline/ref-cache"
import type { Customer, PriceList, Product, ProductUnit } from "@/types"

export type SellProduct = Product & {
  price_lists?: PriceList[]
  units?: ProductUnit[]
}

/**
 * Danh mục tham chiếu để soạn đơn: khách, sản phẩm, tồn kho.
 *
 * VÌ SAO LÀ MỘT CHỖ DUY NHẤT
 *   Màn tạo đơn cũ và màn bán hàng mới cần đúng ba thứ này. Mỗi màn tự
 *   tải lấy thì mỗi màn tự gặp lại các bẫy đã sửa một lần rồi — mà những
 *   bẫy đó đều thuộc loại KHÔNG BÁO GÌ:
 *
 *   ⚠ Supabase cắt 1.000 dòng mỗi lần và trả HTTP 200 KHÔNG kèm lỗi. Nhà
 *     phân phối có hơn 1.000 khách thì khách nằm sau dòng 1.000 không tìm
 *     thấy; hơn 1.000 lô còn hàng thì sản phẩm nằm sau đó hiện TỒN 0, và
 *     nhân viên đứng ở quầy bị chặn "vượt tồn" trên một đơn hợp lệ.
 *
 *   ⚠ Thiếu một cột (migration chưa chạy đủ) thì truy vấn cột tường minh
 *     trả 400 và danh sách về RỖNG — màn hình trông như "chưa có sản phẩm
 *     nào". Nên có bước thử lại bằng `*`.
 */
const CUST_COLS =
  "id, org_id, store_name, owner_name, phone, address, province, district, ward, channel, group_id, credit_limit, payment_terms, status, gps_lat, gps_lng, created_at, created_by, billing_name, tax_code, billing_address, billing_email, payment_method_label, group:customer_groups(*)"
const PROD_COLS =
  "id, org_id, sku, name, category, brand, barcode, base_unit, vat_rate, shelf_life_days, status, created_at, description, warranty_info, cost_price, sell_price, track_serial, min_stock, max_stock, shelf_location, weight, weight_unit, direct_sale, images, allow_price_edit, price_edit_max_type, price_edit_max, primary_supplier_id, price_lists(*), units:product_units(*)"

export interface SellRefData {
  customers: Customer[]
  products: SellProduct[]
  /** product_id → tồn kho theo ĐƠN VỊ CƠ SỞ, cộng mọi lô. */
  stockByProduct: Record<string, number>
  /** `cache` = đang dùng bản lưu ngoại tuyến. */
  source: "server" | "cache" | "empty"
  /** Thời điểm bản cache được ghi (ISO), chỉ có khi `source === "cache"`. */
  cachedAt?: string
  /**
   * Chuyện cần nói với người dùng. RỖNG nghĩa là mọi thứ bình thường —
   * đừng im lặng khi mảng này có phần tử.
   */
  warnings: string[]
}

/** Gộp lô về tồn theo sản phẩm. */
export function stockMapFrom(
  rows: Array<{ product_id: string; qty_on_hand: number }>
): Record<string, number> {
  const m: Record<string, number> = {}
  for (const b of rows) {
    m[b.product_id] = (m[b.product_id] || 0) + (Number(b.qty_on_hand) || 0)
  }
  return m
}

type Client = {
  from: (t: string) => {
    select: (cols: string, opts?: unknown) => {
      eq: (c: string, v: unknown) => { order: (c: string) => { range: (a: number, b: number) => unknown } }
      gt: (c: string, v: unknown) => { range: (a: number, b: number) => unknown }
    }
  }
}

async function fromCache(reason: string): Promise<SellRefData | null> {
  const cached = await getCachedOrderRefData<Customer, SellProduct>()
  if (!cached) return null
  return {
    customers: cached.customers,
    products: cached.products,
    stockByProduct: cached.stockByProduct || {},
    source: "cache",
    cachedAt: cached.cachedAt,
    warnings: [
      `${reason} — đang dùng danh mục lưu lúc ${new Date(cached.cachedAt).toLocaleString("vi-VN")}. Đơn tạo ra sẽ được đẩy lên khi có mạng.`,
    ],
  }
}

export async function loadSellRefData(supabase: unknown): Promise<SellRefData> {
  const sb = supabase as Client
  const warnings: string[] = []

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const c = await fromCache("Không có mạng")
    if (c) return c
  }

  const pageAll = <T,>(cols: string, table: "customers" | "products", orderBy: string) =>
    fetchAllForAggregate<T>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb.from(table).select(cols, { count: "exact" }).eq("status", "active").order(orderBy).range(from, to)) as any
    )

  const [custRes0, prodRes0, batchRes] = await Promise.all([
    pageAll<Customer>(CUST_COLS, "customers", "store_name"),
    pageAll<SellProduct>(PROD_COLS, "products", "name"),
    fetchAllForAggregate<{ product_id: string; qty_on_hand: number }>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb.from("batches").select("product_id, qty_on_hand", { count: "exact" }).gt("qty_on_hand", 0).range(from, to)) as any
    ),
  ])

  let custRes = custRes0
  let prodRes = prodRes0

  // ⚠ Lỗi ở đây làm MỌI sản phẩm hiện tồn 0 mà không báo gì.
  if (batchRes.error) {
    warnings.push("Không đọc được tồn kho — số tồn trên màn hình có thể sai.")
  }
  if (prodRes.error) {
    prodRes = await pageAll<SellProduct>("*, price_lists(*), units:product_units(*)", "products", "name")
  }
  if (custRes.error) {
    custRes = await pageAll<Customer>("*, group:customer_groups(*)", "customers", "store_name")
  }
  if (prodRes.error || custRes.error) {
    warnings.push(
      `Không tải được danh mục: ${prodRes.error || custRes.error || "lỗi không xác định"}`
    )
  }
  // ⚠ Chạm trần nghĩa là danh mục THIẾU một khúc. Im lặng ở đây là để
  // nhân viên tìm một mã có thật mà không ra kết quả.
  if (prodRes.truncated) warnings.push("Danh mục sản phẩm quá lớn, màn hình còn THIẾU một phần.")
  if (custRes.truncated) warnings.push("Danh sách khách quá lớn, màn hình còn THIẾU một phần.")

  const customers = custRes.rows
  const products = prodRes.rows
  if (customers.length === 0 && products.length === 0) {
    const c = await fromCache("Kết nối không ổn định")
    if (c) return c
    return { customers: [], products: [], stockByProduct: {}, source: "empty", warnings }
  }

  const stockByProduct = stockMapFrom(batchRes.rows)
  // Lưu lại để lần sau mất mạng vẫn soạn đơn được.
  void cacheOrderRefData({ customers, products, stockByProduct })
  return { customers, products, stockByProduct, source: "server", warnings }
}
