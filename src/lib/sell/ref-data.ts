import { fetchAllForAggregate, type AggregateResult } from "@/lib/supabase/aggregate"
import { cacheOrderRefData, getCachedOrderRefData, type KhoaKhach, type KhoaSanPham, type OrderRefData } from "@/lib/offline/ref-cache"
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
/**
 * ⚠ CHỈ CỘT MÀN BÁN HÀNG / POS THẬT SỰ ĐỌC (chủ nhà 25/09/2026: tối ưu /sell trên di
 *   động). Danh mục kéo về NGUYÊN KHỐI (1.700 SP) và làm mới mỗi 2 phút — mỗi cột thừa
 *   nhân lên thành dữ liệu di động + thời gian chờ. Đã rà từng cột trong sell / POS /
 *   lưu ngoại tuyến trước khi bỏ (xem `tests/sell-perf-cot.test.ts`).
 * ⚠ KHÔNG CÒN `cost_price` (GIÁ VỐN) — trước đây về tận máy nhân viên bán hàng.
 * ⚠ Sổ thiếu cột → nhánh dự phòng `*` bên dưới vẫn lấy đủ.
 */
const CUST_COLS =
  "id, org_id, store_name, owner_name, phone, address, group_id, credit_limit, payment_terms, status, group:customer_groups(id, name)"
const PROD_COLS =
  "id, org_id, sku, name, barcode, base_unit, vat_rate, status, sell_price, images, allow_price_edit, " +
  "price_lists(id, product_id, unit_name, price, group_id), units:product_units(id, product_id, unit_name, conversion)"

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
  /** Số phiên danh mục lúc đọc (mig 209) — `null` = sổ chưa có / đọc hỏng. */
  phien?: number | null
  /** Sản phẩm lấy từ bản nhớ trên máy (đã kiểm khoá — xem `dungLaiSanPham`), không tải lại. */
  sanPhamNho?: boolean
  /** Số phiên sổ khách lúc đọc (mig 254) — `null` = sổ chưa có / đọc hỏng. */
  phienKhach?: number | null
  /** Sổ khách lấy từ bản nhớ trên máy (đã kiểm khoá — xem `dungLaiKhach`), không tải lại. */
  khachNho?: boolean
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

/** Bản lưu của NGƯỜI KHÁC trên cùng máy — không được hiện / dùng (khách, giá theo RLS của người ấy). */
function cuaNguoiKhac(nho: OrderRefData | null, uid: string | null | undefined): boolean {
  return !!nho?.uid && !!uid && nho.uid !== uid
}

async function fromCache(reason: string, uid?: string | null): Promise<SellRefData | null> {
  const cached = await getCachedOrderRefData<Customer, SellProduct>()
  if (!cached || cuaNguoiKhac(cached, uid)) return null
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
export async function peekCachedSellRefData(uid?: string | null): Promise<SellRefData | null> {
  const cached = await getCachedOrderRefData<Customer, SellProduct>()
  if (!cached || cuaNguoiKhac(cached, uid) || (cached.products.length === 0 && cached.customers.length === 0)) return null
  return {
    customers: cached.customers,
    products: cached.products,
    stockByProduct: cached.stockByProduct || {},
    source: "cache",
    cachedAt: cached.cachedAt,
    /* Số phiên GHI CÙNG bản này (bản lưu cũ chưa có thì `null`). */
    phien: cached.phien ?? null,
    phienKhach: cached.khach?.phien ?? null,
    warnings: [],
  }
}

/**
 * ĐỌC RIÊNG MỘT KHÁCH (chủ nhà 27/09/2026: "sao từ một số khách hàng ấn tạo đơn lại báo
 * không tìm thấy khách hàng của đường dẫn này?").
 *
 * Danh mục của /sell giữ trên máy tới `CATALOG_FRESH_MS` và chỉ có khách ĐANG HOẠT ĐỘNG — nên
 * khách vừa tạo sau lần tải danh mục, hay khách Tạm ngưng / Khoá, không có trong đó. Bấm "Tạo
 * đơn" từ những khách ấy thì hỏi thẳng máy chủ thay vì kết luận "không tìm thấy".
 * `null` = không có khách này (đã xoá / không thuộc đơn vị); lỗi mạng thì NÉM.
 */
export async function loadOneSellCustomer(supabase: unknown, id: string): Promise<Customer | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const doc = (cols: string) => sb.from("customers").select(cols).eq("id", id).maybeSingle() as Promise<{ data: Customer | null; error: { message: string } | null }>
  let r = await doc(CUST_COLS)
  if (r.error) r = await doc("*, group:customer_groups(*)")
  if (r.error) throw new Error(r.error.message)
  return r.data ?? null
}

