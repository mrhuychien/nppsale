import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { DashboardShell } from "@/components/layout/dashboard-shell"
import type { Role } from "@/types"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createServerSupabaseClient()

  // getSession() đọc phiên từ cookie — KHÔNG gọi mạng (getUser validate
  // qua Supabase Auth = 1 round-trip chặn toàn bộ khung app mỗi lần tải
  // cứng). Middleware đã gác xác thực; đây chỉ là fallback định tuyến +
  // lấy role dựng sidebar. Dữ liệu vẫn được RLS bảo vệ ở tầng DB.
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.user) {
    redirect("/login")
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle()

  const role: Role = (profile?.role ?? "sales") as Role

  return <DashboardShell role={role}>{children}</DashboardShell>
}
