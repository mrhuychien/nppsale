/**
 * NẠP DỮ LIỆU CHO CÁC MÀN `/pos`.
 *
 * ⚠ MỌI LƯỢT ĐỌC CÓ THỂ LỚN ĐỀU ĐI QUA `fetchAllForAggregate`. PostgREST
 * cắt ở 1.000 dòng và trả HTTP 200 KHÔNG kèm lỗi — kho mã này đã dính
 * cái bẫy ấy ở chín màn khác nhau. Và mốc chia trang phải DUY NHẤT
 * (`id`), vì các trang được gọi SONG SONG: khoá trùng thì Postgres được
 * quyền trả mỗi request một thứ tự khác, nên `OFFSET/LIMIT` vừa lặp vừa
 * bỏ sót.
 *
 * ⚠ ĐỌC HỎNG KHÔNG ĐƯỢC TRẢ VỀ HÌNH DẠNG CỦA "KHÔNG CÓ GÌ". Mọi hàm ở
 * đây trả `null` (hoặc kèm cờ) cho trường hợp chưa đọc được, và màn
 * hình phải nói "chưa xác định" chứ không vẽ số 0. Số 0 ở ô công nợ đọc
 * như "khách này sạch nợ"; số 0 ở ô tồn đọc như "hết hàng".
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import type { PosLine, PosLotOption } from "@/lib/pos/types"

/* ==================================================================
 * ĐỐI TÁC
 * ================================================================== */

export interface PosSupplier {
  id: string
  name: string
  code: string | null
  phone: string | null
  address: string | null
}

export async function loadSuppliers(sb: SupabaseClient): Promise<PosSupplier[]> {
  const res = await fetchAllForAggregate<PosSupplier>((from, to) =>
    sb
      .from("suppliers")
      .select("id, name, code, phone, address", { count: "exact" })
      .eq("is_active", true)
      // ⚠ Mốc chia trang DUY NHẤT — xem đầu tệp. `name` trùng được.
      .order("id")
      .range(from, to)
  )
  return res.rows.slice().sort((a, b) => a.name.localeCompare(b.name, "vi"))
}

export interface PosSeller {
  id: string
  full_name: string
  role: string
}

/**
 * Nhân viên đứng tên đơn được.
 *
 * ⚠ ĐÚNG BỘ VAI TRÒ TRIGGER CHO PHÉP (mig 153). Hiện ra một cái tên mà
 * máy chủ sẽ từ chối là bẫy người dùng: họ chọn, bấm lưu, rồi nhận một
 * câu lỗi cho một việc màn hình vừa mời họ làm.
 */
export async function loadSellers(sb: SupabaseClient, orgId: string): Promise<PosSeller[]> {
  const { data } = await sb
    .from("users")
    .select("id, full_name, role")
    .eq("org_id", orgId)
    .in("role", ["sales", "manager", "owner"])
    .order("full_name")
  return ((data as unknown) as PosSeller[]) ?? []
}

/* ==================================================================
 * CÔNG NỢ
 * ================================================================== */

/**
 * Công nợ còn lại của một khách.
 *
 * ⚠ `null` = CHƯA ĐỌC ĐƯỢC, và nơi gọi PHẢI hiện "chưa xác định". Trả
 * 0 cho một lỗi mạng là nói với người đi đòi tiền rằng khách này sạch
 * nợ — đúng loại lỗi đắt nhất mà im lặng nhất.
 */
export async function loadCustomerDebt(
  sb: SupabaseClient,
  customerId: string
): Promise<number | null> {
  const res = await fetchAllForAggregate<{ amount: number; paid: number }>((from, to) =>
    sb
      .from("receivables")
      .select("amount, paid", { count: "exact" })
      .eq("customer_id", customerId)
      .neq("status", "paid")
      .order("id")
      .range(from, to)
  )
  if (res.error || res.truncated) return null
  return res.rows.reduce(
    (s, r) => s + Math.max(0, (Number(r.amount) || 0) - (Number(r.paid) || 0)),
    0
  )
}

