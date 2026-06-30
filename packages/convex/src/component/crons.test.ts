import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals'
import type { Crons } from 'convex/server'
import { DEFAULT_INTERVAL_SECONDS, readPollingIntervalSeconds } from './lib.js'

describe('cron registration', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  // The cron is only a supervisor for the self-rescheduling refresh loop — it registers
  // unconditionally and reads no env vars at module load (which would be empty at deploy-time
  // analysis anyway; see #3957). The configured interval governs the loop, not this cron.
  test('registers the refresh-loop supervisor cron', async () => {
    const mod = (await import('./crons.js')) as { default: Crons }
    expect(Object.keys(mod.default.crons)).toContain('Ensure PostHog flag refresh loop is running')
  })
})

describe('readPollingIntervalSeconds', () => {
  let warnSpy: ReturnType<typeof jest.spyOn>

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    delete process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS
  })

  test('returns the default when the env var is unset', () => {
    expect(readPollingIntervalSeconds()).toBe(DEFAULT_INTERVAL_SECONDS)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('returns the default when the env var is empty or whitespace', () => {
    process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS = '   '
    expect(readPollingIntervalSeconds()).toBe(DEFAULT_INTERVAL_SECONDS)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('parses a positive integer', () => {
    process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS = '300'
    expect(readPollingIntervalSeconds()).toBe(300)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('trims whitespace before parsing', () => {
    process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS = '  120  '
    expect(readPollingIntervalSeconds()).toBe(120)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('warns and falls back for non-numeric input', () => {
    process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS = 'abc'
    expect(readPollingIntervalSeconds()).toBe(DEFAULT_INTERVAL_SECONDS)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"abc"'))
  })

  test('warns and falls back for zero', () => {
    process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS = '0'
    expect(readPollingIntervalSeconds()).toBe(DEFAULT_INTERVAL_SECONDS)
    expect(warnSpy).toHaveBeenCalled()
  })

  test('warns and falls back for negative values', () => {
    process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS = '-30'
    expect(readPollingIntervalSeconds()).toBe(DEFAULT_INTERVAL_SECONDS)
    expect(warnSpy).toHaveBeenCalled()
  })

  test('warns and falls back for fractional values', () => {
    process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS = '60.5'
    expect(readPollingIntervalSeconds()).toBe(DEFAULT_INTERVAL_SECONDS)
    expect(warnSpy).toHaveBeenCalled()
  })
})
