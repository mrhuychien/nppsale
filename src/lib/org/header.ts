/**
 * PHẦN ĐẦU CHỨNG TỪ — tên · địa chỉ · điện thoại · mã số thuế của NPP.
 *
 * ⚠ VÌ SAO CÓ FILE NÀY. Hai màn in (`/sales-invoices/[id]/print` và
 * `/invoices/[id]/print`) đều hỏi `organizations.select("name, address,
 * phone")` — BA CỘT CUỐI KHÔNG TỒN TẠI. Bảng `organizations` chỉ có
 * `id, name, slug, settings, created_at`; địa chỉ và điện thoại nằm
 * trong `settings` jsonb, đúng như màn `/setup` ghi chúng vào.
 *
 * Hậu quả: PostgREST trả lỗi, mã nguồn `console.error` rồi `setOrg(null)`
 * — và tờ hóa đơn in ra KHÔNG CÓ phần đầu. Không toast, không màn đỏ,
 * chỉ một tờ giấy thiếu tên công ty đi tới tay khách.
 *
 * ⚠ CÙNG LOẠI VỚI `customers.price_group_id`: tên cột nghe hợp lý, tsc
 * không biết gì về schema, chốt cấu trúc đều xanh. Cách chặn duy nhất là
 * ĐỌC ĐÚNG MỘT CHỖ và neo chỗ đó vào `schema_full.sql` bằng chốt.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface OrgHeader {
  name: string | null
  address: string | null
  phone: string | null
  taxCode: string | null
}

export const EMPTY_ORG_HEADER: OrgHeader = {
  name: null,
  address: null,
  phone: null,
  taxCode: null,
}

/**
 * Bóc phần đầu chứng từ ra khỏi một dòng `organizations`.
 *
 * ⚠ Tách khỏi phần gọi mạng để thử phá được: đây mới là chỗ dễ sai, chứ
 * không phải lệnh `select`.
 *
 * ⚠ CHUỖI RỖNG COI NHƯ CHƯA CÓ. `settings.address = ""` mà trả về chuỗi
 * rỗng thì mẫu in ra dòng "Địa chỉ:" cụt lủn — tệ hơn là không in dòng
 * nào.
 */
export function orgHeaderFrom(
  row: { name?: string | null; settings?: unknown } | null | undefined
): OrgHeader {
  if (!row) return EMPTY_ORG_HEADER
  const s = (row.settings ?? {}) as Record<string, unknown>
  const pick = (k: string): string | null => {
    const v = s[k]
    if (typeof v !== "string") return null
    const t = v.trim()
    return t === "" ? null : t
  }
  const name = typeof row.name === "string" && row.name.trim() !== "" ? row.name.trim() : null
  return { name, address: pick("address"), phone: pick("phone"), taxCode: pick("tax_code") }
}

/**
 * Đọc phần đầu chứng từ của một tổ chức.
 *
 * ⚠ HỎI `settings`, KHÔNG HỎI `address`/`phone`. Đó là cả lý do file này
 * tồn tại — xem khối chú thích đầu file trước khi đổi câu select.
 */
export async function loadOrgHeader(
  supabase: SupabaseClient,
  orgId: string
): Promise<OrgHeader> {
  const { data, error } = await supabase
    .from("organizations")
    .select("name, settings")
    .eq("id", orgId)
    .maybeSingle()
  if (error) {
    console.error("[lib/org/header] truy vấn lỗi:", error.message)
    return EMPTY_ORG_HEADER
  }
  return orgHeaderFrom(data as { name?: string | null; settings?: unknown } | null)
}
