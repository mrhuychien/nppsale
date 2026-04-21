import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

/**
 * POST /api/invoice/misa
 * Gửi hóa đơn đến MISA meInvoice.
 * Body: { orderId, invoiceId }
 */
export async function POST(req: Request) {
  try {
    const { orderId, invoiceId } = await req.json()

    if (!orderId || !invoiceId) {
      return NextResponse.json(
        { error: "Thiếu orderId hoặc invoiceId" },
        { status: 400 }
      )
    }

    // Verify caller is owner or accountant
    const supabase = createServerSupabaseClient()
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
    }
    const { data: callerProfile } = await supabase
      .from("users")
      .select("role, org_id")
      .eq("id", authUser.id)
      .maybeSingle()
    if (
      !callerProfile ||
      !["owner", "accountant", "manager"].includes(callerProfile.role)
    ) {
      return NextResponse.json(
        { error: "Chỉ Chủ sở hữu, Quản lý hoặc Kế toán mới được xuất hóa đơn MISA" },
        { status: 403 }
      )
    }

    // Fetch order with lines + customer (including billing fields)
    const { data: order, error: orderErr } = await supabase
      .from("sales_orders")
      .select(
        "*, customer:customers(*, billing_name, tax_code, billing_address, billing_email, payment_method_label), lines:sales_order_lines(*, product:products(name, sku, vat_rate))"
      )
      .eq("id", orderId)
      .single()
    if (orderErr || !order) {
      return NextResponse.json(
        { error: "Không tìm thấy đơn hàng" },
        { status: 404 }
      )
    }

    // Mark invoice as pending
    await supabase
      .from("invoices")
      .update({ misa_status: "pending" })
      .eq("id", invoiceId)

    const customer = order.customer as Record<string, unknown> | null
    const lines = (order.lines || []) as Array<Record<string, unknown>>

    // Prepare MISA meInvoice payload
    const misaPayload = {
      invoice_type: 1,
      buyer_name: customer?.billing_name || customer?.store_name || "",
      buyer_tax_code: customer?.tax_code || "",
      buyer_address: customer?.billing_address || customer?.address || "",
      buyer_email: customer?.billing_email || "",
      payment_method: customer?.payment_method_label || "Chuyển khoản",
      currency: "VND",
      exchange_rate: 1,
      items: lines.map((line) => {
        const product = line.product as Record<string, unknown> | null
        return {
          item_name: product?.name || "",
          item_code: product?.sku || "",
          unit_name: line.unit_name,
          quantity: line.quantity,
          unit_price: line.unit_price,
          discount: line.line_discount || 0,
          amount: line.line_total,
          vat_rate: product?.vat_rate ?? 10,
        }
      }),
      subtotal: order.subtotal,
      vat_amount: order.vat,
      total_amount: order.total,
    }

    const misaApiKey = process.env.MISA_API_KEY

    let result: {
      invoice_number: string
      invoice_url: string
      signed_at: string
    }

    if (misaApiKey) {
      // Real MISA API call (placeholder URL - user can configure)
      const misaBaseUrl =
        process.env.MISA_API_URL || "https://api.meinvoice.vn/api/v1"
      try {
        const res = await fetch(`${misaBaseUrl}/invoices`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${misaApiKey}`,
          },
          body: JSON.stringify(misaPayload),
        })

        if (!res.ok) {
          const errBody = await res.text()
          await supabase
            .from("invoices")
            .update({
              misa_status: "error",
              misa_error: `MISA API lỗi ${res.status}: ${errBody}`,
              misa_sent_at: new Date().toISOString(),
            })
            .eq("id", invoiceId)
          return NextResponse.json(
            { error: `MISA API lỗi: ${res.status}` },
            { status: 502 }
          )
        }

        const data = await res.json()
        result = {
          invoice_number: data.invoice_number || data.InvoiceNumber || "",
          invoice_url: data.invoice_url || data.InvoiceUrl || "",
          signed_at: data.signed_at || new Date().toISOString(),
        }
      } catch (fetchErr) {
        const errMsg =
          fetchErr instanceof Error ? fetchErr.message : "Lỗi kết nối MISA"
        await supabase
          .from("invoices")
          .update({
            misa_status: "error",
            misa_error: errMsg,
            misa_sent_at: new Date().toISOString(),
          })
          .eq("id", invoiceId)
        return NextResponse.json({ error: errMsg }, { status: 502 })
      }
    } else {
      // Mock response when no MISA_API_KEY
      await new Promise((resolve) => setTimeout(resolve, 1000))
      result = {
        invoice_number: `HD-${Date.now()}`,
        invoice_url: `https://hoadon.misa.vn/mock/${invoiceId}`,
        signed_at: new Date().toISOString(),
      }
    }

    // Update invoice with MISA result
    const { error: updateErr } = await supabase
      .from("invoices")
      .update({
        misa_invoice_id: result.invoice_number,
        misa_invoice_url: result.invoice_url,
        misa_status: "signed",
        misa_error: null,
        misa_sent_at: new Date().toISOString(),
        misa_signed_at: result.signed_at,
      })
      .eq("id", invoiceId)

    if (updateErr) {
      return NextResponse.json(
        { error: `Cập nhật hóa đơn thất bại: ${updateErr.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      invoice_number: result.invoice_number,
      invoice_url: result.invoice_url,
      signed_at: result.signed_at,
      mock: !misaApiKey,
    })
  } catch (err) {
    console.error("[/api/invoice/misa] error:", err)
    const message = err instanceof Error ? err.message : "Lỗi không xác định"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
