/**
 * Câu khám tiền trả NCC — chủ nhà 08/11/2026: "kiểm tra xem phần tiền thanh toán cho ncc cũng chưa có trong công nợ".
 * Chủ nhà dán vào SQL Editor của Supabase rồi gửi lại bảng — nên câu phải MỘT câu (SQL Editor chỉ hiện kết quả câu cuối) và
 * CHỈ ĐỌC. Bộ thử SQL: scripts/sql/thu-kham-tra-tien-ncc.sql (một giao dịch, ROLLBACK) — chạy trên Postgres thử nếu có.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const SQL = readFileSync(resolve(ROOT, "supabase/diagnostics/kham_tra_tien_ncc.sql"), "utf-8")

/** Bỏ chú thích `--` và nội dung chuỗi '…' (giữ dấu nháy) — còn lại là phần câu lệnh thật. */
function boChuThichVaChuoi(src: string): string {
  let ra = ""
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (c === "'") {
      ra += "''"
      i++
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") i += 2
        else if (src[i] === "'") break
        else i++
      }
      i++
      continue
    }
    ra += c
    i++
  }
  return ra
}
const LENH = boChuThichVaChuoi(SQL)

describe("kham_tra_tien_ncc.sql — một câu, chỉ đọc", () => {
  it("đúng MỘT câu: một dấu chấm phẩy, ở cuối", () => {
    expect(LENH.split(";").length - 1).toBe(1)
    expect(LENH.trimEnd().endsWith(";")).toBe(true)
  })

  it("chỉ đọc: không có lệnh ghi / đổi cấu trúc / đổi cài đặt", () => {
    expect(LENH).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|SET|RESET)\b/i)
    expect(LENH).toMatch(/^\s*WITH\b/)
  })

  it("đủ 4 phần, xếp theo SỐ phần", () => {
    for (const p of ["1. TỔNG THEO NCC", "2. ĐÃ TRẢ KHÔNG CÓ PHIẾU", '3. PHIẾU CHI "CHI PHÍ" NGHI LÀ TRẢ NCC', "4. PHIẾU CHI NCC LỆCH"]) {
      expect(SQL).toContain(`'${p}'::text AS phan`)
    }
    expect(SQL).toContain("ORDER BY split_part(phan, '.', 1)::int, hang;")
  })

  it("dư nợ hiện tại cùng luật màn (Σ amount − paid trên khoản chưa 'paid', không kẹp âm)", () => {
    expect(SQL).toContain("coalesce(sum(n.amount - n.paid) FILTER (WHERE n.status <> 'paid'), 0) AS so_tien")
    expect(LENH).not.toMatch(/GREATEST\s*\(\s*0/i)
  })
})

const KET_NOI = ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
  "-d", process.env.PG_THU_DB || "npp_tong"]
function coPgThu(): boolean {
  try {
    execFileSync("psql", [...KET_NOI, "-At", "-c", "SELECT to_regclass('public.supplier_payments') IS NOT NULL"], { stdio: ["ignore", "pipe", "pipe"], timeout: 20000 })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!coPgThu())("kham_tra_tien_ncc.sql trên Postgres thử", () => {
  it("ra đúng dư nợ, khoản đã trả không phiếu, phiếu chi phí nghi là trả NCC, phiếu chi NCC lệch", () => {
    const ra = execFileSync("psql", [...KET_NOI, "-q", "-At", "-F", " | ", "-f", resolve(ROOT, "scripts/sql/thu-kham-tra-tien-ncc.sql")], {
      encoding: "utf-8", timeout: 60000,
    })
    const dong = ra.split("\n").filter((l) => /^\d\. /.test(l))
    expect(dong).toEqual([
      "1. TỔNG THEO NCC | 1 | NCC-AC · cty á châu |  |  | 1200000 | dư nợ hiện tại · nợ ghi (sau trả hàng) 3000000 · phiếu chi NCC 1000000 (2 phiếu) · ghi trả từng khoản 500000 · đã trả không phiếu 400000",
      "1. TỔNG THEO NCC | 2 | NCC-BM · Bình Minh |  |  | 300000 | dư nợ hiện tại · nợ ghi (sau trả hàng) 300000 · phiếu chi NCC 0 (0 phiếu) · ghi trả từng khoản 0 · đã trả không phiếu 0",
      "2. ĐÃ TRẢ KHÔNG CÓ PHIẾU | 1 | cty á châu | Nợ đầu kỳ | 01/09/2026 | 400000 | phải trả 1000000 · đã trả 1000000 · tiền có phiếu 600000 · nợ đầu kỳ",
      '3. PHIẾU CHI "CHI PHÍ" NGHI LÀ TRẢ NCC | 1 | Bình Minh |  | 04/10/2026 | 300000 | Chi phí khác · Chuyển khoản Bình Minh',
      '3. PHIẾU CHI "CHI PHÍ" NGHI LÀ TRẢ NCC | 2 | Bình Minh |  | 02/10/2026 | 200000 | Chi phí khác · Thanh toán NCC Bình Minh',
      '3. PHIẾU CHI "CHI PHÍ" NGHI LÀ TRẢ NCC | 3 | cty á châu |  | 01/10/2026 | 5000000 | Chi phí khác · Trả tiền hàng cty Á Châu đợt 1',
      "4. PHIẾU CHI NCC LỆCH | 1 | cty á châu | PCNCC-T2 | 21/09/2026 | 100000 | số tiền phiếu 100000 · đã chia vào các khoản 0",
    ])
    expect(ra).toContain("=== XONG")
  })
})
