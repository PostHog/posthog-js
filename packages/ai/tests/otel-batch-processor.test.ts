import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import type { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const source = transformSync(readFileSync(new URL('../src/otel/batchProcessor.cts', import.meta.url), 'utf8'), {
  loader: 'ts',
  format: 'cjs',
}).code

describe('OpenTelemetry batch processor compatibility', () => {
  const exporter = {} as OTLPTraceExporter
  const load = vi.fn()
  const legacy = vi.fn(function () {})
  const current = vi.fn(function () {})
  let createBatchSpanProcessor: (exporter: OTLPTraceExporter) => unknown

  beforeEach(() => {
    vi.resetAllMocks()
    load.mockImplementation((name: string) => ({
      BatchSpanProcessor: name === '@opentelemetry/sdk-trace' ? current : legacy,
    }))
    const module = { exports: {} }
    runInNewContext(source, { module, exports: module.exports, require: load })
    createBatchSpanProcessor = (module.exports as { createBatchSpanProcessor: typeof createBatchSpanProcessor })
      .createBatchSpanProcessor
  })

  it('uses sdk-trace with its options constructor when available', () => {
    createBatchSpanProcessor(exporter)

    expect(current).toHaveBeenCalledWith({ exporter })
    expect(legacy).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('@opentelemetry/sdk-trace')
  })

  it.each([
    Object.assign(new Error("Cannot find module '@opentelemetry/sdk-trace'\nRequire stack: ..."), {
      code: 'MODULE_NOT_FOUND',
    }),
    new Error('Dynamic require of "@opentelemetry/sdk-trace" is not supported'),
  ])('uses sdk-trace-base when sdk-trace is absent: %s', (error) => {
    load.mockImplementation((name: string) => {
      if (name === '@opentelemetry/sdk-trace') throw error
      return { BatchSpanProcessor: legacy }
    })

    createBatchSpanProcessor(exporter)

    expect(legacy).toHaveBeenCalledWith(exporter)
    expect(current).not.toHaveBeenCalled()
  })

  it.each([
    Object.assign(new Error("Cannot find module 'missing-transitive-dependency'"), { code: 'MODULE_NOT_FOUND' }),
    Object.assign(new Error('invalid package exports'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }),
    new Error('failed to initialize sdk-trace'),
  ])('does not hide errors loading an installed sdk-trace: %s', (error) => {
    load.mockImplementation(() => {
      throw error
    })

    expect(() => createBatchSpanProcessor(exporter)).toThrow(error)
    expect(legacy).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('explains which optional peer is required when neither package is installed', () => {
    load.mockImplementation((name: string) => {
      throw Object.assign(new Error(`Cannot find module '${name}'`), { code: 'MODULE_NOT_FOUND' })
    })

    expect(() => createBatchSpanProcessor(exporter)).toThrow(
      'PostHogSpanProcessor requires @opentelemetry/sdk-trace or @opentelemetry/sdk-trace-base.'
    )
  })

  it('does not hide errors loading an installed sdk-trace-base', () => {
    const error = new Error('failed to initialize sdk-trace-base')
    load.mockImplementation((name: string) => {
      if (name === '@opentelemetry/sdk-trace') {
        throw Object.assign(new Error(`Cannot find module '${name}'`), { code: 'MODULE_NOT_FOUND' })
      }
      throw error
    })

    expect(() => createBatchSpanProcessor(exporter)).toThrow(error)
  })

  it('does not fall back when the sdk-trace constructor throws', () => {
    const error = new Error('constructor failed')
    current.mockImplementation(() => {
      throw error
    })

    expect(() => createBatchSpanProcessor(exporter)).toThrow(error)
    expect(legacy).not.toHaveBeenCalled()
  })
})
