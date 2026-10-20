/**
 * Quy tắc cho ảnh điểm bán — thuần, không chạm mạng.
 *
 * Bối cảnh: NVBH dựng danh sách điểm bán ở nhà cho nhanh (chỉ tên, SĐT,
 * địa chỉ), rồi hôm sau đi tuyến mới chụp ảnh và lấy toạ độ. Nghĩa là
 * trạng thái "có khách, chưa có ảnh, chưa có vị trí" là BÌNH THƯỜNG chứ
 * không phải lỗi — nhưng để nó nằm im nhiều tháng thì mới là lỗi.
 */

/** Tối đa 3 ảnh mỗi điểm bán. Trùng với CHECK ở migration 103. */
export const MAX_PHOTOS = 3

/** Kho file ảnh điểm bán (migration 103). */
export const CUSTOMER_PHOTO_BUCKET = "customer-photos"

/** Vai trò được chụp / thay / xoá ảnh và sửa vị trí điểm bán — trùng policy "Manage customer photos" (mig 103). */
export const MANAGE_PHOTO_ROLES: readonly string[] = ["owner", "manager", "sales"]

/** Bao nhiêu ngày mới nhắc lại một điểm bán. */
export const REMINDER_COOLDOWN_DAYS = 7

/**
 * Neo KHỐI ẢNH ĐIỂM BÁN ở chi tiết khách — chủ nhà 20/10/2026: "Màn điểm bán cần cập nhật, khi bấm vào mở để chụp ->
 * mở ra chi tiết khách hàng ở phần chụp ảnh luôn (hiện tại đang phải cuộn chuột xuống mới thấy)".
 */
export const NEO_ANH_DIEM_BAN = "anh-diem-ban"
export const linkAnhDiemBan = (customerId: string) => `/customers/${customerId}#${NEO_ANH_DIEM_BAN}`

/**
 * Ô ảnh trống tiếp theo, hoặc null khi đã đủ 3.
 *
 * Lấp lại ô ĐÃ XOÁ chứ không lấy `max + 1`: xoá ảnh 2 rồi chụp lại phải
 * quay về ô 2, nếu không thì sau vài lần thay ảnh sẽ hết ô trong khi
 * điểm bán mới có 2 tấm.
 */
export function nextFreeSlot(usedSlots: number[]): number | null {
  const used = new Set(usedSlots)
  for (let s = 1; s <= MAX_PHOTOS; s++) {
    if (!used.has(s)) return s
  }
  return null
}