/** Công nợ phải trả một NCC. Cùng luật `null` với `loadCustomerDebt`. */
export async function loadSupplierDebt(
  sb: SupabaseClient,
  supplierId: string
): Promise<number | null> {
  const res = await fetchAllForAggregate<{ amount: number; paid: number }>((from, to) =>
    sb
      .from("payables")
      .select("amount, paid", { count: "exact" })
      .eq("supplier_id", supplierId)
      .neq("status", "paid")
      .order("id")
      .range(from, to)
  )
  if (res.error || res.truncated) return null
  return res.rows.reduce(
    (s, r) => s + Math.max(0, (Number(r.amount) || 0) - (Number(r.paid) || 0)),
    0
  )
}

/* ==================================================================
 * LÔ HÀNG
 * ================================================================== */

/** `12/26` từ một ngày hết hạn. Hàng không hạn thì chuỗi rỗng. */
function nhanHan(expires: string | null | undefined): string {
  if (!expires) return ""
  // ⚠ Mốc 2099-12-31 là quy ước "không hạn" của `complete_purchase_invoice`.
  if (expires.startsWith("2099")) return ""
  const [y, m] = expires.split("-")
  return m && y ? `${m}/${y.slice(2)}` : ""
}

/**
 * Lô CÒN HÀNG của một bộ sản phẩm, gom theo `product_id`.
 *
 * ⚠ CHỈ KHO BÁN. Cùng luật với `loadSellRefData`: kho cận date là hàng
 * gần hạn, không bán ra được cho tới khi chuyển vùng (mig 028). Đổ lô
 * cận date vào ô chọn là mời người dùng xuất một lô hệ thống sẽ từ chối.
 */
export async function loadLotsByProduct(
  sb: SupabaseClient,
  productIds: readonly string[]
): Promise<Record<string, PosLotOption[]>> {
  const ids = Array.from(new Set(productIds.filter(Boolean)))
  if (ids.length === 0) return {}
  const res = await fetchAllForAggregate<{
    id: string
    product_id: string
    batch_code: string
    expires_at: string | null
  }>((from, to) =>
    sb
      .from("batches")
      .select("id, product_id, batch_code, expires_at", { count: "exact" })
      .in("product_id", ids)
      .gt("qty_on_hand", 0)
      .eq("warehouse_zone", "sale")
      .eq("status", "available")
      .order("id")
      .range(from, to)
  )
  const out: Record<string, PosLotOption[]> = {}
  for (const b of res.rows) {
    ;(out[b.product_id] ??= []).push({
      id: b.id,
      code: b.batch_code,
      expiry: nhanHan(b.expires_at),
    })
  }
  /* ⚠ SẮP THEO HẠN GẦN TRƯỚC. Người xuất hàng phải thấy lô sắp hết hạn
     ở trên cùng — đó là lô cần đẩy đi trước. */
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999"))
  }
  return out
}

/* ==================================================================
 * NẠP CHỨNG TỪ GỐC
 * ================================================================== */

export interface SourceInvoiceLine {
  productId: string
  sku: string
  name: string
  unitName: string
  quantity: number
  unitPrice: number
  isExchange: boolean
}

/**
 * Dòng hàng của một hóa đơn — dùng để nạp vào phiếu TRẢ HÀNG.
 *
 * ⚠ SPEC §8 mục 4 TƯƠNG TỰ CHO PHÍA BÁN: chỉ trả được món CÓ trên hóa
 * đơn gốc. Phần nghiệp vụ đã có chốt chặn (`enforce_return_line_cap`);
 * nạp sẵn dòng từ tờ gốc là chặn sớm và đỡ cho người nhập cả việc gõ.
 *
 * ⚠ BỎ DÒNG HÀNG ĐỔI. Dòng `is_exchange` trên hóa đơn là hàng đã GIAO
 * bù cho khách, không phải hàng khách mua — trả lại nó là một việc
 * khác hẳn.
 */
export async function loadInvoiceLinesForReturn(
  sb: SupabaseClient,
  invoiceId: string
): Promise<SourceInvoiceLine[]> {
  const { data, error } = await sb
    .from("sales_invoice_lines")
    .select("product_id, unit_name, quantity, unit_price, is_exchange, product:products(name, sku)")
    .eq("invoice_id", invoiceId)
    .order("sort_order", { ascending: true })
  if (error) throw error
  const rows = ((data as unknown) as Array<{
    product_id: string
    unit_name: string
    quantity: number
    unit_price: number
    is_exchange: boolean
    product?: { name?: string | null; sku?: string | null } | null
  }>) ?? []
  return rows
    .filter((r) => !r.is_exchange)
    .map((r) => ({
      productId: r.product_id,
      sku: r.product?.sku ?? "",
      name: r.product?.name ?? "Sản phẩm đã xoá",
      unitName: r.unit_name,
      quantity: Number(r.quantity) || 0,
      unitPrice: Number(r.unit_price) || 0,
      isExchange: false,
    }))
}

