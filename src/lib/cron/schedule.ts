/**
 * Quy tắc "hôm nay có chạy việc này không" — thuần, có test.
 *
 * VÌ SAO CẦN: gói Hobby của Vercel không nhận lịch dày hơn một lần mỗi
 * ngày (đo được: commit đầu tiên thêm cron `0 * * * *` là commit đầu tiên
 * Vercel ngừng deploy, không có commit nào xen giữa). Nên thay vì nhiều
 * cron với nhiều tần suất, dự án có ĐÚNG MỘT cron chạy hằng ngày, và
 * việc nào chỉ cần chạy hằng tuần thì tự kiểm ngày ở đây.
 */

/** Việt Nam là UTC+7, không có giờ mùa hè nên hằng số này an toàn. */
export const VN_OFFSET_MS = 7 * 3600_000

/** Thứ trong tuần theo GIỜ VIỆT NAM. 0 = Chủ nhật … 1 = Thứ Hai. */
export function vnWeekday(nowMs: number): number {
  return new Date(nowMs + VN_OFFSET_MS).getUTCDay()
}

/** Ngày YYYY-MM-DD theo giờ Việt Nam — để ghi log cho người đọc. */
export function vnDate(nowMs: number): string {
  return new Date(nowMs + VN_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Việc hằng tuần có tới lượt chưa?
 *
 * Phải quy về giờ VIỆT NAM rồi mới xét thứ. Cron của Vercel chạy theo UTC:
 * lịch `0 18 * * *` nổ lúc 18:00 UTC, tức 01:00 sáng HÔM SAU ở Việt Nam.
 * Xét thứ trên mốc UTC thì "thứ Hai" của hệ thống lệch một ngày so với
 * thứ Hai mà người dùng đang sống.
 */
export function isWeeklyDue(nowMs: number, weekdayVn: number): boolean {
  return vnWeekday(nowMs) === weekdayVn
}

/** Thứ Hai — mốc nhắc việc đầu tuần. */
export const MONDAY_VN = 1