/** Khoảng cách hai điểm, mét (Haversine). */
export function haversineMeters(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Toạ độ đọc từ máy. */
export type Fix = { lat: number; lng: number; accuracy?: number | null }

/**
 * Có nên lấy toạ độ lúc chụp làm toạ độ ĐIỂM BÁN không?
 *
 * "có" chỉ khi điểm bán CHƯA có toạ độ. Đã có toạ độ tốt rồi thì không
 * được đè: NVBH có thể chụp lại tấm ảnh khi đang đứng ở đầu ngõ, hoặc
 * tệ hơn là chụp lại ảnh cũ ở nhà — đè lên là dời điểm bán đi chỗ khác
 * mà không ai biết.
 *
 * Sai số quá lớn cũng không nhận: 500m thì nó chỉ ra cái phường, không
 * chỉ ra cửa hàng.
 */
export const MAX_PIN_ACCURACY_M = 100

export function shouldPinCustomer(
  current: { lat: number | null; lng: number | null },
  fix: Fix | null
): { pin: boolean; reason: string } {
  if (!fix) return { pin: false, reason: "không lấy được vị trí" }
  if (current.lat != null && current.lng != null) {
    return { pin: false, reason: "điểm bán đã có toạ độ" }
  }
  if (fix.accuracy != null && fix.accuracy > MAX_PIN_ACCURACY_M) {
    return { pin: false, reason: `sai số ${Math.round(fix.accuracy)}m — quá lớn để ghim` }
  }
  return { pin: true, reason: "điểm bán chưa có toạ độ" }
}

/**
 * Ảnh chụp ở XA điểm bán đã ghim thì đáng ngờ.
 *
 * KHÔNG chặn: có cửa hàng nằm sâu trong chợ, GPS lệch cả trăm mét là
 * chuyện thường, và chặn thì NVBH không nộp được ảnh. Chỉ cảnh báo và
 * ghi lại toạ độ thật để người quản lý tự nhìn.
 */
export const FAR_WARN_METERS = 300

export function farFromStore(
  store: { lat: number | null; lng: number | null },
  fix: Fix | null
): number | null {
  if (!fix || store.lat == null || store.lng == null) return null
  const d = haversineMeters(fix.lat, fix.lng, store.lat, store.lng)
  return d > FAR_WARN_METERS ? Math.round(d) : null
}

/*
 * SỬA / CẬP NHẬT LẠI / XOÁ ảnh + vị trí — chủ nhà 12/10/2026: "phần cập nhật ảnh kèm định vị cho điểm bán. chưa
 * sửa, cập nhật lại, xoá ảnh + vị trí cũ". Trước đó chỉ chụp thêm và xoá được dòng ảnh: toạ độ điểm bán ghim sai
 * (vd tạo khách ở nhà rồi bấm "Lấy vị trí") thì không cách nào dời / bỏ, và file ảnh đã xoá vẫn nằm trong kho.
 */

/**
 * Người dùng BẤM "Cập nhật theo chỗ đang đứng" — được đè toạ độ cũ (khác `shouldPinCustomer`, luật tự ghim lúc
 * chụp, chỉ ghim khi CHƯA có). Sai số quá lớn vẫn không nhận, cùng ngưỡng `MAX_PIN_ACCURACY_M`.
 * `movedMeters`: cách vị trí cũ bao xa — hộp xác nhận nói ra; null = trước đó chưa có toạ độ.
 */
export function canRepinStore(
  current: { lat: number | null; lng: number | null },
  fix: Fix | null
): { ok: boolean; reason: string; movedMeters: number | null } {
  if (!fix) return { ok: false, reason: "Chưa lấy được vị trí của máy", movedMeters: null }
  if (fix.accuracy != null && fix.accuracy > MAX_PIN_ACCURACY_M) {
    return {
      ok: false,
      reason: `Sai số ±${Math.round(fix.accuracy)}m — quá lớn để ghim (tối đa ${MAX_PIN_ACCURACY_M}m). Ra chỗ thoáng rồi thử lại.`,
      movedMeters: null,
    }
  }
  const movedMeters =
    current.lat != null && current.lng != null
      ? Math.round(haversineMeters(current.lat, current.lng, fix.lat, fix.lng))
      : null
  return { ok: true, reason: "", movedMeters }
}

/** Khoảng cách để đọc: 850 → "850m", 12345 → "12,3 km". */
export function distanceText(meters: number): string {
  const m = Math.round(meters)
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`
}

/** Câu hỏi trước khi ghim / dời vị trí điểm bán: toạ độ mới, sai số, và dời bao xa so với vị trí cũ. */
export function repinQuestion(fix: Fix, movedMeters: number | null): string {
  const acc = fix.accuracy != null ? ` (±${Math.round(fix.accuracy)}m)` : ""
  const where = `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}${acc}`
  return movedMeters != null
    ? `Dời điểm bán về chỗ bạn đang đứng: ${where} — cách vị trí cũ khoảng ${distanceText(movedMeters)}.`
    : `Ghim điểm bán vào chỗ bạn đang đứng: ${where}.`
}

/** Lệch tới mức này vẫn coi là CÙNG một toạ độ (số đọc lại qua JSON / numeric có thể lệch ở chữ số cuối). */
export const SAME_SPOT_METERS = 1

/**
 * Vị trí điểm bán có được ghim TỪ ảnh này không — tấm ảnh đầu tiên ghim điểm bán bằng chính toạ độ lúc chụp
 * (`shouldPinCustomer`). Ảnh với vị trí là một cặp: chụp lại tấm này thì vị trí đi theo ảnh mới, xoá tấm này thì
 * hỏi xoá luôn vị trí.
 */
export function isStorePinFromPhoto(
  store: { lat: number | null; lng: number | null },
  photo: { gps_lat: number | null; gps_lng: number | null }
): boolean {
  if (store.lat == null || store.lng == null || photo.gps_lat == null || photo.gps_lng == null) return false
  return haversineMeters(Number(store.lat), Number(store.lng), Number(photo.gps_lat), Number(photo.gps_lng)) <= SAME_SPOT_METERS
}

/**
 * Đường dẫn TRONG KHO của một URL ảnh công khai — để xoá file khi xoá / thay ảnh:
 *   `…/storage/v1/object/public/customer-photos/<org>/<khách>/<ô>-<ms>.jpg` → `<org>/<khách>/<ô>-<ms>.jpg`.
 * URL không đúng khuôn (kho khác, có `..`) → null: không đoán, không xoá nhầm.
 */
export function photoStoragePath(url: string | null | undefined): string | null {
  if (!url) return null
  const mark = `/storage/v1/object/public/${CUSTOMER_PHOTO_BUCKET}/`
  const i = url.indexOf(mark)
  if (i < 0) return null
  let path = url.slice(i + mark.length).split(/[?#]/)[0]
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  return path && !path.includes("..") && !path.startsWith("/") ? path : null
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const ORG_PHOTO_PATH = new RegExp(`^(${UUID})/(${UUID})/[\\w-]+\\.jpg$`, "i")

/**
 * File ảnh điểm bán của ĐÚNG đơn vị — khuôn app tải lên: `<org>/<khách>/<ô>-<ms>.jpg`. Máy chủ chỉ xoá file khớp
 * khuôn này (chặn `..`, thư mục lạ, file của đơn vị khác). Trả mã khách để tra xem file còn được dùng không.
 */
export function parseOrgPhotoPath(path: string, orgId: string): { customerId: string } | null {
  const m = ORG_PHOTO_PATH.exec(path)
  if (!m || m[1].toLowerCase() !== orgId.toLowerCase()) return null
  return { customerId: m[2] }
}

/** Một điểm bán, rút gọn cho việc tính nhắc nhở. */
export type ReminderCandidate = {
  id: string
  storeName: string
  photoCount: number
  hasGps: boolean
  /** Lần nhắc gần nhất, ISO. null = chưa nhắc bao giờ. */
  reminderSentAt: string | null
  /** NVBH phụ trách chính. null = chưa ai phụ trách. */
  repId: string | null
}

export type ReminderPlan = {
  /** Nhóm theo NVBH: mỗi người một thông báo gộp. */
  byRep: Array<{ repId: string; customers: ReminderCandidate[] }>
  /** Điểm bán thiếu ảnh nhưng KHÔNG có ai phụ trách — nhắc ai bây giờ? */
  unassigned: ReminderCandidate[]
  /** Đã nhắc gần đây, lần này bỏ qua. */
  cooledDown: number
}

/**
 * Chọn điểm bán cần nhắc.
 *
 * Gộp theo NVBH thay vì mỗi điểm bán một thông báo: một người phụ trách
 * 80 điểm bán mới sẽ nhận 80 thông báo và tắt luôn chuông. Một thông báo
 * "12 điểm bán chưa có ảnh" thì đọc được.
 *
 * `nowMs` truyền vào chứ không gọi Date.now() bên trong — để test cố
 * định được thời gian, và để một lượt chạy dùng chung một mốc.
 */
export function planReminders(
  candidates: ReminderCandidate[],
  nowMs: number,
  cooldownDays: number = REMINDER_COOLDOWN_DAYS
): ReminderPlan {
  const cutoff = nowMs - cooldownDays * 86_400_000
  const byRep = new Map<string, ReminderCandidate[]>()
  const unassigned: ReminderCandidate[] = []
  let cooledDown = 0

  for (const c of candidates) {
    // Cần nhắc khi THIẾU ẢNH **hoặc** THIẾU TOẠ ĐỘ. Có đủ cả hai thì
    // thôi — kể cả mới 1 ảnh: ép cho đủ 3 tấm là phiền người ta vì một
    // con số, còn 1 tấm kèm vị trí đã dùng được.
    //
    // Viết một điều kiện, không hai: `photoCount >= MAX && hasGps` là
    // trường hợp con của `photoCount > 0 && hasGps`, thêm vào chỉ là một
    // dòng không bao giờ quyết định được gì.
    if (c.photoCount > 0 && c.hasGps) continue

    if (c.reminderSentAt) {
      const t = Date.parse(c.reminderSentAt)
      // Mốc hỏng (chuỗi rác) thì coi như CHƯA nhắc — thà nhắc thừa một
      // lần còn hơn im lặng vĩnh viễn vì một ô dữ liệu lỗi.
      if (!Number.isNaN(t) && t > cutoff) {
        cooledDown++
        continue
      }
    }

    if (!c.repId) {
      unassigned.push(c)
      continue
    }
    const arr = byRep.get(c.repId)
    if (arr) arr.push(c)
    else byRep.set(c.repId, [c])
  }

  return {
    byRep: Array.from(byRep.entries()).map(([repId, customers]) => ({ repId, customers })),
    unassigned,
    cooledDown,
  }
}

/** Nội dung thông báo gộp cho một NVBH. */
export function reminderText(customers: ReminderCandidate[]): { title: string; body: string } {
  const n = customers.length
  const names = customers.slice(0, 3).map((c) => c.storeName).join(", ")
  const more = n > 3 ? ` và ${n - 3} điểm nữa` : ""
  return {
    title: `${n} điểm bán chưa có ảnh / vị trí`,
    body: `${names}${more}. Mở app khi tới nơi để chụp — vị trí lấy tự động.`,
  }
}
