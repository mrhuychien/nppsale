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
  invoice_type: number
  is_inherit_from_old_template: boolean
  sandbox: boolean
  is_active: boolean
  username: string
  password: string
  has_username: boolean
  has_password: boolean
}

const EMPTY: ConfigState = {
  api_base: "https://testapp.meinvoice.vn/api/v2",
  token_path: "/oauth",
  publish_path: "/v3sainvoice",
  tax_code: "",
  seller_name: "",
  seller_address: "",
  misa_company_id: "",
  misa_org_unit_id: "",
  misa_template_id: "",
  misa_user_id: "",
  misa_inv_series: "",
  misa_inv_template_no: "1",
  invoice_type: 1,
  is_inherit_from_old_template: false,
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
            token_path: data.config.token_path || prev.token_path,
            publish_path: data.config.publish_path || prev.publish_path,
            misa_inv_template_no: data.config.misa_inv_template_no || "1",
            tax_code: data.config.tax_code || "",
            seller_name: data.config.seller_name || "",
            seller_address: data.config.seller_address || "",
            misa_company_id: data.config.misa_company_id || "",
            misa_org_unit_id: data.config.misa_org_unit_id || "",
            misa_template_id: data.config.misa_template_id || "",
            misa_user_id: data.config.misa_user_id || "",
            misa_inv_series: data.config.misa_inv_series || "",
            invoice_type: typeof data.config.invoice_type === "number" ? data.config.invoice_type : 1,
            is_inherit_from_old_template: !!data.config.is_inherit_from_old_template,
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

  const [testing, setTesting] = useState(false)
  const handleTestConnection = async () => {
    setTesting(true)
    try {
      // Save trước (encrypted ở server) để test-connection có config mới nhất.
      await fetch("/api/einvoice/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      })
      const res = await fetch("/api/einvoice/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cfg.username, password: cfg.password }),
      })
      const text = await res.text()
      let data: { error?: string; auto_filled?: { companyId?: string; orgUnitId?: string; userId?: string }; needs_manual?: { invoice_template_id?: boolean; inv_series?: boolean } } = {}
      try { data = text ? JSON.parse(text) : {} } catch { /* */ }
      if (!res.ok) throw new Error(data.error || `Test thất bại (HTTP ${res.status})`)
      const filled = data.auto_filled || {}
      set({
        misa_company_id: filled.companyId || cfg.misa_company_id,
        misa_org_unit_id: filled.orgUnitId || cfg.misa_org_unit_id,
        misa_user_id: filled.userId || cfg.misa_user_id,
        username: "",
        password: "",
        has_username: true,
        has_password: true,
      })
      const need = data.needs_manual || {}
      const missing: string[] = []
      if (need.invoice_template_id) missing.push("InvoiceTemplateID")
      if (need.inv_series) missing.push("InvSeries")
      toast({
        title: "Kết nối MISA OK",
        description:
          (filled.companyId ? `CompanyID: ${filled.companyId}` : "") +
          (missing.length ? ` · Còn cần nhập tay: ${missing.join(", ")}` : ""),
      })
    } catch (e) {
      toast({ title: "Test thất bại", description: (e as Error).message, variant: "destructive" })
    } finally {
      setTesting(false)
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
        description="Đẩy hoá đơn nháp lên MISA — vào web meInvoice duyệt + ký thủ công"
        backHref="/settings"
      />

      <Card className="border-l-4 border-l-[#fdb022]">
        <CardContent className="p-4 flex gap-3 text-sm">
          <Info className="h-5 w-5 text-[#b54708] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Luồng hiện tại: đẩy nháp lên MISA</p>
            <p className="text-muted-foreground">
              Khi bấm &ldquo;Xuất hoá đơn&rdquo;, hệ thống dùng tài khoản MISA bạn nhập
              bên dưới để đẩy dữ liệu lên <strong>app.meinvoice.vn</strong> ở trạng thái
              hoá đơn <strong>chưa phát hành</strong>. Bạn vào web MISA để duyệt, ký và
              phát hành thủ công. Username/mật khẩu được mã hoá khi lưu (cần env
              <code className="mx-1 px-1 rounded bg-muted">EINVOICE_ENC_KEY</code>).
              Test ở sandbox <code>testapp.meinvoice.vn</code> trước, khi OK đổi sang
              <code className="mx-1 px-1 rounded bg-muted">app.meinvoice.vn</code>.
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
              placeholder="https://testapp.meinvoice.vn/api/v2"
            />
            <p className="text-[11px] text-muted-foreground">
              Sandbox: <code>https://testapp.meinvoice.vn/api/v2</code> ·
              Production: <code>https://app.meinvoice.vn/api/v2</code>.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Endpoint lấy token</Label>
            <Input
              value={cfg.token_path}
              onChange={(e) => set({ token_path: e.target.value })}
              placeholder="/oauth"
            />
            <p className="text-[11px] text-muted-foreground">
              WebAPI v2 mặc định: <code>/oauth</code>.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Endpoint đẩy HĐ</Label>
            <Input
              value={cfg.publish_path}
              onChange={(e) => set({ publish_path: e.target.value })}
              placeholder="/v3sainvoice"
            />
            <p className="text-[11px] text-muted-foreground">
              Không mã CQT: <code>/v3sainvoice</code> · Có mã: <code>/v3sainvoice/Code</code>.
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
          <div className="space-y-2">
            <Label>InvoiceType</Label>
            <Input
              type="number"
              value={cfg.invoice_type}
              onChange={(e) => set({ invoice_type: parseInt(e.target.value, 10) || 1 })}
              placeholder="1"
            />
            <p className="text-[11px] text-muted-foreground">
              1 = HĐ GTGT bán hàng. Lấy theo &ldquo;Lấy danh sách mẫu HĐ&rdquo;.
            </p>
          </div>
          <div className="space-y-2 flex flex-col">
            <Label>IsInheritFromOldTemplate</Label>
            <div className="flex items-center gap-3 h-10">
              <Switch
                checked={cfg.is_inherit_from_old_template}
                onCheckedChange={(v) => set({ is_inherit_from_old_template: v })}
              />
              <span className="text-[11px] text-muted-foreground">
                Theo response API lấy mẫu HĐ của MISA.
              </span>
            </div>
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

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleTestConnection} disabled={testing || saving}>
          {testing ? "Đang test..." : "Test kết nối & lấy IDs"}
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Đang lưu..." : "Lưu cấu hình"}
        </Button>
      </div>
    </div>
  )
}
