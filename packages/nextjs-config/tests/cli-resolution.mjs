import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

for (const format of ['cjs', 'esm']) {
  test(`${format}: resolves the package-local CLI for webpack in parents and Next workers`, (t) => {
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
          cliBinaryPath: process.env.FIXTURE_CLI_BINARY || undefined,
        })('phase-production-build', { defaultConfig: {} })
        const webpack = config.webpack({ plugins: [] }, {})
        if (config.turbopack?.debugIds || config.compiler?.runAfterProductionCompile || webpack.plugins.length !== 1) {
          throw new Error('Expected webpack instrumentation, not the Turbopack upload hook')
        }
        console.log(webpack.plugins.at(-1).resolvedConfig.cliBinaryPath)
      })().catch(error => { console.error(error); process.exitCode = 1 })`
    )
    const run = (cliBinaryPath, selection) =>
      execFileSync(process.execPath, [runner, ...(selection === 'flag' ? ['build', '--webpack'] : [])], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          WEBPACK: selection === 'environment' ? '1' : undefined,
          TURBOPACK: undefined,
          NEXT_PRIVATE_WORKER: selection === 'dev-worker' ? '1' : undefined,
          NEXT_PRIVATE_BUILD_WORKER: selection === 'build-worker' ? '1' : undefined,
          POSTHOG_RELEASE_ID: 'fixture-release',
          FIXTURE_CLI_BINARY: cliBinaryPath,
          PATH: workspaceBin,
        },
      }).trim()

    for (const selection of ['environment', 'flag', 'dev-worker', 'build-worker']) {
      assert.equal(run(undefined, selection), ownCliPath)
      assert.equal(run('custom-posthog-cli', selection), 'custom-posthog-cli')
    }
  })
}
