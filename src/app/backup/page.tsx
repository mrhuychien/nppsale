import type { Metadata } from "next"
import { BackupPublicInfo } from "@/components/backup/public-info"

export const metadata: Metadata = { title: "nppsale backup — Giới thiệu" }

export default function BackupPage() {
  return <BackupPublicInfo section="home" />
}
