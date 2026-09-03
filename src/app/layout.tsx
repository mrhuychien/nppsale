import type { Metadata, Viewport } from "next"
import { Manrope } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { AuthProvider } from "@/hooks/use-auth"
import { ServiceWorkerRegister } from "@/components/offline/sw-register"

const manrope = Manrope({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
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
      </body>
    </html>
  )
}
