import { createClient } from "@/lib/supabase/client"
import type { Entity, ExistingOpening, PlanRow } from "./parse"
import type { Kind } from "./schema"
import { errorMessage } from "@/lib/errors"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"

/**
 * Nạp dữ liệu và ghi kế hoạch công nợ đầu kỳ.
 *
 * Lớp mỏng cố ý: mọi quyết định "ghi cái gì" nằm ở `parse.ts` (thuần, có
 * test). Ở đây chỉ có truy vấn và vòng lặp ghi.
 */

export type LoadResult = {
  entities: Entity[]
  existing: ExistingOpening[]
  /** NVBH phụ trách chính, theo customer_id. Rỗng với NCC. */
  primaryRep: Record<string, string>
  /** true khi chạm trần — nói ra, không im lặng cắt bớt. */
  truncated: boolean
}

/**
 * Đọc ĐỦ một bảng, theo trang.
 *
 * ⚠ `.limit(5000)` CŨ KHÔNG CÓ TÁC DỤNG. PostgREST có `db.max_rows = 1000`
 *   — gửi limit lớn hơn thì máy chủ vẫn trả 1000 và KHÔNG báo gì, nên cờ
 *   `truncated` (so với 5000) không bao giờ bật. Với số dư đầu kỳ, đó là
 *   lỗi TIỀN: khách sau vị trí 1000 không thấy khoản đầu kỳ đã có, nên lần
 *   nhập lại file tạo THÊM một khoản — công nợ nhân đôi.
 *
 * ⚠ SẮP THEO `id` để các trang không chồng / sót nhau (trang song song
 *   mà thứ tự không duy nhất thì Postgres được phép trả mỗi lần một kiểu).
 */
async function docDu<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>
): Promise<{ rows: T[]; truncated: boolean }> {
  const r = await fetchAllForAggregate<T>(build)
  if (r.error) throw new Error(r.error)
  return { rows: r.rows, truncated: r.truncated }
}

export async function loadForKind(kind: Kind, orgId: string): Promise<LoadResult> {
  const supabase = createClient()

  if (kind === "customer") {
    const [custRes, openRes, assignRes] = await Promise.all([
      docDu<{ id: string; store_name: string; phone: string | null }>((from, to) =>
        supabase.from("customers").select("id, store_name, phone", { count: "exact" })
          .eq("org_id", orgId).order("id").range(from, to)),
      docDu<{ id: string; customer_id: string; amount: number; paid: number; due_date: string | null; note: string | null; status: string | null }>(
        (from, to) =>
          supabase.from("receivables").select("id, customer_id, amount, paid, due_date, note, status", { count: "exact" })
            .eq("org_id", orgId).eq("opening_balance", true).order("id").range(from, to)),
      docDu<{ customer_id: string; user_id: string; status: string | null }>((from, to) =>
        supabase.from("customer_assignments").select("customer_id, user_id, status", { count: "exact" })
          .eq("role", "primary").order("id").range(from, to)),
    ])

    const customers = custRes.rows.slice().sort((a, b) => a.store_name.localeCompare(b.store_name, "vi"))
    const primaryRep: Record<string, string> = {}
    for (const a of assignRes.rows) {
      // Chỉ lấy phân công còn hiệu lực. Gán nợ cho NVBH đã nghỉ thì khoản
      // đó biến mất khỏi màn của mọi người đang đi thu.
      if (a.status && a.status !== "active") continue
      if (!primaryRep[a.customer_id]) primaryRep[a.customer_id] = a.user_id
    }
    return {
      entities: customers.map((c) => ({ id: c.id, label: c.store_name, altKey: c.phone || "" })),
      existing: openRes.rows.map((r) => ({
        id: r.id, entityId: r.customer_id, amount: Number(r.amount || 0),
        paid: Number(r.paid || 0), dueDate: r.due_date, note: r.note, status: r.status,
      })),
      primaryRep,
      truncated: custRes.truncated || openRes.truncated || assignRes.truncated,
    }
  }

  const [supRes, openRes] = await Promise.all([
    docDu<{ id: string; name: string; code: string | null }>((from, to) =>
      supabase.from("suppliers").select("id, name, code", { count: "exact" })
        .eq("org_id", orgId).order("id").range(from, to)),
    docDu<{ id: string; supplier_id: string; amount: number; paid: number; due_date: string | null; notes: string | null; status: string | null }>(
      (from, to) =>
        supabase.from("payables").select("id, supplier_id, amount, paid, due_date, notes, status", { count: "exact" })
          .eq("org_id", orgId).eq("opening_balance", true).order("id").range(from, to)),
  ])

  const suppliers = supRes.rows.slice().sort((a, b) => a.name.localeCompare(b.name, "vi"))
  return {
    entities: suppliers.map((s) => ({ id: s.id, label: s.name, altKey: s.code || "" })),
    existing: openRes.rows.map((r) => ({
      id: r.id, entityId: r.supplier_id, amount: Number(r.amount || 0),
      paid: Number(r.paid || 0), dueDate: r.due_date, note: r.notes, status: r.status,
    })),
    primaryRep: {},
    truncated: supRes.truncated || openRes.truncated,
  }
}

