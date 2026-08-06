import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(fileURLToPath(import.meta.url))
const fixtureDir = mkdtempSync(join(tmpdir(), 'posthog-nuxt5-consumer-'))

try {
  execFileSync('pnpm', ['pack', '--pack-destination', fixtureDir], {
    cwd: join(packageDir, '..'),
    stdio: 'inherit',
  })

  const packageTarball = join(
    fixtureDir,
    readdirSync(fixtureDir).find(filename => filename.endsWith('.tgz')),
  )

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
    `export default defineNuxtConfig({ modules: ['@posthog/nuxt'], posthogConfig: { publicKey: 'phc_test' } })\n`,
  )

  execFileSync('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: fixtureDir, stdio: 'inherit' })
  execFileSync('pnpm', ['exec', 'nuxt', 'build'], { cwd: fixtureDir, stdio: 'inherit' })
  console.log('ok nuxt5-consumer.test.mjs')
} finally {
  rmSync(fixtureDir, { recursive: true, force: true })
}
