import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret } from "@/lib/crypto"
import { publishInvoice } from "@/lib/misa/client"
import { invoiceToMisaPayload, type ExportMode, type MapperLine } from "@/lib/misa/mapper"
import type { MisaConfig } from "@/lib/misa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/einvoice/publish
 * Body: { invoiceId, mode?: 'as_sold' | 'box', poNote?: string }
 *
 * Layer 3 — orchestration: auth → load invoice/order/customer/config →
 * idempotency → mapper → MISA client → log + update invoice.
 */
export async function POST(req: Request) {
  // Top-level guard — bất kỳ throw nào ngoài try/catch chi tiết bên trong
  // vẫn phải trả JSON body, không để FE crash vì "Unexpected end of JSON input".
  try {
    return await handlePublish(req)
  } catch (err) {
    console.error("[/api/einvoice/publish] fatal:", err)
    const msg = err instanceof Error ? err.message : "Lỗi server không xác định khi gọi MISA"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function handlePublish(req: Request) {
  let body: { invoiceId?: string; mode?: ExportMode; poNote?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body không hợp lệ" }, { status: 400 })
  }
  const { invoiceId, mode = "as_sold", poNote } = body
  if (!invoiceId) {
    return NextResponse.json({ error: "Thiếu invoiceId" }, { status: 400 })
  }

  // --- Auth ---
  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
  const { data: profile } = await supa
    .from("users")
    .select("id, role, org_id")
    .eq("id", authUser.id)
    .maybeSingle()
  if (!profile || !["owner", "accountant", "manager"].includes(profile.role)) {
    return NextResponse.json(
      { error: "Chỉ Chủ NPP, Kế toán hoặc Quản lý mới được phát hành hoá đơn" },
      { status: 403 }
    )
  }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return NextResponse.json(
      { error: `Server thiếu cấu hình: ${(e as Error).message}` },
      { status: 500 }
    )
  }
  const orgId = profile.org_id as string

  // --- Load invoice (scope theo org) ---
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("org_id", orgId)
    .maybeSingle()
  if (invErr || !invoice) {
    return NextResponse.json({ error: invErr?.message || "Không tìm thấy hoá đơn" }, { status: 404 })
  }

  // --- Idempotency: đã có lookup code → trả cached ---
  if (invoice.misa_lookup_code) {
    return NextResponse.json({
      success: true,
      cached: true,
      lookup_code: invoice.misa_lookup_code,
      inv_no: invoice.misa_invoice_id,
      invoice_url: invoice.misa_invoice_url,
    })
  }

  // --- Atomic pending guard (chống double-click) ---
  const { data: locked, error: lockErr } = await admin
    .from("invoices")
    .update({ misa_status: "pending" })
    .eq("id", invoiceId)
    .is("misa_lookup_code", null)
    .or("misa_status.is.null,misa_status.neq.pending")
    .select("id")
  if (lockErr) {
    return NextResponse.json({ error: `Không khoá được hoá đơn: ${lockErr.message}` }, { status: 500 })
  }
  if (!locked || locked.length === 0) {
    return NextResponse.json(
      { error: "Hoá đơn đang được xử lý hoặc đã phát hành. Thử lại sau giây lát." },
      { status: 409 }
    )
  }

  // Mọi lỗi sau khi đã set misa_status='pending' phải mark lại "error",
  // nếu không invoice kẹt pending → lần retry kế tiếp luôn 409.
  let payload: ReturnType<typeof invoiceToMisaPayload> | null = null
  try {
    // --- Load config + order + customer + lines + org ---
    const [cfgRes, orgRes] = await Promise.all([
      admin.from("company_einvoice_config").select("*").eq("org_id", orgId).maybeSingle(),
      admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    ])
    const cfg = cfgRes.data
    if (!cfg || !cfg.is_active) {
      await admin.from("invoices").update({ misa_status: "error", misa_error: "Chưa cấu hình tài khoản MISA" }).eq("id", invoiceId)
      return NextResponse.json(
        { error: "Chưa cấu hình tài khoản hoá đơn điện tử MISA. Vào Cài đặt → Hoá đơn điện tử." },
        { status: 400 }
      )
    }
    if (!cfg.username_enc || !cfg.password_enc) {
      await admin.from("invoices").update({ misa_status: "error", misa_error: "Thiếu username/password MISA" }).eq("id", invoiceId)
      return NextResponse.json(
        { error: "Chưa nhập username/password MISA. Vào Cài đặt → Hoá đơn điện tử." },
        { status: 400 }
      )
    }

    let lines: MapperLine[] = []
    let buyer = {
      name: invoice.customer_name || "",
      tax_code: invoice.customer_tax_code || "",
      address: invoice.customer_address || "",
      email: "" as string | null,
      channel: "" as string | null,
      payment_method_label: "Chuyển khoản" as string | null,
    }

    if (invoice.order_id) {
      const { data: order } = await admin
        .from("sales_orders")
        .select(
          "id, notes, customer:customers(store_name, billing_name, tax_code, billing_address, address, billing_email, channel, payment_method_label), lines:sales_order_lines(unit_name, quantity, unit_price, line_discount, conversion_factor, product:products(name, sku, base_unit, vat_rate))"
        )
        .eq("id", invoice.order_id)
        .maybeSingle()
      if (order) {
        // Supabase suy luận join là mảng (không biết FK 1-1) — chuẩn hoá:
        const rawCustomer = (order as { customer: unknown }).customer
        const c = (Array.isArray(rawCustomer) ? rawCustomer[0] : rawCustomer || {}) as Record<string, unknown>
        buyer = {
          name: (c.billing_name as string) || (c.store_name as string) || invoice.customer_name || "",
          tax_code: (c.tax_code as string) || invoice.customer_tax_code || "",
          address: (c.billing_address as string) || (c.address as string) || invoice.customer_address || "",
          email: (c.billing_email as string) || null,
          channel: (c.channel as string) || null,
          payment_method_label: (c.payment_method_label as string) || "Chuyển khoản",
        }
        const rawLines = (order as { lines: unknown }).lines
        lines = ((Array.isArray(rawLines) ? rawLines : []) as Array<Record<string, unknown>>).map((l) => {
          const rawP = (l as { product: unknown }).product
          const p = (Array.isArray(rawP) ? rawP[0] : rawP || {}) as Record<string, unknown>
          return {
            product_name: (p.name as string) || "",
            sku: (p.sku as string) || null,
            unit_name: (l.unit_name as string) || (p.base_unit as string) || "",
            base_unit: (p.base_unit as string) || null,
            quantity: Number(l.quantity || 0),
            unit_price: Number(l.unit_price || 0),
            conversion_factor: Number(l.conversion_factor || 1),
            vat_rate:
              p.vat_rate != null ? Math.round(Number(p.vat_rate) * (Number(p.vat_rate) <= 1 ? 100 : 1)) : 10,
            line_discount: Number(l.line_discount || 0),
          }
        })
      }
    }

    // Fallback: hoá đơn không gắn order → 1 dòng tổng hợp.
    if (lines.length === 0) {
      const sub = Number(invoice.subtotal || 0)
      lines = [
        {
          product_name: "Hàng hoá, dịch vụ",
          unit_name: "Lần",
          quantity: 1,
          unit_price: sub || Number(invoice.total || 0),
          conversion_factor: 1,
          vat_rate: sub > 0 ? Math.round((Number(invoice.vat || 0) / sub) * 100) : 10,
          line_discount: 0,
        },
      ]
    }

    let username: string
    let password: string
    try {
      username = decryptSecret(cfg.username_enc)
      password = decryptSecret(cfg.password_enc)
    } catch (e) {
      const msg = `Không giải mã được credentials MISA (kiểm tra EINVOICE_ENC_KEY có thay đổi so với lúc lưu cấu hình không): ${(e as Error).message}`
      await admin.from("invoices").update({ misa_status: "error", misa_error: msg }).eq("id", invoiceId)
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const misaConfig: MisaConfig = {
      apiBase: cfg.api_base,
      taxCode: cfg.tax_code || "",
      username,
      password,
      companyId: cfg.misa_company_id,
      orgUnitId: cfg.misa_org_unit_id,
      templateId: cfg.misa_template_id,
      userId: cfg.misa_user_id,
      invSeries: cfg.misa_inv_series,
      invTemplateNo: cfg.misa_inv_template_no,
      sandbox: cfg.sandbox,
    }

    payload = invoiceToMisaPayload({
      buyer,
      seller: {
        name: cfg.seller_name || (orgRes.data?.name as string) || "",
        taxCode: cfg.tax_code || "",
        address: cfg.seller_address || "",
      },
      lines,
      mode,
      poNote: poNote || null,
      invSeries: cfg.misa_inv_series,
      invTemplateNo: cfg.misa_inv_template_no,
      companyId: cfg.misa_company_id,
      orgUnitId: cfg.misa_org_unit_id,
      templateId: cfg.misa_template_id,
      userId: cfg.misa_user_id,
    })

    // --- Gọi MISA + log ---
    const result = await publishInvoice(misaConfig, payload)

    await admin.from("einvoice_logs").insert({
      org_id: orgId,
      invoice_id: invoiceId,
      order_id: invoice.order_id,
      request_payload: payload as unknown as Record<string, unknown>,
      response_payload: (result.raw ?? null) as Record<string, unknown> | null,
      status: result.ok ? "success" : "failed",
      error_message: result.ok ? null : result.error,
      misa_lookup_code: result.lookup_code,
      misa_inv_no: result.inv_no,
      created_by: profile.id,
    })

    if (!result.ok) {
      await admin
        .from("invoices")
        .update({ misa_status: "error", misa_error: result.error, misa_sent_at: new Date().toISOString() })
        .eq("id", invoiceId)
      return NextResponse.json({ error: result.error || "MISA trả lỗi" }, { status: 502 })
    }

    const lookupUrl = result.lookup_code
      ? `https://www.meinvoice.vn/tra-cuu?code=${encodeURIComponent(result.lookup_code)}`
      : null
    const now = new Date().toISOString()
    await admin
      .from("invoices")
      .update({
        misa_lookup_code: result.lookup_code,
        misa_invoice_id: result.inv_no,
        misa_invoice_url: lookupUrl,
        misa_status: "signed",
        misa_error: null,
        misa_sent_at: now,
        misa_signed_at: now,
        misa_published_at: now,
      })
      .eq("id", invoiceId)

    return NextResponse.json({
      success: true,
      lookup_code: result.lookup_code,
      inv_no: result.inv_no,
      invoice_url: lookupUrl,
      sandbox: cfg.sandbox,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định khi gọi MISA"
    console.error("[/api/einvoice/publish] uncaught:", err)
    try {
      await admin.from("einvoice_logs").insert({
        org_id: orgId,
        invoice_id: invoiceId,
        order_id: invoice.order_id,
        request_payload: (payload ?? null) as unknown as Record<string, unknown> | null,
        response_payload: null,
        status: "failed",
        error_message: msg,
        created_by: profile.id,
      })
    } catch { /* best-effort */ }
    try {
      await admin
        .from("invoices")
        .update({ misa_status: "error", misa_error: msg, misa_sent_at: new Date().toISOString() })
        .eq("id", invoiceId)
    } catch { /* best-effort */ }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
