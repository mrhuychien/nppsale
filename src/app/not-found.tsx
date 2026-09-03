import Link from "next/link"
import { FileQuestion } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Trang 404 của toàn app.
 *
 * Trước đây file này không tồn tại nên Next.js dùng bản mặc định: màn trắng
 * với dòng chữ Anh "This page could not be found." — không sidebar, không
 * nút quay lại, không tiếng Việt. Người dùng cuối là chủ NPP và nhân viên
 * kho; gõ sai một chữ trên thanh địa chỉ là mắc kẹt ở một màn hình không
 * đọc được và không có đường ra.
 *
 * Cố ý KHÔNG dùng "use client": trang này chỉ có chữ và liên kết, không cần
 * JavaScript. Cũng không hiển thị đường dẫn người dùng vừa gõ — trên
 * server-component thì lấy được, nhưng in lại nguyên văn thứ người khác
 * đưa vào URL là mở đường cho chiêu dán link lừa người xem.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <FileQuestion className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-foreground">
            Không tìm thấy trang này
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Đường dẫn có thể bị gõ sai, hoặc trang đã được đổi tên. Không phải
            lỗi của bạn.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild className="w-full sm:w-auto">
            <Link href="/home">Về trang chủ</Link>
          </Button>
          <Button asChild variant="secondary" className="w-full sm:w-auto">
            <Link href="/orders">Danh sách đơn hàng</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Vẫn không vào được? Nhắn quản lý kèm đường dẫn bạn đang mở.
        </p>
      </div>
    </div>
  )
}
