/* Supabase giả cho ĐO HIỆU NĂNG: danh mục cỡ thật (1.700 SP, 500 khách, 3.000 lô). */
import zlib from "node:zlib"
import { createFakeSupabase } from "../e2e/fake-supabase.mjs"
import { tables, rpc, users, ORG } from "../e2e/fixture.mjs"
const port = Number(process.env.FAKE_SUPABASE_PORT || 54321)
const t = tables()
const donVi = ["thùng", "lốc"]
for (let i = 0; i < 1700; i++) {
  const id = `p-${i}`
  const units = donVi.map((u, k) => ({ id: `${id}-u${k}`, product_id: id, unit_name: u, conversion: k ? 6 : 24 }))
  t.products.push({
    id, org_id: ORG, sku: `SP${String(i).padStart(6, "0")}`, barcode: `893${String(i).padStart(10, "0")}`,
    name: `Sản phẩm thử nghiệm số ${i} loại hộp giấy ${i % 7}00g (24 hộp/thùng)`, base_unit: "hộp",
    category: `Nhóm ${i % 12}`, brand: `Hãng ${i % 30}`, vat_rate: 0.08, status: "active",
    sell_price: 10000 + i * 7, cost_price: 8000 + i * 5, description: "Mô tả sản phẩm ".repeat(8),
    warranty_info: null, shelf_location: `K${i % 40}`, weight: 0.3, weight_unit: "kg", images: [],
    created_at: "2026-01-01T00:00:00Z", units,
    price_lists: [
      { id: `${id}-g0`, product_id: id, unit_name: "hộp", group_id: null, price: 10000 + i * 7 },
      { id: `${id}-g1`, product_id: id, unit_name: "thùng", group_id: null, price: (10000 + i * 7) * 24 },
      { id: `${id}-g2`, product_id: id, unit_name: "lốc", group_id: null, price: (10000 + i * 7) * 6 },
    ],
  })
  for (const u of units) t.product_units.push(u)
}
for (let i = 0; i < 500; i++) {
  t.customers.push({
    id: `c-${i}`, org_id: ORG, customer_code: `KH${i}`, store_name: `Tạp hoá số ${i}`, owner_name: `Chủ ${i}`,
    phone: `09${String(10000000 + i)}`, address: `${i} Đường thử`, ward: "Phường A", district: "Quận B", province: "Hải Phòng",
    status: "active", group_id: null, credit_limit: 0, payment_terms: "COD", sales_user_id: t.users[0].id, channel: null,
    gps_lat: 20.8, gps_lng: 106.6, created_at: "2026-01-01T00:00:00Z", group: null,
  })
}
t.batches = t.batches ?? []
for (let i = 0; i < 3000; i++) {
  t.batches.push({ id: `b-${i}`, org_id: ORG, product_id: `p-${i % 1700}`, qty_on_hand: 50 + (i % 40), warehouse_zone: "sale", status: "available", expires_at: "2027-01-01" })
}
const { server } = createFakeSupabase({ tables: t, rpc, users })
/* NÉN GZIP như Supabase thật (sau Cloudflare) — không nén là đo sai độ lớn gói tin
   tới 10 lần. Chỉ ở máy chủ đo này, bộ e2e giữ nguyên. */
const goc = server.listeners("request")[0]
server.removeAllListeners("request")
server.on("request", (req, res) => {
  if (!/gzip/.test(req.headers["accept-encoding"] || "")) return goc(req, res)
  const wh = res.writeHead.bind(res), en = res.end.bind(res)
  let st = 200, hd = {}
  res.writeHead = (s, h) => { st = s; hd = h || {}; return res }
  res.end = (body) => {
    const buf = zlib.gzipSync(Buffer.from(body ?? ""))
    wh(st, { ...hd, "content-encoding": "gzip", "content-length": buf.length })
    return en(buf)
  }
  return goc(req, res)
})
server.listen(port, "127.0.0.1", () => console.log(`fake supabase (lớn) :${port}`))
