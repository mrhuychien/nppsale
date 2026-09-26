import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { trangGoc } from "@/lib/nav/trang-dau"

export default async function Home() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    // Nhân viên về Trang chủ, khối văn phòng về Tổng quan (chủ nhà 26/09/2026).
    const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle()
    redirect(trangGoc(me?.role))
  } else {
    redirect("/login")
  }
}
