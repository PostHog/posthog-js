import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getNextBuildReleaseId } from '@/extensions/error-tracking/next-release.node'
import { PostHog } from '@/entrypoints/index.node'

const globals = globalThis as typeof globalThis & { _posthogReleaseId?: string }
const originalReleaseId = globals._posthogReleaseId
let app: string

beforeEach(() => {
  app = mkdtempSync(path.join(tmpdir(), 'posthog-next-release-'))
  vi.spyOn(process, 'cwd').mockReturnValue(app)
  vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('POSTHOG_RELEASE_ID', '')
  vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '')
  delete globals._posthogReleaseId
})

afterEach(() => {
  if (originalReleaseId === undefined) delete globals._posthogReleaseId
  else globals._posthogReleaseId = originalReleaseId
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(app, { recursive: true, force: true })
})

function writeNextBuild(releaseId: unknown): void {
  mkdirSync(path.join(app, '.next'))
  writeFileSync(
    path.join(app, '.next', 'required-server-files.json'),
    JSON.stringify({ config: { env: { POSTHOG_RELEASE_ID: releaseId } } })
  )
}

describe('externalized SDK in a Next.js server', () => {
  it('uses the build release for a captured exception without a runtime environment variable', async () => {
    writeNextBuild('  build-release  ')
    let captured: any
    const sdk = new PostHog('phc_test', {
      flushInterval: 0,
      before_send(event) {
        captured = event
        return null
      },
    })
    try {
      sdk.captureException(new Error('boom'), 'user-1')
      await sdk.flush()
      expect(captured?.properties?.$release_id).toBe('build-release')
    } finally {
      await sdk.shutdown()
    }
  })

  it('keeps explicit runtime environment and previously injected globals authoritative', async () => {
    writeNextBuild('build-release')
    vi.stubEnv('POSTHOG_RELEASE_ID', 'runtime-release')
    const explicit = new PostHog('phc_test', { flushInterval: 0 })
    expect(globals._posthogReleaseId).toBeUndefined()
    await explicit.shutdown()

    vi.stubEnv('POSTHOG_RELEASE_ID', '')
    globals._posthogReleaseId = 'existing-release'
    const injected = new PostHog('phc_test', { flushInterval: 0 })
    expect(globals._posthogReleaseId).toBe('existing-release')
    await injected.shutdown()
  })

  it('reads the standalone build config when present', () => {
    vi.stubEnv(
      '__NEXT_PRIVATE_STANDALONE_CONFIG',
      JSON.stringify({ env: { POSTHOG_RELEASE_ID: 'standalone-release' } })
    )
    expect(getNextBuildReleaseId()).toBe('standalone-release')
  })

  it('does not read a manifest outside Next production or if it is invalid', () => {
    writeNextBuild('build-release')
    vi.stubEnv('NEXT_RUNTIME', '')
    expect(getNextBuildReleaseId()).toBeUndefined()
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('NODE_ENV', 'development')
    expect(getNextBuildReleaseId()).toBeUndefined()
    vi.stubEnv('NODE_ENV', 'production')
    expect(getNextBuildReleaseId()).toBe('build-release')
    writeFileSync(path.join(app, '.next', 'required-server-files.json'), 'not JSON')
    expect(getNextBuildReleaseId()).toBeUndefined()
    writeFileSync(path.join(app, '.next', 'required-server-files.json'), ' '.repeat(2 * 1024 * 1024 + 1))
    expect(getNextBuildReleaseId()).toBeUndefined()
  })
})
