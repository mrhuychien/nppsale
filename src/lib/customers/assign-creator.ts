/**
 * Phân công điểm bán cho chính người vừa tạo ra nó.
 *
 * VÌ SAO CẦN
 *   NVBH đứng tại cửa hàng, mở app tạo điểm bán mới — rồi điểm bán đó
 *   không thuộc về ai. Chính sách RLS cho NVBH chỉ thấy khách ĐƯỢC PHÂN
 *   CÔNG, nên ngay sau khi tạo họ còn không mở lại được cái mình vừa
 *   nhập. Phải có người quản lý vào phân công tay thì điểm bán mới sống.
 *
 * ⚠ HAI ĐƯỜNG GHI KHÁC NHAU, KHÔNG PHẢI MỘT
 *   RLS (mig 002) chỉ cho owner/manager chèn thẳng vào
 *   `customer_assignments`. NVBH phải đi qua RPC `claim_customer_for_me`
 *   (mig 083, SECURITY DEFINER) — và RPC đó CHẶN mọi vai trò khác sales.
 *   Gọi nhầm đường là nhận một lỗi khó hiểu, nên chọn đường theo vai trò
 *   ngay ở đây.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type AssignOutcome =
  | { kind: "assigned"; role: "primary" | "secondary" }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; message: string }

/**
 * Vai trò nào thì tự phân công cho chính mình khi tạo điểm bán.
 *
 * ⚠ CỐ Ý CHỈ CÓ `sales`. Chủ NPP hay quản lý tạo điểm bán là đang nhập
 * liệu hành chính, không phải nhận tuyến. Gán họ làm người phụ trách
 * CHÍNH thì NVBH thật sau này chỉ còn chỗ 'secondary' — và cái ghế
 * 'primary' bị chiếm bởi người không đi tuyến.
 */
export function shouldAssignToCreator(role: string | null | undefined): boolean {
  return role === "sales"
}

export async function assignCustomerToCreator(
  supabase: SupabaseClient,
  opts: { customerId: string; role: string | null | undefined }
): Promise<AssignOutcome> {
  if (!opts.customerId) return { kind: "skipped", reason: "chưa có mã điểm bán" }
  if (!shouldAssignToCreator(opts.role)) {
    return { kind: "skipped", reason: "chỉ NVBH mới tự nhận tuyến" }
  }

  const { data, error } = await supabase.rpc("claim_customer_for_me", {
    p_customer_id: opts.customerId,
  })
  if (error) return { kind: "failed", message: error.message || String(error) }

  const body = (data ?? {}) as { status?: string; role?: string }
  // `already_assigned` cũng là thành công — bấm lại, hoặc người quản lý
  // vừa phân công trước đó một nhịp.
  const role = body.role === "secondary" ? "secondary" : "primary"
  return { kind: "assigned", role }
}

/** Câu ghép vào thông báo sau khi tạo. `null` = không có gì đáng nói. */
export function assignNote(r: AssignOutcome): string | null {
  if (r.kind === "assigned") {
    return r.role === "primary"
      ? "Đã phân công cho bạn (phụ trách chính)."
      : "Đã thêm bạn vào danh sách phụ trách (điểm bán đã có người phụ trách chính)."
  }
  if (r.kind === "failed") {
    // ⚠ Không nuốt. Điểm bán ĐÃ được tạo, chỉ phần phân công hỏng — nói
    // đúng chuyện đó, đừng để người ta tưởng mất cả điểm bán rồi tạo lại
    // và vướng trùng số điện thoại.
    return `⚠ Đã tạo điểm bán nhưng CHƯA phân công được cho bạn (${r.message}) — nhờ quản lý phân công ở tab Phân công.`
  }
  return null
}