export interface PosReceiptRef {
  id: string
  code: string
  date: string
}

/**
 * Phiếu nhập ĐÃ HOÀN THÀNH của một NCC — để màn trả NCC chọn phiếu gốc.
 *
 * ⚠ CHỈ PHIẾU `completed`. Phiếu còn nháp chưa sinh lô nào cả, nên chọn
 * nó làm phiếu gốc là chọn một tờ không có hàng nào đã vào kho.
 *
 * ⚠ 50 PHIẾU GẦN NHẤT, và đó là trần CÓ CHỦ Ý — người lập phiếu trả
 * luôn trả theo một chuyến hàng vừa nhận. Nơi gọi phải nói ra cái trần
 * ấy, đừng để người dùng tưởng đây là toàn bộ lịch sử nhập.
 */
export async function loadReceiptsOfSupplier(
  sb: SupabaseClient,
  supplierId: string
): Promise<PosReceiptRef[]> {
  const { data, error } = await sb
    .from("purchase_invoices")
    .select("id, receipt_code, invoice_date")
    .eq("supplier_id", supplierId)
    .eq("status", "completed")
    .order("invoice_date", { ascending: false })
    .limit(50)
  if (error) throw error
  const rows = ((data as unknown) as Array<{
    id: string
    receipt_code: string | null
    invoice_date: string | null
  }>) ?? []
  return rows.map((r) => ({
    id: r.id,
    code: r.receipt_code || "(chưa có mã)",
    date: r.invoice_date || "",
  }))
}

export interface SourceReceiptLine {
  productId: string
  sku: string
  name: string
  unitName: string
  /** Số đã nhập theo phiếu — trần của số được trả. */
  receivedQty: number
  unitPrice: number
  /** Lô do chính phiếu này sinh ra. */
  lots: PosLotOption[]
}

/**
 * Dòng hàng + LÔ của một phiếu nhập — dùng cho phiếu TRẢ NCC.
 *
 * ⚠ SPEC §8 mục 4: "select lô chỉ liệt kê lô THUỘC PHIẾU NHẬP GỐC,
 * không liệt kê toàn kho". Lô của phiếu nhập mang mã bắt đầu bằng mã
 * phiếu (`complete_purchase_invoice` đặt `v_code || '-' || seq`), nên
 * nhận diện được mà không cần thêm cột.
 *
 * ⚠ DANH SÁCH NÀY LÀ THÔNG TIN, KHÔNG PHẢI MỘT LỰA CHỌN.
 * `complete_supplier_return` (migration 146, dòng 155-165) chọn lô
 * FIFO theo `expires_at` trong vùng kho của phiếu; bảng
 * `supplier_return_lines` KHÔNG có cột lô nào để nhận lựa chọn ấy. Nơi
 * gọi phải hiện nó dưới dạng chữ đọc, không dưới dạng ô chọn — một ô
 * chọn mà máy chủ bỏ qua là nói dối người dùng ngay tại chỗ họ cẩn thận
 * nhất.
 *
 * ⚠ ĐỌC LÔ THEO `batch_code`, KHÔNG THEO `stock_entry`. `batches` không
 * có cột trỏ ngược về phiếu nhập; mã lô là đường nối duy nhất đang có.
 * Nếu sau này thêm cột ấy thì đổi ở ĐÂY, không rải ra các màn.
 */
