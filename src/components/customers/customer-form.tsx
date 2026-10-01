"use client"

import { lamCuDanhMucBan } from "@/lib/sell/ref-store"
import { xoaNhoNen } from "@/lib/cache/nho-nen"
import { useState, useEffect, useRef } from "react"
import Link from "@/components/ui/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { PAYMENT_TERMS } from "@/lib/constants"
import { SearchSelect } from "@/components/ui/search-select"
import { KhachDaCo, LUA_CHON_PHUONG_XA, chuanHoaSdt, taoKhach } from "@/lib/customers/tao-khach"
import { MapPin, Navigation, ExternalLink } from "lucide-react"
import type { Customer, CustomerGroup } from "@/types"
import { errorMessage } from "@/lib/errors"

interface CustomerFormProps {
  customer?: Customer
  groups: Pick<CustomerGroup, "id" | "name">[]
  /**
   * Nơi quay về sau khi TẠO XONG, thay cho `/customers`.
   *
   * ⚠ CÓ ĐỂ PHỤC VỤ LUỒNG ĐẶT HÀNG. NVBH đang đứng ở cửa hàng mới, bấm +
   * từ màn chọn khách để tạo điểm bán rồi bán luôn. Ném họ về danh sách
   * khách là bắt tự tìm đường quay lại giỏ hàng đang dở — và giỏ thì vẫn
   * còn nguyên ở đó, chỉ là họ không biết.
   *
   * Mã khách vừa tạo được gắn vào `?picked=` để nơi nhận tự chọn sẵn.
   */
  nextHref?: string
  /** SĐT gán sẵn khi tạo mới — từ ô tìm khách không ra kết quả (chủ nhà 01/10/2026). */
  initialPhone?: string
}

interface PjpRouteDisplay {
  id: string
  day_of_week: number
  sales_user?: { full_name: string } | null
}

const DAY_LABELS: Record<number, string> = {
  0: "Chủ nhật",
  1: "Thứ 2",
  2: "Thứ 3",
  3: "Thứ 4",
  4: "Thứ 5",
  5: "Thứ 6",
  6: "Thứ 7",
}

