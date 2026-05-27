"use client"

import { useEffect, useState } from "react"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { Info, ShieldCheck } from "lucide-react"

interface ConfigState {
  api_base: string
  token_path: string
  publish_path: string
  tax_code: string
  seller_name: string
  seller_address: string
  misa_company_id: string
  misa_org_unit_id: string
  misa_template_id: string
  misa_user_id: string
  misa_inv_series: string
  misa_inv_template_no: string
  sandbox: boolean
  is_active: boolean
  username: string
  password: string
  has_username: boolean
  has_password: boolean
}

const EMPTY: ConfigState = {
  api_base: "https://api.meinvoice.vn",
  token_path: "",
  publish_path: "",
  tax_code: "",
  seller_name: "",
  seller_address: "",
  misa_company_id: "",
  misa_org_unit_id: "",
  misa_template_id: "",
  misa_user_id: "",
  misa_inv_series: "",
  misa_inv_template_no: "1",
  sandbox: true,
  is_active: true,
  username: "",
  password: "",
  has_username: false,
  has_password: false,
}

export default function EInvoiceSettingsPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user } = useAuth()
  const { toast } = useToast()
  const [cfg, setCfg] = useState<ConfigState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/einvoice/config")
        const data = await res.json()
        if (res.ok && data.config) {
          setCfg((prev) => ({
            ...prev,
            ...data.config,
            api_base: data.config.api_base || prev.api_base,
            token_path: data.config.token_path || "",
            publish_path: data.config.publish_path || "",
            misa_inv_template_no: data.config.misa_inv_template_no || "1",
            tax_code: data.config.tax_code || "",
            seller_name: data.config.seller_name || "",
            seller_address: data.config.seller_address || "",
            misa_company_id: data.config.misa_company_id || "",
            misa_org_unit_id: data.config.misa_org_unit_id || "",
            misa_template_id: data.config.misa_template_id || "",
            misa_user_id: data.config.misa_user_id || "",
            misa_inv_series: data.config.misa_inv_series || "",
            username: "",
            password: "",
          }))
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const set = (patch: Partial<ConfigState>) => setCfg((c) => ({ ...c, ...patch }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/einvoice/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Lưu thất bại")
      toast({ title: "Đã lưu cấu hình hoá đơn điện tử MISA" })
      set({ username: "", password: "", has_username: cfg.has_username || !!cfg.username, has_password: cfg.has_password || !!cfg.password })
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (user && !["owner", "accountant"].includes(user.role)) {
    return (
      <div className="space-y-4">
        <PageHeader title="Không có quyền" backHref="/settings" />
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          Chỉ Chủ NPP hoặc Kế toán mới cấu hình hoá đơn điện tử.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Hoá đơn điện tử (MISA meInvoice)"
        description="Cấu hình tài khoản MISA để phát hành hoá đơn GTGT điện tử"
        backHref="/settings"
      />

      <Card className="border-l-4 border-l-[#fdb022]">
        <CardContent className="p-4 flex gap-3 text-sm">
          <Info className="h-5 w-5 text-[#b54708] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Lưu ý</p>
            <p className="text-muted-foreground">
              Username/mật khẩu MISA được mã hoá khi lưu (cần đặt biến môi trường
              <code className="mx-1 px-1 rounded bg-muted">EINVOICE_ENC_KEY</code>).
              Nên test ở môi trường <strong>sandbox</strong> trước khi tắt và chạy thật.
              Để trống ô mật khẩu/username khi lưu = giữ giá trị cũ.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Thông tin người bán</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Mã số thuế (MST) *</Label>
            <Input value={cfg.tax_code} onChange={(e) => set({ tax_code: e.target.value })} placeholder="0xxxxxxxxx" />
          </div>
          <div className="space-y-2">
            <Label>Tên công ty (in trên HĐ)</Label>
            <Input value={cfg.seller_name} onChange={(e) => set({ seller_name: e.target.value })} placeholder="Để trống = tên NPP" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Địa chỉ</Label>
            <Input value={cfg.seller_address} onChange={(e) => set({ seller_address: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tài khoản &amp; định danh MISA</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>API base *</Label>
            <Input
              value={cfg.api_base}
              onChange={(e) => set({ api_base: e.target.value })}
              placeholder="https://api.meinvoice.vn (production) / https://demo.meinvoice.vn (sandbox)"
            />
            <p className="text-[11px] text-muted-foreground">
              Là host của API, KHÔNG phải web portal <code>app.meinvoice.vn</code>.
              Lấy trong tài liệu MISA cấp cho NPP của bạn.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Endpoint lấy token *</Label>
            <Input
              value={cfg.token_path}
              onChange={(e) => set({ token_path: e.target.value })}
              placeholder="/api/Account/Login"
            />
            <p className="text-[11px] text-muted-foreground">
              Theo phiên bản API: v3 thường <code>/api/v3/Auth/login</code>;
              cũ <code>/api/Account/Login</code>.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Endpoint phát hành *</Label>
            <Input
              value={cfg.publish_path}
              onChange={(e) => set({ publish_path: e.target.value })}
              placeholder="/api/InvoiceWS/Publish"
            />
            <p className="text-[11px] text-muted-foreground">
              vd <code>/api/InvoiceWS/Publish</code> hoặc <code>/api/v3/invoices</code>.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Tên đăng nhập MISA
            </Label>
            <Input
              value={cfg.username}
              onChange={(e) => set({ username: e.target.value })}
              placeholder={cfg.has_username ? "•••••• (đã lưu, để trống = giữ)" : "username"}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Mật khẩu MISA
            </Label>
            <Input
              type="password"
              value={cfg.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder={cfg.has_password ? "•••••• (đã lưu, để trống = giữ)" : "password"}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label>Company ID</Label>
            <Input value={cfg.misa_company_id} onChange={(e) => set({ misa_company_id: e.target.value })} placeholder="vd 156217" />
          </div>
          <div className="space-y-2">
            <Label>Org Unit ID</Label>
            <Input value={cfg.misa_org_unit_id} onChange={(e) => set({ misa_org_unit_id: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Template ID</Label>
            <Input value={cfg.misa_template_id} onChange={(e) => set({ misa_template_id: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>User ID</Label>
            <Input value={cfg.misa_user_id} onChange={(e) => set({ misa_user_id: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Kí hiệu hoá đơn (InvSeries)</Label>
            <Input value={cfg.misa_inv_series} onChange={(e) => set({ misa_inv_series: e.target.value })} placeholder="vd 1C26THG" />
          </div>
          <div className="space-y-2">
            <Label>Mẫu số (InvTemplateNo)</Label>
            <Input value={cfg.misa_inv_template_no} onChange={(e) => set({ misa_inv_template_no: e.target.value })} placeholder="1" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Trạng thái</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Môi trường sandbox</Label>
              <p className="text-[11px] text-muted-foreground">Bật để test; tắt khi chạy thật (production).</p>
            </div>
            <Switch checked={cfg.sandbox} onCheckedChange={(v) => set({ sandbox: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Kích hoạt</Label>
              <p className="text-[11px] text-muted-foreground">Tắt để tạm dừng phát hành hoá đơn MISA.</p>
            </div>
            <Switch checked={cfg.is_active} onCheckedChange={(v) => set({ is_active: v })} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Đang lưu..." : "Lưu cấu hình"}
        </Button>
      </div>
    </div>
  )
}
