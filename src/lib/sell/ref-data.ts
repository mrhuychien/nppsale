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
  /**
   * product_id → tồn kho theo ĐƠN VỊ CƠ SỞ, cộng các lô Ở KHO BÁN.
   *
   * ⚠ KHÔNG GỒM KHO CẬN DATE. Đây là "số bán được", không phải "số có
   * trong kho" — hai thứ khác nhau kể từ 20/09/2026.
   */
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
      eq: (c: string, v: unknown) => {
        order: (c: string) => { order: (c: string) => { range: (a: number, b: number) => unknown } }
      }
      // ⚠ `.order(...)` PHẢI CÓ TRONG KIỂU NÀY. Xem chỗ đọc `batches`:
      //   chia trang mà không sắp thứ tự thì các trang lặp và sót dòng.
      gt: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => {
          order: (c: string) => { range: (a: number, b: number) => unknown }
        }
      }
    }
  }
}

/** Đủ để chạy phép DÒ NGUYÊN NHÂN khi danh mục về rỗng. */
interface ProbeClient {
  auth: { getUser: () => PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> }
  from: (t: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (cols: string, opts?: unknown) => any
  }
}

/**
 * VÌ SAO PHẢI DÒ.
 *
 * ⚠ Danh mục về 0 dòng KHÔNG nói lên điều gì. PostgREST trả HTTP 200,
 * `error === null`, mảng rỗng cho CẢ BỐN chuyện dưới đây:
 *
 *   1. Phiên đăng nhập hết hạn → request đi bằng khoá ẩn danh, RLS từ chối.
 *   2. Tài khoản chưa gắn `org_id` → `public.user_org_id()` trả NULL, và
 *      mọi policy `org_id = user_org_id()` thành sai với MỌI dòng. Lúc đó
 *      cả app rỗng: sản phẩm rỗng, khách rỗng, đơn rỗng.
 *   3. Có dữ liệu nhưng không dòng nào ở trạng thái `active` — danh mục
 *      này lọc `status = 'active'`, nhập liệu sai một chữ là mất sạch.
 *   4. Đơn vị này thật sự chưa nhập gì.
 *
 * Bốn chuyện, bốn việc phải làm khác hẳn nhau, và màn hình đang nói đúng
 * MỘT câu cho cả bốn: "Chưa có sản phẩm nào" — câu đó đúng ở trường hợp
 * 4 và là lời nói dối ở ba trường hợp còn lại.
 *
 * Phép dò này KHÔNG sửa được gì; việc của nó là nói ra người dùng đang ở
 * trường hợp nào. Nó chỉ chạy khi danh mục đã rỗng, nên không tốn gì của
 * đường đi bình thường.
 *
 * ⚠ Số đếm cũng đi qua RLS. `count > 0` nghĩa là đọc được → lỗi nằm ở bộ
 * lọc trạng thái. `count === 0` thì KHÔNG phân biệt được "rỗng thật" với
 * "bị RLS chặn" — nên câu trả lời phải nói ra cả hai khả năng, đừng chọn
 * bừa một cái nghe xuôi tai.
 */
