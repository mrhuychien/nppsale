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

interface Memo {
  data: SellRefData
  at: number
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
      if (data.source === "server") memo = { data, at: now() }
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
}
