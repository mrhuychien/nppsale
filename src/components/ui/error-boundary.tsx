"use client"

import { Component, type ReactNode } from "react"
import { baoLoiVeMayChu } from "@/lib/client-error"

/**
 * Vùng bắt lỗi cho một MẢNH phụ của khung app (chuông thông báo…): mảnh đó hỏng thì chỉ mảnh
 * đó biến thành `fallback`, không kéo sập cả màn thành "Application error" (chủ nhà 26/09/2026).
 * Lỗi vẫn được báo về máy chủ.
 */
export class KhungAnToan extends Component<{ noi: string; fallback?: ReactNode; children: ReactNode }, { loi: boolean }> {
  state = { loi: false }

  static getDerivedStateFromError() {
    return { loi: true }
  }

  componentDidCatch(error: unknown) {
    console.error(`[${this.props.noi}]`, error)
    baoLoiVeMayChu(error, this.props.noi)
  }

  render() {
    return this.state.loi ? (this.props.fallback ?? null) : this.props.children
  }
}
