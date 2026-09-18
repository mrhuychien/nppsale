import { Wrench } from "lucide-react"

/**
 * Trang báo đang bảo trì.
 *
 * ⚠ KHÔNG GỌI SUPABASE, KHÔNG DÙNG HOOK NÀO. Trang này phải hiện được
 * đúng lúc cơ sở dữ liệu đang bị migration chiếm — thêm một truy vấn vào
 * đây là mở đường cho cảnh "trang bảo trì cũng lỗi".
 *
 * ⚠ KHÔNG CÓ NÚT "THỬ LẠI". Bấm mãi trong lúc người ta đang chạy
 * migration chỉ tạo thêm tải; người dùng sẽ tự tải lại khi được báo.
 */
export const dynamic = "force-static"

export default function MaintenancePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-muted">
          <Wrench className="h-7 w-7 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold">Đang nâng cấp hệ thống</h1>
        <p className="text-sm text-muted-foreground">
          Phần mềm đang được cập nhật. Vui lòng quay lại sau ít phút — đơn hàng và
          công nợ của bạn vẫn nguyên vẹn.
        </p>
        <p className="text-xs text-muted-foreground">
          Đang có việc gấp thì gọi trực tiếp cho nhà phân phối.
        </p>
      </div>
    </div>
  )
}
