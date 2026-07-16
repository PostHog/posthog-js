import { resolveCaptureMode } from '@/capture-v1/config'

describe('resolveCaptureMode', () => {
  const original = process.env.POSTHOG_CAPTURE_MODE

  afterEach(() => {
    if (original === undefined) {
      delete process.env.POSTHOG_CAPTURE_MODE
    } else {
      process.env.POSTHOG_CAPTURE_MODE = original
    }
  })

  it('defaults to v0 when the environment variable is unset', () => {
    delete process.env.POSTHOG_CAPTURE_MODE
    expect(resolveCaptureMode()).toBe('v0')
  })

  it('resolves v1 from the environment variable', () => {
    process.env.POSTHOG_CAPTURE_MODE = 'v1'
    expect(resolveCaptureMode()).toBe('v1')
  })

  it('resolves v0 from the environment variable', () => {
    process.env.POSTHOG_CAPTURE_MODE = 'v0'
    expect(resolveCaptureMode()).toBe('v0')
  })

  it('ignores an invalid environment value and defaults to v0', () => {
    process.env.POSTHOG_CAPTURE_MODE = 'v2'
    expect(resolveCaptureMode()).toBe('v0')
  })
})
