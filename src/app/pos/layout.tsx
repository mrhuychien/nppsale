import type { ReactNode } from "react"
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google"
import { PosShell } from "@/components/pos/pos-shell"
import { PosTabsProvider } from "@/store/pos/tabs"
import { PosSettingsProvider } from "@/store/pos/settings"
import { PosRefDataProvider } from "@/store/pos/ref-data"

/**
 * KHUNG `/pos` — spec chốt 21/09/2026.
 *
 * ⚠ HAI BỘ CHỮ NẠP Ở ĐÂY, KHÔNG Ở `app/layout.tsx`. Cả app đang dùng
 * Manrope; nạp thêm hai họ chữ vào layout gốc là mọi trang `/sell`
 * trên điện thoại phải tải thứ chúng không dùng — đúng những máy có
 * đường truyền kém nhất.
 *
 * ⚠ `next/font` CHỨ KHÔNG PHẢI THẺ `<link>` TỚI Google Fonts. Bản xem
 * thiết kế dùng `<link>` vì nó là một tệp HTML rời; trong Next.js thì
 * `next/font` tự tải chữ về cùng máy chủ, nên không có lượt gọi sang
 * miền khác và không có nhịp chữ nhảy khi tải xong.
 */
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam",
  display: "swap",
})

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
})

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${beVietnam.variable} ${jetbrains.variable}`}>
      <PosSettingsProvider>
        <PosRefDataProvider>
          <PosTabsProvider>
            <PosShell>{children}</PosShell>
          </PosTabsProvider>
        </PosRefDataProvider>
      </PosSettingsProvider>
    </div>
  )
}
