import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Nhận lỗi phía trình duyệt (`baoLoiVeMayChu`) và ghi vào log Vercel — lỗi ở điện thoại của
 * người dùng vốn không để lại dấu vết nào ở máy chủ (chủ nhà 26/09/2026, /dashboard trắng).
 * Chỉ nhận từ người ĐÃ ĐĂNG NHẬP; thân tin cắt ở 8 KB.
 */
export async function POST(req: Request) {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return new NextResponse(null, { status: 401 })
  const text = (await req.text()).slice(0, 8000)
  let payload: unknown = text
  try { payload = JSON.parse(text) } catch { /* giữ nguyên chữ */ }
  console.error("[client-error]", JSON.stringify({ user: data.user.id, ...(typeof payload === "object" && payload ? payload : { raw: payload }) }))
  return new NextResponse(null, { status: 204 })
}
