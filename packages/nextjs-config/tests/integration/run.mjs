import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { compareAssets, digest, validateUploads, validateWorkers } from './assertions.mjs'

const fixtures = ['next15-react18', 'next15', 'next16']
const directory = import.meta.dirname
const repository = path.resolve(directory, '../../../..')
const artifactRoot = path.join(repository, 'test-results/nextjs-integration')
mkdirSync(artifactRoot, { recursive: true })
const artifacts = mkdtempSync(path.join(artifactRoot, 'run-'))
const workspace = mkdtempSync(path.join(tmpdir(), 'posthog-nextjs-integration-'))
const browserRequire = createRequire(path.join(repository, 'packages/browser/package.json'))
const { chromium } = browserRequire('@playwright/test')
const children = new Set()
const started = Date.now()
let browser
let passed = false
console.log(`Next.js integration artifacts: ${artifacts}\nWorkspace: ${workspace}`)

function cleanEnv(extra = {}) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(POSTHOG_|NEXT_PUBLIC_|NEXT_PRIVATE_|WEBPACK$|TURBOPACK$|FIXTURE_)/.test(key)) delete env[key]
  }
  return { ...env, NEXT_TELEMETRY_DISABLED: '1', ...extra }
}

function start(command, args, { cwd = repository, env = cleanEnv(), log, timeout = 180_000 }) {
  mkdirSync(path.dirname(log), { recursive: true })
  const fd = openSync(log, 'a')
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', fd, fd], detached: process.platform !== 'win32' })
  closeSync(fd)
  children.add(child)
  const exited = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }))
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  const timer = setTimeout(() => kill(child, 'SIGKILL'), timeout)
  const done = exited.then((result) => {
    clearTimeout(timer)
    // A failed parent can exit before its Next workers. Reap the group even then.
    kill(child, 'SIGKILL')
    children.delete(child)
    return result
  })
  return { child, done, log }
}

function kill(child, signal) {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function stop(process) {
  kill(process.child, 'SIGTERM')
  const timer = setTimeout(() => kill(process.child, 'SIGKILL'), 5000)
  try {
    await process.done
  } finally {
    clearTimeout(timer)
  }
}

async function run(command, args, options) {
  const process = start(command, args, options)
  const result = await process.done
  assert.equal(
    result.code,
    0,
    `${command} ${args.join(' ')} failed (${result.error || result.signal || result.code}); see ${process.log}`
  )
}

// Kill entire process groups: Next dev and webpack builds fork children of their own.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    for (const child of children) kill(child, 'SIGKILL')
    await browser?.close()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}
process.once('exit', () => {
  for (const child of children) kill(child, 'SIGKILL')
})

function json(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}
function lines(file) {
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
}
function report(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

async function prepare() {
  cpSync(path.join(directory, 'fixtures'), workspace, {
    recursive: true,
    filter: (source) => path.basename(source) !== 'node_modules',
  })
  for (const name of fixtures) {
    const { next, react } = json(path.join(workspace, name, 'package.json')).dependencies
    assert.equal(next.split('.')[0], name.match(/^next(\d+)/)[1], `${name} must use its named Next.js major`)
    const reactMajor = name.match(/react(\d+)/)?.[1]
    if (reactMajor) assert.equal(react.split('.')[0], reactMajor, `${name} must use its named React major`)
  }
  const store = process.env.NEXTJS_INTEGRATION_STORE_DIR
  await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', ...(store ? ['--store-dir', store] : [])], {
    cwd: workspace,
    log: path.join(artifacts, 'install.log'),
    timeout: 300_000,
  })
  const manifests = new Map(
    globSync('packages/*/package.json', { cwd: repository }).map((file) => {
      const manifest = json(path.join(repository, file))
      return [manifest.name, { manifest, directory: path.dirname(path.join(repository, file)) }]
    })
  )
  const packs = new Map()
  async function pack(name) {
    if (packs.has(name)) return
    const item = manifests.get(name)
    assert(item, `Missing workspace package: ${name}`)
    const filename = `${name.replace('@', '').replace('/', '-')}.tgz`
    const tarball = path.join(workspace, filename)
    packs.set(name, tarball)
    await run('pnpm', ['pack', '--out', tarball], {
      cwd: item.directory,
      log: path.join(artifacts, `pack-${filename}.log`),
    })
    for (const [dependency, version] of Object.entries(item.manifest.dependencies ?? {})) {
      if (version.startsWith('workspace:')) await pack(dependency)
    }
  }
  for (const name of ['@posthog/nextjs-config', 'posthog-node', 'posthog-js']) await pack(name)
  const fixtureRequire = createRequire(path.join(workspace, 'package.json'))
  const { satisfies } = fixtureRequire('semver')
  const externalDependencies = json(path.join(workspace, 'package.json')).dependencies
  for (const name of fixtures) {
    const app = path.join(workspace, name)
    cpSync(path.join(directory, 'app'), app, { recursive: true })
    chmodSync(path.join(app, 'mock-cli.cjs'), 0o755)
    // Unpack shipping artifacts into this consumer, not symlinks back into the repository.
    // External dependencies and framework peers come from the frozen fixture workspace.
    for (const [packageName, tarball] of packs) {
      const destination = path.join(app, 'node_modules', packageName)
      mkdirSync(destination, { recursive: true })
      await run('tar', ['-xzf', tarball, '--strip-components=1', '-C', destination], {
        log: path.join(artifacts, 'unpack.log'),
      })
      const manifest = json(path.join(destination, 'package.json'))
      assert.equal(manifest.name, packageName)
      for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
        if (packs.has(dependency)) continue
        const pin = externalDependencies[dependency]
        assert(pin, `Pin ${dependency} in the integration fixture manifest and lockfile`)
        const version = pin.startsWith('npm:') ? pin.slice(pin.lastIndexOf('@') + 1) : pin
        const requested = range.startsWith('npm:') ? range.slice(range.lastIndexOf('@') + 1) : range
        assert(
          satisfies(version, requested),
          `Update the fixture pin for ${dependency}: ${version} does not satisfy ${range}`
        )
      }
    }
  }
}

