"use client"

import { Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Check, CloudOff } from "lucide-react"
import { cn } from "@/lib/utils"

const LABEL: Record<string, { title: string; sub: string; badge: string; tone: "ok" | "wait" }> = {
  confirmed: {
    title: "Đã tạo và duyệt đơn",
    sub: "Đơn đã sang kho để soạn hàng.",
    badge: "Đã duyệt",
    tone: "ok",
  },
  draft: {
    title: "Đã tạo đơn — chờ duyệt",
    sub: "Quản lý sẽ duyệt trước khi kho soạn hàng.",
    badge: "Chờ duyệt",
    tone: "wait",
  },
  queued: {
    title: "Đã lưu đơn trên máy",
    sub: "Chưa có mạng. Đơn sẽ tự đẩy lên khi máy kết nối lại — không cần nhập lại.",
    badge: "Chờ đẩy lên",
    tone: "wait",
  },
}

function DoneBody() {
  const router = useRouter()
  const params = useSearchParams()
  const code = params.get("code") ?? ""
  const status = params.get("status") ?? "draft"
  const reason = params.get("reason") ?? ""
  const info = LABEL[status] ?? LABEL.draft
  const queued = status === "queued"

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-6 pb-nav pt-14 text-center">
      <div
        className={cn(
          "grid h-20 w-20 place-items-center rounded-[28px]",
          info.tone === "ok" ? "bg-tertiary/15 text-tertiary" : "bg-[#fff4e0] text-[#8a5a00]"
        )}
      >
        {queued ? <CloudOff className="h-10 w-10" /> : <Check className="h-10 w-10" strokeWidth={3} />}
      </div>
      <h1 className="mt-5 text-2xl font-extrabold">{info.title}</h1>
      <p className="mt-1.5 max-w-[300px] text-sm font-semibold leading-relaxed text-on-surface-variant">
        {info.sub}
      </p>

      <div className="mt-6 flex w-full flex-col gap-2.5 rounded-2xl bg-surface-container-lowest p-4 text-left shadow-card">
        <Row label="Mã đơn" value={code || "—"} />
        <Row label="Trạng thái" value={info.badge} />
        {/* ⚠ Lý do phải hiện Ở ĐÂY. Biết đơn "chờ duyệt" mà không biết vì
            sao thì nhân viên không sửa được gì, chỉ ngồi đợi. */}
        {reason && (
          <p className="border-t border-outline-variant/40 pt-2.5 text-[13px] font-semibold leading-snug text-on-surface-variant">
            {reason}
          </p>
        )}
      </div>

      <div className="mt-auto flex w-full flex-col gap-2.5 pb-6">
        <button
          type="button"
          onClick={() => router.push("/sell")}
          className="h-13 rounded-2xl bg-primary py-3.5 text-base font-extrabold text-on-primary"
        >
          Tạo đơn tiếp
        </button>
        <Link
          href="/orders"
          className="flex h-12 items-center justify-center rounded-2xl border-[1.5px] border-outline-variant text-sm font-extrabold text-on-surface"
        >
          Xem danh sách đơn
        </Link>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13px] font-semibold text-on-surface-variant">
      <span>{label}</span>
      <span className="font-extrabold text-on-surface">{value}</span>
    </div>
  )
}

export default function SellDonePage() {
  // `useSearchParams` cần Suspense ở App Router, nếu không cả trang bị ép
  // render động và build cảnh báo.
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <DoneBody />
    </Suspense>
  )
}
