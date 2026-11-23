/**
 * ĐỌC VỊ TRÍ MÁY + ĐỐI CHIẾU VỚI ĐIỂM BÁN — một đường cho mọi chỗ ghi toạ độ: Ghé thăm, Check-in Đi tuyến, nút Định vị
 * của khách (form sửa / tạo, tạo nhanh điện thoại).
 *
 * Chủ nhà 23/11/2026 (ảnh Ghé thăm "Chị Nga 81": check-in 20.916420, 106.341170 — "Cách điểm bán 75.82 km"; ghim Google
 * Maps 20.848420, 106.678727 Lê Chân, "1 giờ 20 phút"): "Kiểm tra tại sao toạ độ vị trí trên google maps và trên app lại
 * lệch nhau?". Ba chỗ hở:
 *   · Toạ độ check-in là chỗ MÁY đang đứng, đọc MỘT lần, không có sai số: lần đọc đầu của điện thoại hay là định vị theo
 *     mạng (lệch vài trăm mét tới vài km), máy tính định vị theo IP (lệch hàng chục km) — màn hiện y như số GPS thật.
 *   · 75,82 km là tới vị trí điểm bán ĐANG LƯU (`customers.gps_lat/gps_lng`), không phải tới ghim Google (ghim ấy chỉ cách
 *     35,9 km) — màn không cho xem vị trí đang lưu ở đâu.
 *   · Nút "Định vị" ở form Sửa khách ghi đè vị trí điểm bán NGAY, không hỏi, không xét sai số (khối Ảnh điểm bán thì có):
 *     bấm ở văn phòng / trên máy tính là điểm bán dời đi chỗ khác mà không ai biết.
 */
import { MAX_PIN_ACCURACY_M, distanceText, haversineMeters, type Fix } from "@/lib/customers/photos"

/** Đạt sai số này thì thôi chờ (GPS ngoài trời thường 5–20 m). */
export const SAI_SO_DU_TOT_M = 30
/** Chờ tối đa — bằng hẹn giờ cũ của `getCurrentPosition`; quá thì lấy lần đọc tốt nhất đã có. */
export const CHO_VI_TRI_MS = 10_000

/** Check-in trong khoảng này = đúng điểm bán. */
export const CHECK_IN_DUNG_M = 100
/** Xa hơn khoảng này (kể cả khi trừ hết sai số) = không ở điểm bán — hỏi trước khi ghi nhận. */
export const CHECK_IN_XA_M = 500
/** Lần đọc sai số lớn hơn mức này không đủ để nói "đúng điểm bán" — cùng ngưỡng ghim vị trí (`MAX_PIN_ACCURACY_M`). */
export const SAI_SO_TOI_DA_M = MAX_PIN_ACCURACY_M

/** Mã lỗi theo `GeolocationPositionError` (1 = chưa cho phép, 2 = không xác định được, 3 = hết giờ); 0 = máy không hỗ trợ. */
export class LoiViTri extends Error {
  constructor(public readonly code: number, message: string) {
    super(message)
    this.name = "LoiViTri"
  }
}

/** Câu tiếng Việt cho lỗi định vị — trình duyệt báo tiếng Anh ("User denied Geolocation", "Timeout expired"…). */
export function cauLoiViTri(err: { code?: number; message?: string } | null | undefined): string {
  switch (err?.code) {
    case 0:
      return "Máy không hỗ trợ định vị."
    case 1:
      return "Chưa cho phép lấy vị trí — mở quyền Vị trí cho trình duyệt (hoặc ứng dụng) rồi thử lại."
    case 2:
      return "Máy chưa xác định được vị trí — bật Vị trí (GPS) của máy rồi thử lại."
    case 3:
      return "Chờ vị trí quá lâu — ra chỗ thoáng rồi thử lại."
    default:
      return err?.message?.trim() || "Không lấy được vị trí."
  }
}

const saiSoCua = (f: Fix): number => (f.accuracy != null && Number.isFinite(f.accuracy) ? f.accuracy : Infinity)

/**
 * Theo dõi vị trí tới khi sai số ≤ `duTotM` hoặc hết `choMs`, trả lần đọc có sai số NHỎ NHẤT. `onDoc` nhận mỗi lần đọc tốt
 * hơn lần trước — màn hiện số đang có trong lúc chờ GPS bắt sóng. Không đọc được lần nào → ném `LoiViTri` (câu tiếng Việt).
 *
 * ⚠ Không dùng `getCurrentPosition`: điện thoại trả NGAY lần đọc đầu, thường là định vị theo mạng (±vài trăm m – vài km)
 *   trong khi GPS chưa bắt sóng — check-in ở đúng cửa hàng vẫn ra "cách điểm bán 1,2 km".
 */