/**
 * ĐỌC RIÊNG MỘT SẢN PHẨM theo cột của danh mục bán (kèm bảng giá + đơn vị) — sản phẩm vừa tạo nhanh ở /sell
 * (chủ nhà 03/10/2026, Update 3.10). `null` = không đọc được dòng ấy; lỗi thì NÉM.
 */
export async function loadOneSellProduct(supabase: unknown, id: string): Promise<SellProduct | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const doc = (cols: string) => sb.from("products").select(cols).eq("id", id).maybeSingle() as Promise<{ data: SellProduct | null; error: { message: string } | null }>
  let r = await doc(PROD_COLS)
  if (r.error) r = await doc("*, price_lists(*), units:product_units(*)")
  if (r.error) throw new Error(r.error.message)
  return r.data ?? null
}

/** Lô KHO BÁN còn hàng — nguồn của tồn kho trên màn bán. */
function docLoBan(sb: Client) {
  return (
    fetchAllForAggregate<{ product_id: string; qty_on_hand: number }>((from, to) =>
      // audit-ok: trả NGUYÊN kết quả (kèm `error`) — loadSellStock / loadSellRefData kiểm `.error` rồi mới dùng.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb.from("batches").select("product_id, qty_on_hand", { count: "exact" }).gt("qty_on_hand", 0).eq("warehouse_zone", "sale").order("id").range(from, to)) as any
    )
  )
}

/**
 * CHỈ TỒN KHO (tối ưu /sell di động, 25/09/2026) — ~1/8 dữ liệu của `loadSellRefData`.
 * `null` = đọc hỏng / thiếu trang: giữ số đang hiện, đừng thay bằng tồn 0.
 */
/**
 * SỐ PHIÊN DANH MỤC BÁN HÀNG (mig 209) — tăng mỗi khi sản phẩm / bảng giá / đơn vị đổi. Một dòng,
 * vài byte: máy NVBH hỏi nó để biết có phải tải lại danh mục không (chủ nhà 28/09/2026). `null` =
 * sổ chưa chạy 209 / đọc hỏng → nơi gọi coi như không biết (giữ luật 30 phút cũ).
 */
/** Hai số phiên đọc cùng MỘT câu: hàng (mig 209) + sổ khách (mig 254). `null` = không biết. */
export interface PhienDanhMuc {
  phien: number | null
  phienKhach: number | null
}
const KHONG_BIET_PHIEN: PhienDanhMuc = { phien: null, phienKhach: null }
const soPhien = (x: unknown): number | null => {
  const n = Number(x)
  return x != null && Number.isFinite(n) ? n : null
}
export async function docPhienDanhMucDu(supabase: unknown): Promise<PhienDanhMuc> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return KHONG_BIET_PHIEN
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const doc = (cols: string) =>
    sb.from("danh_muc_ban_phien").select(cols).eq("id", 1).maybeSingle() as Promise<{
      data: { phien?: unknown; phien_khach?: unknown } | null
      error: unknown
    }>
  try {
    let r = await doc("phien, phien_khach")
    /* Sổ chưa chạy mig 254 (thiếu cột → 400) → hỏi lại chỉ số phiên hàng; số khách không biết → sổ khách tải lại như cũ. */
    if (r.error) r = await doc("phien")
    if (r.error || !r.data) return KHONG_BIET_PHIEN
    return { phien: soPhien(r.data.phien), phienKhach: soPhien(r.data.phien_khach) }
  } catch {
    return KHONG_BIET_PHIEN
  }
}
export async function docPhienDanhMuc(supabase: unknown): Promise<number | null> {
  return (await docPhienDanhMucDu(supabase)).phien
}

