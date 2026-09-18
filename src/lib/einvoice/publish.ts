/**
 * Phát hành hoá đơn điện tử MISA cho MỘT hóa đơn bán.
 *
 * ⚠ MỐC LÀ HÓA ĐƠN BÁN, KHÔNG PHẢI ĐƠN ĐẶT HÀNG (workflow v2b). Một đơn
 * xuất làm hai đợt có hai hóa đơn bán; lập hoá đơn điện tử theo ĐƠN thì
 * cả hai lần đều mang toàn bộ dòng của đơn — khách bị xuất thuế hai lần
 * cho cùng một lô hàng. Và hoá đơn đã phát hành thì không sửa được, chỉ
 * huỷ và lập lại, mà mỗi lần như vậy là làm việc với cơ quan thuế.
 *
 * ⚠ BẢNG `invoices` LÀ HĐĐT MISA — tên cũ từ trước, giữ nguyên. Đừng
 * nhầm với `sales_invoices` (hóa đơn bán nội bộ).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface SalesInvoiceForEInvoice {
  id: string
  org_id: string
  order_id: string
  invoice_code: string
  status: string
  subtotal: number
  vat: number
  total: number
  customer?: {
    store_name?: string | null
    billing_name?: string | null
    billing_address?: string | null
    address?: string | null
    tax_code?: string | null
  } | null
}

export interface PublishResult {
  cached: boolean
  invNo: string | null
  lookupCode: string | null
  sandbox: boolean
}

/**
 * Tìm hoặc tạo dòng `invoices` gắn với hóa đơn bán này.
 *
 * ⚠ TÌM THEO `sales_invoice_id`, KHÔNG THEO `order_id`. Tìm theo đơn thì
 * đợt xuất thứ hai vớ phải hoá đơn điện tử của đợt một, rồi API trả
 * "đã phát hành trước đó" và đợt hai KHÔNG BAO GIỜ có hoá đơn.
 *
 * ⚠ GHI CẢ `order_id`. Mọi báo cáo lịch sử đọc theo cột đó; bỏ nó là đứt
 * một nửa sổ.
 */
export async function ensureEInvoiceRow(
  supabase: SupabaseClient,
  si: SalesInvoiceForEInvoice
): Promise<string> {
  if (si.status !== "posted") {
    throw new Error(
      `Hóa đơn ${si.invoice_code} không còn hiệu lực — không phát hành hoá đơn điện tử được.`
    )
  }

  const { data: found, error: findErr } = await supabase
    .from("invoices")
    .select("id")
    .eq("sales_invoice_id", si.id)
    .maybeSingle()
  if (findErr) throw new Error(`Không đọc được hoá đơn điện tử: ${findErr.message}`)
  if (found?.id) return found.id as string

  const c = si.customer || {}
  const { data: created, error: insErr } = await supabase
    .from("invoices")
    .insert({
      org_id: si.org_id,
      order_id: si.order_id,
      sales_invoice_id: si.id,
      invoice_number: null,
      customer_name: c.billing_name || c.store_name || "",
      customer_address: c.billing_address || c.address || null,
      customer_tax_code: c.tax_code || null,
      // ⚠ TIỀN LẤY TỪ HÓA ĐƠN BÁN, không lấy từ đơn. Lấy từ đơn thì đợt
      //   xuất một nửa vẫn khai thuế cho cả đơn.
      subtotal: si.subtotal,
      vat: si.vat,
      total: si.total,
      status: "draft",
    })
    .select("id")
    .single()
  if (insErr || !created) {
    throw new Error(insErr?.message || "Không tạo được hoá đơn điện tử")
  }
  return created.id as string
}

/**
 * Gọi API phát hành.
 *
 * ⚠ ĐỌC BODY BẰNG `text()` RỒI MỚI PARSE. Route có thể trả HTML của một
 * lỗi hạ tầng; `res.json()` khi đó ném một lỗi cú pháp và người dùng
 * nhận "Unexpected token <" thay vì biết chuyện gì xảy ra.
 */
export async function publishEInvoice(
  invoiceId: string,
  mode: "as_sold" | "box" = "as_sold"
): Promise<PublishResult> {
  const res = await fetch("/api/einvoice/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceId, mode }),
  })
  const text = await res.text()
  let data: {
    error?: string
    cached?: boolean
    inv_no?: string
    lookup_code?: string
    sandbox?: boolean
  } = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    /* body không phải JSON — giữ nguyên để câu lỗi dưới nói ra */
  }
  if (!res.ok) {
    throw new Error(
      data.error ||
        `Phát hành MISA thất bại (HTTP ${res.status})${text && !data.error ? `: ${text.slice(0, 200)}` : ""}`
    )
  }
  return {
    cached: data.cached === true,
    invNo: data.inv_no ?? null,
    lookupCode: data.lookup_code ?? null,
    sandbox: data.sandbox === true,
  }
}
