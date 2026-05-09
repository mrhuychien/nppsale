"use client"

/**
 * T-10: "Danh sách giao hàng" — A5 print companion to the export
 * stock entry. The driver carries this paper, ticks off "thực thu"
 * per order at the customer site.
 *
 * One section per driver. When all orders share a single driver (or
 * driver is unset) we render a single section.
 */

import { formatCurrency, formatDate } from "@/lib/utils"

export interface DriverListOrder {
  id: string
  orderCode: string
  customerName: string
  deliveryAddress: string | null
  totalToCollect: number
  /** Optional driver name; blank/null means "unassigned". */
  driverName?: string | null
}

interface DriverListProps {
  /** Sequence / merge / shipment label printed in the header. */
  shipmentCode: string
  shipmentDate: string | null
  vehiclePlate?: string | null
  orders: DriverListOrder[]
}

/** Group rows by driverName; keep insertion order. */
function groupByDriver(
  orders: DriverListOrder[]
): { driver: string; orders: DriverListOrder[] }[] {
  const map = new Map<string, DriverListOrder[]>()
  for (const o of orders) {
    const key = o.driverName?.trim() || "Chưa gán"
    const arr = map.get(key) || []
    arr.push(o)
    map.set(key, arr)
  }
  return Array.from(map.entries()).map(([driver, ord]) => ({
    driver,
    orders: ord,
  }))
}

export function DriverList({
  shipmentCode,
  shipmentDate,
  vehiclePlate,
  orders,
}: DriverListProps) {
  const groups = groupByDriver(orders)

  return (
    <>
      {groups.map((g, gi) => {
        const grandTotal = g.orders.reduce(
          (s, o) => s + Number(o.totalToCollect || 0),
          0
        )
        return (
          <div
            key={`${g.driver}-${gi}`}
            className="driver-list a5-doc print-page p-6"
            style={{ pageBreakAfter: gi < groups.length - 1 ? "always" : "auto" }}
          >
            <h1 className="text-center font-bold uppercase text-base mb-2">
              Danh sách giao hàng
            </h1>
            <div className="grid grid-cols-3 gap-2 my-2 text-[8pt]">
              <div>
                <span className="text-muted-foreground">Lái xe:</span>{" "}
                <strong>{g.driver}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Xe:</span>{" "}
                <strong>{vehiclePlate || "—"}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Ngày:</span>{" "}
                <strong>
                  {shipmentDate ? formatDate(shipmentDate) : formatDate(new Date())}
                </strong>
                <span className="ml-2 text-muted-foreground">Phiếu:</span>{" "}
                <strong className="font-mono">{shipmentCode}</strong>
              </div>
            </div>

            <table className="w-full border-collapse text-[8pt]">
              <thead>
                <tr>
                  <th className="border border-gray-400 px-1 py-1 w-8 text-center">STT</th>
                  <th className="border border-gray-400 px-1 py-1 w-24 text-left">Mã đơn</th>
                  <th className="border border-gray-400 px-1 py-1 text-left">Khách hàng</th>
                  <th className="border border-gray-400 px-1 py-1 text-left">Địa chỉ</th>
                  <th className="border border-gray-400 px-1 py-1 w-24 text-right">
                    Tổng cần thu
                  </th>
                  <th
                    className="border border-gray-400 px-1 py-1 text-right"
                    style={{ width: "20mm" }}
                  >
                    Thực thu
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.orders.map((o, i) => (
                  <tr key={o.id}>
                    <td className="border border-gray-400 px-1 py-1 text-center">
                      {i + 1}
                    </td>
                    <td className="border border-gray-400 px-1 py-1 font-mono">
                      {o.orderCode}
                    </td>
                    <td className="border border-gray-400 px-1 py-1">
                      {o.customerName}
                    </td>
                    <td className="border border-gray-400 px-1 py-1">
                      {o.deliveryAddress || "—"}
                    </td>
                    <td className="border border-gray-400 px-1 py-1 text-right tabular-nums">
                      {formatCurrency(o.totalToCollect)}
                    </td>
                    {/* Driver fills "thực thu" by hand. */}
                    <td className="border border-gray-400 px-1 py-1"></td>
                  </tr>
                ))}
                <tr className="font-bold border-t-2 border-gray-600">
                  <td
                    className="border border-gray-400 px-1 py-1 text-right"
                    colSpan={4}
                  >
                    TỔNG
                  </td>
                  <td className="border border-gray-400 px-1 py-1 text-right tabular-nums">
                    {formatCurrency(grandTotal)}
                  </td>
                  <td className="border border-gray-400 px-1 py-1"></td>
                </tr>
              </tbody>
            </table>

            <footer className="grid grid-cols-3 gap-2 mt-6 text-center text-[7pt] signatures">
              <div>
                <p className="font-semibold">Lái xe</p>
                <p className="text-muted-foreground italic mt-8">(Ký, họ tên)</p>
              </div>
              <div>
                <p className="font-semibold">Thủ kho</p>
                <p className="text-muted-foreground italic mt-8">(Ký, họ tên)</p>
              </div>
              <div>
                <p className="font-semibold">Kế toán</p>
                <p className="text-muted-foreground italic mt-8">(Ký, họ tên)</p>
              </div>
            </footer>
          </div>
        )
      })}
    </>
  )
}
