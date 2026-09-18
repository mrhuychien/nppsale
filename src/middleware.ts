import { updateSession } from "@/lib/supabase/middleware"
import { NextResponse, type NextRequest } from "next/server"
import {
  MAINTENANCE_BYPASS_COOKIE,
  shouldBlockForMaintenance,
} from "@/lib/maintenance"

export async function middleware(request: NextRequest) {
  /**
   * ⚠ CHẶN TRƯỚC KHI GỌI SUPABASE. `updateSession` làm mới phiên đăng
   *   nhập — tức một lượt đi mạng. Trong lúc chạy migration thì đó vừa là
   *   tải thừa, vừa là một chỗ nữa có thể timeout rồi đẩy người dùng về
   *   `/login` thay vì về trang bảo trì.
   *
   * ⚠ REWRITE, KHÔNG REDIRECT. Redirect đổi địa chỉ trên thanh URL; người
   *   dùng bookmark nhầm `/maintenance` rồi sau này mở lại vào đúng trang
   *   đó dù đã mở cửa từ lâu. Rewrite giữ nguyên địa chỉ họ gõ, nên bấm
   *   F5 sau khi xong là vào thẳng chỗ cũ.
   */
  if (
    shouldBlockForMaintenance({
      pathname: request.nextUrl.pathname,
      hasBypassCookie: !!request.cookies.get(MAINTENANCE_BYPASS_COOKIE),
    })
  ) {
    return NextResponse.rewrite(new URL("/maintenance", request.url), {
      status: 503,
      headers: { "Retry-After": "600" },
    })
  }

  return await updateSession(request)
}

export const config = {
  // /api/* routes mỗi route handler đã tự gọi supabase.auth.getUser() —
  // không cần middleware lặp lại. Loại khỏi matcher để bớt 1 RT/api call.
  //
  // ⚠ HỆ QUẢ VỚI CHẾ ĐỘ BẢO TRÌ: các route `/api/*` KHÔNG bị chặn. Chúng
  //   là đường máy-gọi-máy (hoá đơn điện tử, cron hằng ngày), không phải
  //   đường người dùng bấm. Muốn khoá luôn thì tắt cron trên Vercel —
  //   xem `docs/bao-tri.md`.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
