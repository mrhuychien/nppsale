import { createFakeSupabase } from "./fake-supabase.mjs"
import { tables, rpc, users } from "./fixture.mjs"
const port = Number(process.env.FAKE_SUPABASE_PORT || 54321)
const { server } = createFakeSupabase({ tables: tables(), rpc, users })
server.listen(port, "127.0.0.1", () => console.log(`fake supabase :${port}`))