export async function diagnoseEmptyCatalog(supabase: unknown): Promise<string> {
  const sb = supabase as ProbeClient

  let userId: string | null = null
  try {
    const { data } = await sb.auth.getUser()
    userId = data?.user?.id ?? null
  } catch {
    return "Không kiểm tra được phiên đăng nhập. Tải lại trang; nếu vẫn vậy thì đăng nhập lại."
  }
  if (!userId) {
    return "Phiên đăng nhập đã hết hạn nên máy chủ không trả về dữ liệu nào. Đăng nhập lại rồi mở lại màn này."
  }

  const { data: prof, error: profErr } = await sb
    .from("users")
    .select("org_id")
    .eq("id", userId)
    .maybeSingle()
  if (profErr) {
    return `Không đọc được hồ sơ tài khoản (${profErr.message}). Báo quản trị viên — nhiều khả năng là quyền trên bảng người dùng.`
  }
  if (!prof?.org_id) {
    return "Tài khoản này chưa được gắn ĐƠN VỊ (org_id rỗng), nên mọi danh mục đều về rỗng. Quản trị viên cần gán đơn vị cho tài khoản."
  }

  // Đếm KHÔNG kèm bộ lọc trạng thái — để tách "lọc sai" khỏi "không đọc được".
  const [p, c] = await Promise.all([
    sb.from("products").select("id", { count: "exact", head: true }),
    sb.from("customers").select("id", { count: "exact", head: true }),
  ])
  if (p.error || c.error) {
    return `Không đọc được danh mục: ${p.error?.message || c.error?.message}.`
  }
  const nProd = Number(p.count ?? 0)
  const nCust = Number(c.count ?? 0)
  if (nProd > 0 || nCust > 0) {
    return `Đơn vị có ${nProd} sản phẩm và ${nCust} khách, nhưng KHÔNG dòng nào ở trạng thái "đang hoạt động" (status = 'active') nên màn này không hiện được gì. Vào Sản phẩm / Khách hàng bật lại trạng thái.`
  }
  return "Đơn vị này đọc về 0 sản phẩm và 0 khách. Hoặc dữ liệu chưa được nhập, hoặc tài khoản không có quyền đọc (RLS chặn theo org_id). Kiểm tra đơn vị của tài khoản trước."
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

/**
 * Bản lưu ngoại tuyến để HIỆN TRƯỚC trong lúc tải bản mới — KHÔNG kèm cảnh
 * báo, vì đây không phải tình huống mất mạng: bản mới đang trên đường về
 * và sẽ thay vào. Xem `@/lib/sell/ref-store`.
 *
 * Trả `null` khi bản lưu rỗng: hiện một danh mục trống rồi thay bằng danh
 * mục đầy thì còn giật hơn là hiện khung xương.
 */
export async function peekCachedSellRefData(): Promise<SellRefData | null> {
  const cached = await getCachedOrderRefData<Customer, SellProduct>()
  if (!cached || (cached.products.length === 0 && cached.customers.length === 0)) return null
  return {
    customers: cached.customers,
    products: cached.products,
    stockByProduct: cached.stockByProduct || {},
    source: "cache",
    cachedAt: cached.cachedAt,
    warnings: [],
  }
}

export async function loadSellRefData(supabase: unknown): Promise<SellRefData> {
  const sb = supabase as Client
  const warnings: string[] = []

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const c = await fromCache("Không có mạng")
    if (c) return c
  }

  /**
   * ⚠ KHOÁ PHỤ `id` SAU CỘT TÊN. Hai cửa hàng / hai mặt hàng trùng tên là
   *   chuyện thường; các trang chạy SONG SONG, sắp theo tên không duy nhất
   *   thì Postgres được trả mỗi trang một kiểu — một khách lặp hai lần,
   *   khách khác biến mất khỏi bộ nhớ đệm, và nhân viên gõ đúng tên mà
   *   không tìm ra (cùng lý do với lô hàng bên dưới).
   */
  const pageAll = <T,>(cols: string, table: "customers" | "products", orderBy: string) =>
    fetchAllForAggregate<T>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb.from(table).select(cols, { count: "exact" }).eq("status", "active").order(orderBy).order("id").range(from, to)) as any
    )

  const [custRes0, prodRes0, batchRes] = await Promise.all([
    pageAll<Customer>(CUST_COLS, "customers", "store_name"),
    pageAll<SellProduct>(PROD_COLS, "products", "name"),
    /**
     * ⚠ PHẢI CÓ `.order("id")`. `fetchAllForAggregate` chia trang bằng
     *   `range(from, to)` và gọi các trang SONG SONG; không có thứ tự cố
     *   định thì Postgres được quyền trả mỗi request một thứ tự khác,
     *   nên `OFFSET/LIMIT` vừa LẶP vừa BỎ SÓT dòng. Ở đây các dòng được
     *   CỘNG lại thành tồn kho: lô bị đếm hai lần là tồn PHỒNG LÊN, và
     *   màn bán hàng cho nhân viên đặt nhiều hơn số thật sự có.
     *
     *   Chỉ lộ ra khi đơn vị vượt một trang (1.000 lô) — đúng lúc kho đã
     *   lớn và không ai còn kiểm tay được nữa. `id` là khoá chính nên
     *   luôn duy nhất, đủ làm mốc chia trang ổn định.
     */
    /**
     * ⚠ CHỈ KHO BÁN (chủ nhà chốt 20/09/2026: "hàng trong kho cận date
     *   không được bán"). Bản cũ cộng MỌI vùng kho, nên con số "tồn"
     *   trên màn bán hàng lớn hơn số thật sự xuất được — nhân viên đặt
     *   theo nó rồi màn Xuất hàng báo thiếu. Vùng `date` là hàng gần
     *   hạn (mig 028); muốn bán xả thì chuyển lô về vùng `sale` trước.
     */
    fetchAllForAggregate<{ product_id: string; qty_on_hand: number }>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb.from("batches").select("product_id, qty_on_hand", { count: "exact" }).gt("qty_on_hand", 0).eq("warehouse_zone", "sale").order("id").range(from, to)) as any
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
  /**
   * ⚠ TRẦN CỦA LÔ HÀNG CŨNG PHẢI NÓI. Hai dòng trên đã kiểm `truncated`
   * từ lâu, dòng này thì quên — nên khi kho vượt trần, tồn của một số
   * mặt hàng bị cộng THIẾU và màn hình chặn nhầm những đơn hợp lệ, hoặc
   * hiện "hết hàng" cho thứ đang còn đầy kho. Cùng một loại lỗi im lặng.
   */
  if (batchRes.truncated) {
    warnings.push("Số lô hàng vượt trần tải về nên TỒN KHO trên màn này đang thiếu một phần.")
  }

  const customers = custRes.rows
  const products = prodRes.rows
  if (customers.length === 0 && products.length === 0) {
    const c = await fromCache("Kết nối không ổn định")
    if (c) return c
    // ⚠ KHÔNG trả về rỗng KÈM IM LẶNG. Xem `diagnoseEmptyCatalog`: 0 dòng
    // là câu trả lời giống hệt nhau cho bốn nguyên nhân khác hẳn nhau, và
    // màn hình đang chọn giúp người dùng một cái nghe xuôi tai nhất
    // ("Chưa có sản phẩm nào") — thứ họ không kiểm chứng được và cũng
    // không sửa được.
    warnings.push(await diagnoseEmptyCatalog(supabase))
    return { customers: [], products: [], stockByProduct: {}, source: "empty", warnings }
  }

  const stockByProduct = stockMapFrom(batchRes.rows)
  // Lưu lại để lần sau mất mạng vẫn soạn đơn được.
  void cacheOrderRefData({ customers, products, stockByProduct })
  return { customers, products, stockByProduct, source: "server", warnings }
}