function collectAssets(root) {
  const assets = new Map()
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (file.endsWith('.js'))
        assets.set(path.relative(root, file).split(path.sep).join('/'), readFileSync(file, 'utf8'))
    }
  }
  visit(root)
  return assets
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}

async function serve(app, env, log, dev = false) {
  const port = await availablePort()
  const origin = `http://127.0.0.1:${port}`
  const next = createRequire(path.join(app, 'package.json')).resolve('next/dist/bin/next')
  const server = start(
    process.execPath,
    [next, dev ? 'dev' : 'start', ...(dev ? ['--webpack'] : []), '-H', '127.0.0.1', '-p', String(port)],
    { cwd: app, env, log }
  )
  try {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      assert(server.child.exitCode === null && server.child.signalCode === null, `Server exited; see ${log}`)
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(1000) })
        if (response.ok) return { ...server, origin }
      } catch {
        /* The listener may not yet exist, or dev is still compiling. */
      }
      await sleep(100)
    }
    throw new Error(`Server did not become ready; see ${log}`)
  } catch (error) {
    await stop(server)
    throw error
  }
}

async function checkServer(origin, releaseId) {
  const response = await fetch(`${origin}/api/release`, { signal: AbortSignal.timeout(30_000) })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(result, {
    event: '$exception',
    releaseId,
    compiledReleaseId: releaseId,
    runtimeEnvironment: null,
    globalReleaseId: releaseId,
  })
  return result
}

async function checkBrowser(app, origin, oldAssets, output) {
  const minimum = path.join(workspace, 'node_modules/posthog-js-minimum')
  assert.equal(json(path.join(minimum, 'package.json')).version, '1.438.5')
  const sources = {
    minimum: readFileSync(path.join(minimum, 'dist/array.js'), 'utf8'),
    candidate: readFileSync(path.join(app, 'node_modules/posthog-js/dist/array.js'), 'utf8'),
  }
  for (const mode of ['minimum', 'candidate', 'bundled']) {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    const unexpectedRequests = [],
      errors = [],
      assetFailures = [],
      cached = new Set()
    try {
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin === 'https://posthog.test') return route.fulfill({ contentType: 'application/json', body: '{}' })
        if (url.origin !== origin) {
          unexpectedRequests.push(url.href)
          return route.abort()
        }
        if (url.pathname === '/fixture-sdk.js')
          return route.fulfill({ contentType: 'application/javascript', body: sources[mode] })
        if (url.pathname.startsWith('/_next/static/')) {
          const key = decodeURIComponent(url.pathname.slice('/_next/static/'.length))
          if (oldAssets.has(key)) {
            cached.add(key)
            return route.fulfill({ contentType: 'application/javascript', body: oldAssets.get(key) })
          }
        }
        return route.continue()
      })
      const page = await context.newPage()
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        if (response.url().includes('/_next/static/') && response.status() >= 400) assetFailures.push(response.url())
      })
      await page.goto(origin + (mode === 'bundled' ? '/bundled' : '/'))
      assert.equal(await page.evaluate(() => globalThis._posthogReleaseId), 'release-two')
      if (mode !== 'bundled') {
        await page.click('#load')
        await page.waitForFunction(() => document.querySelector('#result').textContent === 'lazy loaded successfully')
        await page.addScriptTag({ url: `${origin}/fixture-sdk.js` })
        await page.evaluate(() => {
          window.posthog.init('phc_integration', {
            api_host: 'https://posthog.test',
            autocapture: false,
            capture_pageview: false,
            capture_pageleave: false,
            disable_session_recording: true,
            advanced_disable_decide: true,
            _disable_external_dependency_loading: true,
            // Playwright is intentionally detected as a bot. Allow this controlled capture.
            opt_out_useragent_filter: true,
            persistence: 'memory',
            before_send(event) {
              if (event.event === '$exception') window.cdnException = event
              return null
            },
          })
        })
      }
      await page.click('#capture')
      await page.waitForFunction(
        (mode) => (mode === 'bundled' ? window.bundledException : window.cdnException)?.event === '$exception',
        mode
      )
      const releaseId = await page.evaluate(
        (mode) => (mode === 'bundled' ? window.bundledException : window.cdnException).properties.$release_id,
        mode
      )
      assert.equal(releaseId, 'release-two', `${mode} SDK lost release metadata`)
      if (mode !== 'bundled') {
        // Negative control: the uncompiled SDK really depends on the injected global.
        await page.evaluate(() => {
          delete globalThis._posthogReleaseId
          window.cdnException = undefined
        })
        await page.click('#capture')
        await page.waitForFunction(() => window.cdnException?.event === '$exception')
        assert.equal(await page.evaluate(() => window.cdnException.properties.$release_id), undefined)
      }
      assert(cached.size > 0, 'No previous-deployment assets were replayed')
      assert.deepEqual(errors, [])
      assert.deepEqual(assetFailures, [])
      assert.deepEqual(unexpectedRequests, [])
      report(path.join(output, `browser-${mode}.json`), {
        releaseId,
        cached: [...cached],
        errors,
        assetFailures,
        unexpectedRequests,
      })
    } finally {
      await context.tracing.stop({ path: path.join(output, `browser-${mode}.zip`) })
      await context.close()
    }
  }
}

