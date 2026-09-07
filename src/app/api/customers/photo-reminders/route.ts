import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireCronSecret } from "@/lib/misa/cron-auth"
import {
  planReminders,
  reminderText,
  REMINDER_COOLDOWN_DAYS,
  type ReminderCandidate,
} from "@/lib/customers/photos"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/** Trần bản ghi nạp mỗi lượt. */
const CAP = 5000

/**
 * Nhắc NVBH cập nhật ảnh / vị trí cho điểm bán còn thiếu.
 *
 * VÌ SAO CẦN: NVBH dựng danh sách điểm bán ở nhà rồi định hôm sau chụp
 * ảnh — và quên. Không có ai nhắc thì danh sách rỗng ảnh nằm đó vài
 * tháng, tới lúc cần tra lại điểm bán thì không có gì để nhìn.
 *
 * XÁC THỰC BẰNG CRON_SECRET, không dùng phiên người dùng: route này chạy
 * theo lịch khi không có ai đăng nhập và dùng admin client (BỎ QUA RLS),
 * nên header bí mật là hàng rào duy nhất.
 *
 * Vì bỏ qua RLS, mọi truy vấn ở đây phải TỰ lọc org_id — không có lưới
 * an toàn nào phía dưới bắt lỗi hộ.
 */
export async function POST(req: Request) { return wrap(req) }
export async function GET(req: Request) { return wrap(req) }

async function wrap(req: Request) {
  try {
    return await handle(req)
  } catch (err) {
    console.error("[/api/customers/photo-reminders] fatal:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

async function handle(req: Request) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const admin = createAdminClient()
  // MỘT mốc thời gian cho cả lượt chạy: gọi Date.now() rải rác thì cửa
  // sổ hạ nhiệt của điểm bán đầu và điểm bán cuối lệch nhau.
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  const report = {
    orgs: 0,
    notified_reps: 0,
    customers_flagged: 0,
    unassigned: 0,
    cooled_down: 0,
    hit_cap: false,
    errors: [] as Array<{ org_id?: string; message: string }>,
  }

  const { data: orgs, error: orgErr } = await admin.from("organizations").select("id")
  if (orgErr) {
    return NextResponse.json({ error: `Lỗi đọc tổ chức: ${orgErr.message}` }, { status: 500 })
  }

  for (const org of (orgs || []) as Array<{ id: string }>) {
    report.orgs++
    try {
      const [custRes, photoRes, assignRes] = await Promise.all([
        admin
          .from("customers")
          .select("id, store_name, gps_lat, gps_lng, photo_reminder_sent_at")
          .eq("org_id", org.id)
          .eq("status", "active")
          .limit(CAP),
        admin.from("customer_photos").select("customer_id").eq("org_id", org.id).limit(CAP),
        admin
          .from("customer_assignments")
          .select("customer_id, user_id, role, status")
          .eq("role", "primary")
          .eq("status", "active")
          .limit(CAP),
      ])
      const qErr = [custRes, photoRes, assignRes].find((r) => r.error)?.error
      if (qErr) {
        report.errors.push({ org_id: org.id, message: qErr.message })
        continue
      }

      const customers = (custRes.data || []) as Array<{
        id: string; store_name: string; gps_lat: number | null; gps_lng: number | null
        photo_reminder_sent_at: string | null
      }>
      if (customers.length >= CAP) report.hit_cap = true

      const counts = new Map<string, number>()
      for (const p of (photoRes.data || []) as Array<{ customer_id: string }>) {
        counts.set(p.customer_id, (counts.get(p.customer_id) ?? 0) + 1)
      }
      const repOf = new Map<string, string>()
      for (const a of (assignRes.data || []) as Array<{ customer_id: string; user_id: string }>) {
        if (!repOf.has(a.customer_id)) repOf.set(a.customer_id, a.user_id)
      }

      const candidates: ReminderCandidate[] = customers.map((c) => ({
        id: c.id,
        storeName: c.store_name,
        photoCount: counts.get(c.id) ?? 0,
        hasGps: c.gps_lat != null && c.gps_lng != null,
        reminderSentAt: c.photo_reminder_sent_at,
        repId: repOf.get(c.id) ?? null,
      }))

      const plan = planReminders(candidates, now, REMINDER_COOLDOWN_DAYS)
      report.cooled_down += plan.cooledDown
      report.unassigned += plan.unassigned.length

      for (const group of plan.byRep) {
        const { title, body } = reminderText(group.customers)
        const { error: nErr } = await admin.from("notifications").insert({
          org_id: org.id,
          user_id: group.repId,
          type: "customer_photo_missing",
          title,
          body,
          link_url: "/customers/missing-photos",
          metadata: { customer_ids: group.customers.map((c) => c.id) },
        })
        if (nErr) {
          report.errors.push({ org_id: org.id, message: `ghi thông báo lỗi: ${nErr.message}` })
          // KHÔNG đóng dấu đã nhắc khi thông báo hỏng: đóng dấu rồi thì
          // điểm bán im lặng thêm 7 ngày nữa vì một thông báo chưa từng
          // tới tay ai.
          continue
        }
        report.notified_reps++
        report.customers_flagged += group.customers.length

        const { error: uErr } = await admin
          .from("customers")
          .update({ photo_reminder_sent_at: nowIso })
          .in("id", group.customers.map((c) => c.id))
          .eq("org_id", org.id)
        if (uErr) report.errors.push({ org_id: org.id, message: `đóng dấu đã nhắc lỗi: ${uErr.message}` })
      }
    } catch (e) {
      report.errors.push({ org_id: org.id, message: (e as Error).message })
    }
  }

  return NextResponse.json({ success: true, ...report })
}
