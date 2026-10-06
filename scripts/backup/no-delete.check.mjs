import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from './upload-drive.ts'

test('upload succeeds without listing or deleting old backups; failures never prune', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nppsale-backup-test-'))
  const originalFetch = globalThis.fetch
  const keys = ['GDRIVE_CLIENT_ID', 'GDRIVE_CLIENT_SECRET', 'GDRIVE_REFRESH_TOKEN', 'GDRIVE_FOLDER_ID']
  const saved = keys.map(key => process.env[key])
  keys.forEach(key => { process.env[key] = 'mock-only' })
  writeFileSync(join(dir, 'nppsale-20261006.pgc.age'), 'age-encryption.org/v1\nmock-only')
  try {
    for (const fail of [false, true]) {
      const requests = []
      globalThis.fetch = async (url, init = {}) => {
        requests.push([String(url), init.method || 'GET'])
        if (String(url) === 'https://oauth2.googleapis.com/token') {
          return Response.json({ access_token: 'mock-only' })
        }
        if (String(url).includes('uploadType=resumable')) {
          return new Response(null, { headers: { location: 'https://mock.invalid/upload' } })
        }
        if (String(url) === 'https://mock.invalid/upload') {
          for await (const chunk of init.body) assert.ok(chunk.length > 0)
          return fail ? new Response('mock failure', { status: 500 }) : Response.json({ id: 'mock-id' })
        }
        throw new Error('Unexpected network request: ' + url)
      }
      if (fail) await assert.rejects(main(dir, true), /Upload lỗi/)
      else await main(dir)
      assert.deepEqual(requests.map(([, method]) => method), ['POST', 'POST', 'PUT'])
      assert.equal(requests.some(([, method]) => method === 'DELETE'), false)
    }
  } finally {
    globalThis.fetch = originalFetch
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i] })
    rmSync(dir, { recursive: true, force: true })
  }
})
