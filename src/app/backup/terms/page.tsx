import type { Metadata } from "next"
import { BackupPublicInfo } from "@/components/backup/public-info"

export const metadata: Metadata = { title: "nppsale backup — Điều khoản sử dụng" }

export default function BackupTermsPage() {
  return <BackupPublicInfo section="terms" />
}
