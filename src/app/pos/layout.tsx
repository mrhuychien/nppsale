import type { ReactNode } from "react"
import { PosShell } from "@/components/pos/pos-shell"
import { PosTabsProvider } from "@/store/pos/tabs"
import { PosSettingsProvider } from "@/store/pos/settings"
import { PosRefDataProvider } from "@/store/pos/ref-data"

/**
 * KHUNG `/pos` — spec chốt 21/09/2026.
 *
 * ⚠ KHÔNG NẠP BỘ CHỮ RIÊNG Ở ĐÂY (chủ nhà chốt đợt 8: *"các font chữ
 * điều chỉnh về theo phong cách thiết kế cũ"*).
 *
 * Bản đầu nạp Be Vietnam Pro + JetBrains Mono cho riêng `/pos`, theo
 * bản xem thiết kế. Hệ quả là mở `/pos` ra thấy một app KHÁC: cả phần
 * còn lại dùng Manrope, và hai họ chữ cạnh nhau trong cùng một sản
 * phẩm đọc như hai phần mềm ghép lại. Nay `/pos` dùng đúng Manrope mà
 * `app/layout.tsx` đã nạp sẵn cho toàn app.
 *
 * ⚠ VÀ ĐÓ CŨNG LÀ BỎ HAI LƯỢT TẢI CHỮ. Hai họ chữ × bốn độ đậm là dữ
 * liệu tải về chỉ để phục vụ một màn — trong khi họ chữ đúng đã nằm
 * sẵn trong bộ nhớ đệm của trình duyệt từ mọi màn khác.
 */
export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <PosSettingsProvider>
      <PosRefDataProvider>
        <PosTabsProvider>
          <PosShell>{children}</PosShell>
        </PosTabsProvider>
      </PosRefDataProvider>
    </PosSettingsProvider>
  )
}
