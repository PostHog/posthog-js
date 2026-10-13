// Runs the built `posthog-node/metrics/register` entrypoint the documented way
// (`node --import`) against a fake PostHog host. Covers what in-process tests
// cannot: the package export, the ESM loader hook and the flush on SIGTERM.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

const APP = `
import { createServer } from 'node:http'

const server = createServer((_request, response) => response.end('ok'))
server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address()
  await fetch('http://127.0.0.1:' + port + '/')
  console.log('ready')
})
`

async function startFakePostHog(t) {
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks),
      })
      response.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  return { requests, host: `http://127.0.0.1:${server.address().port}` }
}

test('flushes autocaptured metrics to the host when the process gets SIGTERM', async (t) => {
  const fakePostHog = await startFakePostHog(t)
  const dir = mkdtempSync(path.join(tmpdir(), 'posthog-metrics-register-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const app = path.join(dir, 'app.mjs')
  writeFileSync(app, APP)

  // Resolved from the package directory, so the package's own `exports` and its
  // OpenTelemetry dev dependencies are used.
  const child = spawn(process.execPath, ['--import', 'posthog-node/metrics/register', app], {
    cwd: packageDir,
    env: {
      ...process.env,
      POSTHOG_PROJECT_TOKEN: 'phc_test',
      // The trailing slash must not change the export path.
      POSTHOG_HOST: `${fakePostHog.host}/`,
      OTEL_SERVICE_NAME: 'metrics-register-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))
  t.after(() => child.kill('SIGKILL'))

  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => String(chunk).includes('ready') && resolve())
    child.on('exit', () => reject(new Error(`app exited before it was ready: ${stderr}`)))
  })
  // The export interval is 10s, so only the shutdown flush can send before this.
  child.kill('SIGTERM')

  assert.deepEqual(await exited, { code: null, signal: 'SIGTERM' }, stderr)
  const exports = fakePostHog.requests.filter((request) => request.url === '/i/v1/metrics')
  assert.ok(exports.length > 0, `requests: ${JSON.stringify(fakePostHog.requests.map((r) => r.url))}`)
  for (const metricsExport of exports) {
    assert.equal(metricsExport.method, 'POST')
    assert.equal(metricsExport.authorization, 'Bearer phc_test')
  }
  const body = Buffer.concat(exports.map((metricsExport) => metricsExport.body)).toString('latin1')
  // Protobuf keeps strings as raw bytes.
  for (const expected of [
    'metrics-register-test',
    'posthog-node',
    'http.server.request.duration',
    'http.client.request.duration',
  ]) {
    assert.ok(body.includes(expected), `export is missing ${expected}`)
  }
})
