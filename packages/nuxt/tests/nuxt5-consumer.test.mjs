import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { waitForPackages } from './wait-for-packages.mjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
const fixtureDir = mkdtempSync(join(tmpdir(), 'posthog-nuxt5-consumer-'))
const packageRoot = join(packageDir, '..')
let captureServer
let nuxtServer

async function availablePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (nuxtServer.exitCode !== null) {
      throw new Error(`Nuxt server exited with code ${nuxtServer.exitCode}`)
    }
    try {
      return await fetch(url)
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('Nuxt server did not start')
}

function withTimeout(promise, milliseconds, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds)
    }),
  ]).finally(() => clearTimeout(timer))
}

// TEMP: posthog-js@1.438.3 failed the S3 release gate and never reached npm, so this test cannot install it.
// Remove once the S3 recovery publishes it.
const unpublishedPosthogJs = '1.438.3'
const posthogJsVersion = JSON.parse(
  readFileSync(join(packageRoot, 'node_modules', 'posthog-js', 'package.json'), 'utf8')
).version
if (posthogJsVersion === unpublishedPosthogJs) {
  try {
    await waitForPackages([['posthog-js', posthogJsVersion]], { attempts: 1 })
  } catch {
    console.log(`skip nuxt5-consumer.test.mjs: posthog-js@${posthogJsVersion} is not published to npm`)
    rmSync(fixtureDir, { recursive: true, force: true })
    process.exit(0)
  }
}

try {
  const packagesToWaitFor = new Map()
  function packBuiltPackage(root, name, localDependencies = {}) {
    const stage = join(fixtureDir, name)
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.dependencies = Object.fromEntries(
      Object.entries(packageManifest.dependencies).map(([dependency, version]) => {
        if (localDependencies[dependency]) return [dependency, localDependencies[dependency]]
        if (version !== 'catalog:' && !version.startsWith('workspace:')) return [dependency, version]
        const manifest = JSON.parse(
          readFileSync(join(root, 'node_modules', ...dependency.split('/'), 'package.json'), 'utf8')
        )
        const range = version === 'workspace:^' ? '^' : version === 'workspace:~' ? '~' : ''
        packagesToWaitFor.set(dependency, manifest.version)
        return [dependency, `${range}${manifest.version}`]
      })
    )
    delete packageManifest.scripts
    delete packageManifest.devDependencies
    mkdirSync(stage, { recursive: true })
    cpSync(join(root, 'dist'), join(stage, 'dist'), { recursive: true })
    writeFileSync(join(stage, 'package.json'), JSON.stringify(packageManifest, null, 2))
    execFileSync('pnpm', ['pack', '--pack-destination', stage], { cwd: stage, stdio: 'inherit' })
    return join(
      stage,
      readdirSync(stage).find((filename) => filename.endsWith('.tgz'))
    )
  }
  const nodeTarball = packBuiltPackage(join(packageRoot, '..', 'node'), 'node-package')
  const packageTarball = packBuiltPackage(packageRoot, 'nuxt-package', {
    'posthog-node': `file:${nodeTarball}`,
  })
  let resolveCapture
  const capture = new Promise((resolve) => {
    resolveCapture = resolve
  })
  captureServer = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) {
      chunks.push(chunk)
    }
    if (request.url === '/batch/') {
      resolveCapture(Buffer.concat(chunks).toString())
    }
    response.end('{}')
  })
  captureServer.listen(0, '127.0.0.1')
  await once(captureServer, 'listening')
  const posthogHost = `http://127.0.0.1:${captureServer.address().port}`

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        scripts: { build: 'nuxt build' },
        dependencies: {
          '@nuxt/kit': 'npm:@nuxt/kit-nightly@5.0.0-29762631.396a4ae3',
          '@posthog/nuxt': `file:${packageTarball}`,
          'nitro': '3.0.260610-beta',
          'nuxt': 'npm:nuxt-nightly@5.0.0-29762631.396a4ae3',
        },
      },
      null,
      2
    )
  )
  writeFileSync(
    join(fixtureDir, 'nuxt.config.mjs'),
    `export default defineNuxtConfig({ modules: ['@posthog/nuxt'], posthogConfig: { publicKey: 'phc_test', host: '${posthogHost}', serverConfig: { enableExceptionAutocapture: true, flushAt: 100, flushInterval: 0, disableCompression: true, disableRemoteConfig: true } } })\n`
  )
  mkdirSync(join(fixtureDir, 'server', 'plugins'), { recursive: true })
  writeFileSync(
    join(fixtureDir, 'server', 'plugins', 'background-error.mjs'),
    `setInterval(() => {}, 60_000)\nexport default () => { process.once('SIGUSR2', () => { Promise.reject(new Error('background shutdown test')) }) }\n`
  )

  await waitForPackages(packagesToWaitFor)
  execFileSync('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: fixtureDir, stdio: 'inherit' })
  execFileSync('pnpm', ['exec', 'nuxt', 'build'], { cwd: fixtureDir, stdio: 'inherit' })

  const nuxtPort = await availablePort()
  nuxtServer = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: fixtureDir,
    env: {
      ...process.env,
      CI: '',
      HOST: '127.0.0.1',
      PORT: String(nuxtPort),
      TEST: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const nuxtHost = `http://127.0.0.1:${nuxtPort}`
  await waitForServer(nuxtHost)
  nuxtServer.kill('SIGUSR2')
  await new Promise((resolve) => setTimeout(resolve, 100))
  const exit = once(nuxtServer, 'exit')
  nuxtServer.kill('SIGTERM')
  assert.match(
    await withTimeout(capture, 5_000, 'PostHog events were not flushed while the server had an active handle'),
    /background shutdown test/
  )
  assert.equal(nuxtServer.exitCode, null)
  nuxtServer.kill('SIGKILL')
  await withTimeout(exit, 5_000, 'Nuxt server did not exit')
  console.log('ok nuxt5-consumer.test.mjs')
} finally {
  if (nuxtServer?.exitCode === null) {
    nuxtServer.kill('SIGKILL')
  }
  if (captureServer) {
    await new Promise((resolve) => captureServer.close(resolve))
  }
  rmSync(fixtureDir, { recursive: true, force: true })
}
