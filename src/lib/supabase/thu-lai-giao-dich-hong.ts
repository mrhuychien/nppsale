/**
 * GIAO DỊCH ĐÃ HỎNG (Postgres 25P02) — TỰ GỬI LẠI CÂU.
 *
 * Chủ nhà 29/10/2026 (Báo cáo nhân viên, tháng 9): "Chưa dựng được báo cáo … đọc dòng phiếu nhập hàng trả: current
 * transaction is aborted, commands ignored until end of transaction block".
 *
 * ⚠ 25P02 KHÔNG DO CÂU BỊ BÁO LỖI GÂY RA. Postgres chỉ trả câu này khi một lệnh TRƯỚC ĐÓ trong cùng giao dịch / cùng kết
 *   nối phía máy chủ đã hỏng; câu đọc ở đây là `SELECT` thường trên `stock_entry_lines` (chính sách RLS đơn giản), và mọi
 *   câu khác của cùng lượt nạp vẫn chạy được — tức kết nối PostgREST lấy từ hàng chờ đã ở sẵn trạng thái hỏng (lỗi gốc nằm
 *   ở nhật ký Postgres, ngay trước dòng 25P02). PostgREST ABORT giao dịch ấy rồi mới trả lời, nên kết nối lành lại.
 *
 * ⚠ GỬI LẠI LÀ AN TOÀN — KỂ CẢ CÂU GHI / RPC. Giao dịch đã ở trạng thái hỏng thì chỉ có thể huỷ: không lệnh nào của câu ấy
 *   được ghi vào sổ. Vì thế chỉ áp cho câu tới PostgREST (`/rest/v1/`) — nơi một câu HTTP là trọn một giao dịch — và chỉ
 *   khi thân câu gửi lại được (không có, hoặc là chuỗi: postgrest-js luôn gửi JSON dạng chuỗi).
 *
 * Một luật cho mọi client: trình duyệt (`fetchCoHetGio`), máy chủ Next (`createServerSupabaseClient`), admin.
 */

export const MA_GIAO_DICH_HONG = "25P02"

/** Số lần gửi lại tối đa. Mỗi câu 25P02 làm lành đúng một kết nối hỏng; hai lần đủ cho vài kết nối hỏng cùng lúc. */
export const SO_LAN_GUI_LAI_GIAO_DICH_HONG = 2

export type HamFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function urlCua(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return (input as Request).url ?? ""
}

/** Câu tới PostgREST — chỉ ở đó một câu HTTP là trọn một giao dịch Postgres. */
export function laCauPostgrest(input: RequestInfo | URL): boolean {
  try {
    return new URL(urlCua(input), "http://x").pathname.includes("/rest/v1/")
  } catch {
    return false
  }
}

/** Thân câu gửi lại được nguyên vẹn: không có thân, hoặc thân là chuỗi. Luồng (stream) / tệp thì không đụng. */
export function guiLaiDuoc(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof input !== "string" && !(input instanceof URL)) return false
  return init?.body == null || typeof init.body === "string"
}

/** Response là PostgREST báo 25P02. Đọc BẢN SAO — bản gốc vẫn nguyên cho thư viện đọc nếu không gửi lại. */
export async function laGiaoDichHong(res: Response): Promise<boolean> {
  if (res.status < 500) return false
  try {
    const j = (await res.clone().json()) as { code?: unknown } | null
    return j?.code === MA_GIAO_DICH_HONG
  } catch {
    return false
  }
}

/**
 * Bọc một hàm fetch: câu PostgREST trả 25P02 thì gửi lại (tối đa `SO_LAN_GUI_LAI_GIAO_DICH_HONG` lần). Nơi gọi đã huỷ
 * (`signal`) thì thôi, trả nguyên lỗi. Lần cuối vẫn 25P02 thì trả đúng câu lỗi ấy — màn hình nói ra (`errorMessage`).
 */
export function thuLaiKhiGiaoDichHong(goc: HamFetch): HamFetch {
  return async (input, init) => {
    let res = await goc(input, init)
    if (!laCauPostgrest(input) || !guiLaiDuoc(input, init)) return res
    for (let lan = 0; lan < SO_LAN_GUI_LAI_GIAO_DICH_HONG; lan++) {
      if (!(await laGiaoDichHong(res))) return res
      if (init?.signal?.aborted) return res
      // Bỏ thân câu lỗi không dùng tới (đã đọc bản sao).
      void res.body?.cancel().catch(() => {})
      res = await goc(input, init)
    }
    return res
  }
}
