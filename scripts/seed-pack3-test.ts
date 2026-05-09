/**
 * Pack3 test seed (spec section 7).
 *
 * Creates the canonical test fixture so the E2E acceptance criteria
 * (T-01 "4 thùng → -40 hộp", T-02 FIFO 50@10k+30@12k, T-14 row-level KH,
 * etc.) can be exercised against a clean Supabase project.
 *
 * Usage:
 *   SUPABASE_URL=https://<proj>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   npx tsx scripts/seed-pack3-test.ts
 *
 * Idempotent: detects an existing seed-org by name "Hoàng Giang Test"
 * and bails to avoid duplicating fixture rows.
 */

/* eslint-disable no-console */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRole) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
  )
  process.exit(1)
}

const sb: SupabaseClient = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ORG_NAME = "Hoàng Giang Test"

interface SeedUser {
  email: string
  full_name: string
  role: string
}

const USERS: SeedUser[] = [
  { email: "admin@hg-test.local", full_name: "Hoàng Giang Admin", role: "owner" },
  { email: "director@hg-test.local", full_name: "GĐ Test", role: "manager" },
  { email: "sales-a@hg-test.local", full_name: "NV Sales A", role: "sales" },
  { email: "sales-b@hg-test.local", full_name: "NV Sales B", role: "sales" },
  { email: "warehouse@hg-test.local", full_name: "Thủ kho Test", role: "warehouse" },
]

const PRODUCTS: Array<{ sku: string; name: string; base_unit: string }> = [
  { sku: "SKU001", name: "Sữa NPP — chai 250ml", base_unit: "hộp" },
  { sku: "SKU002", name: "Bánh quy A", base_unit: "hộp" },
  { sku: "SKU003", name: "Mì gói B", base_unit: "hộp" },
  { sku: "SKU004", name: "Nước tương C", base_unit: "hộp" },
  { sku: "SKU005", name: "Dầu ăn D", base_unit: "hộp" },
]

