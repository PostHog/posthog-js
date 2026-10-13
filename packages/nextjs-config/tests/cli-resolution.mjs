import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

for (const format of ['cjs', 'esm']) {
  test(`${format}: resolves the package-local CLI and preserves explicit overrides`, (t) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'posthog-next-cli-')))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const installedPackage = path.join(root, 'node_modules/@posthog/nextjs-config')
    mkdirSync(installedPackage, { recursive: true })
    cpSync(path.join(packageDir, 'package.json'), path.join(installedPackage, 'package.json'))
    cpSync(path.join(packageDir, 'dist'), path.join(installedPackage, 'dist'), { recursive: true })

    for (const name of ['@posthog/webpack-plugin', '@posthog/plugin-utils', 'semver']) {
      const target = path.join(packageDir, 'node_modules', name)
      symlinkSync(target, path.join(root, 'node_modules', name), 'junction')
    }
    const nextDir = path.join(root, 'node_modules/next')
    mkdirSync(nextDir)
    writeFileSync(path.join(nextDir, 'package.json'), JSON.stringify({ name: 'next', version: '16.1.1' }))

    const ownCliDir = path.join(installedPackage, 'node_modules/@posthog/cli')
    mkdirSync(ownCliDir, { recursive: true })
    writeFileSync(path.join(ownCliDir, 'package.json'), JSON.stringify({ name: '@posthog/cli', version: '0.18.10' }))
    const ownCliPath = path.join(ownCliDir, 'run-posthog-cli.js')
    writeFileSync(ownCliPath, 'throw new Error("CLI must not run during config resolution")')
    const workspaceBin = path.join(root, 'node_modules/.bin')
    mkdirSync(workspaceBin)
    writeFileSync(path.join(workspaceBin, 'posthog-cli'), 'outdated workspace CLI')

    const load = format === 'cjs' ? 'require' : 'await import'
    const runner = path.join(root, `consumer.${format === 'cjs' ? 'cjs' : 'mjs'}`)
    writeFileSync(
      runner,
      `(async () => {
        const { withPostHogConfig } = ${load}('@posthog/nextjs-config')
        const config = await withPostHogConfig({}, {
          personalApiKey: 'phx_test',
          projectId: '1',
          cliBinaryPath: process.argv[2],
        })('phase-production-build', { defaultConfig: {} })
        const webpack = config.webpack({ plugins: [] }, {})
        console.log(webpack.plugins.at(-1).resolvedConfig.cliBinaryPath)
      })().catch(error => { console.error(error); process.exitCode = 1 })`
    )
    const run = (args = []) =>
      execFileSync(process.execPath, [runner, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, WEBPACK: '1', TURBOPACK: '', PATH: workspaceBin },
      }).trim()

    assert.equal(run(), ownCliPath)
    assert.equal(run(['custom-posthog-cli']), 'custom-posthog-cli')
  })
}
