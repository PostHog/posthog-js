import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(fileURLToPath(import.meta.url))
const fixtureDir = mkdtempSync(join(tmpdir(), 'posthog-nuxt5-consumer-'))
const packageRoot = join(packageDir, '..')
const packageStageDir = join(fixtureDir, 'package')
let captureServer
let nuxtServer

async function availablePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
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
      await new Promise(resolve => setTimeout(resolve, 100))
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

try {
  const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  packageManifest.dependencies = Object.fromEntries(
    Object.entries(packageManifest.dependencies).map(([name, version]) => {
      if (version !== 'catalog:' && !version.startsWith('workspace:')) {
        return [name, version]
      }

      const dependencyManifest = JSON.parse(
        readFileSync(join(packageRoot, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'),
      )
      const range = version === 'workspace:^' ? '^' : version === 'workspace:~' ? '~' : ''
      return [name, `${range}${dependencyManifest.version}`]
    }),
  )
  delete packageManifest.scripts
  cpSync(join(packageRoot, 'dist'), join(packageStageDir, 'dist'), { recursive: true })
  writeFileSync(join(packageStageDir, 'package.json'), JSON.stringify(packageManifest, null, 2))

  execFileSync('pnpm', ['pack', '--pack-destination', fixtureDir], {
    cwd: packageStageDir,
    stdio: 'inherit',
  })

  const packageTarball = join(
    fixtureDir,
    readdirSync(fixtureDir).find(filename => filename.endsWith('.tgz')),
  )
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
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'nuxt.config.mjs'),
    `export default defineNuxtConfig({ modules: ['@posthog/nuxt'], posthogConfig: { publicKey: 'phc_test', host: '${posthogHost}', serverConfig: { enableExceptionAutocapture: true, flushAt: 100, flushInterval: 0, disableCompression: true, disableRemoteConfig: true } } })\n`,
  )
  mkdirSync(join(fixtureDir, 'server', 'plugins'), { recursive: true })
  writeFileSync(
    join(fixtureDir, 'server', 'plugins', 'background-error.mjs'),
    `setInterval(() => {}, 60_000)\nexport default () => { process.once('SIGUSR2', () => { Promise.reject(new Error('background shutdown test')) }) }\n`,
  )

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
  await new Promise(resolve => setTimeout(resolve, 100))
  const exit = once(nuxtServer, 'exit')
  nuxtServer.kill('SIGTERM')
  assert.match(
    await withTimeout(capture, 5_000, 'PostHog events were not flushed while the server had an active handle'),
    /background shutdown test/,
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
    await new Promise(resolve => captureServer.close(resolve))
  }
  rmSync(fixtureDir, { recursive: true, force: true })
}
