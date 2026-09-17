/**
 * Đo: lọc 1.700 sản phẩm theo một phím gõ — chuẩn hoá lại mỗi lần
 * (`viMatchAllWords`) so với chỉ mục tính sẵn (`viSearchKey` + `viMatchKey`).
 * Chạy: npx tsx scripts/bench-search.ts
 */
import { viMatchAllWords, viMatchKey, viQueryWords, viSearchKey } from "../src/lib/search"

const N = 1700
const words = ["Coca", "Pepsi", "Mì Hảo Hảo", "Nước mắm Nam Ngư", "Dầu ăn Tường An", "Sữa Vinamilk", "Bia Sài Gòn", "Trà Ô Long", "Bánh Oreo", "Kem đánh răng P/S"]
const products = Array.from({ length: N }, (_, i) => ({
  name: `${words[i % words.length]} ${i} loại ${i % 7} thùng ${12 + (i % 24)}`,
  sku: `SP${String(i).padStart(5, "0")}`,
  barcode: `893${String(i * 7919).padStart(10, "0")}`,
}))
const queries = ["c", "co", "coc", "coca", "coca 12", "mi hao", "sp001", "893", "nuoc mam"]

function bench(label: string, fn: (q: string) => number): number {
  for (let i = 0; i < 3; i++) fn(queries[0])
  const ROUNDS = 20
  const t0 = performance.now()
  let hits = 0
  for (let r = 0; r < ROUNDS; r++) for (const q of queries) hits += fn(q)
  const ms = (performance.now() - t0) / (ROUNDS * queries.length)
  console.log(`${label.padEnd(28)} ${ms.toFixed(2).padStart(6)} ms / phím gõ   (hits ${hits})`)
  return ms
}

const t = performance.now()
const keys = products.map((p) => viSearchKey(p.name, p.sku, p.barcode))
console.log(`dựng chỉ mục ${N} SP một lần: ${(performance.now() - t).toFixed(1)} ms\n`)

const oldWay = (q: string) => products.filter((p) => viMatchAllWords(q, p.name, p.sku, p.barcode)).length
const newWay = (qq: string) => { const w = viQueryWords(qq); let n = 0; for (let i = 0; i < keys.length; i++) if (viMatchKey(keys[i], w)) n++; return n }

const a = bench("chuẩn hoá lại mỗi phím", oldWay)
const b = bench("chỉ mục tính sẵn", newWay)
console.log(`\nnhanh hơn ${(a / b).toFixed(0)}×`)

// Đúng như nhau?
for (const qq of queries) {
  const x = products.filter((p) => viMatchAllWords(qq, p.name, p.sku, p.barcode)).map((p) => p.sku).join(",")
  const w = viQueryWords(qq)
  const y = products.filter((_, i) => viMatchKey(keys[i], w)).map((p) => p.sku).join(",")
  if (x !== y) { console.error("LỆCH KẾT QUẢ:", qq); process.exit(1) }
}
console.log("kết quả hai đường: giống hệt")
