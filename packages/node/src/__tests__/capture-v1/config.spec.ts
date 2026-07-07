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

  it('uses the explicit option when valid', () => {
    expect(resolveCaptureMode('v1')).toBe('v1')
    expect(resolveCaptureMode('v0')).toBe('v0')
  })

  it('defaults to v0 when nothing is set', () => {
    delete process.env.POSTHOG_CAPTURE_MODE
    expect(resolveCaptureMode(undefined)).toBe('v0')
  })

  it('falls back to the environment variable when no option is given', () => {
    process.env.POSTHOG_CAPTURE_MODE = 'v1'
    expect(resolveCaptureMode(undefined)).toBe('v1')
  })

  it('lets the explicit option win over the environment variable', () => {
    process.env.POSTHOG_CAPTURE_MODE = 'v1'
    expect(resolveCaptureMode('v0')).toBe('v0')
  })

  it('ignores an invalid environment value', () => {
    process.env.POSTHOG_CAPTURE_MODE = 'v2'
    expect(resolveCaptureMode(undefined)).toBe('v0')
  })

  it('ignores an invalid option and falls through to the environment', () => {
    process.env.POSTHOG_CAPTURE_MODE = 'v1'
    expect(resolveCaptureMode('nonsense' as unknown as undefined)).toBe('v1')
  })
})
