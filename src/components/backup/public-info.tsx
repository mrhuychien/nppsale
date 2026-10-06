import Link from "@/components/ui/link"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { backupInfo } from "@/lib/backup/public-info"

type Section = "home" | "privacy" | "terms"

export function BackupPublicInfo({ section }: { section: Section }) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:py-12">
      <header className="space-y-3">
        <p className="text-sm font-medium text-primary">npp.sale · nppsale backup</p>
        <h1 className="text-3xl font-semibold tracking-tight">nppsale backup</h1>
        <p className="text-lg">Chính sách quyền riêng tư và điều khoản sử dụng</p>
        <p className="text-sm text-muted-foreground">Cập nhật: {backupInfo.updated}</p>
        <nav aria-label="Thông tin công cụ sao lưu" className="flex flex-wrap gap-2">
          {([["home", "/backup", "Giới thiệu"], ["privacy", "/backup/privacy", "Quyền riêng tư"], ["terms", "/backup/terms", "Điều khoản"]] as const).map(([key, href, label]) => (
            <Link key={key} href={href} aria-current={section === key ? "page" : undefined} className="inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-medium hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{label}</Link>
          ))}
        </nav>
      </header>
      <Card><CardHeader><h2 className="text-xl font-semibold">1. Mục đích</h2></CardHeader><CardContent className="space-y-4 leading-relaxed">{backupInfo.introduction.map((text) => <p key={text}>{text}</p>)}</CardContent></Card>
      {backupInfo.privacy.map((item) => <Card key={item.title}><CardHeader><h2 className="text-xl font-semibold">{item.title}</h2></CardHeader><CardContent className="space-y-4 leading-relaxed">{item.paragraphs.map((text) => <p key={text}>{text}</p>)}</CardContent></Card>)}
      <Card><CardHeader><h2 className="text-xl font-semibold">6. Điều kiện sử dụng</h2></CardHeader><CardContent className="space-y-4 leading-relaxed">{backupInfo.terms.map((text) => <p key={text}>{text}</p>)}</CardContent></Card>
      <footer className="rounded-xl border bg-muted/30 p-4 text-sm leading-relaxed"><h2 className="mb-2 text-xl font-semibold">7. Liên hệ</h2><a className="inline-flex min-h-11 items-center break-all text-primary underline underline-offset-4" href={`mailto:${backupInfo.contact}`}>{backupInfo.contact}</a></footer>
    </main>
  )
}