export function docViTriTotNhat(
  geo: Pick<Geolocation, "watchPosition" | "clearWatch"> | null | undefined,
  {
    choMs = CHO_VI_TRI_MS,
    duTotM = SAI_SO_DU_TOT_M,
    onDoc,
    signal,
  }: { choMs?: number; duTotM?: number; onDoc?: (f: Fix) => void; signal?: AbortSignal } = {}
): Promise<Fix> {
  return new Promise<Fix>((resolve, reject) => {
    if (!geo) {
      reject(new LoiViTri(0, cauLoiViTri({ code: 0 })))
      return
    }
    let tot: Fix | null = null
    let xong = false
    let watchId: number | null = null
    let hen: ReturnType<typeof setTimeout> | null = null
    const huy = () => ket(() => reject(new LoiViTri(-1, "Đã huỷ lấy vị trí.")))
    const ket = (lam: () => void) => {
      if (xong) return
      xong = true
      if (watchId != null) geo.clearWatch(watchId)
      if (hen != null) clearTimeout(hen)
      signal?.removeEventListener("abort", huy)
      lam()
    }
    if (signal?.aborted) {
      huy()
      return
    }
    signal?.addEventListener("abort", huy)
    const id = geo.watchPosition(
      (p) => {
        if (xong) return
        const acc = p.coords.accuracy
        const f: Fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(acc) ? acc : null }
        if (tot && saiSoCua(f) >= saiSoCua(tot)) return
        tot = f
        onDoc?.(f)
        if (saiSoCua(f) <= duTotM) ket(() => resolve(f))
      },
      (e) => {
        // Đã có một lần đọc thì lỗi giữa chừng (mất sóng, hết giờ một lượt) không bỏ nó — hết giờ thì trả lần tốt nhất.
        if (!tot) ket(() => reject(new LoiViTri(e.code, cauLoiViTri(e))))
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: choMs }
    )
    // Máy (hoặc bản giả) gọi lại ngay trong `watchPosition` thì `ket` chạy khi chưa có id — tắt theo dõi ở đây.
    if (xong) geo.clearWatch(id)
    else {
      watchId = id
      hen = setTimeout(() => {
        const t = tot
        ket(() => (t ? resolve(t) : reject(new LoiViTri(3, cauLoiViTri({ code: 3 })))))
      }, choMs)
    }
  })
}

/** "±8m" / "±2,5 km"; không có sai số → "". */
export function cauSaiSo(saiSoM: number | null | undefined): string {
  return saiSoM != null && Number.isFinite(saiSoM) ? `±${distanceText(saiSoM)}` : ""
}

/** Toạ độ để đọc + sai số: "20.916420, 106.341170 (±25m)" — 6 chữ số như Google Maps, so được từng số. */
export function toaDoText(f: Fix): string {
  const ss = cauSaiSo(f.accuracy)
  return `${f.lat.toFixed(6)}, ${f.lng.toFixed(6)}${ss ? ` (${ss})` : ""}`
}

