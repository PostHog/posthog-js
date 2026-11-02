import type { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { createBatchSpanProcessor } from '../src/otel/batchProcessor'

const { load, resolve, legacy, current } = vi.hoisted(() => ({
  load: vi.fn(),
  resolve: vi.fn(),
  legacy: vi.fn(function () {}),
  current: vi.fn(function () {}),
}))

vi.mock('node:module', () => ({
  createRequire: () => Object.assign(load, { resolve }),
}))

describe('OpenTelemetry batch processor compatibility', () => {
  const exporter = {} as OTLPTraceExporter

  beforeEach(() => {
    vi.resetAllMocks()
    load.mockImplementation((name: string) => ({
      BatchSpanProcessor: name === '@opentelemetry/sdk-trace' ? current : legacy,
    }))
  })

  it('uses sdk-trace with its options constructor when available', () => {
    resolve.mockReturnValue('/sdk-trace/index.cjs')

    createBatchSpanProcessor(exporter)

    expect(current).toHaveBeenCalledWith({ exporter })
    expect(legacy).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('@opentelemetry/sdk-trace')
  })

  it('uses sdk-trace-base with its legacy constructor when sdk-trace is absent', () => {
    resolve.mockImplementation(() => {
      throw Object.assign(new Error('sdk-trace not installed'), { code: 'MODULE_NOT_FOUND' })
    })

    createBatchSpanProcessor(exporter)

    expect(legacy).toHaveBeenCalledWith(exporter)
    expect(current).not.toHaveBeenCalled()
  })

  it('does not hide errors while loading an installed sdk-trace', () => {
    const error = Object.assign(new Error('missing transitive dependency'), { code: 'MODULE_NOT_FOUND' })
    resolve.mockReturnValue('/sdk-trace/index.cjs')
    load.mockImplementation(() => {
      throw error
    })

    expect(() => createBatchSpanProcessor(exporter)).toThrow(error)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('propagates resolution errors other than an absent package', () => {
    const error = Object.assign(new Error('invalid package exports'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
    resolve.mockImplementation(() => {
      throw error
    })

    expect(() => createBatchSpanProcessor(exporter)).toThrow(error)
    expect(load).not.toHaveBeenCalled()
  })
})
