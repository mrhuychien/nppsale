import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireCronSecret } from "@/lib/misa/cron-auth"
import { errorMessage } from "@/lib/errors"
import { lapNhacTuyen, noiDungNhacTuyen, type KhachChuaTuyen } from "@/lib/customers/nhac-tuyen"
import { docKhachDangBan, docPhuTrachChinh } from "@/app/(dashboard)/customers/missing-photos/doc-anh"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Nhắc cập nhật tuyến cho khách chưa gán tuyến — chủ nhà 01/10/2026: "Khách hàng nào chưa gán tuyến push noti
 * yêu cầu cập nhật tuyến". Thông báo trong chuông cho NVBH phụ trách chính; khách chưa ai phụ trách → chủ NPP /
 * quản lý. Chạy trong cron chung hằng ngày (`/api/cron/daily`), hạ nhiệt theo `NHAC_TUYEN_SAU_NGAY`.
 *
 * XÁC THỰC BẰNG CRON_SECRET + admin client (bỏ qua RLS) như `photo-reminders` — mọi truy vấn TỰ lọc org_id.
 */
export async function POST(req: Request) { return wrap(req) }
export async function GET(req: Request) { return wrap(req) }

async function wrap(req: Request) {
  try {
    return await handle(req)
  } catch (err) {
    console.error("[/api/customers/route-reminders] fatal:", err)
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 })
  }
}

async function handle(req: Request) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const admin = createAdminClient()
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const report = { orgs: 0, notified: 0, customers_flagged: 0, cooled_down: 0, no_recipient: 0, errors: [] as Array<{ org_id?: string; message: string }> }

  const { data: orgs, error: orgErr } = await admin.from("organizations").select("id")
  if (orgErr) return NextResponse.json({ error: `Lỗi đọc tổ chức: ${orgErr.message}` }, { status: 500 })

  for (const org of (orgs || []) as Array<{ id: string }>) {
    report.orgs++
    try {
      const [custRes, assignRes, qlRes] = await Promise.all([
        docKhachDangBan<{ id: string; store_name: string; channel: string | null; route_reminder_sent_at: string | null }>(
          admin, "id, store_name, channel, route_reminder_sent_at", org.id
        ),
        docPhuTrachChinh(admin, org.id),
        admin.from("users").select("id").eq("org_id", org.id).in("role", ["owner", "manager"]).eq("is_active", true),
      ])
      // Phân công đọc thiếu thì KHÔNG nhắc lượt này — "chưa ai phụ trách" có thể sai, gửi nhầm người.
      if (assignRes.truncated) {
        report.errors.push({ org_id: org.id, message: "Phân công vượt trần đọc — bỏ qua lượt nhắc." })
        continue
      }
      if (qlRes.error) report.errors.push({ org_id: org.id, message: `đọc quản lý lỗi: ${qlRes.error.message}` })
      const ds: KhachChuaTuyen[] = custRes.rows.map((c) => ({
        id: c.id,
        storeName: c.store_name,
        channel: c.channel,
        reminderSentAt: c.route_reminder_sent_at,
        repId: assignRes.repOf.get(c.id) ?? null,
      }))
      const quanLy = ((qlRes.data as Array<{ id: string }> | null) ?? []).map((u) => u.id)
      const plan = lapNhacTuyen(ds, quanLy, now)
      report.cooled_down += plan.hoaNhiet
      report.no_recipient += plan.khongNguoiNhan

      const daNhac = new Set<string>()
      for (const g of plan.theoNguoi) {
        const { title, body } = noiDungNhacTuyen(g.khach)
        const { error: nErr } = await admin.from("notifications").insert({
          org_id: org.id,
          user_id: g.userId,
          type: "customer_route_missing",
          title,
          body,
          link_url: "/customers?tuyen=chua",
          metadata: { customer_ids: g.khach.map((k) => k.id) },
        })
        if (nErr) {
          // Không đóng dấu khi thông báo hỏng — đóng dấu rồi là im thêm mấy ngày vì một tin chưa tới tay ai.
          report.errors.push({ org_id: org.id, message: `ghi thông báo lỗi: ${nErr.message}` })
          continue
        }
        report.notified++
        for (const k of g.khach) daNhac.add(k.id)
      }
      if (daNhac.size) {
        report.customers_flagged += daNhac.size
        // Theo lô 200 mã — một `in(...)` vài nghìn mã là URL quá dài.
        const ids = Array.from(daNhac)
        for (let i = 0; i < ids.length; i += 200) {
          const { error: uErr } = await admin
            .from("customers")
            .update({ route_reminder_sent_at: nowIso })
            .in("id", ids.slice(i, i + 200))
            .eq("org_id", org.id)
          if (uErr) report.errors.push({ org_id: org.id, message: `đóng dấu đã nhắc lỗi: ${uErr.message}` })
        }
      }
    } catch (e) {
      report.errors.push({ org_id: org.id, message: errorMessage(e) })
    }
  }
  return NextResponse.json({ success: true, ...report })
}