/** Người đang tải danh mục — sản phẩm NVBH thấy tuỳ vai + công ty được làm (RLS mig 081). */
export interface NguoiTaiDanhMuc {
  uid: string
  vai: string
}

/**
 * ⚠ DÙNG LẠI SẢN PHẨM ĐÃ LƯU TRÊN MÁY (chủ nhà 23/10/2026 "Làm nốt" — POS mở tab mới là tải lại cả ~2.500 mặt hàng +
 *   bảng giá + đơn vị). Chỉ khi khớp ĐỦ: số phiên danh mục (mig 209 — tăng mỗi khi hàng / giá / đơn vị đổi), đúng
 *   người, đúng vai, đúng công ty được làm (đổi phân công thì hàng NVBH thấy đổi mà số phiên không tăng). Thiếu một
 *   thứ (sổ chưa chạy 209, đọc hỏng, bản lưu cũ chưa có khoá) là tải lại — không bao giờ bán theo giá cũ.
 */
export function dungLaiSanPham(nho: OrderRefData | null | undefined, khoa: KhoaSanPham | null | undefined): boolean {
  return (
    !!nho && !!khoa && nho.products.length > 0 &&
    nho.phien === khoa.phien && nho.uid === khoa.uid && nho.vai === khoa.vai && nho.ncc === khoa.ncc
  )
}

/**
 * ⚠ DÙNG LẠI SỔ KHÁCH ĐÃ LƯU TRÊN MÁY (đợt 4 tốc độ, mig 254) — POS / bán hàng mở là kéo cả sổ khách ≈570 KB về dù khách
 *   hầu như không đổi trong ngày. Chỉ khi khớp ĐỦ: số phiên sổ khách (tăng khi khách / nhóm khách / phân công / quyền
 *   xem khách đổi), đúng người, đúng vai (NVBH chỉ thấy khách mình phụ trách). Thiếu một thứ (sổ chưa chạy 254, đọc
 *   hỏng, bản lưu chưa có khoá khách) là tải lại — khách vừa tạo / vừa được giao không bao giờ "mất" trên máy.
 */
export function dungLaiKhach(nho: OrderRefData | null | undefined, khoa: KhoaKhach | null | undefined): boolean {
  const k = nho?.khach
  return (
    !!nho && !!khoa && !!k && nho.customers.length > 0 &&
    k.phien === khoa.phien && k.uid === khoa.uid && k.vai === khoa.vai
  )
}

/** Công ty NVBH được làm — phần khoá `ncc` của bản sản phẩm lưu trên máy. Vai khác thấy mọi hàng: "*". `null` = đọc hỏng. */
async function docNccCuaNguoi(supabase: unknown, nguoi: NguoiTaiDanhMuc): Promise<string | null> {
  if (nguoi.vai !== "sales") return "*"
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).from("user_suppliers").select("supplier_id").eq("user_id", nguoi.uid)
    if (error) return null
    return ((data as Array<{ supplier_id: string | null }>) ?? []).map((r) => r.supplier_id ?? "").filter(Boolean).sort().join(",")
  } catch {
    return null
  }
}

export async function loadSellStock(supabase: unknown): Promise<Record<string, number> | null> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return null
  const res = await docLoBan(supabase as Client)
  if (res.error || res.truncated) return null
  return stockMapFrom(res.rows)
}

export interface TuyChonTai {
  /** `false` = màn không dùng sổ khách (POS nhập hàng / trả NCC) — không kéo ≈1 MB khách về, `customers` trả rỗng. */
  khach?: boolean
}

const KHONG_TAI_KHACH: AggregateResult<Customer> = { rows: [], truncated: false, error: null, total: 0 }

type PageAll = <T>(cols: string, table: "customers" | "products", orderBy: string) => Promise<AggregateResult<T>>