/** Mở một điểm trên Google Maps — cùng dạng với các link bản đồ đang có. */
export function linkBanDo(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

/** Sai số lần đọc vượt mức tin được không. */
export function saiSoLon(f: Fix | null | undefined): boolean {
  return f?.accuracy != null && Number.isFinite(f.accuracy) && f.accuracy > SAI_SO_TOI_DA_M
}

/**
 * Sai số từ mức này trở lên = máy chỉ cho vị trí GẦN ĐÚNG, không phải GPS. Chủ nhà 23/11/2026 (cùng một iPhone, cách một phút):
 * *"Vị trí check in chính là toạ độ vị trí hiện tại trên app ấy. Nó đang bị lệch so với vị trí hiện tại trên gmaps"* — Google
 * Maps và trang web xin vị trí qua HAI quyền riêng của iOS; "Trang web Safari" tắt "Vị trí chính xác" thì iOS chỉ đưa cho
 * MỌI trang web một điểm đại diện của cả vùng (Apple chia sẵn vùng, không cộng nhiễu nhỏ — điểm ấy có thể ở thành phố khác),
 * kèm sai số cỡ km. Android tắt "Dùng vị trí chính xác" tương tự (~2 km); máy tính định vị theo mạng (hàng chục km).
 * Không có API web nào cho biết người dùng đang để chính xác hay gần đúng — chỉ đoán qua sai số.
 */
export const SAI_SO_GAN_DUNG_M = 1000

/** Máy / trình duyệt đang mở app — để chỉ đúng chỗ bật "Vị trí chính xác". */
export type MayDung = { ua: string; touch?: number }

export function mayDangDung(): MayDung {
  if (typeof navigator === "undefined") return { ua: "" }
  return { ua: navigator.userAgent || "", touch: navigator.maxTouchPoints || 0 }
}

/** iPhone / iPad (iPad mới báo là Macintosh nhưng có cảm ứng), Android, hay máy tính. */
export function loaiMay({ ua, touch = 0 }: MayDung): "ios" | "android" | "may-tinh" {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return "ios"
  return /Android/.test(ua) ? "android" : "may-tinh"
}

/** Chỗ bật "Vị trí chính xác" theo máy + trình duyệt đang mở app (đọc user agent). */
export function cachBatViTriChinhXac(may: MayDung): string {
  const { ua } = may
  const zalo = /Zalo/i.test(ua)
  const loai = loaiMay(may)
  if (loai === "ios") {
    if (zalo) return "Mở app trong Zalo: Cài đặt → Zalo → Vị trí → bật Vị trí chính xác (hoặc mở app bằng Safari)."
    if (/CriOS/.test(ua)) return "iPhone dùng Chrome: Cài đặt → Chrome → Vị trí → bật Vị trí chính xác."
    return "iPhone: Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Trang web Safari → bật Vị trí chính xác."
  }
  if (loai === "android") {
    const app = zalo ? "Zalo" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : "Chrome"
    return `Android: Cài đặt → Ứng dụng → ${app} → Quyền → Vị trí → bật Dùng vị trí chính xác; bật cả Vị trí (GPS) của máy.`
  }
  return "Máy tính định vị theo mạng nên có thể lệch hàng chục km — check-in bằng điện thoại."
}

/** Câu báo khi lần đọc sai số lớn — nói vì sao và làm gì (gần đúng thì chỉ thẳng chỗ bật theo máy đang dùng). */
export function cauSaiSoLon(saiSoM: number, may: MayDung = { ua: "" }): string {
  const ss = cauSaiSo(saiSoM)
  if (saiSoM < SAI_SO_GAN_DUNG_M) {
    return `Vị trí đọc được chưa chính xác (sai số ${ss}) — ra chỗ thoáng, bật GPS rồi bấm Lấy lại vị trí.`
  }
  if (loaiMay(may) === "may-tinh") return `Vị trí GẦN ĐÚNG (sai số ${ss}). ${cachBatViTriChinhXac(may)}`
  return (
    `Máy chỉ cho vị trí GẦN ĐÚNG (sai số ${ss}) — thường do đang tắt "Vị trí chính xác"; toạ độ ấy có thể nằm ở ` +
    `quận / thành phố khác. ${cachBatViTriChinhXac(may)} Bật xong bấm Lấy lại vị trí.`
  )
}

export type DanhGiaCheckIn =
  | { loai: "chua-luu" }
  | { loai: "dung" | "gan" | "xa" | "chua-ro"; cachM: number; saiSoM: number | null }

/**
 * Đối chiếu chỗ check-in với vị trí điểm bán ĐANG LƯU.
 *   · `xa`: xa hơn `CHECK_IN_XA_M` kể cả khi trừ hết sai số — chắc chắn không ở cửa hàng;
 *   · `chua-ro`: sai số lớn mà chưa chắc xa — không nói được "đúng điểm bán" hay "quá xa";
 *   · `dung` (≤ `CHECK_IN_DUNG_M`) / `gan` (≤ `CHECK_IN_XA_M`): lần đọc đủ tin.
 */
export function danhGiaCheckIn(
  fix: Fix,
  store: { lat: number | null; lng: number | null } | null | undefined
): DanhGiaCheckIn {
  if (!store || store.lat == null || store.lng == null) return { loai: "chua-luu" }
  const cachM = haversineMeters(fix.lat, fix.lng, Number(store.lat), Number(store.lng))
  const saiSoM = fix.accuracy != null && Number.isFinite(fix.accuracy) ? fix.accuracy : null
  if (saiSoLon(fix)) {
    return { loai: cachM - (saiSoM ?? 0) > CHECK_IN_XA_M ? "xa" : "chua-ro", cachM, saiSoM }
  }
  if (cachM <= CHECK_IN_DUNG_M) return { loai: "dung", cachM, saiSoM }
  if (cachM <= CHECK_IN_XA_M) return { loai: "gan", cachM, saiSoM }
  return { loai: "xa", cachM, saiSoM }
}

/** Câu hỏi trước khi ghi nhận lượt ghé (null = không cần hỏi). */
export function cauHoiCheckIn(dg: DanhGiaCheckIn): string | null {
  if (dg.loai === "xa") {
    const ss = cauSaiSo(dg.saiSoM)
    return `Bạn đang cách điểm bán ${distanceText(dg.cachM)}${ss ? ` (vị trí đọc sai số ${ss})` : ""} — vẫn ghi nhận?`
  }
  if (dg.loai === "chua-ro") {
    return (
      `Vị trí đọc được sai số ${cauSaiSo(dg.saiSoM)} nên chưa biết bạn có đang ở điểm bán không ` +
      `(cách vị trí điểm bán đã lưu ${distanceText(dg.cachM)}) — vẫn ghi nhận?`
    )
  }
  return null
}