export type CommitResult = {
  created: number
  updated: number
  deleted: number
  failures: Array<{ rowNo: number; label: string; message: string }>
}

/**
 * Ghi kế hoạch.
 *
 * GHI TỪNG DÒNG, KHÔNG gộp một lệnh: một dòng hỏng (khách bị xoá giữa
 * chừng, đụng ràng buộc) không được kéo theo 499 dòng còn lại. Dòng nào
 * hỏng thì ghi vào `failures` kèm số dòng Excel để người ta sửa đúng chỗ.
 *
 * Hệ quả đã biết: KHÔNG có giao dịch bao trùm. Ghi nửa chừng mà mạng
 * đứt thì phần đã ghi vẫn nằm đó — nhưng nhập lại chính file đó là cập
 * nhật đúng chỗ cũ (chỉ mục duy nhất ở migration 102 lo việc này), nên
 * lần chạy thứ hai hội tụ chứ không nhân đôi.
 */
export async function commitPlan(
  kind: Kind,
  orgId: string,
  rows: PlanRow[],
  primaryRep: Record<string, string>
): Promise<CommitResult> {
  const supabase = createClient()
  const table = kind === "customer" ? "receivables" : "payables"
  const fkColumn = kind === "customer" ? "customer_id" : "supplier_id"
  const noteColumn = kind === "customer" ? "note" : "notes"
  const res: CommitResult = { created: 0, updated: 0, deleted: 0, failures: [] }

  for (const r of rows) {
    try {
      if (r.action === "create") {
        const payload: Record<string, unknown> = {
          org_id: orgId,
          [fkColumn]: r.entityId,
          amount: r.amount,
          paid: 0,
          due_date: r.dueDate,
          status: "open",
          opening_balance: true,
          [noteColumn]: r.note,
        }
        // NVBH phụ trách PHẢI được gán: policy "Sales see own receivables"
        // lọc theo sales_user_id, để trống là khoản nợ vô hình với chính
        // người đi thu nó.
        if (kind === "customer" && r.entityId && primaryRep[r.entityId]) {
          payload.sales_user_id = primaryRep[r.entityId]
        }
        await supabase.from(table).insert(payload).throwOnError()
        res.created++
      } else if (r.action === "update") {
        await ghiPhaiTrungDong(
          supabase
            .from(table)
            .update({
              amount: r.amount,
              due_date: r.dueDate,
              [noteColumn]: r.note,
              // Vượt ranh "đã trả đủ" thì trạng thái phải đổi theo — không
              // thì phần nợ mới bị mọi hàm tổng (`status <> 'paid'`) bỏ qua.
              ...(r.status ? { status: r.status } : {}),
            })
            .eq("id", r.existingId as string)
        )
        res.updated++
      } else if (r.action === "delete") {
        await ghiPhaiTrungDong(supabase.from(table).delete().eq("id", r.existingId as string))
        res.deleted++
      }
    } catch (e) {
      res.failures.push({
        rowNo: r.rowNo,
        label: r.label,
        message: errorMessage(e, "lỗi không xác định"),
      })
    }
  }
  return res
}
