import { updateSession } from "@/lib/supabase/middleware"
import { NextResponse, type NextRequest } from "next/server"
import {
  MAINTENANCE_BYPASS_COOKIE,
  shouldBlockForMaintenance,
} from "@/lib/maintenance"
import { COOKIE_KHO, dichPosMayChu } from "@/lib/nav/kho-man"

export async function middleware(request: NextRequest) {
  // Trang thông tin tĩnh công khai; không đọc phiên hoặc dữ liệu Supabase.
  if (["/backup", "/backup/privacy", "/backup/terms"].includes(request.nextUrl.pathname)) {
    return NextResponse.next({ request })
  }

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

  /**
   * ⚠ MÁY TÍNH MỞ LỐI POS CŨ (dấu trang, chuột giữa, gõ địa chỉ, link dán) → CHUYỂN THẲNG SANG POS, trước khi dựng màn cũ
   *   (chủ nhà 03/11/2026: "nhận diện từ đầu là đang trên máy tính để load pos luôn"). Khổ màn do trình duyệt ghi vào
   *   cookie `npp_kho` — xem `@/lib/nav/kho-man`. Trước bước đọc phiên: màn cũ không cần, trang POS tự đọc.
   */
  const dichPos = dichPosMayChu({
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    kho: request.cookies.get(COOKIE_KHO)?.value,
    rsc: request.headers.get("rsc"),
    prefetch: request.headers.get("next-router-prefetch") ?? request.headers.get("x-middleware-prefetch"),
    purpose: request.headers.get("sec-purpose") ?? request.headers.get("purpose"),
    dest: request.headers.get("sec-fetch-dest"),
    mode: request.headers.get("sec-fetch-mode"),
    accept: request.headers.get("accept"),
  })
  if (dichPos) return NextResponse.redirect(new URL(dichPos, request.url), 307)

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
