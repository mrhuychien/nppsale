import { createClient } from "@/lib/supabase/client"
import type { Entity, ExistingOpening, PlanRow } from "./parse"
import type { Kind } from "./schema"

/**
 * Nạp dữ liệu và ghi kế hoạch công nợ đầu kỳ.
 *
 * Lớp mỏng cố ý: mọi quyết định "ghi cái gì" nằm ở `parse.ts` (thuần, có
 * test). Ở đây chỉ có truy vấn và vòng lặp ghi.
 */

/** Trần số bản ghi nạp về một lượt. NPP lớn nhất đang có ~4.000 khách. */
const FETCH_CAP = 5000

export type LoadResult = {
  entities: Entity[]
  existing: ExistingOpening[]
  /** NVBH phụ trách chính, theo customer_id. Rỗng với NCC. */
  primaryRep: Record<string, string>
  /** true khi chạm trần — nói ra, không im lặng cắt bớt. */
  truncated: boolean
}

export async function loadForKind(kind: Kind, orgId: string): Promise<LoadResult> {
  const supabase = createClient()

  if (kind === "customer") {
    const [custRes, openRes, assignRes] = await Promise.all([
      supabase
        .from("customers")
        .select("id, store_name, phone")
        .eq("org_id", orgId)
        .order("store_name")
        .limit(FETCH_CAP),
      supabase
        .from("receivables")
        .select("id, customer_id, amount, paid, due_date, note")
        .eq("org_id", orgId)
        .eq("opening_balance", true)
        .limit(FETCH_CAP),
      supabase
        .from("customer_assignments")
        .select("customer_id, user_id, role, status")
        .eq("role", "primary")
        .limit(FETCH_CAP),
    ])
    const err = [custRes, openRes, assignRes].find((r) => r.error)?.error
    if (err) throw new Error(err.message)

    const customers = (custRes.data || []) as Array<{ id: string; store_name: string; phone: string | null }>
    const primaryRep: Record<string, string> = {}
    for (const a of (assignRes.data || []) as Array<{ customer_id: string; user_id: string; status: string | null }>) {
      // Chỉ lấy phân công còn hiệu lực. Gán nợ cho NVBH đã nghỉ thì khoản
      // đó biến mất khỏi màn của mọi người đang đi thu.
      if (a.status && a.status !== "active") continue
      if (!primaryRep[a.customer_id]) primaryRep[a.customer_id] = a.user_id
    }
    return {
      entities: customers.map((c) => ({ id: c.id, label: c.store_name, altKey: c.phone || "" })),
      existing: ((openRes.data || []) as Array<{
        id: string; customer_id: string; amount: number; paid: number; due_date: string | null; note: string | null
      }>).map((r) => ({
        id: r.id, entityId: r.customer_id, amount: Number(r.amount || 0),
        paid: Number(r.paid || 0), dueDate: r.due_date, note: r.note,
      })),
      primaryRep,
      truncated: customers.length >= FETCH_CAP,
    }
  }

  const [supRes, openRes] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, code")
      .eq("org_id", orgId)
      .order("name")
      .limit(FETCH_CAP),
    supabase
      .from("payables")
      .select("id, supplier_id, amount, paid, due_date, notes")
      .eq("org_id", orgId)
      .eq("opening_balance", true)
      .limit(FETCH_CAP),
  ])
  const err = [supRes, openRes].find((r) => r.error)?.error
  if (err) throw new Error(err.message)

  const suppliers = (supRes.data || []) as Array<{ id: string; name: string; code: string | null }>
  return {
    entities: suppliers.map((s) => ({ id: s.id, label: s.name, altKey: s.code || "" })),
    existing: ((openRes.data || []) as Array<{
      id: string; supplier_id: string; amount: number; paid: number; due_date: string | null; notes: string | null
    }>).map((r) => ({
      id: r.id, entityId: r.supplier_id, amount: Number(r.amount || 0),
      paid: Number(r.paid || 0), dueDate: r.due_date, note: r.notes,
    })),
    primaryRep: {},
    truncated: suppliers.length >= FETCH_CAP,
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
        await supabase
          .from(table)
          .update({ amount: r.amount, due_date: r.dueDate, [noteColumn]: r.note })
          .eq("id", r.existingId as string)
          .throwOnError()
        res.updated++
      } else if (r.action === "delete") {
        await supabase.from(table).delete().eq("id", r.existingId as string).throwOnError()
        res.deleted++
      }
    } catch (e) {
      res.failures.push({
        rowNo: r.rowNo,
        label: r.label,
        message: e instanceof Error ? e.message : "lỗi không xác định",
      })
    }
  }
  return res
}
