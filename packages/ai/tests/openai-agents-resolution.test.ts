import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { execFileSync } from 'child_process'

const packageRoot = resolve(__dirname, '..')
const repositoryRoot = resolve(packageRoot, '../..')
const fixtureRoot = join(tmpdir(), 'posthog-ai-openai-agents-resolution-')
const fixtures: string[] = []

function linkPackage(fixture: string, packageName: string, target: string): void {
  const link = join(fixture, 'node_modules', ...packageName.split('/'))
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, 'junction')
}

function createIsolatedFixture(): string {
  const fixture = mkdtempSync(fixtureRoot)
  fixtures.push(fixture)

  const installedPackage = join(fixture, 'node_modules', '@posthog', 'ai')
  mkdirSync(installedPackage, { recursive: true })
  cpSync(join(packageRoot, 'dist'), join(installedPackage, 'dist'), { recursive: true })
  cpSync(join(packageRoot, 'package.json'), join(installedPackage, 'package.json'))

  // Only expose peers declared by @posthog/ai. @openai/agents-core must remain
  // reachable solely as an implementation dependency of @openai/agents.
  linkPackage(fixture, '@openai/agents', resolve(packageRoot, 'node_modules/@openai/agents'))
  linkPackage(fixture, 'posthog-node', resolve(packageRoot, 'node_modules/posthog-node'))

  expect(existsSync(join(fixture, 'node_modules', '@openai', 'agents-core'))).toBe(false)

  return fixture
}

beforeAll(() => {
  execFileSync(process.execPath, [resolve(repositoryRoot, 'node_modules/rollup/dist/bin/rollup'), '-c'], {
    cwd: packageRoot,
    stdio: 'pipe',
  })
})

afterAll(() => {
  for (const fixture of fixtures) {
    rmSync(fixture, { recursive: true, force: true })
  }
})

describe('@posthog/ai/openai-agents package resolution', () => {
  it('loads and instruments at runtime with only the declared @openai/agents peer', () => {
    const fixture = createIsolatedFixture()
    const testFile = join(fixture, 'runtime.cjs')

    writeFileSync(
      testFile,
      `const assert = require('node:assert/strict')
const { instrument, PostHogTracingProcessor } = require('@posthog/ai/openai-agents')

instrument({ client: { capture() {} } }).then((processor) => {
  assert.ok(processor instanceof PostHogTracingProcessor)
})
`
    )

    execFileSync(process.execPath, [testFile], { cwd: fixture, stdio: 'pipe' })
  })

  it('resolves its public types with only declared peers installed', () => {
    const fixture = createIsolatedFixture()
    const testFile = join(fixture, 'types.ts')

    writeFileSync(
      testFile,
      `import {
  instrument,
  type DistinctIdResolver,
  type InstrumentOptions,
  type PostHogTracingProcessor,
} from '@posthog/ai/openai-agents'

declare const options: InstrumentOptions
const processor: Promise<PostHogTracingProcessor> = instrument(options)
const resolver: DistinctIdResolver = (trace) => {
  // @ts-expect-error Trace is resolved from the declared @openai/agents peer, not any.
  return trace.notARealTraceProperty
}
void processor
void resolver
`
    )

    execFileSync(
      process.execPath,
      [
        resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        testFile,
      ],
      { cwd: fixture, stdio: 'pipe' }
    )
  })
})
