/**
 * LỖI PHÍA TRÌNH DUYỆT — nhận diện, tự tải lại, báo về máy chủ.
 *
 * ⚠ CHỦ NHÀ 26/09/2026 gửi ảnh /dashboard trắng trơn "Application error: a client-side
 *   exception has occurred". Lỗi ném ở KHUNG APP (header, chuông, menu) nằm ngoài
 *   `(dashboard)/error.tsx`, nên Next hiện màn trắng mặc định: không chữ nào nói lỗi gì, và
 *   lỗi trình duyệt không vào log của Vercel. Từ nay màn lỗi hiện đúng câu lỗi, và gửi nó về
 *   `/api/client-error` (log Vercel) để tra được nguyên nhân thật.
 */

/** Lỗi tải mã (bản cũ còn mở trong tab sau khi phát hành bản mới / rớt mạng giữa chừng). */
export function laLoiTaiMa(e: unknown): boolean {
  const ten = (e as { name?: string } | null)?.name ?? ""
  const msg = String((e as { message?: string } | null)?.message ?? e ?? "")
  return (
    ten === "ChunkLoadError" ||
    /Loading (CSS )?chunk [\w-]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  )
}

const KHOA_TAI_LAI = "npp:tai-lai-loi-ma"
/** Không tải lại quá một lần mỗi 30 giây — tránh vòng lặp tải lại khi lỗi không phải do bản cũ. */
export const CACH_TAI_LAI_MS = 30_000

/** Được tự tải lại không (lần trước cách đủ xa). */
export function duocTuTaiLai(bayGio: number, lanTruoc: number | null): boolean {
  return lanTruoc === null || !Number.isFinite(lanTruoc) || bayGio - lanTruoc > CACH_TAI_LAI_MS
}

/** Lỗi tải mã thì tải lại trang MỘT lần (ghi mốc vào sessionStorage). Trả true nếu đã tải lại. */
export function taiLaiNeuLoiTaiMa(e: unknown): boolean {
  if (typeof window === "undefined" || !laLoiTaiMa(e)) return false
  let lanTruoc: number | null = null
  try {
    const v = window.sessionStorage.getItem(KHOA_TAI_LAI)
    lanTruoc = v ? Number(v) : null
  } catch { /* chế độ riêng tư: vẫn tải lại một lần */ }
  const bayGio = Date.now()
  if (!duocTuTaiLai(bayGio, lanTruoc)) return false
  try { window.sessionStorage.setItem(KHOA_TAI_LAI, String(bayGio)) } catch { /* bỏ qua */ }
  window.location.reload()
  return true
}

/** Gói báo lỗi gửi về máy chủ — cắt ngắn, không kèm dữ liệu người dùng ngoài đường dẫn. */
export function goiBaoLoi(e: unknown, noi: string, duongDan: string) {
  const err = e as { name?: string; message?: string; stack?: string; digest?: string } | null
  return {
    noi,
    duongDan: duongDan.slice(0, 300),
    ten: String(err?.name ?? "Error").slice(0, 100),
    thongBao: String(err?.message ?? e ?? "").slice(0, 1000),
    stack: String(err?.stack ?? "").slice(0, 3000),
    digest: err?.digest ? String(err.digest).slice(0, 100) : null,
    trinhDuyet: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : "",
  }
}

/** Gửi lỗi về `/api/client-error` (không chặn, không ném). */
export function baoLoiVeMayChu(e: unknown, noi: string) {
  if (typeof window === "undefined") return
  try {
    const body = JSON.stringify(goiBaoLoi(e, noi, window.location.pathname + window.location.search))
    const ok = typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon("/api/client-error", new Blob([body], { type: "application/json" }))
    if (!ok) void fetch("/api/client-error", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {})
  } catch { /* báo lỗi không được thì thôi — đừng ném thêm lỗi */ }
}
