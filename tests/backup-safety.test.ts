import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { main, safeFailure } from "../scripts/backup/upload-drive"

const marker = "DUMMY_PRIVATE_VALUE_MUST_NOT_APPEAR"
const roots: string[] = []
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "backup-safety-"))
  roots.push(dir)
  return dir
}
const secrets = ["SUPABASE_DB_URL", "AGE_PUBLIC_KEY", "GDRIVE_CLIENT_ID", "GDRIVE_CLIENT_SECRET", "GDRIVE_REFRESH_TOKEN", "GDRIVE_FOLDER_ID"]

beforeEach(() => {
  for (const name of secrets) vi.stubEnv(name, marker)
  vi.spyOn(console, "log").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("Drive failures never expose remote or local exception text", () => {
  const file = () => {
    const dir = temp()
    writeFileSync(join(dir, "nppsale-20261006.pgc.age"), "dummy encrypted content")
    return dir
  }
  const response = (status: number, body: unknown, headers?: Record<string, string>) =>
    new Response(JSON.stringify(body), { status, headers })
  const token = () => response(200, { access_token: "DUMMY_ACCESS" })
  const start = () => response(200, {}, { location: "https://www.googleapis.com/upload/dummy" })
  const uploaded = () => response(200, { id: "dummy-file-id" })
  const reply = (make: () => Response) => async (_url: string, init?: RequestInit) => {
    // A real fetch consumes the upload stream. Do the same in the mock so
    // temporary files are not deleted while their asynchronous open is pending.
    if (init?.method === "PUT") {
      for await (const chunk of init.body as unknown as AsyncIterable<Uint8Array>) void chunk
    }
    return make()
  }
  async function failed(responses: (() => Response)[], code: string, prune = false) {
    const fetch = vi.fn()
    for (const make of responses) fetch.mockImplementationOnce(reply(make))
    vi.stubGlobal("fetch", fetch)
    const result = await main(file(), prune).catch(safeFailure)
    expect(result).toBe(code)
    expect(String(result)).not.toContain(marker)
    expect(vi.mocked(console.log).mock.calls.flat().join(" ")).not.toContain(marker)
    return fetch
  }
  it("discards OAuth error descriptions and response bodies", async () => {
    await failed([() => response(400, { error_description: marker, error: marker })], "OAUTH_HTTP_FAILURE (HTTP 400)")
  })
  it("discards resumable-start error body", async () => {
    await failed([token, () => response(403, { error: marker })], "DRIVE_UPLOAD_START_HTTP_FAILURE (HTTP 403)")
  })
  it("discards upload error body", async () => {
    await failed([token, start, () => response(500, marker)], "DRIVE_UPLOAD_HTTP_FAILURE (HTTP 500)")
  })
  it("discards list error body when prune is explicitly requested", async () => {
    await failed([token, start, uploaded, () => response(403, marker)], "DRIVE_LIST_HTTP_FAILURE (HTTP 403)", true)
  })
  it("discards delete error body when prune is explicitly requested", async () => {
    await failed([token, start, uploaded, () => response(200, { files: [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `keep-${i}`, name: `nppsale-202610${String(i + 1).padStart(2, "0")}.pgc.age` })),
      { id: "old", name: "nppsale-20250315.pgc.age" },
    ] }), () => response(403, marker)], "DRIVE_DELETE_HTTP_FAILURE (HTTP 403)", true)
  })
  it("redacts network exception details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(marker)))
    expect(await main(file()).catch(safeFailure)).toBe("OAUTH_NETWORK")
  })
  it("redacts invalid JSON and unexpected errors", async () => {
    await failed([() => new Response(marker, { status: 200 })], "OAUTH_INVALID_RESPONSE")
    expect(safeFailure(new Error(marker))).toBe("BACKUP_UNEXPECTED_FAILURE")
    expect(safeFailure(marker)).toBe("BACKUP_UNEXPECTED_FAILURE")
  })
  it("uploads without listing or deleting by default", async () => {
    const fetch = vi.fn().mockImplementationOnce(reply(token)).mockImplementationOnce(reply(start)).mockImplementationOnce(reply(uploaded))
    vi.stubGlobal("fetch", fetch)
    await main(file())
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "POST", "PUT"])
  })
})

