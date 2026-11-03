/**
 * Câu khám bộ nhớ máy sổ (chủ nhà 03/11/2026 gửi Observability: gói Free, RAM 409 MB, Swap ~800 MB cả ngày; rồi "đéo phải,
 * mày chưa nghĩ hết cách"). Chủ nhà dán vào SQL Editor của Supabase lúc đông người rồi gửi lại bảng — nên câu phải:
 * MỘT câu (SQL Editor chỉ hiện kết quả câu cuối), CHỈ ĐỌC, và không được hỏng khi sổ thiếu bảng Realtime / pg_cron hoặc vai
 * đọc thiếu quyền (hỏng một chỗ là mất cả bảng). Bộ thử SQL: scripts/sql/thu-kham-bo-nho.sql (một giao dịch, ROLLBACK).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const SQL = readFileSync(resolve(ROOT, "supabase/diagnostics/kham_bo_nho.sql"), "utf-8")

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

describe("kham_bo_nho.sql — một câu, chỉ đọc, bảng tuỳ chọn có chặn", () => {
  it("đúng MỘT câu: một dấu chấm phẩy, ở cuối", () => {
    expect(LENH.split(";").length - 1).toBe(1)
    expect(LENH.trimEnd().endsWith(";")).toBe(true)
  })

  it("chỉ đọc: không có lệnh ghi / đổi cấu trúc / đổi cài đặt", () => {
    expect(LENH).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|SET|RESET)\b/i)
    expect(LENH).toMatch(/^\s*WITH\b/)
  })

  it("bảng Realtime / pg_cron chỉ đọc trong chuỗi query_to_xml, sau phép kiểm USAGE schema + SELECT bảng", () => {
    // Ngoài chuỗi không có câu nào đọc thẳng schema realtime / cron (thiếu quyền là cả câu hỏng).
    expect(LENH).not.toMatch(/\b(realtime|cron)\.[a-z_]+/i)
    expect(SQL).toContain("has_schema_privilege(c.relnamespace, 'USAGE') AND has_table_privilege(c.oid, 'SELECT')")
    // Tra bảng qua catalog, không qua to_regclass (to_regclass('cron.job') vẫn ném lỗi khi thiếu USAGE schema).
    expect(LENH).not.toMatch(/to_regclass/i)
    // Mỗi chỗ đọc bảng tuỳ chọn là chuỗi của một query_to_xml, và CASE bọc query_to_xml ấy xét doc_duoc trước.
    const cho = Array.from(SQL.matchAll(/FROM (realtime|cron)\.[a-z_]+/g)).map((m) => m.index!)
    expect(cho.length).toBeGreaterThanOrEqual(4)
    for (const i of cho) {
      const truoc = SQL.slice(0, i)
      const q = truoc.lastIndexOf("query_to_xml(")
      expect(q, SQL.slice(i, i + 60)).toBeGreaterThan(0)
      const caseBoc = truoc.slice(0, q).lastIndexOf("CASE WHEN")
      expect(caseBoc, SQL.slice(i, i + 60)).toBeGreaterThan(0)
      expect(truoc.slice(caseBoc, q), SQL.slice(i, i + 60)).toContain("doc_duoc")
    }
  })

  it("đủ 10 phần, xếp theo SỐ phần (10 sau 9, không xếp chữ)", () => {
    for (let n = 1; n <= 10; n++) expect(SQL).toMatch(new RegExp(`'${n}\\. [^']+'`))
    expect(SQL).toContain("ORDER BY split_part(phan, '.', 1)::int, hang;")
  })

  it("CLAUDE.md ghi luật: câu khám bộ nhớ, hạ shared_buffers không bớt RAM thật, gói Free không sao lưu", () => {
    const md = readFileSync(resolve(ROOT, "CLAUDE.md"), "utf-8")
    expect(md).toContain("`supabase/diagnostics/kham_bo_nho.sql`")
    expect(md).toContain("**Hạ `shared_buffers` không bớt RAM thật**")
    expect(md).toContain("**Gói Free không có sao lưu tự động**")
  })
})

/** Postgres thử có sẵn không (máy CI không có thì bỏ qua) — có mà bộ thử hỏng thì bài phải ĐỎ, không được bỏ qua. */
const KET_NOI = ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
  "-d", process.env.PG_THU_DB || "npp_tong"]
function coPgThu(): boolean {
  try {
    execFileSync("psql", [...KET_NOI, "-At", "-c", "SELECT 1"], { stdio: ["ignore", "pipe", "pipe"], timeout: 20000 })
    return true
  } catch {
    return false
  }
}
describe.skipIf(!coPgThu())("kham_bo_nho.sql trên Postgres thử", () => {
  it("vai đủ quyền đọc ra đăng ký Realtime + lịch chạy; vai thường không hỏng câu, ghi 'không có quyền đọc'", () => {
    const ra = execFileSync("psql", [...KET_NOI, "-q", "-At", "-F", " | ", "-f", resolve(ROOT, "scripts/sql/thu-kham-bo-nho.sql")], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000,
    })
    expect(ra).toContain("=== XONG")
    const du = ra.slice(ra.indexOf("=== DU_QUYEN"), ra.indexOf("=== VAI_THUONG"))
    const thuong = ra.slice(ra.indexOf("=== VAI_THUONG"), ra.indexOf("=== XONG"))
    for (const phan of [du, thuong]) {
      for (const n of [1, 4, 5, 7, 8, 9, 10]) expect(phan, `phần ${n}`).toMatch(new RegExp(`^${n}\\. `, "m"))
      expect(phan.indexOf("\n10. "), "phần 10 đứng sau phần 9").toBeGreaterThan(phan.indexOf("\n9. "))
    }
    expect(du).toContain("9. ĐĂNG KÝ REALTIME | 0 | tổng số đăng ký | 3 | cỡ bảng")
    expect(du).toContain("9. ĐĂNG KÝ REALTIME | 1 | notifications | 2 | cũ nhất 95 phút")
    expect(du).toContain("10. LỊCH CHẠY NỀN | 1 | release-stale-entity-locks · * * * * * |  | đang bật")
    expect(du).toContain("10. LỊCH CHẠY NỀN | 100 | sổ lịch sử chạy (cron.job_run_details) | 1440 | dòng")
    expect(thuong).toContain("9. ĐĂNG KÝ REALTIME | 0 | tổng số đăng ký |  | không có quyền đọc")
    expect(thuong).toContain("10. LỊCH CHẠY NỀN | 100 | sổ lịch sử chạy (cron.job_run_details) |  | không có quyền đọc")
    expect(thuong).not.toContain("release-stale-entity-locks")
  })
})
