"use client"

/**
 * KHÁCH HÀNG Ở NGĂN XEM NHANH (đơn / hóa đơn / phiếu trả).
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Khách hàng hiển thị đầy đủ thông tin địa chỉ và số
 *   điện thoại luôn". Bản trước để tuyến ĐÈ số điện thoại (`routeName ?? phone`)
 *   và cắt chữ một dòng; địa chỉ thì chỉ có số nhà hoặc không có.
 */

import { fullCustomerAddress, type CustomerAddressParts } from "@/lib/customers/address"

export interface QuickCustomer extends CustomerAddressParts {
  store_name?: string | null
  phone?: string | null
}

export function CustomerQuickInfo({
  customer,
  routeName = null,
  className = "",
}: {
  customer: QuickCustomer | null | undefined
  routeName?: string | null
  className?: string
}) {
  const diaChi = customer ? fullCustomerAddress(customer) : ""
  const phone = (customer?.phone ?? "").trim()
  return (
    <div className={`rounded-xl bg-surface-container-low p-3 ${className}`} data-testid="xem-nhanh-khach">
      <span className="block text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
        Khách hàng
      </span>
      <span className="mt-1 block break-words text-sm font-extrabold text-on-surface">
        {customer?.store_name || "Khách lẻ"}
      </span>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs font-semibold text-on-surface-variant">
        <dt>SĐT</dt>
        <dd className="text-on-surface">
          {phone ? (
            <a href={`tel:${phone.replace(/\s+/g, "")}`} className="tabular-data hover:underline">
              {phone}
            </a>
          ) : (
            "—"
          )}
        </dd>
        <dt>Địa chỉ</dt>
        <dd className="break-words text-on-surface">{diaChi || "—"}</dd>
        {routeName && (
          <>
            <dt>Tuyến</dt>
            <dd className="text-on-surface">{routeName}</dd>
          </>
        )}
      </dl>
    </div>
  )
}