describe("CI gates with dummy command binaries only", () => {
  function run(script: string, commands: Record<string, string> = {}, env: Record<string, string> = {}) {
    const dir = temp(); mkdirSync(join(dir, "bin")); mkdirSync(join(dir, "out"))
    for (const [name, code] of Object.entries(commands)) writeFileSync(join(dir, "bin", name), "#!/usr/bin/env bash\n" + code, { mode: 0o755 })
    const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash"
    const scriptPath = resolve(__dirname, "../scripts/backup", script).replaceAll("\\", "/")
    const result = spawnSync(bash, ["-c", 'export PATH="$PWD/bin:$PATH"; bash "$1"', "test", scriptPath], {
      cwd: dir, env: { ...process.env, PGURL: marker, ...env }, encoding: "utf8",
    })
    expect(result.error).toBeUndefined()
    expect(result.stdout + result.stderr).not.toContain(marker)
    return result
  }
  it.each(secrets)("blocks missing %s before any DB/OAuth command", (name) => {
    const result = run("preflight.sh", {}, { [name]: "" })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(`BACKUP_MISSING_SECRET ${name}`)
  })
  it("accepts six present dummy secrets without printing them", () => {
    expect(run("preflight.sh").status).toBe(0)
  })
  it("blocks failed restore and discards both output streams", () => {
    const result = run("verify-dump.sh", { pg_restore: `echo '${marker}'; echo '${marker}' >&2; exit 1` })
    expect(result.status).toBe(1); expect(result.stdout).toContain("BACKUP_RESTORE_FAILED")
  })
  it("reports target incompatibility without ignoring missing dependencies or echoing their names", () => {
    const result = run("verify-dump.sh", { pg_restore: `echo 'ERROR: role "${marker}" does not exist' >&2; exit 1` })
    expect(result.status).toBe(1); expect(result.stdout).toContain("BACKUP_RESTORE_TARGET_INCOMPATIBLE")
  })
  it("reports only whitelisted public schema names", () => {
    const known = run("verify-dump.sh", { pg_restore: 'echo \'pg_restore: error: could not execute query: ERROR:  schema "extensions" does not exist\' >&2; exit 1' })
    expect(known.status).toBe(1); expect(known.stdout).toContain("Missing restore schema: extensions")
    const unknown = run("verify-dump.sh", { pg_restore: `echo 'pg_restore: error: could not execute query: ERROR:  schema "${marker}" does not exist' >&2; exit 1` })
    expect(unknown.status).toBe(1); expect(unknown.stdout).not.toContain("Missing restore schema:")
  })
  it("targets only disposable localhost and enables fail-fast transaction", () => {
    const result = run("verify-dump.sh", { pg_restore: '[ "$2" = "postgresql://postgres@localhost:5433/verify" ] && [[ "$*" == *"--exit-on-error"* ]] && [[ "$*" == *"--single-transaction"* ]]' })
    expect(result.status).toBe(0)
  })
  it("blocks failed source query without printing DB errors", () => {
    const result = run("verify-counts.sh", { psql: `echo '${marker}' >&2; exit 1` })
    expect(result.status).toBe(1); expect(result.stdout).toContain("BACKUP_SOURCE_TABLE_QUERY_FAILED")
  })
  it("rejects nonnumeric query output without reflecting it", () => {
    const result = run("verify-counts.sh", { psql: `echo '${marker}'` })
    expect(result.status).toBe(1); expect(result.stdout).toContain("BACKUP_TABLE_COUNT_MISMATCH_OR_INVALID")
  })
  it("rejects empty restored table count", () => {
    expect(run("verify-counts.sh", { psql: 'echo 0' }).status).toBe(1)
  })
  it("accepts matching positive table/user counts", () => {
    expect(run("verify-counts.sh", { psql: 'echo 3' }).status).toBe(0)
  })
})
