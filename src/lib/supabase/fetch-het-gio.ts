/**
 * fetch CỦA SUPABASE TRÊN TRÌNH DUYỆT — có hẹn giờ để một câu không treo mãi.
 *
 * Chủ nhà 22/10/2026 (ảnh màn Sản phẩm trên điện thoại): "Không tải được danh sách sản phẩm — AbortError: Fetch is
 * aborted". Không ai bấm huỷ: chính bộ hẹn giờ 10 giây này cắt câu. Bản cũ sai ba chỗ:
 *   1. ĐẾM CẢ LÚC APP NẰM NỀN. Chuyển app / tắt màn hình, iOS treo trang nhưng đồng hồ vẫn chạy; mở lại là quá hạn,
 *      câu đang chờ bị cắt ngay (máy chủ có khi đã trả lời xong). Nay: trang ẩn thì dừng đếm, hiện lại đếm từ đầu.
 *   2. CÂU ĐỌC HẾT GIỜ LÀ HỎNG LUÔN — một lần mạng chập chờn / máy chủ khựng là màn "0 sản phẩm". Nay câu ĐỌC
 *      (GET / HEAD) thử lại MỘT lần. Câu GHI (POST / PATCH / DELETE, RPC) không thử lại: có thể máy chủ đã ghi xong.
 *   3. ĐÈ MẤT `signal` CỦA NƠI GỌI (`.abortSignal()`): huỷ câu cũ không ăn, kết quả cũ về sau đè kết quả mới (ô tìm ở
 *      màn kiểm kê). Nay nơi gọi huỷ là huỷ thật, và không bị thử lại.
 *
 * ⚠ HẾT GIỜ NÉM LỖI TÊN "AbortError", KHÔNG PHẢI "TimeoutError". Thư viện PostgREST tự thử lại câu đọc gặp lỗi mạng tới
 *   3 lần (chờ 1–2–4 giây) — trừ lỗi AbortError. Đã thử lại một lần ở đây; để nó thử thêm là một câu chậm thành tám câu
 *   dồn lên máy chủ đang chậm. Câu chữ thì khác câu huỷ: có `LOI_HET_GIO` — `laHetGio` nhận ra, `errorMessage` dịch.
 */

import { thuLaiKhiGiaoDichHong, type HamFetch } from "@/lib/supabase/thu-lai-giao-dich-hong"

/** Một lượt chờ máy chủ. */
export const HET_GIO_MS = 10_000

/**
 * Hàm báo cáo đọc một lượt (`/rpc/bao_cao_*`, mig 204) trả DÒNG THÔ của cả kỳ — chờ lâu hơn, và KHÔNG gửi lại: chậm ở
 * máy chủ chứ không phải mất gói tin, gửi lại là bắt máy chủ đang bận làm lại từ đầu. Chủ nhà 29/10/2026: "Đọc số bán
 * hàng hỏng: … Máy chủ chưa trả lời sau 10 giây".
 */
export const HET_GIO_BAO_CAO_MS = 45_000

/** Câu gọi hàm báo cáo một lượt (`bao_cao_so_ban`, `bao_cao_cong_no`, `bao_cao_ton_kho`). */
export function laBaoCaoMotLuot(input: RequestInfo | URL): boolean {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url ?? ""
  return /\/rest\/v1\/rpc\/bao_cao_/.test(u)
}

/** Dấu nhận ra lỗi hết giờ trong câu lỗi (thư viện ghép thành "AbortError: <câu này>"). */
export const LOI_HET_GIO = "Máy chủ chưa trả lời"

/** Dặn kèm khi câu GHI hết giờ: máy chủ có thể đã ghi xong — bấm lại ngay là lập trùng (hai đơn, hai phiếu thu). */
export const DAN_CAU_GHI = "thao tác có thể đã được ghi — tải lại trang kiểm tra trước khi làm lại"

export class HetGioError extends Error {
  constructor(soLan: number, ghi = false, ms = HET_GIO_MS) {
    super(
      `${LOI_HET_GIO} sau ${ms / 1000} giây` +
        (soLan > 1 ? ` (đã thử ${soLan} lần)` : "") +
        (ghi ? ` — ${DAN_CAU_GHI}` : "")
    )
    // Tên "AbortError": thư viện PostgREST không tự thử lại thêm (xem đầu tệp).
    this.name = "AbortError"
  }
}

/** Lỗi (hoặc câu lỗi) này là hết giờ chờ máy chủ — KHÁC với nơi gọi tự huỷ. */
export function laHetGio(err: unknown): boolean {
  if (err instanceof HetGioError) return true
  const msg = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message
  return typeof msg === "string" && msg.includes(LOI_HET_GIO)
}

