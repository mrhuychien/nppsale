import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MoneyInput } from "../src/components/ui/money-input"

const hien = (value: unknown) =>
  /value="([^"]*)"/.exec(
    renderToStaticMarkup(createElement(MoneyInput, { value: value as number, onChange: () => {}, showSuffix: false }))
  )![1]

/**
 * ⚠ Ô TIỀN NHẬN GIÁ TRỊ ĐÚNG NHƯ NƠI GỌI ĐƯA. Lỗi tìm ra khi đổi 54 ô nhập
 *   tiền sang MoneyInput (23/09/2026): state hay giữ `String(r.x)` của một
 *   cột `numeric` — "1234.5" — và bản cũ bỏ dấu chấm thành 12.345.
 */
describe("MoneyInput hiện đúng giá trị", () => {
  it.each([
    [9000000, "9.000.000"],
    ["9000000", "9.000.000"],
    ["1234.5", "1.235"],
    ["250000.00", "250.000"],
    [10416.67, "10.417"],
    ["1.500.000", "1.500.000"],
    ["", ""],
    [null, ""],
    [0, "0"],
  ])("%j → %s", (v, ra) => {
    expect(hien(v)).toBe(ra)
  })
})
