"use client"

// =====================================================================
// T-08 — Phiếu thu lái xe (Mẫu 01-TT, TT 200/2014/TT-BTC).
// Single-liên, A5 portrait. Caller wraps in any layout and triggers
// window.print() — globals.css `@page A5 portrait` does the rest.
// =====================================================================

import { numberToVietnameseWords } from "@/lib/utils/number-to-vn-words"

export interface PaymentReceiptTT200Props {
  organizationName: string
  organizationDept?: string
  bookNo?: string
  receiptNo: string
  date: Date
  payerName: string
  reason: string
  amount: number
  evidenceCount?: number
}

const formatVND = (n: number) =>
  new Intl.NumberFormat("vi-VN").format(Math.round(n))

const pad = (n: number) => String(n).padStart(2, "0")

export function PaymentReceiptTT200({
  organizationName,
  organizationDept,
  bookNo,
  receiptNo,
  date,
  payerName,
  reason,
  amount,
  evidenceCount = 0,
}: PaymentReceiptTT200Props) {
  const dd = pad(date.getDate())
  const mm = pad(date.getMonth() + 1)
  const yyyy = date.getFullYear()
  return (
    <div className="a5-doc print-page" style={{ width: "148mm" }}>
      <header style={{ display: "flex", justifyContent: "space-between", fontSize: "7pt" }}>
        <div>
          <div>Đơn vị: <strong>{organizationName}</strong></div>
          {organizationDept && <div>Bộ phận: {organizationDept}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          Mẫu số 01-TT
          <br />
          <span style={{ fontStyle: "italic" }}>
            (Ban hành theo TT 200/2014/TT-BTC)
          </span>
        </div>
      </header>

      <h1 style={{ textAlign: "center", marginTop: "8mm", fontWeight: 700 }}>
        PHIẾU THU
      </h1>
      <div style={{ textAlign: "center", fontStyle: "italic" }}>
        Ngày {dd} tháng {mm} năm {yyyy}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "8mm",
          margin: "3mm 0",
        }}
      >
        {bookNo && <div>Quyển số: {bookNo}</div>}
        <div>Số: {receiptNo}</div>
        <div>Nợ: 111</div>
        <div>Có: 131</div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ width: "32%", paddingTop: "1mm" }}>Họ tên người nộp:</td>
            <td>{payerName}</td>
          </tr>
          <tr>
            <td style={{ paddingTop: "1mm" }}>Lý do nộp:</td>
            <td>{reason}</td>
          </tr>
          <tr>
            <td style={{ paddingTop: "1mm" }}>Số tiền:</td>
            <td style={{ fontWeight: 700 }}>{formatVND(amount)} VNĐ</td>
          </tr>
          <tr>
            <td style={{ paddingTop: "1mm" }}>Bằng chữ:</td>
            <td style={{ fontStyle: "italic" }}>{numberToVietnameseWords(amount)}</td>
          </tr>
          <tr>
            <td style={{ paddingTop: "1mm" }}>Kèm theo:</td>
            <td>{evidenceCount} chứng từ gốc</td>
          </tr>
        </tbody>
      </table>

      <div style={{ textAlign: "right", fontStyle: "italic", marginTop: "4mm" }}>
        Ngày {dd} tháng {mm} năm {yyyy}
      </div>

      <footer
        className="signatures"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "2mm",
          marginTop: "6mm",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>Giám đốc</div>
          <div style={{ fontStyle: "italic" }}>(Ký, họ tên)</div>
        </div>
        <div>
          <div style={{ fontWeight: 600 }}>Kế toán trưởng</div>
          <div style={{ fontStyle: "italic" }}>(Ký, họ tên)</div>
        </div>
        <div>
          <div style={{ fontWeight: 600 }}>Người nộp</div>
          <div style={{ fontStyle: "italic" }}>(Ký, họ tên)</div>
        </div>
        <div>
          <div style={{ fontWeight: 600 }}>Người lập phiếu</div>
          <div style={{ fontStyle: "italic" }}>(Ký, họ tên)</div>
        </div>
        <div>
          <div style={{ fontWeight: 600 }}>Thủ quỹ</div>
          <div style={{ fontStyle: "italic" }}>(Ký, họ tên)</div>
        </div>
      </footer>
    </div>
  )
}
