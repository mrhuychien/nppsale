/**
 * Các phép tính thuần của màn NHẬP KHO — tách ra để kiểm được.
 *
 * Ba việc ở đây đều là chuyện của tồn kho ĐẦU KỲ: khi bàn giao hệ thống,
 * NPP gõ một phiếu nhập lớn để mang số dư từ sổ cũ sang. Phiếu đó khác
 * phiếu nhập hằng ngày ở hai điểm, và cả hai đều từng bị làm sai:
 *
 *   1. Nó được GHI LÙI NGÀY (chốt sổ 31/12), không phải ngày hôm nay.
 *   2. Giá vốn của nó là giá vốn thật lấy từ sổ cũ, không phải giá bán.
 */

/** Việt Nam không có giờ mùa hè — lệch cố định +07 từ 1975. */
export const VN_OFFSET = "+07:00"
const VN_MS = 7 * 60 * 60 * 1000

/** Hôm nay theo LỊCH VIỆT NAM, dạng yyyy-mm-dd. */
export function vnToday(now: Date): string {
  return new Date(now.getTime() + VN_MS).toISOString().slice(0, 10)
}

/**
 * Thời điểm ghi sổ của phiếu, suy từ NGÀY người dùng chọn ở ô "Ngày nhập".
 *
 * ⚠ Trước đây ô "Ngày nhập" chỉ đi vào mã phiếu; `posted_at` luôn là
 * `now()`. Nghĩa là phiếu tồn đầu kỳ ghi 31/12/2025 vẫn nằm ở ngày bấm
 * nút — thẻ kho, báo cáo nhập xuất tồn và giá vốn hàng bán đều gom theo
 * `posted_at`, nên toàn bộ tồn đầu kỳ rơi nhầm vào kỳ hiện tại. Ô ngày
 * trông như có tác dụng mà không có: đó là kiểu sai tệ nhất, vì người
 * dùng tin là mình đã ghi đúng.
 *
 * 12:00 giờ Việt Nam, không phải 00:00Z: 00:00Z là 07:00 sáng giờ Việt —
 * đúng ngày, nhưng chỉ cần một chỗ khác quy đổi ngược là trượt sang ngày
 * trước. Giữa trưa thì cách cả hai biên 12 tiếng, không mốc nào với tới.
 *
 * Riêng phiếu của CHÍNH HÔM NAY vẫn dùng `now`, để nhiều phiếu trong một
 * ngày còn giữ đúng thứ tự trước sau trên thẻ kho.
 */
export function postedAtFor(entryDate: string | null | undefined, now: Date): string {
  const d = String(entryDate ?? "").trim()
  // Không đọc được ngày thì dùng bây giờ — thà ghi ngày hôm nay còn hơn
  // ném lỗi giữa lúc người ta vừa gõ xong 200 dòng.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return now.toISOString()
  if (d === vnToday(now)) return now.toISOString()
  const t = new Date(`${d}T12:00:00${VN_OFFSET}`)
  return Number.isNaN(t.getTime()) ? now.toISOString() : t.toISOString()
}

/**
 * Giá vốn mồi sẵn cho một dòng, theo ĐƠN VỊ GIAO DỊCH của dòng đó.
 *
 * ⚠ Trước đây ô "Giá vốn" được mồi bằng GIÁ BÁN, và lúc lưu, ô để trống
 * cũng lùi về giá bán. Giá vốn bằng giá bán nghĩa là lãi gộp bằng 0 —
 * nhưng không có dòng cảnh báo nào, con số vẫn trông như số thật. Cùng
 * lúc đó `products.cost_price` (cột giá vốn nhập từ file Excel sản phẩm)
 * thì không được đọc tới.
 *
 * `cost_price` tính theo ĐƠN VỊ CƠ BẢN, còn ô nhập theo đơn vị của dòng
 * (thùng, lốc…). Phải nhân hệ số quy đổi lên, vì lúc lưu chỗ kia chia lại
 * đúng hệ số đó.
 */
export function seedUnitCost(
  costPricePerBase: number | null | undefined,
  conversion: number
): string {
  const c = Number(costPricePerBase ?? 0)
  const k = Number(conversion)
  if (!Number.isFinite(c) || c <= 0) return ""
  if (!Number.isFinite(k) || k <= 0) return String(c)
  // Số nguyên thì giữ nguyên dạng; lẻ thì cắt phần đuôi dấu phẩy động
  // (0.1 * 3 = 0.30000000000000004) để ô nhập không hiện một dãy số rác.
  const v = c * k
  return String(Number.isInteger(v) ? v : Number(v.toFixed(6)))
}

/**
 * Giá vốn thật sự ghi xuống, và nó có phải SỐ BIẾT KHÔNG.
 *
 * Để trống hoặc số 0 đều là "chưa biết giá vốn" — migration 098 đã coi
 * giá vốn 0 là thiếu thông tin chứ không phải hàng không có giá trị, nên
 * ghi 0 là ghi đúng sự thật. Cái KHÔNG được làm là lặng lẽ điền giá bán
 * vào đó.
 *
 * `known = false` để nơi gọi còn nói ra, chứ không phải để nó tự đoán.
 */
export function resolveUnitCost(raw: string | number | null | undefined): {
  cost: number
  known: boolean
} {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").trim())
  if (!Number.isFinite(n) || n <= 0) return { cost: 0, known: false }
  return { cost: n, known: true }
}

/**
 * Những dòng chưa có giá vốn, để cảnh báo trước khi lưu.
 *
 * Trả về SỐ THỨ TỰ DÒNG (1-based) đúng như trên màn hình, không phải chỉ
 * số mảng — người dùng đối chiếu bằng cái nhãn "#3" họ nhìn thấy.
 */
export function linesMissingCost(
  lines: Array<{ product_id: string; quantity: string; unit_cost: string }>
): number[] {
  const out: number[] = []
  lines.forEach((l, i) => {
    const qty = parseFloat(l.quantity)
    if (!l.product_id || !(qty > 0)) return
    if (!resolveUnitCost(l.unit_cost).known) out.push(i + 1)
  })
  return out
}
