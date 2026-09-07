import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { isWeeklyDue, vnWeekday, vnDate, MONDAY_VN, VN_OFFSET_MS } from "../src/lib/cron/schedule"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Quét theo dòng — xem ghi chú ở tests/mobile-actions-lines.test.ts. */
const strip = (s: string) => {
  const out: string[] = []
  let inBlock = false
  for (const line of s.split("\n")) {
    const t = line.trim()
    if (inBlock) { if (t.includes("*/")) inBlock = false; continue }
    if (t.startsWith("{/*") || t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; continue }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(line)
  }
  return out.join("\n")
}

type Cron = { path: string; schedule: string }
const CRONS = (JSON.parse(read("vercel.json")) as { crons: Cron[] }).crons

/** Số lần một lịch cron nổ trong một ngày, cho các dạng đang dùng. */
function firesPerDay(schedule: string): number {
  const [min, hour] = schedule.trim().split(/\s+/)
  const count = (f: string, span: number) => {
    if (f === "*") return span
    const step = /^\*\/(\d+)$/.exec(f)
    if (step) return Math.ceil(span / Number(step[1]))
    return f.split(",").length
  }
  return count(min, 60) * count(hour, 24)
}

describe("Lịch chạy phải nằm trong giới hạn gói", () => {
  /**
   * ⚠ ĐÂY LÀ LỖI ĐÃ TRẢ GIÁ THẬT. Commit đầu tiên thêm
   * `"schedule": "0 * * * *"` vào vercel.json cũng đúng là commit đầu
   * tiên Vercel NGỪNG tạo bản deploy — không có commit nào xen giữa. 13
   * commit sau đó không cái nào lên được production, và không hề có bản
   * deploy lỗi nào để nhìn thấy: nó bị từ chối trước khi thành bản deploy.
   *
   * Lúc đó vercel.json mới có ĐÚNG MỘT cron, nên vấn đề không phải số
   * lượng mà là TẦN SUẤT.
   */
  it("không lịch nào chạy quá một lần mỗi ngày", () => {
    for (const c of CRONS) {
      expect(firesPerDay(c.schedule), `${c.path} (${c.schedule}) chạy quá dày`).toBeLessThanOrEqual(1)
    }
  })

  /** Giữ số cron ở mức thấp nhất — mọi việc đi qua một cửa. */
  it("chỉ khai báo MỘT cron", () => {
    expect(CRONS).toHaveLength(1)
    expect(CRONS[0].path).toBe("/api/cron/daily")
  })

  it("hàm đếm nhịp nhận diện đúng các dạng lịch", () => {
    expect(firesPerDay("0 18 * * *")).toBe(1)
    expect(firesPerDay("0 * * * *")).toBe(24)
    expect(firesPerDay("*/5 * * * *")).toBe(12 * 24)
    expect(firesPerDay("0 1 * * 1")).toBe(1)
  })
})

describe("Quy về giờ Việt Nam", () => {
  /**
   * ⚠ Cron của Vercel chạy theo UTC. Lịch 18:00 UTC nổ vào 01:00 sáng
   * HÔM SAU ở Việt Nam — xét thứ trên mốc UTC thì lệch nguyên một ngày so
   * với thứ mà người dùng đang sống.
   */
  it("18:00 UTC Chủ nhật là thứ Hai ở Việt Nam", () => {
    const sundayEvening = Date.parse("2026-09-06T18:00:00Z")
    expect(new Date(sundayEvening).getUTCDay()).toBe(0) // Chủ nhật theo UTC
    expect(vnWeekday(sundayEvening)).toBe(MONDAY_VN)
    expect(isWeeklyDue(sundayEvening, MONDAY_VN)).toBe(true)
  })

  it("18:00 UTC thứ Hai đã sang thứ Ba ở Việt Nam — không chạy nữa", () => {
    const mondayEvening = Date.parse("2026-09-07T18:00:00Z")
    expect(isWeeklyDue(mondayEvening, MONDAY_VN)).toBe(false)
  })

  it("ngày ghi log cũng theo giờ Việt Nam", () => {
    expect(vnDate(Date.parse("2026-09-06T18:00:00Z"))).toBe("2026-09-07")
    expect(vnDate(Date.parse("2026-09-06T16:59:00Z"))).toBe("2026-09-06")
  })

  it("lệch múi giờ đúng 7 tiếng", () => {
    expect(VN_OFFSET_MS).toBe(7 * 3600_000)
  })
})

