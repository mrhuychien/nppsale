/**
 * NHẮC CẬP NHẬT TUYẾN cho khách chưa gán tuyến — chủ nhà 01/10/2026: "Khách hàng nào chưa gán tuyến push noti
 * yêu cầu cập nhật tuyến".
 *
 * Thông báo (chuông) gửi NVBH phụ trách chính; khách chưa ai phụ trách thì gửi chủ NPP / quản lý. Hạ nhiệt
 * `NHAC_TUYEN_SAU_NGAY` ngày cho từng khách (`customers.route_reminder_sent_at`, mig 221) — chạy mỗi ngày
 * trong cron chung mà không nhắc lặp mỗi sáng.
 */

export const NHAC_TUYEN_SAU_NGAY = 3

export interface KhachChuaTuyen {
  id: string
  storeName: string
  channel: string | null
  reminderSentAt: string | null
  repId: string | null
}

export const chuaCoTuyen = (channel: string | null | undefined) => !String(channel ?? "").trim()

/**
 * Chia khách cần nhắc theo người nhận. `quanLy` = chủ NPP / quản lý nhận phần khách chưa ai phụ trách.
 * `nowMs` truyền vào — một mốc cho cả lượt, test cố định được.
 */
export function lapNhacTuyen(
  ds: readonly KhachChuaTuyen[],
  quanLy: readonly string[],
  nowMs: number,
  sauNgay = NHAC_TUYEN_SAU_NGAY
): { theoNguoi: Array<{ userId: string; khach: KhachChuaTuyen[] }>; hoaNhiet: number; khongNguoiNhan: number } {
  const moc = nowMs - sauNgay * 86_400_000
  const m = new Map<string, KhachChuaTuyen[]>()
  let hoaNhiet = 0
  let khongNguoiNhan = 0
  const them = (uid: string, k: KhachChuaTuyen) => {
    const a = m.get(uid)
    if (a) a.push(k)
    else m.set(uid, [k])
  }
  for (const k of ds) {
    if (!chuaCoTuyen(k.channel)) continue
    if (k.reminderSentAt) {
      const t = Date.parse(k.reminderSentAt)
      // Mốc hỏng = coi như chưa nhắc (thà nhắc thừa còn hơn im lặng mãi).
      if (!Number.isNaN(t) && t > moc) {
        hoaNhiet++
        continue
      }
    }
    if (k.repId) them(k.repId, k)
    else if (quanLy.length) for (const q of quanLy) them(q, k)
    else khongNguoiNhan++
  }
  return { theoNguoi: Array.from(m, ([userId, khach]) => ({ userId, khach })), hoaNhiet, khongNguoiNhan }
}

export function noiDungNhacTuyen(khach: readonly KhachChuaTuyen[]): { title: string; body: string } {
  const n = khach.length
  const ten = khach.slice(0, 3).map((k) => k.storeName).join(", ")
  const them = n > 3 ? ` và ${n - 3} khách nữa` : ""
  return {
    title: `${n} khách hàng chưa gán tuyến`,
    body: `${ten}${them}. Mở khách hàng để cập nhật tuyến bán hàng.`,
  }
}