export async function loadReceiptLinesForReturn(
  sb: SupabaseClient,
  receiptId: string
): Promise<{ lines: SourceReceiptLine[]; receiptCode: string | null }> {
  const [h, l] = await Promise.all([
    sb.from("purchase_invoices").select("id, receipt_code").eq("id", receiptId).maybeSingle(),
    sb
      .from("purchase_invoice_lines")
      .select("product_id, unit_name, quantity, unit_price, product:products(name, sku)")
      .eq("invoice_id", receiptId)
      .order("sort_order", { ascending: true }),
  ])
  if (l.error) throw l.error
  const code = ((h.data as unknown) as { receipt_code?: string | null } | null)?.receipt_code ?? null

  const rows = ((l.data as unknown) as Array<{
    product_id: string
    unit_name: string
    quantity: number
    unit_price: number
    product?: { name?: string | null; sku?: string | null } | null
  }>) ?? []

  /* Lô của phiếu: mã bắt đầu bằng mã phiếu. */
  let lots: Array<{ id: string; product_id: string; batch_code: string; expires_at: string | null }> = []
  if (code) {
    const res = await fetchAllForAggregate<(typeof lots)[number]>((from, to) =>
      sb
        .from("batches")
        .select("id, product_id, batch_code, expires_at", { count: "exact" })
        .like("batch_code", `${code}-%`)
        .order("id")
        .range(from, to)
    )
    lots = res.rows
  }

  return {
    receiptCode: code,
    lines: rows.map((r) => ({
      productId: r.product_id,
      sku: r.product?.sku ?? "",
      name: r.product?.name ?? "Sản phẩm đã xoá",
      unitName: r.unit_name,
      receivedQty: Number(r.quantity) || 0,
      unitPrice: Number(r.unit_price) || 0,
      lots: lots
        .filter((b) => b.product_id === r.product_id)
        .map((b) => ({ id: b.id, code: b.batch_code, expiry: nhanHan(b.expires_at) })),
    })),
  }
}

/* ==================================================================
 * GIÁ BÁN GẦN NHẤT CHO MỘT KHÁCH
 * ================================================================== */

export interface LastPriceInfo {
  price: number
  times: number
}

/**
 * Giá bán gần nhất + số lần mua, theo (khách, mặt hàng) — spec §4.
 *
 * ⚠ ĐỌC TỪ DÒNG HÓA ĐƠN, KHÔNG TỪ DÒNG ĐƠN. Đơn là thứ đã THOẢ THUẬN;
 * hóa đơn là thứ đã GIAO và đã ghi sổ. Gợi ý theo đơn là gợi ý một giá
 * có thể chưa bao giờ thu được.
 *
 * ⚠ GIỚI HẠN 500 DÒNG GẦN NHẤT, và đó là một cái trần CÓ CHỦ Ý — gợi ý
 * giá không đáng để kéo cả lịch sử. Người đọc cần biết nó là gợi ý chứ
 * không phải một phép thống kê đầy đủ.
 */
export async function loadLastPrices(
  sb: SupabaseClient,
  customerId: string
): Promise<Record<string, LastPriceInfo>> {
  const { data, error } = await sb
    .from("sales_invoice_lines")
    .select("product_id, unit_price, created_at, invoice:sales_invoices!inner(customer_id, status)")
    .eq("invoice.customer_id", customerId)
    .eq("invoice.status", "posted")
    .order("created_at", { ascending: false })
    .limit(500)
  if (error) return {}
  const rows = ((data as unknown) as Array<{ product_id: string; unit_price: number }>) ?? []
  const out: Record<string, LastPriceInfo> = {}
  for (const r of rows) {
    const cu = out[r.product_id]
    // ⚠ Dòng ĐẦU TIÊN gặp là dòng mới nhất (đã sắp giảm dần).
    if (!cu) out[r.product_id] = { price: Number(r.unit_price) || 0, times: 1 }
    else cu.times += 1
  }
  return out
}

/* ==================================================================
 * GẮN SỐ VÀO DÒNG
 * ================================================================== */

/**
 * Gắn lô, tồn, giá gần nhất vào một bộ dòng — một chỗ duy nhất.
 *
 * ⚠ KHÔNG GHI ĐÈ THỨ ĐÃ CÓ. Dòng nạp từ chứng từ gốc đã mang sẵn lô
 * của nó; đổ lại cả rổ lô lên là xoá lựa chọn người dùng vừa làm.
 */
export function attachLineExtras(
  lines: readonly PosLine[],
  extras: {
    lotsByProduct?: Record<string, PosLotOption[]>
    lastPrices?: Record<string, LastPriceInfo>
  }
): PosLine[] {
  return lines.map((l) => ({
    ...l,
    lots: l.lots && l.lots.length > 0 ? l.lots : extras.lotsByProduct?.[l.productId] ?? l.lots,
    lastPrice: l.lastPrice ?? extras.lastPrices?.[l.productId]?.price ?? null,
    lastBuyCount: l.lastBuyCount ?? extras.lastPrices?.[l.productId]?.times ?? null,
  }))
}
