import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { execFileSync } from 'child_process'

const packageRoot = resolve(__dirname, '..')
const repositoryRoot = resolve(packageRoot, '../..')
const minimumSdkRoot = resolve(packageRoot, 'node_modules/@anthropic-ai/sdk-0-112')
const fixtureRoot = join(tmpdir(), 'posthog-ai-anthropic-peer-compatibility-')
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

  linkPackage(fixture, '@anthropic-ai/sdk', minimumSdkRoot)
  linkPackage(fixture, '@posthog/core', resolve(packageRoot, 'node_modules/@posthog/core'))
  linkPackage(fixture, 'posthog-node', resolve(packageRoot, 'node_modules/posthog-node'))
  linkPackage(fixture, 'uuid', resolve(packageRoot, 'node_modules/uuid'))

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

describe('@posthog/ai minimum Anthropic peer compatibility', () => {
  it('uses the minimum supported SDK version in the compatibility fixture', () => {
    const packageJson = JSON.parse(readFileSync(join(minimumSdkRoot, 'package.json'), 'utf8'))
    expect(packageJson.version).toBe('0.112.3')
  })

  it('preserves provider promises at runtime', () => {
    const fixture = createIsolatedFixture()
    const testFile = join(fixture, 'runtime.cjs')

    writeFileSync(
      testFile,
      `const assert = require('node:assert/strict')
const PostHogAnthropic = require('@posthog/ai/anthropic').default

const message = {
  id: 'msg_compatibility',
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content: [{ type: 'text', text: 'Hello' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
}
const fetch = async () => new Response(JSON.stringify(message), {
  status: 200,
  headers: { 'content-type': 'application/json', 'request-id': 'req_compatibility' },
})
const posthog = { capture() {}, captureImmediate() {}, privacy_mode: false }
const client = new PostHogAnthropic({ apiKey: 'test', posthog, fetch })
const promise = client.messages.create({
  model: 'claude-test',
  max_tokens: 8,
  messages: [{ role: 'user', content: 'Hello' }],
})

Promise.all([
  promise.withResponse().then(({ data, request_id, workspace_id }) => {
    assert.equal(data.id, message.id)
    assert.equal(request_id, 'req_compatibility')
    assert.equal(workspace_id, null)
  }),
  promise._thenUnwrap(() => ({ transformed: true })).then((value) => {
    assert.equal(value.transformed, true)
    assert.equal(value._request_id, 'req_compatibility')
    assert.equal(value._workspace_id, null)
  }),
])
`
    )

    execFileSync(process.execPath, [testFile], { cwd: fixture, stdio: 'pipe' })
  })

  it('resolves public types against the minimum supported SDK version', () => {
    const fixture = createIsolatedFixture()
    const testFile = join(fixture, 'types.ts')

    writeFileSync(
      testFile,
      `import PostHogAnthropic from '@posthog/ai/anthropic'

const client = new PostHogAnthropic({ apiKey: 'test', posthog: {} as any })
const promise = client.messages.create({
  model: 'claude-test',
  max_tokens: 8,
  messages: [{ role: 'user', content: 'Hello' }],
})
promise.withResponse().then(({ data, request_id }) => {
  const messageId: string = data.id
  const requestId: string | null | undefined = request_id
  void messageId
  void requestId
})
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
