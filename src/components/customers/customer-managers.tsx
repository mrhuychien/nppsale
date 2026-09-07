"use client"

import { Badge } from "@/components/ui/badge"
import { AlertTriangle, UserCog } from "lucide-react"
import { managersWarning, scopeLabel, type Manager } from "@/lib/customers/managers"

/**
 * Ai phụ trách điểm bán này, và mỗi người bán hàng gì.
 *
 * Hiện ĐỦ danh sách chứ không chỉ người phụ trách chính: một điểm bán
 * thường có nhiều người cùng vào, mỗi người một ngành hàng, và chỉ hiện
 * một tên là câu trả lời sai cho câu hỏi "gọi ai bây giờ".
 */
export function CustomerManagers({ managers }: { managers: Manager[] }) {
  const warning = managersWarning(managers)

  return (
    <div className="space-y-2">
      {managers.length === 0 ? (
        <p className="text-sm text-on-surface-variant">Chưa phân công cho ai.</p>
      ) : (
        <ul className="space-y-2">
          {managers.map((m) => (
            <li
              key={m.userId}
              className="flex items-start justify-between gap-3 rounded-lg border border-outline-variant p-2.5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold">{m.fullName}</span>
                  <Badge variant={m.isPrimary ? "default" : "secondary"}>
                    {m.isPrimary ? "Phụ trách chính" : "Phụ"}
                  </Badge>
                  {(m.userInactive || m.unknownUser) && (
                    <Badge variant="danger">Đã nghỉ</Badge>
                  )}
                </div>
                {/* Ngành hàng là lý do có nhiều người ở cùng một điểm bán
                    — không hiện thì danh sách tên trông như trùng lặp. */}
                <p
                  className={`mt-0.5 text-xs ${
                    m.suppliers.length === 0 ? "text-[#b54708]" : "text-on-surface-variant"
                  }`}
                >
                  {scopeLabel(m)}
                </p>
              </div>
              <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-variant" />
            </li>
          ))}
        </ul>
      )}

      {warning && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-[#b54708]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {warning}
        </p>
      )}
    </div>
  )
}

/**
 * Bản gọn cho một ô trong bảng danh sách.
 *
 * Vẫn kèm ngành hàng: cột "phụ trách" mà chỉ có tên thì không trả lời
 * được câu hỏi thật sự ("ai lo hàng sữa ở điểm này").
 */
export function CustomerManagersCell({ managers, max = 2 }: { managers: Manager[]; max?: number }) {
  if (managers.length === 0) {
    return <span className="text-xs text-on-surface-variant">Chưa phân công</span>
  }
  const head = managers.slice(0, max)
  const rest = managers.length - head.length
  return (
    <div className="space-y-0.5">
      {head.map((m) => (
        <div key={m.userId} className="leading-tight">
          <span className={`text-xs ${m.isPrimary ? "font-semibold" : ""}`}>{m.fullName}</span>
          {(m.userInactive || m.unknownUser) && (
            <span className="ml-1 text-[10px] font-semibold text-error">(đã nghỉ)</span>
          )}
          <span className="block truncate text-[10px] text-on-surface-variant">
            {scopeLabel(m)}
          </span>
        </div>
      ))}
      {rest > 0 && (
        <span className="text-[10px] font-semibold text-on-surface-variant">
          +{rest} người nữa
        </span>
      )}
    </div>
  )
}