async function main() {
  console.log(`[seed-pack3] Looking up org "${ORG_NAME}"…`)
  const existing = await sb
    .from("organizations")
    .select("id")
    .eq("name", ORG_NAME)
    .maybeSingle()
  if (existing.data) {
    console.log(
      `[seed-pack3] Org already exists (${existing.data.id}). Bailing out — re-run after deleting it if you want a fresh seed.`
    )
    return
  }

  // 1. Org
  const { data: org } = await sb
    .from("organizations")
    .insert({ name: ORG_NAME })
    .select("id")
    .single()
  if (!org) throw new Error("Failed to create org")
  const orgId = org.id as string
  console.log(`[seed-pack3] Created org ${orgId}`)

  // 2. Users — auth.users + public.users (public.users PK = auth uid).
  const userIds: Record<string, string> = {}
  for (const u of USERS) {
    const { data: auth } = await sb.auth.admin.createUser({
      email: u.email,
      password: "Pack3Test!",
      email_confirm: true,
      user_metadata: { full_name: u.full_name, org_id: orgId, role: u.role },
    })
    if (!auth?.user?.id) throw new Error(`createUser failed for ${u.email}`)
    const uid = auth.user.id
    await sb.from("users").insert({
      id: uid,
      org_id: orgId,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      is_active: true,
    })
    userIds[u.email] = uid
    console.log(`[seed-pack3] User ${u.email} → ${uid}`)
  }
  const salesA = userIds["sales-a@hg-test.local"]
  const salesB = userIds["sales-b@hg-test.local"]

  // 3. Customers — 10 split 5/5 between sales A and B.
  const customers = []
  for (let i = 1; i <= 10; i++) {
    customers.push({
      org_id: orgId,
      store_name: `KH Test ${String(i).padStart(2, "0")}`,
      phone: `09000000${String(i).padStart(2, "0")}`,
      address: `Đường ${i}`,
      district: "Quận 1",
      province: "TP HCM",
      status: "active",
    })
  }
  const { data: insertedCustomers } = await sb
    .from("customers")
    .insert(customers)
    .select("id")
  if (!insertedCustomers) throw new Error("customers insert failed")
  const custIds = insertedCustomers.map((c) => c.id as string)

  // Assign 5 to A, 5 to B (T-14).
  const assignments = custIds.map((cid, idx) => ({
    org_id: orgId,
    customer_id: cid,
    user_id: idx < 5 ? salesA : salesB,
  }))
  await sb.from("customer_assignments").insert(assignments)
  console.log(`[seed-pack3] 10 customers + assignments created`)

  // 4. Products + units — 1 thùng = 10 hộp, 1 lốc = 5 hộp.
  const productIds: string[] = []
  for (const p of PRODUCTS) {
    const { data: prod } = await sb
      .from("products")
      .insert({
        org_id: orgId,
        sku: p.sku,
        name: p.name,
        base_unit: p.base_unit,
        sell_price: 12000,
        cost_price: 10000,
        status: "active",
      })
      .select("id")
      .single()
    if (!prod) throw new Error(`product insert failed: ${p.sku}`)
    productIds.push(prod.id as string)
    await sb.from("product_units").insert([
      { product_id: prod.id, unit_name: "hộp", conversion: 1 },
      { product_id: prod.id, unit_name: "lốc", conversion: 5 },
      { product_id: prod.id, unit_name: "thùng", conversion: 10 },
    ])
  }
  console.log(`[seed-pack3] 5 products + units created`)

  // 5. Initial stock: 100 hộp / SKU in sale zone, 1 FIFO layer @ 10k.
  for (const pid of productIds) {
    const { data: batch } = await sb
      .from("batches")
      .insert({
        org_id: orgId,
        product_id: pid,
        warehouse_zone: "sale",
        qty_on_hand: 100,
        unit_cost: 10000,
      })
      .select("id")
      .single()
    if (!batch) continue
    await sb.from("fifo_layers").insert({
      org_id: orgId,
      product_id: pid,
      warehouse_zone: "sale",
      qty_in_base_uom_remaining: 100,
      unit_cost: 10000,
      posting_at: new Date().toISOString(),
    })
  }
  console.log(`[seed-pack3] 100 hộp seed stock + FIFO layer per SKU`)

  // 6. Orders — 3 draft, 2 picking, 1 delivering. Each order = 1 line of
  //    a random SKU, 4 thùng (= 40 hộp) so the T-01 acceptance flow is
  //    immediately exercisable.
  const stages: Array<{ status: string; count: number }> = [
    { status: "draft", count: 3 },
    { status: "picking", count: 2 },
    { status: "delivering", count: 1 },
  ]
  let seq = 1
  for (const s of stages) {
    for (let i = 0; i < s.count; i++) {
      const cust = custIds[seq % custIds.length]
      const product = productIds[seq % productIds.length]
      const orderCode = `DH${String(seq).padStart(4, "0")}`
      const { data: order } = await sb
        .from("sales_orders")
        .insert({
          org_id: orgId,
          order_code: orderCode,
          customer_id: cust,
          sales_user_id: salesA,
          status: s.status,
          subtotal: 480000,
          total: 480000,
        })
        .select("id")
        .single()
      if (!order) continue
      await sb.from("sales_order_lines").insert({
        order_id: order.id,
        product_id: product,
        unit_name: "thùng",
        quantity: 4,
        unit_price: 120000,
        line_total: 480000,
        conversion_factor: 10,
      })
      seq++
    }
  }
  console.log(`[seed-pack3] 6 orders created (3 draft / 2 picking / 1 delivering)`)

  console.log("[seed-pack3] Done. Login with email/Pack3Test!")
}

main().catch((err) => {
  console.error("[seed-pack3] Failed:", err)
  process.exit(1)
})
