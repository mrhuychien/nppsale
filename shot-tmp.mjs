import { chromium } from "playwright"
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(()=>chromium.launch())
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } })
p.on("pageerror", e => console.log("ERR", e.message))
await p.goto("file://" + process.cwd() + "/proto.html")
await p.waitForTimeout(2500)
const shots = [["overview","Tổng quan"],["sales","Bán hàng"],["eod","Cuối ngày"],["stock","Kho"],["debt","Công nợ"],["fin","Tài chính"]]
for (const [k,label] of shots) {
  await p.getByRole("button", { name: label, exact: true }).first().click().catch(e=>console.log("noclick",label))
  await p.waitForTimeout(600)
  await p.screenshot({ path: `s-${k}.png`, fullPage: true })
}
await b.close()
