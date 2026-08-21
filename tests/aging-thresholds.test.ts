import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getAgingStatus } from "@/lib/utils"

/**
 * Ngưỡng phân nhóm tuổi nợ hiện nằm ở HAI nơi:
 *
 *   1. `getAgingStatus()` trong src/lib/utils.ts — dùng cho từng dòng công
 *      nợ trên giao diện (tô màu badge).
 *   2. Hàm SQL `receivables_summary()` trong migration 093 — dùng cho các ô
 *      tổng ở đầu trang /receivables.
 *
 *  Đây là cái giá của việc chuyển sang cộng ở phía database. Nếu sau này ai
 *  đó sửa ngưỡng ở một bên mà quên bên kia, trang Công nợ sẽ hiện tổng nhóm
 *  "Quá hạn" khác hẳn số badge đỏ đếm được bên dưới — và không có lỗi nào
 *  báo cho ai biết.
 *
 *  Test này khoá cả hai lại với nhau: nó đọc thẳng file SQL và đối chiếu.
 */

const SQL_RAW = readFileSync(
  resolve(__dirname, "../supabase/migrations/093_aggregate_functions.sql"),
  "utf-8"
)

/**
 * Bỏ dòng comment trước khi kiểm. Cần thiết vì chính file SQL có đoạn ghi
 * chú "TUYỆT ĐỐI KHÔNG dùng SECURITY DEFINER" — nếu không lọc, test sẽ đỏ
 * vì đúng cái câu cảnh báo đó.
 */
const SQL = SQL_RAW.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n")

/** Ngày quá hạn → nhóm, theo đúng thứ tự CASE trong hàm SQL. */
const SQL_THRESHOLDS: Array<[number, string]> = [
  [0, "current"],
  [30, "warning"],
  [60, "overdue"],
]

/** Dựng một ngày đến hạn cách hôm nay đúng `daysOverdue` ngày. */
function dueDateOverdueBy(daysOverdue: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - daysOverdue)
  return d.toISOString().slice(0, 10)
}

describe("ngưỡng tuổi nợ — SQL và TypeScript phải khớp nhau", () => {
  it("file SQL dùng đúng các ngưỡng mà getAgingStatus đang dùng", () => {
    // Bắt đúng khối CASE của receivables_summary, không phải chỗ khác.
    const block = SQL.slice(
      SQL.indexOf("CREATE FUNCTION public.receivables_summary()"),
      SQL.indexOf("$$;", SQL.indexOf("CREATE FUNCTION public.receivables_summary()"))
    )
    for (const [days, bucket] of SQL_THRESHOLDS) {
      const re = new RegExp(
        `\\(CURRENT_DATE - due_date\\) <= ${days}\\s+THEN '${bucket}'`
      )
      expect(
        re.test(block),
        `SQL thiếu nhánh "<= ${days} → ${bucket}". Nếu bạn vừa đổi ngưỡng ở ` +
          `getAgingStatus() thì phải đổi cả trong migration 093.`
      ).toBe(true)
    }
    // Nhánh cuối: quá 60 ngày.
    expect(/ELSE 'critical'/.test(block)).toBe(true)
  })

  it("SQL không còn nhánh nào ngoài 4 nhóm đã biết", () => {
    const block = SQL.slice(
      SQL.indexOf("CREATE FUNCTION public.receivables_summary()"),
      SQL.indexOf("$$;", SQL.indexOf("CREATE FUNCTION public.receivables_summary()"))
    )
    const buckets = Array.from(block.matchAll(/THEN '(\w+)'|ELSE '(\w+)'/g)).map(
      (m) => m[1] ?? m[2]
    )
    expect(new Set(buckets)).toEqual(
      new Set(["current", "warning", "overdue", "critical"])
    )
  })

  it("getAgingStatus phân nhóm đúng tại từng ranh giới", () => {
    // Nếu những khẳng định này đổi thì SQL cũng phải đổi theo.
    expect(getAgingStatus(dueDateOverdueBy(-1))).toBe("current") // chưa đến hạn
    expect(getAgingStatus(dueDateOverdueBy(0))).toBe("current")
    expect(getAgingStatus(dueDateOverdueBy(1))).toBe("warning")
    expect(getAgingStatus(dueDateOverdueBy(30))).toBe("warning")
    expect(getAgingStatus(dueDateOverdueBy(31))).toBe("overdue")
    expect(getAgingStatus(dueDateOverdueBy(60))).toBe("overdue")
    expect(getAgingStatus(dueDateOverdueBy(61))).toBe("critical")
  })
})

describe("migration 093 — các bất biến về bảo mật", () => {
  it("KHÔNG hàm nào được là SECURITY DEFINER", () => {
    // SECURITY DEFINER ở đây là mở toang toàn bộ số liệu tài chính cho mọi
    // vai trò: hàm sẽ chạy bằng quyền chủ sở hữu và bỏ qua RLS, mà không có
    // lỗi nào báo ra. Nếu ai đó thêm vào "cho tiện", test này phải đỏ.
    expect(SQL).not.toMatch(/SECURITY\s+DEFINER/i)
  })

  it("mọi hàm đều lọc theo org_id của người gọi", () => {
    const bodies = Array.from(
      SQL.matchAll(/CREATE FUNCTION public\.(\w+)\([\s\S]*?\n\$\$;/g)
    )
    expect(bodies.length).toBeGreaterThan(0)
    for (const m of bodies) {
      expect(
        m[0].includes("public.user_org_id()"),
        `Hàm ${m[1]} không lọc org_id — phòng vệ chiều sâu, đừng chỉ dựa vào RLS.`
      ).toBe(true)
    }
  })

  it("mọi hàm đều DROP trước khi CREATE (chạy lại được)", () => {
    // Bài học từ migration 091: thiếu DROP thì lần chạy thứ hai lỗi
    // "already exists" và dừng giữa chừng, để lại database dở dang.
    const created = Array.from(SQL.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)).map((m) => m[1])
    const dropped = Array.from(SQL.matchAll(/DROP FUNCTION IF EXISTS public\.(\w+)\(/g)).map((m) => m[1])
    for (const name of created) {
      expect(dropped, `Hàm ${name} thiếu DROP FUNCTION IF EXISTS`).toContain(name)
    }
  })

  it("mọi hàm đều được GRANT cho authenticated, và không hàm nào cấp cho anon", () => {
    const created = Array.from(SQL.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)).map((m) => m[1])
    for (const name of created) {
      expect(
        SQL.includes(`GRANT EXECUTE ON FUNCTION public.${name}(`),
        `Hàm ${name} chưa được GRANT — người dùng sẽ nhận lỗi permission denied.`
      ).toBe(true)
    }
    expect(SQL).not.toMatch(/GRANT EXECUTE[^\n]*\bTO\b[^\n]*\banon\b/)
  })
})
