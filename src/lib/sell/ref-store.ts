import type { SellRefData } from "@/lib/sell/ref-data"

/**
 * Bộ nhớ danh mục DÙNG CHUNG cho cả phiên — sống qua việc rời và quay lại
 * luồng bán hàng.
 *
 * VÌ SAO CẦN
 *   `SellDataProvider` nằm ở layout của `/sell/*`. Người dùng đi
 *   /sell → /orders → /sell là provider ĐÓNG rồi MỞ LẠI, và bản đầu tải
 *   lại từ đầu 1.700 sản phẩm + bảng giá + đơn vị + khách + lô — mỗi lần
 *   quay lại là vài giây nhìn khung xương, trên 3G ở quầy khách. App gốc
 *   không làm vậy: danh sách đã có thì HIỆN NGAY, làm mới ngầm.
 *
 * CÁCH LÀM — hiện-cũ-tải-mới (stale-while-revalidate)
 *   · Có bản trong RAM → dùng ngay, không chờ. Cũ hơn `FRESH_MS` thì tải
 *     lại NGẦM và thay khi về — người dùng không thấy khung xương lần hai.
 *   · Chưa có RAM (mở app lần đầu trong phiên) → thử IndexedDB: bản lưu
 *     lần trước cũng hiện ngay, rồi tải mới ngầm.
 *   · Không có gì → tải, và lúc này mới hiện khung xương.
 *
 * ⚠ TỒN KHO PHẢI MỚI. Bản cũ hiện ra để người dùng bắt đầu gõ ngay; nhưng
 * chốt vượt-tồn xét trên số tồn, nên bản mới PHẢI thay vào ngay khi về —
 * không "để lần sau". `FRESH_MS` ngắn là vì thế.
 *
 * ⚠ Hai màn cùng gọi tải một lúc (layout vừa mount, người dùng bấm "Tải
 * lại") thì chỉ MỘT request đi — gộp qua `inflight`.
 */
export const FRESH_MS = 2 * 60_000

/**
 * ⚠ DANH MỤC SỐNG LÂU HƠN TỒN KHO (tối ưu /sell di động, 25/09/2026). Đo trên máy
 *   giả lập: mỗi lần tải lại đủ là ~180 KB nén (sản phẩm + giá + khách + lô) và
 *   hàng MB JSON phải parse — mà thứ đổi theo phút chỉ là TỒN KHO (~23 KB). Nên:
 *   quá `FRESH_MS` → chỉ làm mới tồn; quá `CATALOG_FRESH_MS` → mới tải lại đủ.
 *   Bấm "Tải lại danh mục" vẫn tải đủ ngay.
 */
export const CATALOG_FRESH_MS = 30 * 60_000

interface Memo {
  data: SellRefData
  /** Lúc TỒN KHO được đọc. */
  at: number
  /** Lúc DANH MỤC (sản phẩm / giá / khách) được đọc. */
  catalogAt: number
  /** Số phiên danh mục của bản này (mig 209). */
  phien: number | null
}

let memo: Memo | null = null
let inflight: Promise<SellRefData> | null = null

export function peekSellRefData(): SellRefData | null {
  return memo?.data ?? null
}

export function sellRefDataAge(now = Date.now()): number | null {
  return memo ? now - memo.at : null
}

export function isSellRefDataFresh(now = Date.now()): boolean {
  return memo !== null && now - memo.at < FRESH_MS
}

/** Danh mục còn dùng được — chỉ cần làm mới tồn kho. */
export function isSellCatalogFresh(now = Date.now()): boolean {
  return memo !== null && now - memo.catalogAt < CATALOG_FRESH_MS
}

const KHOA_CU = "sell-danh-muc-cu"

/**
 * Khách vừa được tạo / sửa (chủ nhà 27/09/2026) → danh mục bán hàng trên máy đã CŨ: lần mở /sell
 * sau tải lại đủ, không đợi hết `CATALOG_FRESH_MS`. Ghi cả RAM lẫn mốc trên máy (bản IndexedDB).
 */
export function lamCuDanhMucBan(now = Date.now()): void {
  if (memo) memo = { ...memo, catalogAt: 0 }
  try {
    localStorage.setItem(KHOA_CU, String(now))
  } catch {
    /* không có bộ nhớ trình duyệt — RAM đã đánh dấu là đủ cho phiên này */
  }
}

function mocCu(): number {
  try {
    return Number(localStorage.getItem(KHOA_CU)) || 0
  } catch {
    return 0
  }
}

/** Bản lưu trên máy (IndexedDB) còn đủ mới để khỏi tải lại danh mục. */
export function isCachedCatalogFresh(cachedAt: string | number | null | undefined, now = Date.now()): boolean {
  const t = typeof cachedAt === "number" ? cachedAt : cachedAt ? Date.parse(cachedAt) : NaN
  return Number.isFinite(t) && now - t >= 0 && now - t < CATALOG_FRESH_MS && t > mocCu()
}

