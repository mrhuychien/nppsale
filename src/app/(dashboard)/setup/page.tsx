"use client"

/**
 * Trình hướng dẫn cài đặt ban đầu (Setup wizard) — chạy 1 lần khi
 * NPP mới triển khai. Lưu cờ hoàn tất vào organizations.settings.
 * setup_completed_at để ẩn banner trên /home sau này.
 *
 * 5 bước:
 *  1. Chào mừng
 *  2. Thông tin NPP (tên, MST, địa chỉ, liên hệ)
 *  3. Quy tắc giá (NV có được sửa giá / mức cap)
 *  4. Lương cơ bản (lương CB, phụ cấp, mức KPI A, % vượt / dưới 60%)
 *  5. Hoàn tất + checklist các việc tiếp theo
 *
 * Mỗi bước Next sẽ tự lưu phần thay đổi của bước đó. Cuối cùng set
 * setup_completed_at = now() và redirect /home.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Rocket,
  Building2, Tag, Wallet, Users, Package, Factory, FileText, Trophy,
} from "lucide-react"

const STEPS = ["welcome", "org", "warehouse", "salary", "done"] as const
type Step = (typeof STEPS)[number]

const STEP_LABEL: Record<Step, string> = {
  welcome: "Chào mừng",
  org: "Thông tin NPP",
  warehouse: "Kho date",
  salary: "Lương cơ bản",
  done: "Hoàn tất",
}

interface OrgState {
  name: string
  slug: string
  tax_code: string
  address: string
  phone: string
  email: string
}

interface WarehouseState {
  date_warehouse_threshold_days: string
}

interface SalaryState {
  base_salary: string
  gas_allowance: string
  phone_allowance: string
  working_days_per_month: string
  kpi_target_revenue: string
  over_target_percent: string
  under_60_percent: string
}

const DEFAULT_WAREHOUSE: WarehouseState = {
  date_warehouse_threshold_days: "30",
}
const DEFAULT_SALARY: SalaryState = {
  base_salary: "3700000",
  gas_allowance: "1000000",
  phone_allowance: "300000",
  working_days_per_month: "26",
  kpi_target_revenue: "0",
  over_target_percent: "5",
  under_60_percent: "6",
}

export default function SetupWizardPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  const [step, setStep] = useState<Step>("welcome")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [org, setOrg] = useState<OrgState>({ name: "", slug: "", tax_code: "", address: "", phone: "", email: "" })
  const [warehouse, setWarehouse] = useState<WarehouseState>(DEFAULT_WAREHOUSE)
  const [salary, setSalary] = useState<SalaryState>(DEFAULT_SALARY)
  const [salaryConfigId, setSalaryConfigId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [orgRes, prRes, scRes] = await Promise.all([
      supabase.from("organizations").select("name, slug, settings").eq("id", user.org_id).maybeSingle(),
      supabase.from("pricing_rules").select("*").eq("org_id", user.org_id).maybeSingle(),
      supabase
        .from("hr_salary_config")
        .select("*")
        .eq("org_id", user.org_id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const oRow = (orgRes.data || {}) as Record<string, unknown>
    const settings = (oRow.settings || {}) as Record<string, unknown>
    setOrg({
      name: (oRow.name as string) || "",
      slug: (oRow.slug as string) || "",
      tax_code: (settings.tax_code as string) || "",
      address: (settings.address as string) || "",
      phone: (settings.phone as string) || "",
      email: (settings.email as string) || "",
    })
    const pr = prRes.data as Record<string, unknown> | null
    if (pr) {
      setWarehouse({
        date_warehouse_threshold_days: String(pr.date_warehouse_threshold_days ?? 30),
      })
    }
    const sc = scRes.data as Record<string, unknown> | null
    if (sc) {
      setSalaryConfigId(sc.id as string)
      setSalary({
        base_salary: String(sc.base_salary ?? DEFAULT_SALARY.base_salary),
        gas_allowance: String(sc.gas_allowance ?? DEFAULT_SALARY.gas_allowance),
        phone_allowance: String(sc.phone_allowance ?? DEFAULT_SALARY.phone_allowance),
        working_days_per_month: String(sc.working_days_per_month ?? 26),
        kpi_target_revenue: String(sc.kpi_target_revenue ?? 0),
        over_target_percent: String(sc.over_target_percent ?? 5),
        under_60_percent: String(sc.under_60_percent ?? 6),
      })
    }
    setLoading(false)
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const stepIdx = useMemo(() => STEPS.indexOf(step), [step])
  const progress = Math.round(((stepIdx + 1) / STEPS.length) * 100)

  const saveOrg = async () => {
    if (!user?.org_id) return false
    if (!org.name.trim()) {
      toast({ title: "Cần nhập tên NPP", variant: "destructive" })
      return false
    }
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("settings")
      .eq("id", user.org_id)
      .maybeSingle()
    const existing = ((orgRow as { settings?: Record<string, unknown> } | null)?.settings || {}) as Record<string, unknown>
    const settings = {
      ...existing,
      tax_code: org.tax_code || null,
      address: org.address || null,
      phone: org.phone || null,
      email: org.email || null,
    }
    const payload: Record<string, unknown> = { name: org.name.trim(), settings }
    if (org.slug.trim()) payload.slug = org.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
    const { error } = await supabase.from("organizations").update(payload).eq("id", user.org_id)
    if (error) {
      toast({ title: "Lỗi lưu NPP", description: error.message, variant: "destructive" })
      return false
    }
    return true
  }

  const saveWarehouse = async () => {
    if (!user?.org_id) return false
    const days = Math.max(0, Math.min(365, parseInt(warehouse.date_warehouse_threshold_days) || 30))
    const row = {
      org_id: user.org_id,
      date_warehouse_threshold_days: days,
      updated_by: user.id,
    }
    const { error } = await supabase.from("pricing_rules").upsert(row, { onConflict: "org_id" })
    if (error) {
      toast({ title: "Lỗi lưu ngưỡng kho date", description: error.message, variant: "destructive" })
      return false
    }
    return true
  }

  const saveSalary = async () => {
    if (!user?.org_id) return false
    const num = (v: string) => Math.max(0, parseFloat(v) || 0)
    const intNum = (v: string) => Math.max(1, parseInt(v) || 1)
    const fields = {
      base_salary: num(salary.base_salary),
      gas_allowance: num(salary.gas_allowance),
      phone_allowance: num(salary.phone_allowance),
      working_days_per_month: intNum(salary.working_days_per_month),
      kpi_target_revenue: num(salary.kpi_target_revenue),
      over_target_percent: num(salary.over_target_percent),
      under_60_percent: num(salary.under_60_percent),
    }
    if (salaryConfigId) {
      const { error } = await supabase.from("hr_salary_config").update(fields).eq("id", salaryConfigId)
      if (error) {
        toast({ title: "Lỗi lưu lương", description: error.message, variant: "destructive" })
        return false
      }
    } else {
      const { data, error } = await supabase
        .from("hr_salary_config")
        .insert({
          ...fields,
          org_id: user.org_id,
          name: "Cấu hình mặc định",
          is_active: true,
        })
        .select("id")
        .maybeSingle()
      if (error) {
        toast({ title: "Lỗi tạo lương", description: error.message, variant: "destructive" })
        return false
      }
      if (data) setSalaryConfigId((data as { id: string }).id)
    }
    return true
  }

  const finish = async () => {
    if (!user?.org_id) return
    setSaving(true)
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("settings")
      .eq("id", user.org_id)
      .maybeSingle()
    const existing = ((orgRow as { settings?: Record<string, unknown> } | null)?.settings || {}) as Record<string, unknown>
    const { error } = await supabase
      .from("organizations")
      .update({ settings: { ...existing, setup_completed_at: new Date().toISOString() } })
      .eq("id", user.org_id)
    setSaving(false)
    if (error) {
      toast({ title: "Lỗi", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: "Đã hoàn tất cài đặt ban đầu" })
    router.push("/home")
  }

  const next = async () => {
    setSaving(true)
    let ok = true
    if (step === "org") ok = await saveOrg()
    else if (step === "warehouse") ok = await saveWarehouse()
    else if (step === "salary") ok = await saveSalary()
    setSaving(false)
    if (!ok) return
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
  }

  const prev = () => {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1])
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (user && user.role !== "owner") {
    return (
      <div className="space-y-4">
        <PageHeader title="Không có quyền" backHref="/home" />
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          Chỉ Chủ NPP mới chạy được trình hướng dẫn cài đặt.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Trình hướng dẫn cài đặt"
        description={`Bước ${stepIdx + 1}/${STEPS.length}: ${STEP_LABEL[step]}`}
        backHref="/home"
      />

      {/* Thanh tiến độ */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= stepIdx ? "font-semibold text-primary" : ""}>
              {i + 1}. {STEP_LABEL[s]}
            </span>
          ))}
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {step === "welcome" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" /> Chào mừng đến với npp.sale
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Trình hướng dẫn sẽ giúp bạn thiết lập các cấu hình tối thiểu để NPP vận hành:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Thông tin NPP</strong> — tên, MST, địa chỉ.</li>
              <li><strong className="text-foreground">Quy tắc giá</strong> — NV bán hàng có được tự sửa giá không, mức cap.</li>
              <li><strong className="text-foreground">Lương cơ bản</strong> — lương, phụ cấp, mức KPI doanh số.</li>
            </ul>
            <p className="text-muted-foreground">
              Bạn có thể bỏ qua và sửa sau tại các trang Cài đặt — nhưng nên hoàn thành để hệ thống chạy ổn ngay từ đầu.
            </p>
          </CardContent>
        </Card>
      )}

      {step === "org" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> Thông tin nhà phân phối
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Tên NPP *</Label>
              <Input value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} placeholder="VD: Công ty TNHH An Phát" />
            </div>
            <div className="space-y-2">
              <Label>Slug (định danh URL)</Label>
              <Input value={org.slug} onChange={(e) => setOrg({ ...org, slug: e.target.value })} placeholder="an-phat" />
            </div>
            <div className="space-y-2">
              <Label>Mã số thuế</Label>
              <Input value={org.tax_code} onChange={(e) => setOrg({ ...org, tax_code: e.target.value })} placeholder="0xxxxxxxxx" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Địa chỉ</Label>
              <Input value={org.address} onChange={(e) => setOrg({ ...org, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Điện thoại</Label>
              <Input value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} placeholder="028xxxxxxx" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={org.email} onChange={(e) => setOrg({ ...org, email: e.target.value })} placeholder="contact@npp.vn" />
            </div>
          </CardContent>
        </Card>
      )}

      {step === "warehouse" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" /> Ngưỡng kho date
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 max-w-sm">
              <Label>Tự động chuyển sang Kho date khi còn (ngày)</Label>
              <Input
                type="number"
                min={0}
                max={365}
                step="1"
                value={warehouse.date_warehouse_threshold_days}
                onChange={(e) =>
                  setWarehouse({
                    ...warehouse,
                    date_warehouse_threshold_days: e.target.value,
                  })
                }
                placeholder="30"
              />
              <p className="text-[11px] text-muted-foreground">
                Lô hàng còn ≤ ngưỡng này tự động chuyển từ Kho bán sang
                Kho date. Mặc định 30 ngày. Quy tắc giá sửa được cấu hình
                riêng cho từng nhân viên ở /settings/users/[id].
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "salary" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" /> Lương cơ bản &amp; KPI
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Lương cơ bản (VND/tháng)</Label>
              <Input type="number" min={0} value={salary.base_salary} onChange={(e) => setSalary({ ...salary, base_salary: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Ngày công chuẩn / tháng</Label>
              <Input type="number" min={1} max={31} value={salary.working_days_per_month} onChange={(e) => setSalary({ ...salary, working_days_per_month: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Phụ cấp xăng (VND)</Label>
              <Input type="number" min={0} value={salary.gas_allowance} onChange={(e) => setSalary({ ...salary, gas_allowance: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Phụ cấp điện thoại (VND)</Label>
              <Input type="number" min={0} value={salary.phone_allowance} onChange={(e) => setSalary({ ...salary, phone_allowance: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Mức doanh số chung A (VND)</Label>
              <Input type="number" min={0} value={salary.kpi_target_revenue} onChange={(e) => setSalary({ ...salary, kpi_target_revenue: e.target.value })} />
              <p className="text-[10px] text-muted-foreground">
                Mức KPI dùng cho mọi NV bán hàng. Bậc thưởng cộng dồn theo % của A
                (mặc định 70/80/90/100). Để 0 = chưa áp dụng thưởng KPI.
              </p>
            </div>
            <div className="space-y-2">
              <Label>% thưởng vượt 100% A</Label>
              <Input type="number" min={0} max={100} step="0.5" value={salary.over_target_percent} onChange={(e) => setSalary({ ...salary, over_target_percent: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>% trên doanh số khi đạt &lt; 60% A</Label>
              <Input type="number" min={0} max={100} step="0.5" value={salary.under_60_percent} onChange={(e) => setSalary({ ...salary, under_60_percent: e.target.value })} />
              <p className="text-[10px] text-muted-foreground">Đạt dưới 60% → không hưởng lương cứng &amp; phụ cấp; lương = doanh số × %.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "done" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-tertiary" /> Sẵn sàng vận hành
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>Cài đặt cốt lõi đã xong. Tiếp theo bạn nên:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <NextStepLink href="/settings/users/new" icon={Users} label="Thêm nhân viên" />
              <NextStepLink href="/products" icon={Package} label="Thêm sản phẩm" />
              <NextStepLink href="/customers/new" icon={Building2} label="Thêm khách hàng" />
              <NextStepLink href="/suppliers" icon={Factory} label="Thêm nhà cung cấp" />
              <NextStepLink href="/hr/bonus-config" icon={Trophy} label="Cấu hình thưởng tháng" />
              <NextStepLink href="/settings/einvoice" icon={FileText} label="Cấu hình HĐ điện tử (MISA)" />
            </div>
            <p className="text-[11px] text-muted-foreground pt-2">
              Có thể quay lại trình hướng dẫn bất kỳ lúc nào từ <strong>Cài đặt → Trình hướng dẫn</strong>.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Điều hướng */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={prev} disabled={stepIdx === 0 || saving}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Quay lại
        </Button>
        {step === "done" ? (
          <Button onClick={finish} disabled={saving}>
            <Check className="h-4 w-4 mr-1.5" /> {saving ? "Đang hoàn tất..." : "Hoàn tất"}
          </Button>
        ) : (
          <Button onClick={next} disabled={saving}>
            {saving ? "Đang lưu..." : "Tiếp tục"} <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

function NextStepLink({ href, icon: Icon, label }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-lg border p-3 hover:border-primary hover:bg-primary/5 transition-colors">
      <Icon className="h-4 w-4 text-primary" />
      <span className="text-sm font-medium">{label}</span>
      <ArrowRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
    </Link>
  )
}
