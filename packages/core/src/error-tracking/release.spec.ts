import { getInjectedReleaseId } from './release'

describe('getInjectedReleaseId', () => {
  const originalReleaseId = process.env.POSTHOG_RELEASE_ID

  afterEach(() => {
    if (originalReleaseId === undefined) {
      delete process.env.POSTHOG_RELEASE_ID
    } else {
      process.env.POSTHOG_RELEASE_ID = originalReleaseId
    }
    delete (globalThis as any)._posthogReleaseId
  })

  it('reads and trims POSTHOG_RELEASE_ID', () => {
    process.env.POSTHOG_RELEASE_ID = '  release-from-environment  '

    expect(getInjectedReleaseId()).toBe('release-from-environment')
  })

  it('prefers POSTHOG_RELEASE_ID over the injected global', () => {
    process.env.POSTHOG_RELEASE_ID = 'release-from-environment'
    ;(globalThis as any)._posthogReleaseId = 'release-from-injection'

    expect(getInjectedReleaseId()).toBe('release-from-environment')
  })

  it('falls back to the injected global when the environment value is empty', () => {
    process.env.POSTHOG_RELEASE_ID = '   '
    ;(globalThis as any)._posthogReleaseId = 'release-from-injection'

    expect(getInjectedReleaseId()).toBe('release-from-injection')
  })
})
