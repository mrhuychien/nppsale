import { NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/misa/cron-auth"
import { isWeeklyDue, MONDAY_VN, vnDate, vnWeekday } from "@/lib/cron/schedule"
import { GET as einvoiceSync } from "@/app/api/einvoice/sync/route"
import { GET as pullSnapshots } from "@/app/api/einvoice/pull-snapshots/route"
import { GET as photoReminders } from "@/app/api/customers/photo-reminders/route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * MỘT cửa duy nhất cho mọi việc chạy theo lịch.
 *
 * VÌ SAO GỘP: gói Hobby không nhận lịch dày hơn một lần mỗi ngày. Đo
 * được: commit đầu tiên thêm `"schedule": "0 * * * *"` vào vercel.json
 * cũng đúng là commit đầu tiên Vercel ngừng tạo bản deploy — không có
 * commit nào xen giữa, và 13 commit sau đó cũng không bản nào. Nên thay
 * vì ba cron ba tần suất, dự án khai báo ĐÚNG MỘT cron hằng ngày và tự
 * phân việc ở đây.
 *
 * KHÔNG chép lại logic: gọi thẳng handler của từng route, nên gọi tay
 * từng endpoint riêng vẫn chạy y hệt và không có bản sao nào để lệch.
 *
 * THỨ TỰ CÓ CHỦ Ý — quan trọng nhất trước. Hobby giới hạn thời gian chạy
 * hàm (thấp hơn `maxDuration` khai ở đây), nên nếu hết giờ giữa chừng thì
 * việc đứng sau bị cắt. Đồng bộ hoá đơn đứng đầu vì nó ảnh hưởng chứng
 * từ thuế; kéo snapshot xếp cuối vì nó nặng nhất và bỏ một ngày không
 * mất gì — lần chạy sau kéo lại đủ.
 */
export async function POST(req: Request) { return handle(req) }
export async function GET(req: Request) { return handle(req) }

type JobResult = {
  job: string
  ran: boolean
  status?: number
  skipped?: string
  error?: string
  body?: unknown
}

async function runJob(
  name: string,
  fn: (req: Request) => Promise<Response>,
  req: Request
): Promise<JobResult> {
  try {
    const res = await fn(req)
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // Handler trả về thứ không phải JSON — không sao, giữ status là đủ.
    }
    return { job: name, ran: true, status: res.status, body }
  } catch (e) {
    // Một việc hỏng KHÔNG được kéo đổ các việc còn lại: cả ba đều độc
    // lập, và mất cả ba vì một cái là tệ hơn hẳn.
    return { job: name, ran: false, error: e instanceof Error ? e.message : "lỗi không xác định" }
  }
}

async function handle(req: Request) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  // Một mốc thời gian cho cả lượt — xem lib/cron/schedule.
  const now = Date.now()
  const jobs: JobResult[] = []

  jobs.push(await runJob("einvoice-sync", einvoiceSync, req))

  if (isWeeklyDue(now, MONDAY_VN)) {
    jobs.push(await runJob("customer-photo-reminders", photoReminders, req))
  } else {
    jobs.push({
      job: "customer-photo-reminders",
      ran: false,
      skipped: `chỉ chạy thứ Hai giờ VN (hôm nay là thứ ${vnWeekday(now)})`,
    })
  }

  jobs.push(await runJob("einvoice-pull-snapshots", pullSnapshots, req))

  return NextResponse.json({
    success: jobs.every((j) => j.ran || !!j.skipped),
    vn_date: vnDate(now),
    jobs,
  })
}