async function checkFixture(name) {
  const app = path.join(workspace, name)
  const output = path.join(artifacts, name)
  mkdirSync(output)
  const require = createRequire(path.join(app, 'package.json'))
  const version = require('next/package.json').version
  const next = require.resolve('next/dist/bin/next')
  const initial = Date.now()
  let first
  for (const releaseId of ['release-one', 'release-two']) {
    const workerLog = path.join(output, `${releaseId}-workers.jsonl`)
    const cliLog = path.join(output, `${releaseId}-cli.jsonl`)
    const env = cleanEnv({ FIXTURE_WORKER_LOG: workerLog, FIXTURE_CLI_LOG: cliLog })
    await run(process.execPath, [next, 'build', ...(name === 'next16' ? ['--webpack'] : [])], {
      cwd: app,
      env: { ...env, FIXTURE_RELEASE: releaseId },
      log: path.join(output, `${releaseId}-build.log`),
    })
    validateWorkers(lines(workerLog), 'buildWorker')
    const uploads = validateUploads(lines(cliLog), releaseId)
    for (const { file, sha256 } of uploads) {
      assert.equal(digest(readFileSync(path.join(app, file))), sha256, 'Uploaded asset changed after upload: ' + file)
      assert(!existsSync(path.join(app, file + '.map')), 'Uploaded map was not deleted: ' + file)
    }
    const serverBundle = readFileSync(path.join(app, '.next/server/pages/api/release.js'), 'utf8')
    assert.match(
      serverBundle,
      /(?:require|import)\(["']posthog-node["']\)/,
      'posthog-node must actually be externalized'
    )
    const assets = collectAssets(path.join(app, '.next/static'))
    if (releaseId === 'release-one') first = assets
    else report(path.join(output, 'asset-comparison.json'), compareAssets(first, assets))
    const server = await serve(app, env, path.join(output, `${releaseId}-server.log`))
    try {
      report(path.join(output, `${releaseId}-server.json`), await checkServer(server.origin, releaseId))
      if (releaseId === 'release-two') await checkBrowser(app, server.origin, first, output)
    } finally {
      await stop(server)
    }
    validateUploads(lines(cliLog), releaseId)
    if (releaseId === 'release-one') renameSync(path.join(app, '.next'), path.join(app, 'build-one'))
  }
  if (name === 'next16') {
    const workerLog = path.join(output, 'dev-workers.jsonl')
    const cliLog = path.join(output, 'dev-cli.jsonl')
    const env = cleanEnv({ FIXTURE_WORKER_LOG: workerLog, FIXTURE_CLI_LOG: cliLog })
    const server = await serve(app, env, path.join(output, 'dev.log'), true)
    try {
      const response = await fetch(`${server.origin}/api/release`, { signal: AbortSignal.timeout(30_000) })
      assert.equal(response.status, 200)
      assert.equal((await response.json()).event, '$exception')
      validateWorkers(lines(workerLog), 'devWorker')
      validateUploads(lines(cliLog), undefined)
    } finally {
      await stop(server)
    }
  }
  const result = { next: version, seconds: (Date.now() - initial) / 1000 }
  report(path.join(output, 'summary.json'), result)
  console.log(`PASS Next ${version}: ${result.seconds.toFixed(1)}s`)
}

try {
  await prepare()
  browser = await chromium.launch({ headless: true })
  for (const name of fixtures) await checkFixture(name)
  passed = true
  report(path.join(artifacts, 'summary.json'), { passed, seconds: (Date.now() - started) / 1000 })
  console.log(`Next.js integration passed in ${((Date.now() - started) / 1000).toFixed(1)}s`)
} catch (error) {
  report(path.join(artifacts, 'failure.json'), { error: error.stack, workspace })
  console.error(error)
  console.error(`Retained workspace: ${workspace}\nArtifacts: ${artifacts}`)
  process.exitCode = 1
} finally {
  await browser?.close()
  for (const child of children) kill(child, 'SIGKILL')
  if (passed) rmSync(workspace, { recursive: true, force: true })
}
