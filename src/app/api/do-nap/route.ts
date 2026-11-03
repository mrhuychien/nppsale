import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Nhận bản tóm tắt thời gian nạp màn POS (`baoNapPos`) và ghi vào nhật ký Vercel — chủ nhà 03/11/2026: "…load đơn vào pos
 * vẫn có hiện tượng chậm hoặc báo lỗi quá 10s". Chỉ người ĐÃ ĐĂNG NHẬP; thân tin cắt ở 4 KB; chỉ ghi, không đọc / ghi sổ.
 * Tra: nhật ký runtime, tìm "[pos-nap]".
 */
export async function POST(req: Request) {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return new NextResponse(null, { status: 401 })
  const text = (await req.text()).slice(0, 4000)
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return new NextResponse(null, { status: 400 })
  // `user` đặt SAU: thân gửi lên có khoá "user" cũng không ghi đè được người đăng nhập thật.
  console.warn("[pos-nap]", JSON.stringify({ ...(payload as Record<string, unknown>), user: data.user.id }))
  return new NextResponse(null, { status: 204 })
}
