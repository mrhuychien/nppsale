// =====================================================================
// T-08 — số → chữ tiếng Việt cho phiếu thu TT200.
// Hỗ trợ tới 999 tỷ (đủ cho mọi giao dịch nội địa).
// =====================================================================

const DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]

function readBelow1000(n: number, full: boolean): string {
  if (n === 0) return ""
  const hundred = Math.floor(n / 100)
  const tenAndUnit = n % 100
  const ten = Math.floor(tenAndUnit / 10)
  const unit = tenAndUnit % 10
  const parts: string[] = []

  if (full || hundred > 0) {
    parts.push(`${DIGITS[hundred]} trăm`)
  }
  if (ten > 1) {
    parts.push(`${DIGITS[ten]} mươi`)
    if (unit === 1) parts.push("mốt")
    else if (unit === 5) parts.push("lăm")
    else if (unit > 0) parts.push(DIGITS[unit])
  } else if (ten === 1) {
    parts.push("mười")
    if (unit === 5) parts.push("lăm")
    else if (unit > 0) parts.push(DIGITS[unit])
  } else if (ten === 0) {
    if (unit > 0) {
      if (full || hundred > 0) parts.push("lẻ")
      parts.push(DIGITS[unit])
    }
  }
  return parts.join(" ").trim()
}

/** Convert integer VND amount to Vietnamese words (capitalised). */
export function numberToVietnameseWords(amount: number): string {
  const n = Math.floor(Math.max(0, Number(amount) || 0))
  if (n === 0) return "Không đồng"

  const billion = Math.floor(n / 1_000_000_000)
  const million = Math.floor((n / 1_000_000) % 1000)
  const thousand = Math.floor((n / 1000) % 1000)
  const unit = n % 1000

  const parts: string[] = []
  if (billion > 0) parts.push(`${readBelow1000(billion, false)} tỷ`)
  if (million > 0) parts.push(`${readBelow1000(million, parts.length > 0)} triệu`)
  if (thousand > 0) parts.push(`${readBelow1000(thousand, parts.length > 0)} nghìn`)
  if (unit > 0) parts.push(readBelow1000(unit, parts.length > 0))

  const text = parts.join(" ").replace(/\s+/g, " ").trim() + " đồng"
  return text.charAt(0).toUpperCase() + text.slice(1)
}
