/**
 * Edge Runtime Compatibility Tests
 *
 * These tests verify that PostHog MCP analytics gracefully handles environments where
 * certain Node.js modules may not be available or have limited functionality
 * (like Cloudflare Workers, Vercel Edge, Deno Deploy).
 *
 * Note: For full edge runtime testing with actual Cloudflare Workers environment,
 * consider using @cloudflare/vitest-pool-workers with a separate vitest config.
 * These tests simulate edge-like conditions within the Node.js test environment.
 */

import { captureException } from '../extensions/exceptions'

describe('Edge Runtime Compatibility', () => {
  describe('Exception Capture - Graceful Degradation', () => {
    it('should capture basic exception info without filesystem access', () => {
      const captured = captureException(new Error('Test error'))
      const [exception] = captured.$exception_list

      expect(exception.value).toBe('Test error')
      expect(exception.type).toBe('Error')
      expect(captured.$exception_level).toBe('error')
    })

    it('should parse stack traces without requiring fs module', () => {
      const captured = captureException(new Error('Stack trace test'))
      const frames = captured.$exception_list[0].stacktrace?.frames

      expect(Array.isArray(frames)).toBe(true)
      expect(frames!.length).toBeGreaterThan(0)
      expect(frames![0].filename).toBeDefined()
    })

    it('should handle chained errors (Error.cause)', () => {
      const wrapper = new Error('Wrapper error', { cause: new Error('Root cause') })
      const captured = captureException(wrapper)

      // Cause chains become multiple entries in $exception_list.
      expect(captured.$exception_list.map((e) => e.value)).toEqual(['Wrapper error', 'Root cause'])
    })

    it('should handle non-Error objects being thrown', () => {
      expect(captureException('string error').$exception_list[0].value).toBe('string error')
      expect(captureException({ code: 404 }).$exception_list[0].value).toContain('code')
      expect(captureException(null).$exception_list[0].value).toContain('null')
      expect(captureException(undefined).$exception_list[0].value).toContain('undefined')
    })
  })

  describe('Process Object Availability', () => {
    let originalProcess: typeof process

    beforeEach(() => {
      originalProcess = globalThis.process
    })

    afterEach(() => {
      globalThis.process = originalProcess
    })

    it('should handle missing process.cwd gracefully', () => {
      // Create a mock process without cwd
      const mockProcess = { ...originalProcess } as typeof process
      // @ts-expect-error - intentionally removing cwd for test
      mockProcess.cwd = undefined
      globalThis.process = mockProcess

      // captureException should still work
      const error = new Error('Test without cwd')
      const captured = captureException(error)

      expect(captured.$exception_list[0].value).toBe('Test without cwd')
      expect(captured.$exception_list[0].type).toBe('Error')
    })

    it('should handle process.cwd throwing', () => {
      const mockProcess = {
        ...originalProcess,
        cwd: () => {
          throw new Error('cwd not available')
        },
      } as typeof process
      globalThis.process = mockProcess

      const error = new Error('Test with throwing cwd')
      const captured = captureException(error)

      expect(captured.$exception_list[0].value).toBe('Test with throwing cwd')
    })
  })

  describe('Event Queue Signal Handlers', () => {
    let originalProcess: typeof process

    beforeEach(() => {
      originalProcess = globalThis.process
    })

    afterEach(() => {
      globalThis.process = originalProcess
      jest.resetModules()
    })

    it('should not throw when process.once is unavailable', async () => {
      // Create mock process without once
      const mockProcess = { ...originalProcess } as typeof process
      // @ts-expect-error - intentionally removing once for test
      mockProcess.once = undefined
      globalThis.process = mockProcess

      // Reset modules to re-run module-level code
      jest.resetModules()

      // Should not throw when importing
      await expect(import('../extensions/capture')).resolves.toBeDefined()
    })

    it('should handle process being undefined', async () => {
      // @ts-expect-error - intentionally removing process for test
      globalThis.process = undefined

      jest.resetModules()

      // Should not throw - capture module should still load without process
      const module = await import('../extensions/capture')
      expect(typeof module.captureEvent).toBe('function')

      // Restore process before other tests run
      globalThis.process = originalProcess
    })
  })

  describe('Logging Module Behavior', () => {
    it('should export log function', async () => {
      const { log } = await import('../extensions/logger')
      expect(typeof log).toBe('function')
    })

    it('should not throw when called', async () => {
      const { log } = await import('../extensions/logger')

      // log should never throw, regardless of environment
      expect(() => log('Test message')).not.toThrow()
      expect(() => log('')).not.toThrow()
      expect(() => log('Special chars: \n\t\r')).not.toThrow()
    })

    it('should handle rapid successive calls', async () => {
      const { log } = await import('../extensions/logger')

      // Should handle many calls without issues
      expect(() => {
        for (let i = 0; i < 100; i++) {
          log(`Message ${i}`)
        }
      }).not.toThrow()
    })
  })

  describe('Full SDK API Availability', () => {
    it('should export instrument function', async () => {
      const mcpAnalytics = await import('../index')
      expect(typeof mcpAnalytics.instrument).toBe('function')
    })

    it('should export publishCustomEvent function', async () => {
      const mcpAnalytics = await import('../index')
      expect(typeof mcpAnalytics.publishCustomEvent).toBe('function')
    })

    it('should export type definitions', async () => {
      // IdentifyFunction type is exported for users to define their identify callbacks
      const mcpAnalytics = await import('../index')
      // The module should load without issues
      expect(mcpAnalytics).toBeDefined()
    })
  })

  describe('Edge Environment Detection Patterns', () => {
    it('should detect Node.js environment correctly', () => {
      // Helper function that PostHog MCP analytics could use internally
      const isNodeJs = () => typeof process !== 'undefined' && process.versions != null && process.versions.node != null

      // In test environment, we should be in Node.js
      expect(isNodeJs()).toBe(true)
    })

    it('should detect Cloudflare Workers pattern', () => {
      // Pattern for detecting Cloudflare Workers
      const isCloudflareWorkers = () => {
        try {
          // Cloudflare Workers have caches.default
          return (
            typeof caches !== 'undefined' &&
            // @ts-expect-error - caches.default is Cloudflare-specific
            typeof caches.default !== 'undefined'
          )
        } catch {
          return false
        }
      }

      // In Node.js test environment, should return false
      expect(isCloudflareWorkers()).toBe(false)
    })

    it('should detect generic edge runtime pattern', () => {
      // Generic pattern for detecting edge runtimes
      const isEdgeRuntime = () => {
        // Edge runtimes typically don't have full Node.js process
        const hasFullNodeProcess =
          typeof process !== 'undefined' &&
          typeof process.versions?.node === 'string' &&
          typeof process.cwd === 'function'

        return !hasFullNodeProcess
      }

      // In Node.js test environment, should return false
      expect(isEdgeRuntime()).toBe(false)
    })
  })

  describe('Path Normalization Without cwd', () => {
    it('should handle various path formats', () => {
      // These patterns should work regardless of process.cwd availability
      const testPaths = [
        '/Users/john/project/src/index.ts',
        'src/index.ts',
        './relative/path.ts',
        'node_modules/package/index.js',
        'node:internal/modules/loader',
        'native',
        '<anonymous>',
      ]

      const error = new Error('Path test')
      error.stack = testPaths.map((path, index) => `    at test${index} (${path}:1:1)`).join('\n')
      const captured = captureException(error)

      // Should have parsed the stack without errors
      expect(captured.$exception_list[0].stacktrace?.frames).toBeDefined()
    })
  })
})

