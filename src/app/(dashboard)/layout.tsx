import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/layout/dashboard-shell"
import { NapHoSo } from "@/hooks/use-auth"
import { layHoSoMayChu } from "@/lib/auth/ho-so-may-chu"
import type { Role } from "@/types"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // getSession() đọc phiên từ cookie — KHÔNG gọi mạng (getUser validate
  // qua Supabase Auth = 1 round-trip chặn toàn bộ khung app mỗi lần tải
  // cứng). Middleware đã gác xác thực; đây chỉ là fallback định tuyến +
  // lấy role dựng sidebar. Dữ liệu vẫn được RLS bảo vệ ở tầng DB.
  const phien = await layHoSoMayChu()

  if (!phien) {
    redirect("/login")
  }

  const role: Role = (phien.hoSo?.role ?? "sales") as Role

  /* Hồ sơ đọc ở đây gửi kèm trang (`NapHoSo`) — trình duyệt khỏi hỏi lại `users` trước khi trang hỏi dữ
     liệu của nó (chủ nhà 23/10/2026: "load trang chậm lắm"). */
  return (
    <>
      <NapHoSo hoSo={phien.hoSo} />
      <DashboardShell role={role}>{children}</DashboardShell>
    </>
  )
}
