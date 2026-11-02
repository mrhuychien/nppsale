/**
 * CAMERA CỦA BỘ QUÉT MÃ VẠCH — chủ nhà 02/11/2026: "phần tạo sản phẩm mới trên điện thoại mã vạch chưa quét được".
 *
 * Bản cũ để html5-qrcode tự lo camera: xin camera KHÔNG kèm độ phân giải (điện thoại trả 640×480, rồi còn cắt về tỉ lệ
 * 1,5) và giải mã trên ô `qrbox` 280×150 tính bằng điểm ảnh CSS — ảnh thật bị thu nhỏ trước khi đọc. Mã EAN-13 có 95
 * mô-đun; cầm cách 10–15 cm (gần hơn camera không lấy nét được) mã chỉ chiếm ~30% khung → còn ~1 điểm ảnh mỗi mô-đun,
 * không bộ đọc nào đọc nổi. Đo trên Chromium chiếu khung giả 1080×1920: bản cũ 0/3 tình huống đọc được trong 15 giây.
 *
 * Bản này: xin khung 1920×1080 (lý tưởng — máy không có thì trình duyệt lấy gần nhất), bật lấy nét liên tục khi máy cho,
 * và cắt ĐÚNG phần dưới ô ngắm ở độ phân giải GỐC của camera (`vungCat`) rồi mới giải mã.
 */

/** Ô ngắm = phần ảnh đem đi giải mã, theo tỉ lệ khung xem. Khung vẽ trên màn và vùng cắt dùng CÙNG số này. */
export const O_NGAM = { rong: 0.86, cao: 0.42 } as const

/** Cắt rộng hơn thì thu về: 1280 điểm ảnh vẫn ≥ 4 điểm ảnh / mô-đun cho mã chiếm 30% khung; to hơn chỉ làm chậm. */
export const TRAN_RONG_GIAI = 1280

/** Nghỉ giữa hai lần giải mã (ms) — ~8 lần mỗi giây, đủ nhạy mà không nóng máy. */
export const NHIP_QUET_MS = 120

/**
 * Ràng buộc thử LẦN LƯỢT: camera sau + 1920×1080 → camera sau → camera bất kỳ. Chỉ lùi bước khi máy không đáp được ràng
 * buộc; bị từ chối quyền / không có camera thì dừng ngay (thử tiếp chỉ hỏi quyền lần nữa).
 */
export const RANG_BUOC_CAMERA: MediaStreamConstraints[] = [
  { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
  { audio: false, video: { facingMode: { ideal: "environment" } } },
  { audio: false, video: true },
]

const LOI_RANG_BUOC = new Set(["OverconstrainedError", "ConstraintNotSatisfiedError", "TypeError"])

/** Tên lỗi riêng khi trình duyệt không có `getUserMedia` (trang http, trình duyệt cũ). */
export const KHONG_HO_TRO_CAMERA = "KhongHoTroCamera"

type NguonCamera = Pick<MediaDevices, "getUserMedia">

export async function moCamera(md: NguonCamera | undefined = typeof navigator === "undefined" ? undefined : navigator.mediaDevices): Promise<MediaStream> {
  if (!md || typeof md.getUserMedia !== "function") {
    const e = new Error("getUserMedia không có")
    e.name = KHONG_HO_TRO_CAMERA
    throw e
  }
  let loiCuoi: unknown = null
  for (const rb of RANG_BUOC_CAMERA) {
    try {
      return await md.getUserMedia(rb)
    } catch (e) {
      loiCuoi = e
      if (!LOI_RANG_BUOC.has((e as { name?: string } | null)?.name ?? "")) throw e
    }
  }
  throw loiCuoi
}

/** Tắt hẳn camera (đèn camera tắt). Không bao giờ ném. */
export function tatCamera(s: MediaStream | null | undefined) {
  if (!s) return
  for (const t of s.getTracks()) {
    try {
      t.stop()
    } catch {
      /* track đã dừng */
    }
  }
}

/** Bật lấy nét liên tục nếu máy cho (Android Chrome); iPhone tự lấy nét, không có ràng buộc này. Không bao giờ ném. */
export async function batNetLienTuc(s: MediaStream): Promise<boolean> {
  const t = s.getVideoTracks()[0]
  try {
    const cap = (t?.getCapabilities?.() ?? {}) as { focusMode?: string[] }
    if (!cap.focusMode?.includes("continuous")) return false
    await t.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] })
    return true
  } catch {
    return false
  }
}

export interface VungCat {
  sx: number
  sy: number
  sw: number
  sh: number
}

/**
 * Vùng của khung hình camera (điểm ảnh GỐC vw×vh) nằm dưới ô ngắm, khi video vẽ `object-fit: cover` vào khung xem cw×ch.
 * Khung xem chưa đo được (0) → coi khung xem cùng tỉ lệ với khung hình.
 */
export function vungCat(vw: number, vh: number, cw: number, ch: number, o: { rong: number; cao: number } = O_NGAM): VungCat {
  if (!(vw > 0 && vh > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 }
  const coKhung = cw > 0 && ch > 0
  const kw = coKhung ? cw : vw
  const kh = coKhung ? ch : vh
  const tiLe = Math.max(kw / vw, kh / vh) // cover: phóng cho phủ kín, phần thừa bị cắt hai bên
  const sw = Math.min(vw, Math.max(1, Math.round((kw / tiLe) * o.rong)))
  const sh = Math.min(vh, Math.max(1, Math.round((kh / tiLe) * o.cao)))
  return { sx: Math.round((vw - sw) / 2), sy: Math.round((vh - sh) / 2), sw, sh }
}

/** Cỡ ảnh đem giải mã: giữ nguyên độ phân giải gốc, chỉ thu khi rộng quá `tran`. */
export function coAnhGiai(sw: number, sh: number, tran = TRAN_RONG_GIAI): { w: number; h: number } {
  if (sw <= tran) return { w: sw, h: sh }
  return { w: tran, h: Math.max(1, Math.round((sh * tran) / sw)) }
}

/** Câu tiếng Việt cho lỗi mở camera — hiện ngay trên hộp quét (bản cũ lặng lẽ nhảy sang Nhập tay, không nói vì sao). */
export function cauLoiCamera(e: unknown): string {
  const ten = (e as { name?: string } | null)?.name ?? ""
  const thongBao = String((e as { message?: string } | null)?.message ?? (typeof e === "string" ? e : "")).trim()
  switch (ten) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Chưa được phép dùng camera. Cho phép camera cho trang này trong cài đặt trình duyệt (iPhone: Cài đặt → Safari → Camera), rồi bấm Thử lại."
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "Không tìm thấy camera trên máy này — dùng Nhập tay hoặc máy quét USB / Bluetooth."
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "Camera đang bị ứng dụng khác dùng hoặc vừa bị tắt — đóng ứng dụng đó rồi bấm Thử lại."
    case KHONG_HO_TRO_CAMERA:
      return "Trình duyệt này không mở được camera (cần trang https và trình duyệt mới) — dùng Nhập tay."
    case "ChunkLoadError":
      return "Không tải được bộ đọc mã (mạng chập chờn) — bấm Thử lại."
  }
  if (/Loading chunk|dynamically imported module|Importing a module script failed/i.test(thongBao)) {
    return "Không tải được bộ đọc mã (mạng chập chờn) — bấm Thử lại."
  }
  return thongBao ? `Không mở được camera: ${thongBao}` : "Không mở được camera — dùng Nhập tay."
}