export function CustomerForm({ customer, groups, nextHref, initialPhone }: CustomerFormProps) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  /** Chống bấm Lưu 2 lần — `loading` chưa kịp vẽ lại thì cú bấm thứ hai vẫn lọt (chủ nhà 01/10/2026). */
  const dangLuu = useRef(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [pjpRoutes, setPjpRoutes] = useState<PjpRouteDisplay[]>([])
  const [salesRoutes, setSalesRoutes] = useState<Array<{ code: string; name: string }>>([])
  const [form, setForm] = useState<Record<string, string>>({
    store_name: customer?.store_name || "",
    owner_name: customer?.owner_name || "",
    phone: customer?.phone || initialPhone || "",
    address: customer?.address || "",
    ward: customer?.ward || "",
    channel: customer?.channel || "",
    group_id: customer?.group_id || "",
    credit_limit: customer?.credit_limit?.toString() || "0",
    payment_terms: customer?.payment_terms || "COD",
    status: customer?.status || "active",
    gps_lat: customer?.gps_lat?.toString() || "",
    gps_lng: customer?.gps_lng?.toString() || "",
    billing_name: customer?.billing_name || "",
    tax_code: customer?.tax_code || "",
    billing_address: customer?.billing_address || "",
    billing_email: customer?.billing_email || "",
    payment_method_label: customer?.payment_method_label || "Chuyển khoản",
  })
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  // Load sales routes (tuyến bán hàng) once
  useEffect(() => {
    async function fetchRoutes() {
      const { data, error } = await createClient()
        .from("sales_routes")
        .select("code, name")
        .eq("is_active", true)
        .order("sort_order")
        .order("code")
      if (error) console.error("[customers/customer-form] truy vấn tuyến lỗi:", error.message)
      setSalesRoutes((data as Array<{ code: string; name: string }>) || [])
    }
    fetchRoutes()
  }, [])

  // Fetch PJP routes for this customer
  useEffect(() => {
    if (!customer?.id) return
    async function fetchPjp() {
      const { data, error } = await createClient()
        .from("pjp_routes")
        .select("id, day_of_week, sales_user:users(full_name)")
        .eq("customer_id", customer!.id)
        .eq("is_active", true)
        .order("day_of_week")
      if (error) console.error("[customers/customer-form] truy vấn PJP lỗi:", error.message)
      if (data) {
        setPjpRoutes(
          data.map((r: Record<string, unknown>) => ({
            id: r.id as string,
            day_of_week: r.day_of_week as number,
            sales_user: r.sales_user as { full_name: string } | null,
          }))
        )
      }
    }
    fetchPjp()
  }, [customer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGetGps = () => {
    if (!navigator.geolocation) {
      toast({ title: "Lỗi", description: "Trình duyệt không hỗ trợ định vị GPS", variant: "destructive" })
      return
    }
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude.toString()
        const lng = position.coords.longitude.toString()
        setForm((prev) => ({ ...prev, gps_lat: lat, gps_lng: lng }))

        // Save immediately if editing
        if (customer) {
          const { error } = await supabase
            .from("customers")
            .update({ gps_lat: parseFloat(lat), gps_lng: parseFloat(lng) })
            .eq("id", customer.id)
          if (error) {
            toast({ title: "Lỗi", description: "Không thể lưu tọa độ GPS", variant: "destructive" })
          } else {
            toast({ title: "Đã lưu tọa độ GPS" })
          }
        }
        setGpsLoading(false)
      },
      (err) => {
        toast({ title: "Lỗi", description: `Không thể lấy vị trí: ${err.message}`, variant: "destructive" })
        setGpsLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (dangLuu.current) return
    // Tuyến BẮT BUỘC (chủ nhà 01/10/2026: "Tuyến -> trường bắt buộc").
    if (!form.channel) {
      toast({ title: "Chưa chọn tuyến bán hàng", description: "Tuyến là trường bắt buộc.", variant: "destructive" })
      return
    }
    dangLuu.current = true
    setLoading(true)

    try {
      /**
       * Kiểm trùng số điện thoại TRƯỚC khi ghi — chỉ để báo sớm cho đẹp.
       *
       * ⚠ PHÉP KIỂM NÀY KHÔNG ĐÁNG TIN, VÀ ĐÓ LÀ CHUYỆN BÌNH THƯỜNG. Nó
       * chạy qua RLS: NVBH chỉ thấy khách ĐƯỢC PHÂN CÔNG, nên một khách
       * trùng số do người khác phụ trách sẽ trả về 0 dòng và phép kiểm nói
       * "không trùng". Thứ chặn thật là ràng buộc `UNIQUE(org_id, phone)`
       * dưới database, và `errorMessage` dịch lỗi 23505 đó thành câu giải
       * thích đúng hoàn cảnh ("khách này do nhân viên khác phụ trách").
       *
       * Vậy nên ở đây KHÔNG được coi "đọc hỏng" là "không trùng" rồi đi
       * tiếp trong im lặng — nói ra, rồi vẫn để database phán.
       */
      // Tạo mới: `taoKhach` tự kiểm trùng (thấy cả khách người khác phụ trách). Ở đây chỉ còn cho SỬA số.
      if (customer && customer.phone !== form.phone) {
        const { data: existing, error: existingErr } = await supabase
          .from("customers")
          .select("id")
          .eq("phone", form.phone)
          .limit(1)
        if (existingErr) {
          console.error("[customers/customer-form] truy vấn lỗi:", existingErr.message)
          toast({
            title: "Chưa kiểm được trùng số điện thoại",
            description: `${errorMessage(existingErr)} — vẫn thử lưu, nếu trùng thì hệ thống sẽ báo.`,
          })
        }
        if (existing && existing.length > 0) {
          toast({
            title: "Số điện thoại đã tồn tại",
            description: `Đã có khách hàng dùng số ${form.phone}. Tìm lại trong danh sách khách trước khi tạo mới.`,
            variant: "destructive",
          })
          setLoading(false)
          return
        }
      }

      const payload: Record<string, unknown> = {
        store_name: form.store_name,
        owner_name: form.owner_name,
        phone: chuanHoaSdt(form.phone),
        address: form.address,
        ward: form.ward || null,
        channel: form.channel || null,
        group_id: form.group_id || null,
        credit_limit: parseInt(form.credit_limit) || 0,
        payment_terms: form.payment_terms,
        status: form.status,
        billing_name: form.billing_name || null,
        tax_code: form.tax_code || null,
        billing_address: form.billing_address || null,
        billing_email: form.billing_email || null,
        payment_method_label: form.payment_method_label || "Chuyển khoản",
      }

      // Include GPS if set
      if (form.gps_lat && form.gps_lng) {
        payload.gps_lat = parseFloat(form.gps_lat)
        payload.gps_lng = parseFloat(form.gps_lng)
      }

      // ⚠ KHAI BÁO NGOÀI NHÁNH. Phần điều hướng ở cuối hàm cần biết mã
      //   khách vừa tạo; để bên trong nhánh thì nó không thấy.
      let newId: string | null = null

      if (customer) {
        const { error } = await supabase.from("customers").update(payload).eq("id", customer.id)
        if (error) throw error
        toast({ title: "Đã cập nhật khách hàng" })
      } else {
        // Kiểm trùng số (cả khách người khác phụ trách) + ghi + phân công cho người tạo — `taoKhach`.
        const kq = await taoKhach(supabase, user, payload)
        newId = kq.id
        toast({
          title: "Đã tạo khách hàng mới",
          description: kq.ghiChu ?? undefined,
          variant: kq.phanCongLoi ? "destructive" : undefined,
        })
      }

      // Danh mục khách của /sell trên máy giờ đã cũ — lần mở sau tải lại (thấy khách mới / tên mới).
      lamCuDanhMucBan()
      xoaNhoNen("nen:khach") // ô lọc khách ở danh sách đơn / hoá đơn thấy khách mới ngay

      /**
       * ⚠ CHỈ QUAY VỀ LUỒNG CŨ KHI THẬT SỰ CÓ MÃ KHÁCH. `newId` rỗng nghĩa
       *   là ghi xong mà không đọc lại được mã (RLS, hoặc cột trả về
       *   thiếu); gửi `?picked=` rỗng về màn chọn khách là nó ngồi đợi một
       *   khách không bao giờ tới. Về danh sách khách vẫn hơn.
       */
      if (nextHref && newId) {
        router.push(`${nextHref}?picked=${encodeURIComponent(newId)}`)
      } else {
        router.push("/customers")
      }
      router.refresh()
    } catch (err: unknown) {
      // ⚠ Tiêu đề phải nói THAO TÁC NÀO hỏng. "Lỗi" một mình thì người
      // dùng không biết mình vừa mất cái gì — bản nháp còn hay đã bay.
      // Trùng số: báo "đã có khách hàng" và Ở LẠI màn (không chuyển trang).
      toast({
        title: err instanceof KhachDaCo ? "Đã có khách hàng" : customer ? "Không cập nhật được khách hàng" : "Không tạo được khách hàng",
        description: err instanceof KhachDaCo ? err.message : errorMessage(err),
        variant: "destructive",
      })
    } finally {
      dangLuu.current = false
      setLoading(false)
    }
  }

  const hasGps = form.gps_lat && form.gps_lng

  return (
    <Card>
      <CardHeader>
        <CardTitle>{customer ? "Cập nhật khách hàng" : "Thêm khách hàng mới"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tên cửa hàng *</Label>
              <Input value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} required placeholder="VD: Tạp hóa Bà Hai" />
            </div>
            <div className="space-y-2">
              <Label>Tên chủ cửa hàng *</Label>
              <Input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Số điện thoại *</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="0901000001" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Tuyến bán hàng *</Label>
                <Link
                  href="/customers/routes"
                  className="text-[10px] text-primary hover:underline"
                >
                  Quản lý tuyến
                </Link>
              </div>
              {salesRoutes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Chưa có tuyến. <Link href="/customers/routes" className="text-primary font-semibold hover:underline">Thêm tuyến</Link>
                </p>
              ) : (
                <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                  <SelectTrigger><SelectValue placeholder="Chọn tuyến" /></SelectTrigger>
                  <SelectContent>
                    {salesRoutes.map((r) => (
                      <SelectItem key={r.code} value={r.code}>{r.code} — {r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Address with GPS button */}
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label>Địa chỉ *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGetGps}
                  disabled={gpsLoading}
                  className="h-7 text-xs gap-1"
                >
                  <Navigation className="h-3 w-3" />
                  {gpsLoading ? "Đang định vị..." : "Định vị"}
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  className="sm:col-span-2"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  required
                  placeholder="Số nhà, tên đường"
                />
                {/* 114 phường / xã / đặc khu Hải Phòng sau sáp nhập, có ô tìm (chủ nhà 01/10/2026). */}
                <SearchSelect
                  id="customer-ward"
                  options={LUA_CHON_PHUONG_XA}
                  valueId={LUA_CHON_PHUONG_XA.some((o) => o.id === form.ward) ? form.ward : ""}
                  freeText={form.ward}
                  allowFreeText
                  onPick={(o, text) => setForm({ ...form, ward: o?.id ?? text })}
                  placeholder="Phường / xã (gõ tìm)"
                  limit={120}
                />
              </div>
              {hasGps && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 text-primary" />
                  <span>{parseFloat(form.gps_lat).toFixed(6)}, {parseFloat(form.gps_lng).toFixed(6)}</span>
                  <a
                    href={`https://maps.google.com/?q=${form.gps_lat},${form.gps_lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary font-semibold hover:underline inline-flex items-center gap-0.5"
                  >
                    Xem trên Google Maps <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            {/* Thông tin xuất hóa đơn */}
            <div className="sm:col-span-2 space-y-3 rounded-xl border border-border/40 bg-surface-low/50 p-4">
              <Label className="text-sm font-bold">Thông tin xuất hóa đơn</Label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tên xuất HĐ</Label>
                  <Input
                    value={form.billing_name}
                    onChange={(e) => setForm({ ...form, billing_name: e.target.value })}
                    placeholder="Tên trên hóa đơn VAT"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Mã số thuế</Label>
                  <Input
                    value={form.tax_code}
                    onChange={(e) => setForm({ ...form, tax_code: e.target.value })}
                    placeholder="VD: 0102345678"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Địa chỉ xuất HĐ</Label>
                  <Input
                    value={form.billing_address}
                    onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
                    placeholder="Địa chỉ trên hóa đơn"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email nhận HĐ</Label>
                  <Input
                    type="email"
                    value={form.billing_email}
                    onChange={(e) => setForm({ ...form, billing_email: e.target.value })}
                    placeholder="email@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Hình thức TT</Label>
                  <Select value={form.payment_method_label} onValueChange={(v) => setForm({ ...form, payment_method_label: v })}>
                    <SelectTrigger><SelectValue placeholder="Chọn hình thức" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Chuyển khoản">Chuyển khoản</SelectItem>
                      <SelectItem value="Tiền mặt">Tiền mặt</SelectItem>
                      <SelectItem value="TM/CK">TM/CK</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* PJP Routes display */}
            {customer && pjpRoutes.length > 0 && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Tuyến bán hàng (PJP)</Label>
                <div className="flex flex-wrap gap-2">
                  {pjpRoutes.map((r) => {
                    const salesName = Array.isArray(r.sales_user)
                      ? (r.sales_user as Array<{ full_name: string }>)[0]?.full_name
                      : r.sales_user?.full_name
                    return (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2.5 py-1 rounded-full text-xs font-semibold"
                      >
                        {DAY_LABELS[r.day_of_week] || `Ngày ${r.day_of_week}`}
                        {salesName && <span className="text-muted-foreground">• {salesName}</span>}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
            {customer && pjpRoutes.length === 0 && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Tuyến bán hàng (PJP)</Label>
                <p className="text-sm text-muted-foreground">Chưa được phân tuyến</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Nhóm khách hàng</Label>
              <Select value={form.group_id} onValueChange={(v) => setForm({ ...form, group_id: v })}>
                <SelectTrigger><SelectValue placeholder="Chọn nhóm" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Hạn mức công nợ (VND)</Label>
              <MoneyInput value={form.credit_limit} onChange={(v) => setForm({ ...form, credit_limit: String(v) })} />
            </div>
            <div className="space-y-2">
              <Label>Điều khoản thanh toán</Label>
              <Select value={form.payment_terms} onValueChange={(v) => setForm({ ...form, payment_terms: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_TERMS.map((pt) => <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Trạng thái</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Hoạt động</SelectItem>
                  <SelectItem value="suspended">Tạm ngưng</SelectItem>
                  <SelectItem value="locked">Khóa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
            <Button type="submit" disabled={loading}>{loading ? "Đang lưu..." : (customer ? "Cập nhật" : "Tạo mới")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