/** Thêm một khách vừa đọc riêng (khách mới tạo sau lần tải danh mục) vào bản trong RAM. */
export function addSellCustomer(c: SellRefData["customers"][number]): void {
  if (!memo || memo.data.customers.some((x) => x.id === c.id)) return
  memo = { ...memo, data: { ...memo.data, customers: [...memo.data.customers, c] } }
}

/**
 * Thêm một sản phẩm vừa tạo nhanh ở /sell (chủ nhà 03/10/2026, Update 3.10) vào bản trong RAM — rời màn rồi
 * quay lại vẫn thấy, không đợi tải lại danh mục.
 */
export function addSellProduct(p: SellRefData["products"][number]): void {
  if (!memo || memo.data.products.some((x) => x.id === p.id)) return
  memo = { ...memo, data: { ...memo.data, products: [...memo.data.products, p] } }
}

/** Ghi bản danh mục đọc từ máy (IndexedDB) làm gốc, để làm mới TỒN KHO trên nó. */
export function seedSellRefData(data: SellRefData, catalogAt: number): void {
  if (!memo) memo = { data, at: 0, catalogAt, phien: phienTrenMay() }
}

/* Số phiên của bản lưu trên máy (IndexedDB không giữ trường này) — ghi cạnh nó ở localStorage. */
const KHOA_PHIEN = "sell-phien-danh-muc"
function phienTrenMay(): number | null {
  try {
    const n = Number(localStorage.getItem(KHOA_PHIEN))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}
function ghiPhienTrenMay(p: number | null | undefined) {
  try {
    if (typeof p === "number") localStorage.setItem(KHOA_PHIEN, String(p))
  } catch {
    /* bỏ qua */
  }
}

/** Lúc danh mục đang dùng được đọc (ms) — hiện "Cập nhật HH:mm" cạnh nút làm mới. */
export function sellCatalogAt(): number | null {
  return memo && memo.catalogAt > 0 ? memo.catalogAt : null
}

let inflightPhien: Promise<boolean | null> | null = null
/**
 * ⚠ SẢN PHẨM / GIÁ VỪA ĐỔI? (chủ nhà 28/09/2026, mig 209). Hỏi số phiên (một dòng) và so với bản
 *   đang dùng: `true` = đã đổi → tải lại danh mục; `false` = chưa đổi; `null` = không biết (sổ
 *   chưa chạy 209, mất mạng, bản đang dùng không có số) → giữ luật `CATALOG_FRESH_MS` cũ.
 */
export function kiemPhienDanhMucShared(loader: () => Promise<number | null>): Promise<boolean | null> {
  if (inflightPhien) return inflightPhien
  inflightPhien = loader()
    .then((p) => {
      if (p === null || !memo || memo.phien === null) return null
      return p !== memo.phien
    })
    .finally(() => {
      inflightPhien = null
    })
  return inflightPhien
}

let inflightStock: Promise<Record<string, number> | null> | null = null

/**
 * Chỉ làm mới TỒN KHO trên danh mục đang có. Trả `null` khi đọc hỏng — bản đang
 * hiện giữ nguyên (không thay bằng tồn 0).
 */
export function refreshSellStockShared(
  loader: () => Promise<Record<string, number> | null>,
  now: () => number = Date.now
): Promise<Record<string, number> | null> {
  if (inflightStock) return inflightStock
  inflightStock = loader()
    .then((stock) => {
      if (stock && memo) memo = { ...memo, data: { ...memo.data, stockByProduct: stock }, at: now() }
      return stock
    })
    .finally(() => {
      inflightStock = null
    })
  return inflightStock
}

/**
 * Tải danh mục qua `loader`, ghi vào RAM. Gọi trùng lúc đang tải thì chờ
 * chung một request.
 *
 * ⚠ Chỉ GHI ĐÈ RAM khi kết quả đến từ MÁY CHỦ. Bản rỗng hay bản lấy từ
 * cache ngoại tuyến không được thay một bản RAM đang tốt — đó là "gán null
 * vào cột đang có giá trị tốt" ở dạng khác.
 */
export function loadSellRefDataShared(
  loader: () => Promise<SellRefData>,
  now: () => number = Date.now
): Promise<SellRefData> {
  if (inflight) return inflight
  inflight = loader()
    .then((data) => {
      if (data.source === "server") {
        memo = { data, at: now(), catalogAt: now(), phien: data.phien ?? null }
        ghiPhienTrenMay(data.phien)
      }
      return data
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Cho kiểm thử, và cho lúc đăng xuất — danh mục của người khác không được ở lại. */
export function resetSellRefData(): void {
  memo = null
  inflight = null
  inflightStock = null
  inflightPhien = null
}
