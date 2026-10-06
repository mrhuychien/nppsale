import type { Metadata } from "next"
import { BackupPublicInfo } from "@/components/backup/public-info"

export const metadata: Metadata = { title: "nppsale backup — Chính sách quyền riêng tư" }

export default function BackupPrivacyPage() {
  return <BackupPublicInfo section="privacy" />
}
