import type { OfflineReturnLine } from "@/lib/orders/create"
import { mayChuThieuCot } from "@/lib/db/co-rpc"

/**
 * Lập phiếu trả hàng (đầu phiếu + dòng) qua `create_return_with_lines`.
 *
 * ⚠ MỘT GIAO DỊCH (mig 171). Bản cũ chèn đầu phiếu `submitted` — đã mang
 *   sẵn khoản có — rồi mới chèn dòng: dòng hỏng là một phiếu trả có tiền
 *   mà không có hàng nằm lại, và không ai xoá được (chính sách xoá chỉ
 *   nhận phiếu nháp).
 *
 * ⚠ MÁY CHỦ CHƯA CHẠY 171 THÌ TRẢ `null` để nơi gọi đi đường cũ — lập
 *   phiếu trả không được gãy chỉ vì bản web lên trước migration. Lỗi khác
 *   (RLS, trigger, dữ liệu) thì ném.
 */
export interface CoRpcVaFrom {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

export async function lapPhieuTraMotLan(
  supabase: CoRpcVaFrom,
  head: Record<string, unknown>,
  lines: OfflineReturnLine[]
): Promise<string | null> {
  const { data, error } = await supabase.rpc("create_return_with_lines", { p_head: head, p_lines: lines })
  if (!error) {
    if (typeof data !== "string" || !data) {
      throw new Error("Máy chủ không trả về phiếu vừa lập — mở danh sách phiếu trả để xem đã lập chưa.")
    }
    return data
  }
  const e = error as { code?: string; message?: string }
  const m = (e.message || "").toLowerCase()
  const thieuHam =
    e.code === "PGRST202" ||
    (e.code === "42883" && m.includes("create_return_with_lines")) ||
    (m.includes("could not find the function") && m.includes("create_return_with_lines"))
  // Thiếu cột (chưa chạy mig 159 / 160): hàm đã lui cả giao dịch — đi đường cũ.
  if (thieuHam || mayChuThieuCot(error)) return null
  throw error
}
