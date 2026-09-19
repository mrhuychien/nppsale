"use client"

import { useEffect, useState } from "react"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { clearOrgCache, useOrg } from "@/hooks/use-org"
import { createClient } from "@/lib/supabase/client"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"
import { loadOrgHeader, EMPTY_ORG_HEADER, type OrgHeader } from "@/lib/org/header"

/**
 * ⚠ ĐỊA CHỈ · ĐIỆN THOẠI · MST NẰM TRONG `organizations.settings` JSONB,
 * không phải cột trên bảng. Xem `lib/org/header` — đó là chỗ DUY NHẤT
 * đọc chúng, và màn `/setup` cũng ghi vào đúng ba khoá ấy.
 *
 * ⚠ VÌ SAO THÊM VÀO ĐÂY. Ba ô này trước chỉ có ở trình hướng dẫn cài đặt
 * ban đầu (`/setup`) — chạy MỘT LẦN. Ai bỏ qua bước đó, hoặc chuyển trụ
 * sở, hoặc đổi số điện thoại, thì không có đường nào sửa, và mọi tờ hóa
 * đơn in ra thiếu hẳn phần đầu mà không có gì báo.
 */
export default function OrgSettingsPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { org } = useOrg()
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [phone, setPhone] = useState("")
  const [taxCode, setTaxCode] = useState("")
  const [allowOversell, setAllowOversell] = useState(false)
  const [loading, setLoading] = useState(false)
  const [header, setHeader] = useState<OrgHeader>(EMPTY_ORG_HEADER)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    if (org) {
      setName(org.name)
      setAllowOversell(org.allow_oversell)
    }
  }, [org])

  // Phần đầu chứng từ đọc riêng: `useOrg` chỉ lấy `name` + `allow_oversell`.
  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      const h = await loadOrgHeader(createClient(), org.id)
      if (cancelled) return
      setHeader(h)
      setAddress(h.address ?? "")
      setPhone(h.phone ?? "")
      setTaxCode(h.taxCode ?? "")
    })()
    return () => { cancelled = true }
  }, [org?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const handleSave = async () => {
    if (!org) return
    setLoading(true)
    try {
      /**
       * ⚠ ĐỌC `settings` RỒI GHI ĐÈ CÓ GỘP. Ghi thẳng một object ba khoá
       * là XOÁ SẠCH mọi khoá khác đang nằm trong đó — `setup_completed_at`,
       * `email`, và bất cứ thứ gì thêm sau này. Chúng biến mất không một
       * lời báo, và banner "chưa cài đặt" quay lại trên trang chủ.
       */
      const { data: row, error: readErr } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", org.id)
        .maybeSingle()
      if (readErr) throw readErr
      const existing =
        ((row as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>
      // ⚠ Chuỗi rỗng ghi thành `null`: `orgHeaderFrom` coi cả hai là
      //   "chưa có", nên giữ hai cách biểu diễn là tự tạo ra lệch.
      const trimmed = (v: string) => (v.trim() === "" ? null : v.trim())
      const { error } = await supabase
        .from("organizations")
        .update({
          name,
          allow_oversell: allowOversell,
          settings: {
            ...existing,
            address: trimmed(address),
            phone: trimmed(phone),
            tax_code: trimmed(taxCode),
          },
        })
        .eq("id", org.id)
      if (error) throw error
      setHeader({ name, address: trimmed(address), phone: trimmed(phone), taxCode: trimmed(taxCode) })
      clearOrgCache()
      toast({ title: "Đã cập nhật thông tin tổ chức" })
    } catch (err) {
      toast({
        title: "Lỗi",
        description: errorMessage(err),
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Cấu hình tổ chức" backHref="/settings" />

      <Card>
        <CardHeader><CardTitle>Thông tin NPP</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Tên NPP</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Địa chỉ</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="VD: 13 Hoàng Minh Thảo, P. Trần Nguyên Hãn, Q. Lê Chân, Hải Phòng"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Điện thoại</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="VD: 0912420924"
              />
            </div>
            <div className="space-y-2">
              <Label>Mã số thuế</Label>
              <Input value={taxCode} onChange={(e) => setTaxCode(e.target.value)} />
            </div>
          </div>
          {/* ⚠ NÓI RA BA Ô NÀY ĐI ĐÂU. Không có câu này thì chúng trông
              như thông tin hành chính không ai đọc, và người dùng bỏ
              trống — rồi hóa đơn in ra thiếu phần đầu. */}
          <p className="rounded-xl bg-surface-container-low px-3 py-2.5 text-xs leading-relaxed text-on-surface-variant">
            Ba ô trên in ở <b>đầu mỗi tờ hóa đơn bán và đơn đặt hàng</b>. Bỏ trống thì
            dòng tương ứng không hiện trên giấy.
            {!header.address && !header.phone && (
              <b className="mt-1 block text-[#b54708]">
                Hiện chưa có địa chỉ và điện thoại — tờ in đang thiếu phần đầu.
              </b>
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quy tắc bán hàng</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-xl border bg-background p-3">
            <div className="space-y-1">
              <Label className="text-sm font-semibold">
                Cho phép bán vượt tồn kho
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Bật để nhân viên tạo được đơn dù tồn không đủ (đơn đặt
                trước). Khi pick, tồn kho sẽ tạm về âm cho đến khi nhập
                hàng bổ sung. Tắt (mặc định) sẽ chặn ngay trên form và
                hiện lỗi &ldquo;Vượt tồn kho&rdquo;.
              </p>
            </div>
            <Switch
              checked={allowOversell}
              onCheckedChange={setAllowOversell}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={loading}>
          {loading ? "Đang lưu..." : "Lưu thay đổi"}
        </Button>
      </div>
    </div>
  )
}
