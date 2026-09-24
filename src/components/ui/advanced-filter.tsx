"use client"

import { useEffect, useState } from "react"
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CompactSelect } from "@/components/ui/compact-select"
import {
  NHAN_TOAN_TU, TOAN_TU_THEO_KIEU, dieuKienDu, dieuKienMoi,
  type DieuKienLoc, type ToanTu, type TruongLoc,
} from "@/lib/search/advanced-filter"

/**
 * BỘ LỌC NÂNG CAO — chọn trường bất kỳ → phép so → giá trị (chủ nhà 24/09/2026).
 * Dùng chung cho mọi danh sách; luật lọc ở `@/lib/search/advanced-filter`.
 *
 * ⚠ SỬA TRÊN BẢN NHÁP, BẤM "ÁP DỤNG" MỚI LỌC. Lọc theo từng phím gõ là mỗi chữ
 *   một lượt gọi máy chủ, và dòng đang gõ dở ("≥ 1") lọc ra một danh sách sai.
 */
export function AdvancedFilter({
  truong,
  value,
  onApply,
  className,
}: {
  truong: readonly TruongLoc[]
  value: readonly DieuKienLoc[]
  onApply: (next: DieuKienLoc[]) => void
  className?: string
}) {
  const [mo, setMo] = useState(false)
  const [nhap, setNhap] = useState<DieuKienLoc[]>([])
  useEffect(() => {
    if (mo) setNhap(value.length ? value.map((d) => ({ ...d })) : [dieuKienMoi(truong)])
  }, [mo, value, truong])
  const dangAp = value.filter((d) => dieuKienDu(d, truong.find((t) => t.key === d.truong))).length
  const sua = (id: string, p: Partial<DieuKienLoc>) => setNhap((c) => c.map((d) => (d.id === id ? { ...d, ...p } : d)))

  return (
    <Popover open={mo} onOpenChange={setMo}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={className} aria-label="Lọc nâng cao">
          <SlidersHorizontal className="mr-1.5 h-4 w-4" />
          Lọc nâng cao
          {dangAp > 0 && (
            <span className="ml-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
              {dangAp}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,640px)] p-3">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
          Lọc theo trường bất kỳ — mọi điều kiện cùng đúng
        </p>
        <div className="space-y-2">
          {nhap.map((d, i) => {
            const t = truong.find((x) => x.key === d.truong)
            const ops = t ? TOAN_TU_THEO_KIEU[t.kieu] : []
            const canGiaTri = d.toanTu !== "rong" && d.toanTu !== "co_gia_tri"
            const kieuO = t?.kieu === "date" ? "date" : "text"
            return (
              <div key={d.id} data-testid="dieu-kien-loc" className="flex flex-wrap items-center gap-1.5">
                <CompactSelect
                  ariaLabel={`Trường điều kiện ${i + 1}`}
                  className="h-9 w-[170px] text-sm"
                  value={d.truong}
                  options={truong.map((x) => ({ value: x.key, label: x.nhan }))}
                  onChange={(k) => {
                    const moi = dieuKienMoi(truong, k)
                    sua(d.id, { truong: k, toanTu: moi.toanTu, giaTri: moi.giaTri, giaTri2: "" })
                  }}
                />
                <CompactSelect
                  ariaLabel={`Phép so điều kiện ${i + 1}`}
                  className="h-9 w-[130px] text-sm"
                  value={d.toanTu}
                  options={ops.map((o) => ({ value: o, label: NHAN_TOAN_TU[o] }))}
                  onChange={(o) => sua(d.id, { toanTu: o as ToanTu })}
                />
                {canGiaTri && t && (t.kieu === "enum" || t.kieu === "bool") ? (
                  <CompactSelect
                    ariaLabel={`Giá trị điều kiện ${i + 1}`}
                    className="h-9 min-w-[150px] flex-1 text-sm"
                    value={d.giaTri}
                    options={t.kieu === "bool" ? [{ value: "true", label: "Có" }, { value: "false", label: "Không" }] : [...(t.luaChon ?? [])]}
                    onChange={(v) => sua(d.id, { giaTri: v })}
                  />
                ) : canGiaTri ? (
                  <>
                    <Input
                      aria-label={`Giá trị điều kiện ${i + 1}`}
                      type={kieuO}
                      inputMode={t?.kieu === "number" ? "decimal" : undefined}
                      className="h-9 min-w-[120px] flex-1"
                      value={d.giaTri}
                      onChange={(e) => sua(d.id, { giaTri: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") { onApply(nhap); setMo(false) } }}
                    />
                    {d.toanTu === "khoang" && (
                      <Input
                        aria-label={`Đến giá trị điều kiện ${i + 1}`}
                        type={kieuO}
                        inputMode={t?.kieu === "number" ? "decimal" : undefined}
                        className="h-9 min-w-[120px] flex-1"
                        value={d.giaTri2 ?? ""}
                        onChange={(e) => sua(d.id, { giaTri2: e.target.value })}
                      />
                    )}
                  </>
                ) : (
                  <span className="flex-1" />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0"
                  aria-label={`Bỏ điều kiện ${i + 1}`}
                  onClick={() => setNhap((c) => c.filter((x) => x.id !== d.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )
          })}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setNhap((c) => [...c, dieuKienMoi(truong)])}>
            <Plus className="mr-1 h-4 w-4" /> Thêm điều kiện
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => { onApply([]); setMo(false) }}>
            Xoá hết
          </Button>
          <Button size="sm" onClick={() => { onApply(nhap); setMo(false) }}>
            Áp dụng
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