describe("Cửa chạy lịch chung", () => {
  const D = strip(read("src/app/api/cron/daily/route.ts"))

  /** Route dùng admin client qua các handler con — bí mật là hàng rào duy nhất. */
  it("xác thực bằng CRON_SECRET trước khi làm bất cứ việc gì", () => {
    const i = D.indexOf("async function handle")
    const body = D.slice(i)
    expect(body.indexOf("requireCronSecret(req)")).toBeLessThan(body.indexOf("runJob("))
    expect(D).toContain("if (denied) return denied")
  })

  /**
   * ⚠ Chép lại logic vào cửa chung là tạo bản sao thứ hai để lệch. Gọi
   * thẳng handler của từng route thì gọi tay endpoint riêng vẫn chạy y hệt.
   */
  it("gọi thẳng handler của route gốc, không chép lại", () => {
    expect(D).toContain('from "@/app/api/einvoice/sync/route"')
    expect(D).toContain('from "@/app/api/einvoice/pull-snapshots/route"')
    expect(D).toContain('from "@/app/api/customers/photo-reminders/route"')
    // Không tự dựng client quản trị ở đây — việc đó là của handler con.
    expect(D).not.toContain("createAdminClient")
  })

  /** ⚠ Một việc hỏng không được kéo đổ hai việc còn lại. */
  it("mỗi việc bọc try/catch riêng, hỏng thì ghi lại và đi tiếp", () => {
    const i = D.indexOf("async function runJob")
    const fn = D.slice(i, D.indexOf("async function handle"))
    expect(fn).toContain("try {")
    expect(fn).toContain("catch (e)")
    expect(fn).toContain("ran: false")
    expect(fn).not.toContain("throw")
  })

  /**
   * ⚠ Hobby cắt hàm sớm hơn `maxDuration` khai trong mã. Hết giờ giữa
   * chừng thì việc đứng SAU bị mất — nên việc quan trọng nhất phải đứng
   * trước, việc nặng nhất đứng cuối.
   */
  it("đồng bộ hoá đơn chạy TRƯỚC, kéo snapshot chạy CUỐI", () => {
    const sync = D.indexOf('runJob("einvoice-sync"')
    const photo = D.indexOf('runJob("customer-photo-reminders"')
    const pull = D.indexOf('runJob("einvoice-pull-snapshots"')
    expect(sync).toBeGreaterThan(0)
    expect(sync).toBeLessThan(photo)
    expect(photo).toBeLessThan(pull)
  })

  /** Việc bị bỏ qua phải NÓI RA, không im lặng biến mất khỏi báo cáo. */
  it("việc hằng tuần chưa tới lượt thì báo skipped kèm lý do", () => {
    expect(D).toContain("skipped:")
    expect(D).toContain("chỉ chạy thứ Hai giờ VN")
  })

  it("dùng chung lib quy đổi giờ, không tự tính lại múi giờ", () => {
    expect(D).toContain("isWeeklyDue(now, MONDAY_VN)")
    expect(D).not.toContain("3600_000")
    expect(D).not.toContain("getUTCDay")
  })

  /** Một mốc thời gian cho cả lượt chạy. */
  it("chỉ đọc đồng hồ một lần", () => {
    expect(D.match(/Date\.now\(\)/g)?.length).toBe(1)
  })
})

describe("Các route gốc vẫn gọi tay được", () => {
  /**
   * Gộp lịch KHÔNG được làm mất đường gọi tay: lúc dựng sổ hoặc lúc gỡ
   * lỗi vẫn phải bắn được từng endpoint riêng.
   */
  it("cả ba route vẫn còn và vẫn tự xác thực", () => {
    for (const p of [
      "src/app/api/einvoice/sync/route.ts",
      "src/app/api/einvoice/pull-snapshots/route.ts",
      "src/app/api/customers/photo-reminders/route.ts",
    ]) {
      const src = read(p)
      expect(src, `${p} thiếu handler GET`).toContain("export async function GET")
      expect(src, `${p} không tự kiểm CRON_SECRET`).toContain("requireCronSecret(req)")
    }
  })
})
