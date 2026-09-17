"use client"

import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast"
import { useToast } from "@/hooks/use-toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast
            key={id}
            {...props}
            /* ⚠ THÔNG BÁO LỖI PHẢI Ở LÂU HƠN. 5 giây đủ cho "Đã lưu", nhưng
               một câu lỗi kèm nguyên văn của database thì đọc chưa xong đã
               biến mất — và người dùng không có cách nào gọi nó lại. */
            duration={props.variant === "destructive" ? 15000 : 5000}
          >
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {/* Chọn được chữ để người dùng chụp / chép gửi cho người hỗ trợ. */}
              {description && (
                <ToastDescription className="select-text break-words">
                  {description}
                </ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