describe('Integration: SDK in Limited Environment', () => {
  let originalProcess: typeof process

  beforeEach(() => {
    originalProcess = globalThis.process
  })

  afterEach(() => {
    globalThis.process = originalProcess
    jest.resetModules()
  })

  it('should work when process has limited functionality', async () => {
    // Simulate limited process object (like some edge runtimes)
    const limitedProcess = {
      env: {},
      // Missing: cwd, once, versions, etc.
    } as unknown as typeof process

    globalThis.process = limitedProcess
    jest.resetModules()

    // SDK should still load
    const mcpAnalytics = await import('../index')

    // Core functions should exist
    expect(mcpAnalytics.instrument).toBeDefined()
    expect(mcpAnalytics.publishCustomEvent).toBeDefined()

    // Exception capture should work
    const { captureException: capture } = await import('../extensions/exceptions')
    const error = new Error('Limited env test')
    const captured = capture(error)

    expect(captured.$exception_list[0].value).toBe('Limited env test')

    // Restore
    globalThis.process = originalProcess
  })

  it('should handle environment transitions gracefully', async () => {
    // First call in "normal" environment
    const { log: writeLog1 } = await import('../extensions/logger')
    expect(() => writeLog1('Normal environment')).not.toThrow()

    // Module state persists between calls (this is expected behavior)
    expect(() => writeLog1('Second call')).not.toThrow()
  })
})

describe('Error Handling Robustness', () => {
  it('should not crash on malformed stack traces', () => {
    const error = new Error('Malformed')
    // Override stack with malformed content
    error.stack = 'Error: Malformed\n    at malformed line without proper format\n    garbage data'

    const captured = captureException(error)

    // Should still capture basic info
    expect(captured.$exception_list[0].value).toBe('Malformed')
    expect(captured.$exception_list[0].type).toBe('Error')
  })

  it('should handle circular reference in error.cause', () => {
    const error1 = new Error('Error 1') as Error & { cause?: Error }
    const error2 = new Error('Error 2') as Error & { cause?: Error }

    // Create circular reference
    error1.cause = error2
    error2.cause = error1

    // Should not infinite loop
    const captured = captureException(error1)

    expect(captured.$exception_list[0].value).toBe('Error 1')
    // Core caps cause recursion, so the list stays bounded instead of looping.
    expect(captured.$exception_list.length).toBeLessThanOrEqual(10)
  })

  it('should handle deeply nested error chains', () => {
    // Create a deep chain of errors
    let current = new Error('Root')
    for (let i = 0; i < 20; i++) {
      current = new Error(`Level ${i}`, { cause: current })
    }

    const captured = captureException(current)

    expect(captured.$exception_list[0].value).toBe('Level 19')
    // Core caps the cause chain, so the list stays bounded.
    expect(captured.$exception_list.length).toBeLessThanOrEqual(10)
  })
})
