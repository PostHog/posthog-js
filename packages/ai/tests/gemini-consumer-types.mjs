import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const tests = dirname(fileURLToPath(import.meta.url))
const root = resolve(tests, '../../..')
const directory = mkdtempSync(join(tmpdir(), 'posthog-gemini-consumers-'))
const packageManager = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager
const env = { ...process.env, CI: '1', PREK: '0' }
const pnpmEntry = process.env.npm_execpath
console.log(`Consumer artifacts: ${directory}`)

function run(command, args, cwd, log) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 180000 })
  writeFileSync(join(directory, log), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''))
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed; see ${join(directory, log)}`)
  return result.stdout
}
function pnpm(args, cwd, log) {
  return run(pnpmEntry ? process.execPath : 'pnpm', pnpmEntry ? [pnpmEntry, ...args] : args, cwd, log)
}

const tarballs = join(directory, 'tarballs')
mkdirSync(tarballs)
const dependencies = {}
for (const [index, name] of ['types', 'core', 'node', 'ai'].entries()) {
  const cwd = join(root, 'packages', name)
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  const tarball = join(tarballs, `${index}.tgz`)
  pnpm(['pack', '--out', tarball], cwd, `pack-${name}.log`)
  dependencies[manifest.name] = `file:${tarball}`
}
for (const version of ['1.52.0', '2.18.0']) {
  const consumer = join(directory, version)
  mkdirSync(consumer)
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        private: true,
        packageManager,
        type: 'module',
        dependencies: { ...dependencies, '@google/genai': version, '@modelcontextprotocol/sdk': '1.30.0' },
        devDependencies: { typescript: '5.8.2', '@types/node': '22.19.1', '@types/express': '5.0.6' },
      },
      null,
      2
    )
  )
  writeFileSync(
    join(consumer, 'pnpm-workspace.yaml'),
    `minimumReleaseAge: 10080\nautoInstallPeers: false\noverrides: ${JSON.stringify(dependencies)}\n`
  )
  pnpm(
    ['install', '--ignore-scripts', ...(process.env.GEMINI_CONSUMER_OFFLINE === '1' ? ['--offline'] : [])],
    consumer,
    `install-${version}.log`
  )
  for (const name of Object.keys(dependencies))
    assert.ok(realpathSync(join(consumer, 'node_modules', name)).startsWith(realpathSync(consumer)))
  assert.equal(
    JSON.parse(readFileSync(join(consumer, 'node_modules/@google/genai/package.json'), 'utf8')).version,
    version
  )
  cpSync(join(tests, 'fixtures/gemini-consumer/runtime.mjs'), join(consumer, 'runtime.mjs'))
  for (const extension of ['mts', 'cts']) {
    const source = readFileSync(join(tests, 'fixtures/gemini-consumer/models.ts'), 'utf8')
    if (version === '2.18.0') {
      // Keep separate modules so both fixtures exercise the same public imports.
      cpSync(join(tests, 'fixtures/gemini-consumer/interactions.ts'), join(consumer, `interactions.${extension}`))
    }
    writeFileSync(join(consumer, `models.${extension}`), source)
    writeFileSync(
      join(consumer, `tsconfig.${extension}.json`),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
        },
        files: [`models.${extension}`, ...(version === '2.18.0' ? [`interactions.${extension}`] : [])],
      })
    )
    run(
      process.execPath,
      [join(consumer, 'node_modules/typescript/bin/tsc'), '-p', `tsconfig.${extension}.json`, '--pretty', 'false'],
      consumer,
      `types-${version}-${extension}.log`
    )
  }
  console.log(run(process.execPath, ['runtime.mjs', version], consumer, `runtime-${version}.log`).trim())
}
console.log(
  'Strict installed-consumer declarations and local runtime checks passed for both supported Google SDK versions'
)
