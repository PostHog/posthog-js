import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, resolve } from 'node:path'

// Pulling the image may use the network; the test process cannot.
const image = 'node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553'
const root = fileURLToPath(new URL('../../..', import.meta.url))
const args = [
  'run',
  '--rm',
  '--init',
  '--network=none',
  '--read-only',
  '--user=node',
  '--cap-drop=ALL',
  '--security-opt=no-new-privileges',
  // Allow read-only bind mounts on SELinux hosts without relabeling the checkout.
  '--security-opt=label=disable',
  '--tmpfs=/tmp:rw,nosuid,nodev,size=256m',
  '--env=CI=1',
  '--env=REQUIRE_OFFLINE=1',
  '--workdir=/workspace/packages/ai',
]

// Mount only installed dependencies, manifests, build outputs and the harness.
// In particular, neither the checkout's .git nor local .env files are exposed.
const paths = ['node_modules', 'package.json', 'packages/ai/harness']
for (const name of ['ai', 'node', 'core', 'types']) {
  paths.push(...['package.json', 'node_modules', 'dist'].map((path) => `packages/${name}/${path}`))
}

const vitest = realpathSync(join(root, 'packages/ai/node_modules/vitest/vitest.mjs'))
if (relative(root, vitest).startsWith('..')) {
  throw new Error(
    'Offline replay needs checkout-local dependencies. Run pnpm install --frozen-lockfile --config.enable-global-virtual-store=false before building.'
  )
}

for (const path of paths) {
  const source = resolve(root, path)
  if (!existsSync(source)) {
    throw new Error(`Missing ${path}. Install dependencies and build @posthog/ai with Turbo before offline replay.`)
  }
  args.push('--mount', `type=bind,source=${source},target=/workspace/${path},readonly`)
}

args.push(image, 'node', 'node_modules/vitest/vitest.mjs', 'run', '--config', 'harness/vitest.config.ts', '--no-cache')
const result = spawnSync('docker', args, { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