/**
 * ⚠ KHOÁ PHỤ `id` SAU CỘT TÊN. Hai cửa hàng / hai mặt hàng trùng tên là
 *   chuyện thường; các trang chạy SONG SONG, sắp theo tên không duy nhất
 *   thì Postgres được trả mỗi trang một kiểu — một khách lặp hai lần,
 *   khách khác biến mất khỏi bộ nhớ đệm, và nhân viên gõ đúng tên mà
 *   không tìm ra (cùng lý do với lô hàng bên dưới).
 */
const taoPageAll = (sb: Client): PageAll => <T,>(cols: string, table: "customers" | "products", orderBy: string) =>
  fetchAllForAggregate<T>((from, to) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb.from(table).select(cols, { count: "exact" }).eq("status", "active").order(orderBy).order("id").range(from, to)) as any
  )

/** Sổ khách cho màn bán — thiếu cột (sổ chưa chạy migration) thì thử lại bằng `*`. */
async function docKhachBan(pageAll: PageAll): Promise<AggregateResult<Customer>> {
  const r = await pageAll<Customer>(CUST_COLS, "customers", "store_name")
  return r.error ? pageAll<Customer>("*, group:customer_groups(*)", "customers", "store_name") : r
}

/** Sổ khách RIÊNG — POS đang ở màn nhập hàng / trả NCC (không tải khách) mở thêm tab đơn / hoá đơn / trả hàng khách. */
export async function loadSellCustomers(supabase: unknown): Promise<{ customers: Customer[]; warnings: string[] }> {
  const r = await docKhachBan(taoPageAll(supabase as Client))
  const warnings: string[] = []
  if (r.error) warnings.push(`Không tải được danh sách khách: ${r.error}`)
  if (r.truncated) warnings.push("Danh sách khách quá lớn, màn hình còn THIẾU một phần.")
  return { customers: r.rows, warnings }
}

/**
 * `nguoi` — người đang tải (biết thì sản phẩm dùng lại được bản lưu trên máy khi khớp khoá, xem `dungLaiSanPham`;
 * không biết thì tải đủ như cũ). Khách + tồn kho luôn đọc mới — trừ khi `tuyChon.khach === false` (màn không dùng khách).
 */
