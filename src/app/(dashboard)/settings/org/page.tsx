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
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"
import { loadOrgHeader, EMPTY_ORG_HEADER, type OrgHeader } from "@/lib/org/header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { mucCanDung } from "@/lib/ui/muc-chon"
import { QrSvg } from "@/components/printing/qr-svg"
import {
  chuoiVietQr, loiTaiKhoanNhan, NGAN_HANG_VIETQR, NOI_DUNG_QR_HOA_DON, taiKhoanNhanTu,
} from "@/lib/thanh-toan/vietqr"

/** Giá trị của lựa chọn "Không in mã QR" (Radix không nhận chuỗi rỗng làm giá trị). */
const KHONG_IN_QR = "khong"

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
  const [printNote, setPrintNote] = useState("")
  const [bankBin, setBankBin] = useState("")
  const [bankAccount, setBankAccount] = useState("")
  const [moNganHang, setMoNganHang] = useState(false)
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
      setPrintNote(h.printNote ?? "")
      setBankBin(h.bank?.bin ?? "")
      setBankAccount(h.bank?.soTaiKhoan ?? "")
    })()
    return () => { cancelled = true }
  }, [org?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  /* Mã xem thử (không ghi số tiền) — quét bằng app ngân hàng phải ra đúng tên chủ tài khoản của NPP. */
  const qrXemThu = chuoiVietQr({ bin: bankBin, soTaiKhoan: bankAccount })

  const handleSave = async () => {
    if (!org) return
    const loiTk = loiTaiKhoanNhan(bankBin, bankAccount)
    if (loiTk) {
      toast({ title: "Chưa lưu", description: loiTk, variant: "destructive" })
      return
    }
    const nhanTien = taiKhoanNhanTu(bankBin, bankAccount)
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
            print_note: trimmed(printNote),
            bank_bin: nhanTien?.bin ?? null,
            bank_account_no: nhanTien?.soTaiKhoan ?? null,
          },
        })
        .eq("id", org.id)
      if (error) throw error
      setHeader({
        name, address: trimmed(address), phone: trimmed(phone), taxCode: trimmed(taxCode), printNote: trimmed(printNote),
        bank: nhanTien,
      })
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

      {/* Chủ nhà 10/11/2026: "thêm cho tao vào dưới bảng đơn hàng/hóa đơn : Lưu ý: Khách hàng thanh toán bằng tiền mặt và
          chỉ chuyển khoản vào số tài khoản của NPP …" — câu của từng NPP, không ghi cứng vào mã (`lib/printing/luu-y-in`). */}
      <Card>
        <CardHeader><CardTitle>Tờ in hóa đơn / đơn đặt hàng</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="luu-y-in">Lưu ý in dưới bảng hàng</Label>
          <Textarea
            id="luu-y-in"
            value={printNote}
            onChange={(e) => setPrintNote(e.target.value)}
            rows={3}
            placeholder="VD: Lưu ý: Khách hàng chỉ chuyển khoản vào số tài khoản của NPP: Ngân hàng … - số tài khoản … - tên chủ tài khoản …"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            In nguyên văn ngay dưới bảng hàng của mỗi tờ <b>hóa đơn bán</b> và <b>đơn đặt hàng</b> (cả tệp Excel
            &ldquo;như mẫu in&rdquo;); chữ trước dấu hai chấm đầu câu (&ldquo;Lưu ý:&rdquo;) in đậm. Bỏ trống thì không in.
          </p>

          {/* Chủ nhà 10/11/2026: "mã QR thanh toán số tiền trên hóa đơn … mã để cạnh khu vực ký (song song)" — tài khoản của
              từng NPP, không ghi cứng vào mã (`lib/thanh-toan/vietqr`). */}
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-semibold">Mã QR chuyển khoản trên hóa đơn</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ngan-hang-qr">Ngân hàng nhận tiền</Label>
                <Select
                  value={bankBin || KHONG_IN_QR}
                  onValueChange={(v) => setBankBin(v === KHONG_IN_QR ? "" : v)}
                  onOpenChange={setMoNganHang}
                >
                  <SelectTrigger id="ngan-hang-qr" aria-label="Ngân hàng nhận tiền"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={KHONG_IN_QR}>Không in mã QR</SelectItem>
                    {mucCanDung(NGAN_HANG_VIETQR, bankBin, moNganHang, (b) => b.bin).map((b) => (
                      <SelectItem key={b.bin} value={b.bin}>{b.ten} — {b.tenDayDu}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="so-tk-qr">Số tài khoản</Label>
                <Input
                  id="so-tk-qr"
                  inputMode="numeric"
                  autoComplete="off"
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                  placeholder="VD: 0123456789"
                />
              </div>
            </div>
            {qrXemThu && (
              <div className="flex items-center gap-3 rounded-xl border bg-background p-3" data-testid="qr-xem-thu">
                <QrSvg value={qrXemThu} className="h-28 w-28 shrink-0" nhan="Mã QR xem thử" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <b>Quét thử bằng app ngân hàng:</b> phải ra đúng tên chủ tài khoản của NPP. Mã xem thử không ghi số tiền;
                  trên tờ hóa đơn mã ghi sẵn <b>số còn phải thu</b>, nội dung &ldquo;{NOI_DUNG_QR_HOA_DON}&rdquo;.
                </p>
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Có đủ ngân hàng + số tài khoản thì mỗi tờ <b>hóa đơn bán</b> đã ghi sổ (còn tiền phải thu) in mã QR chuyển khoản
              đúng số tiền, đặt cạnh khu vực ký. Đơn đặt hàng và hóa đơn đã huỷ không in mã. Chọn &ldquo;Không in mã QR&rdquo;
              để bỏ.
            </p>
          </div>
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
                Bật để mọi phiếu xuất kho đều xuất được dù tồn không đủ: bán
                hàng / xuất hoá đơn, trả hàng NCC, phiếu xuất kho (hỏng, biếu…).
                Tồn kho sẽ thiếu cho tới khi nhập hàng bổ sung hoặc kiểm kê.
                Tắt (mặc định) thì chặn và báo &ldquo;không đủ tồn&rdquo;.
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
