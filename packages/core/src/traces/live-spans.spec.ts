import { PostHogTraces } from './index'
import { SyncSpanContextManager } from './context'
import type { ResolvedTracesConfig } from './types'
import type { Logger } from '../types'

// The pipeline holds no reference to a span until that span ends, so a handle the
// caller drops is collectable like any other object.
const gc = (globalThis as { gc?: () => void }).gc

// `--expose-gc` is set by the `test:unit` script. A runner that invokes jest
// directly has no `gc`, and a probe that cannot force a collection proves nothing.
const itWithGc = gc ? it : process.env.CI ? it : it.skip

describe('live spans', () => {
  const config: ResolvedTracesConfig = {
    serviceName: 'svc',
    flushIntervalMs: 5000,
    maxExportBatchSize: 512,
    maxQueueSize: 2048,
  }

  const createTraces = (): PostHogTraces =>
    new PostHogTraces(
      {
        isDisabled: false,
        optedOut: false,
        getLibraryId: () => 'posthog-core',
        getLibraryVersion: () => '0.0.0',
        _sendTracesBatch: async () => ({ kind: 'ok' }),
      },
      config,
      { debug: jest.fn(), warn: jest.fn() } as unknown as Logger,
      () => ({}),
      new SyncSpanContextManager()
    )

  itWithGc('does not retain spans that never end', async () => {
    if (!gc) {
      throw new Error('Run this suite with NODE_OPTIONS=--expose-gc; see packages/core test:unit')
    }
    jest.useRealTimers()
    try {
      const traces = createTraces()
      // Started in their own frame so the handles are unreachable once it returns.
      const refs = ((): WeakRef<object>[] =>
        Array.from({ length: 1000 }, (_unused, i) => new WeakRef(traces.startSpan(`leaked-${i}`) as object)))()

      await new Promise((resolve) => setTimeout(resolve, 50))
      gc()
      await new Promise((resolve) => setTimeout(resolve, 50))
      gc()

      // A threshold, not zero: collection timing is not guaranteed, but a registry
      // holding every span would keep all 1000 alive.
      const alive = refs.filter((ref) => ref.deref() !== undefined).length
      expect(alive).toBeLessThan(100)
    } finally {
      jest.useFakeTimers()
    }
  })
})