/**
 * Câu cho người dùng khi hết giờ — một câu cho mọi màn (`errorMessage`, `selectResilient`). Bỏ tiền tố "AbortError:"
 * thư viện ghép vào và cả dấu vết ngăn xếp (stack) đi kèm: người dùng cần biết phải làm gì, không cần tên lớp lỗi.
 */
export function cauHetGio(raw?: string | null): string {
  // Bỏ "AbortError:" ở BẤT KỲ chỗ nào — lỗi đã gói ("đọc số bán: AbortError: …", chủ nhà 29/10/2026) có nó ở giữa câu.
  const chiTiet = (raw ?? "").replace(/\bAbortError:\s*/g, "").trim() || `${LOI_HET_GIO} sau ${HET_GIO_MS / 1000} giây`
  return chiTiet.includes(DAN_CAU_GHI)
    ? `Mạng chậm hoặc máy chủ đang bận: ${chiTiet}.`
    : `Mạng chậm hoặc máy chủ đang bận: ${chiTiet}. Kiểm tra mạng rồi thử lại.`
}

const laCauDoc = (init?: RequestInit) => {
  const m = (init?.method ?? "GET").toUpperCase()
  return m === "GET" || m === "HEAD"
}

/** Một lượt fetch có hẹn giờ; trang ẩn thì không đếm. Hết giờ → `het = true` rồi huỷ. */
async function motLuot(input: RequestInfo | URL, init: RequestInit | undefined, ms: number): Promise<{ res?: Response; het: boolean; err?: unknown }> {
  const ngoai = init?.signal ?? null
  const ctl = new AbortController()
  let het = false
  let hen: ReturnType<typeof setTimeout> | undefined
  const coTrang = typeof document !== "undefined"
  const datHen = () => {
    clearTimeout(hen)
    hen = setTimeout(() => {
      het = true
      ctl.abort()
    }, ms)
  }
  const doiTrang = () => {
    if (document.visibilityState === "hidden") clearTimeout(hen)
    else datHen()
  }
  const huyTheoNoiGoi = () => ctl.abort(ngoai?.reason)

  if (ngoai?.aborted) ctl.abort(ngoai.reason)
  else ngoai?.addEventListener("abort", huyTheoNoiGoi, { once: true })
  if (!coTrang || document.visibilityState !== "hidden") datHen()
  if (coTrang) document.addEventListener("visibilitychange", doiTrang)
  try {
    return { res: await fetch(input, { ...init, signal: ctl.signal }), het: false }
  } catch (err) {
    return { het, err }
  } finally {
    clearTimeout(hen)
    ngoai?.removeEventListener("abort", huyTheoNoiGoi)
    if (coTrang) document.removeEventListener("visibilitychange", doiTrang)
  }
}

/** Một câu có hẹn giờ (câu đọc hết giờ thử lại một lần) — chưa gồm luật gửi lại khi giao dịch hỏng. */
async function fetchHetGioMotCau(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Hàm báo cáo một lượt: chờ HET_GIO_BAO_CAO_MS, một lượt duy nhất (xem trên).
  const baoCao = laBaoCaoMotLuot(input)
  const ms = baoCao ? HET_GIO_BAO_CAO_MS : HET_GIO_MS
  const lan1 = await motLuot(input, init, ms)
  if (lan1.res) return lan1.res
  if (!lan1.het) throw lan1.err
  // Hết giờ: câu đọc thử lại một lần (trừ khi nơi gọi đã huỷ trong lúc chờ); câu ghi thì báo luôn.
  if (!laCauDoc(init)) throw new HetGioError(1, true, ms)
  if (baoCao) throw new HetGioError(1, false, ms)
  if (init?.signal?.aborted) throw new HetGioError(1)
  const lan2 = await motLuot(input, init, HET_GIO_MS)
  if (lan2.res) return lan2.res
  if (!lan2.het) throw lan2.err
  throw new HetGioError(2)
}

/**
 * fetch cho `createBrowserClient` (`global.fetch`): hẹn giờ như trên, và câu PostgREST trả 25P02 ("current transaction is
 * aborted…", chủ nhà 29/10/2026 — Báo cáo nhân viên) thì gửi lại — xem `thu-lai-giao-dich-hong.ts`.
 */
export const fetchCoHetGio: HamFetch = thuLaiKhiGiaoDichHong(fetchHetGioMotCau)
