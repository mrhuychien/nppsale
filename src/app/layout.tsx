import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { AuthProvider } from "@/hooks/use-auth"
import { ServiceWorkerRegister } from "@/components/offline/sw-register"
import { GhiKhoMan } from "@/components/nav/ghi-kho-man"

/**
 * VÌ SAO FONT NẰM TRONG REPO (chủ nhà 12/11/2026: "Có lỗi gì mà font chữ thay đổi hết vậy")
 *
 * `next/font/google` tải Manrope từ Google LÚC BUILD, riêng cho phần máy chủ và phần trình duyệt; tên lớp
 * (`__variable_<băm>`) băm từ CSS Google trả về. Google đổi tệp Manrope → bản build ceb2b87 trên Vercel: phần máy
 * chủ tải mới (`__variable_08700a`), phần CSS dùng lại bộ nhớ build cũ (`.__variable_6c36b7`) → `--font-manrope`
 * không có giá trị, cả app rơi về font mặc định. Tệp tự lưu thì băm chỉ theo nội dung tệp — hai phần luôn khớp,
 * build không cần mạng. `scripts/kiem-font-build.mjs` chặn build nếu vẫn lệch.
 *
 * Tệp: Manrope[wght] 4.505 (github.com/google/fonts, OFL — `fonts/OFL.txt`) cắt đúng ba vùng Google phát cho
 * trang tiếng Việt (latin + latin-ext + vietnamese), bỏ hinting, giữ trục đậm 200–800 và bộ tính năng của Google
 * (`tnum` cho cột số). Đã so nét + độ rộng từng ký tự ở 6 độ đậm với tệp Google: y hệt. Cắt lại:
 *   pyftsubset 'Manrope[wght].ttf' --unicodes=<ba vùng> --no-hinting --flavor=woff2
 *     --layout-features=calt,dnom,frac,liga,locl,numr,pnum,tnum,kern
 * `weight: "400 700"`: như bốn mặt 400/500/600/700 cũ — đậm hơn 700 vẫn vẽ 700, nhạt hơn 400 vẫn vẽ 400.
 */
const manrope = localFont({
  src: "./fonts/manrope-latin-vi.woff2",
  weight: "400 700",
  variable: "--font-manrope",
  display: "swap",
})

/**
 * VÌ SAO PHẢI CÓ `viewport-fit=cover`
 *
 * File này trước đây KHÔNG export `viewport`, nên Next phát ra
 *     <meta name="viewport" content="width=device-width, initial-scale=1">
 * Thiếu `viewport-fit=cover` thì trên iOS `env(safe-area-inset-bottom)`
 * LUÔN trả về 0. Nghĩa là `.safe-area-bottom` trong globals.css và mọi
 * `calc(... + env(safe-area-inset-*))` rải trong dashboard-shell.tsx và
 * order-form.tsx đều là CODE CHẾT — thanh nav dưới nằm chồng lên vùng
 * Home Indicator của iPhone mà không ai biết.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // KHÔNG khoá zoom: nhân viên bán hàng lớn tuổi cần phóng to đọc mã SP.
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#ffffff",
  interactiveWidget: "resizes-content",
}

export const metadata: Metadata = {
  title: "npp.sale - Mini ERP cho Nhà Phân Phối",
  description: "Quản lý đơn hàng, kho, khách hàng, công nợ, hoa hồng trong một hệ thống duy nhất",
  manifest: "/manifest.webmanifest",
  /* Logo mới (chủ nhà 28/09/2026) — sinh bằng `node scripts/tao-icon.mjs`. iPhone "Thêm vào MH chính"
     đọc apple-touch-icon (nền tràn viền, máy tự bo góc); favicon.ico nằm ở src/app. */
  icons: {
    icon: [{ url: "/icons/logo.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "npp.sale" },
  // iOS tự bôi xanh và biến số như "26.400.000" thành link gọi điện.
  formatDetection: { telephone: false },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="vi" className={manrope.variable}>
      <body className="font-sans antialiased bg-background text-foreground">
        <AuthProvider>
          {children}
        </AuthProvider>
        <Toaster />
        <ServiceWorkerRegister />
        {/* Khổ màn → cookie: máy chủ chuyển thẳng lối POS cũ sang POS trên máy tính (chủ nhà 03/11/2026). */}
        <GhiKhoMan />
      </body>
    </html>
  )
}
