import type { Metadata } from "next"
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

export const metadata: Metadata = {
  title: "npp.sale - Mini ERP cho Nhà Phân Phối",
  description: "Quản lý đơn hàng, kho, khách hàng, công nợ, hoa hồng trong một hệ thống duy nhất",
  manifest: "/manifest.webmanifest",
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