export async function loadSellRefData(
  supabase: unknown,
  nguoi?: NguoiTaiDanhMuc | null,
  tuyChon?: TuyChonTai
): Promise<SellRefData> {
  const sb = supabase as Client
  const warnings: string[] = []
  const canKhach = tuyChon?.khach !== false

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const c = await fromCache("Không có mạng", nguoi?.uid)
    if (c) return c
  }

  const pageAll = taoPageAll(sb)
  /* Bản lưu trên máy — đọc MỘT lần, dùng cho cả việc dùng lại sản phẩm lẫn việc ghi lại bản lưu. */
  const nhoP = getCachedOrderRefData<Customer, SellProduct>().catch(() => null)

  /* Có `nguoi`: câu sản phẩm CHỜ số phiên (đọc trước, không song song). Sửa giá chen giữa hai câu thì bản lưu mang số
     CŨ — lần sau số đã khác, tải lại. Song song mà câu sản phẩm về trước thì bản cũ mang số mới: giữ nhầm mãi. Không
     có `nguoi` thì tải song song như cũ, và bản lưu không mang khoá (không dùng lại được). */
  /* Hai số phiên (hàng mig 209 + sổ khách mig 254) — MỘT câu. */
  const phienDuP = docPhienDanhMucDu(sb)
  const phienP = phienDuP.then((p) => p.phien)
  const khoaP: Promise<KhoaSanPham | null> = nguoi
    ? Promise.all([phienP, docNccCuaNguoi(sb, nguoi)]).then(([p, ncc]) =>
        p === null || ncc === null ? null : { phien: p, uid: nguoi.uid, vai: nguoi.vai, ncc }
      )
    : Promise.resolve(null)
  /* Khoá sổ khách (mig 254): số phiên khách + người + vai. Như sản phẩm, câu khách CHỜ số phiên về rồi mới đi. */
  const khoaKhachP: Promise<KhoaKhach | null> = nguoi
    ? phienDuP.then((p) => (p.phienKhach === null ? null : { phien: p.phienKhach, uid: nguoi.uid, vai: nguoi.vai }))
    : Promise.resolve(null)
  const sanPhamP: Promise<AggregateResult<SellProduct> & { nho?: boolean }> = nguoi
    ? Promise.all([khoaP, nhoP]).then(([khoa, nho]) =>
        nho && dungLaiSanPham(nho, khoa)
          ? { rows: nho.products, truncated: false, error: null, total: nho.products.length, nho: true }
          : pageAll<SellProduct>(PROD_COLS, "products", "name")
      )
    : pageAll<SellProduct>(PROD_COLS, "products", "name")
  /* Màn không dùng sổ khách (POS nhập hàng / trả NCC — chủ nhà 23/10/2026) thì không kéo ≈1 MB khách về; biết người thì
     sổ khách dùng lại bản lưu khi khớp khoá (`dungLaiKhach`), không biết thì tải như cũ. */
  const khachP: Promise<AggregateResult<Customer> & { nho?: boolean }> = !canKhach
    ? Promise.resolve(KHONG_TAI_KHACH)
    : nguoi
      ? Promise.all([khoaKhachP, nhoP]).then(([khoa, nho]) =>
          nho && dungLaiKhach(nho, khoa)
            ? { rows: nho.customers, truncated: false, error: null, total: nho.customers.length, nho: true }
            : docKhachBan(pageAll)
        )
      : docKhachBan(pageAll)

  const [custRes, prodRes0, batchRes, phienDu, khoa, khoaKhach] = await Promise.all([
    khachP,
    sanPhamP,
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
    docLoBan(sb),
    /* Số phiên ĐỌC CÙNG LƯỢT với danh mục — lần kiểm sau so với đúng bản đang có. */
    phienDuP,
    khoaP,
    khoaKhachP,
  ])
  const phien = phienDu.phien

  let prodRes = prodRes0

  // ⚠ Lỗi ở đây làm MỌI sản phẩm hiện tồn 0 mà không báo gì.
  if (batchRes.error) {
    warnings.push("Không đọc được tồn kho — số tồn trên màn hình có thể sai.")
  }
  if (prodRes.error) {
    prodRes = await pageAll<SellProduct>("*, price_lists(*), units:product_units(*)", "products", "name")
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
  if (products.length === 0 && (customers.length === 0 || !canKhach)) {
    const c = await fromCache("Kết nối không ổn định", nguoi?.uid)
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
  // Lưu lại để lần sau mất mạng vẫn soạn đơn được. Khoá chỉ đi kèm khi sản phẩm ĐỦ (thiếu một khúc thì lần sau tải lại).
  const khoaGhi = prodRes.error || prodRes.truncated ? null : khoa
  const khoaKhachGhi = custRes.error || custRes.truncated ? null : khoaKhach
  if (canKhach) {
    void cacheOrderRefData({ customers, products, stockByProduct }, khoaGhi, khoaKhachGhi)
  } else {
    /* ⚠ Không tải khách thì KHÔNG đè khách rỗng lên bản lưu — mất mạng mở bán hàng là không còn khách nào. Có bản lưu
       của đúng người thì giữ khách cũ (kèm khoá khách của bản ấy), chỉ làm mới hàng + tồn; không có thì thôi, lần mở
       đơn / hoá đơn sau sẽ ghi. */
    const nho = await nhoP
    if (nho && !cuaNguoiKhac(nho, nguoi?.uid)) {
      void cacheOrderRefData({ customers: nho.customers, products, stockByProduct }, khoaGhi, nho.khach ?? null)
    }
  }
  return {
    customers, products, stockByProduct, source: "server", warnings,
    phien, phienKhach: phienDu.phienKhach, sanPhamNho: !!prodRes0.nho, khachNho: !!custRes.nho,
  }
}
