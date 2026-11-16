import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { build } from 'esbuild'
import { rollup } from 'rollup'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import webpack from 'webpack'
import { Miniflare } from 'miniflare'

async function bundleWorker(bundler, entry, worker, consumer) {
  if (bundler === 'esbuild') {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      external: ['node:*'],
      outfile: worker,
      logLevel: 'silent',
    })
    assert.deepEqual(
      result.warnings.filter((warning) => !warning.text.startsWith('The condition "types" here will never be used')),
      []
    )
  } else if (bundler === 'rollup') {
    const warnings = []
    const bundle = await rollup({
      input: entry,
      external: (id) => id.startsWith('node:'),
      plugins: [nodeResolve({ browser: true }), commonjs(), json()],
      onwarn: (warning) => warnings.push(warning),
    })
    try {
      await bundle.write({ file: worker, format: 'esm', inlineDynamicImports: true })
    } finally {
      await bundle.close()
    }
    writeFileSync(`${worker}.log`, JSON.stringify(warnings, null, 2))
    assert.deepEqual(
      warnings.filter((warning) => !['THIS_IS_UNDEFINED', 'CIRCULAR_DEPENDENCY'].includes(warning.code)),
      []
    )
  } else {
    const stats = await new Promise((resolve, reject) => {
      const compiler = webpack({
        mode: 'production',
        target: 'webworker',
        entry,
        devtool: false,
        performance: false,
        experiments: { outputModule: true },
        externalsType: 'module',
        externals: [/^node:/],
        output: { path: consumer, filename: basename(worker), library: { type: 'module' } },
        optimization: { minimize: false },
      })
      compiler.run((error, result) => {
        compiler.close((closeError) => {
          if (error || closeError) reject(error || closeError)
          else resolve(result)
        })
      })
    })
    const diagnostics = stats.toJson({ all: false, errors: true, warnings: true })
    writeFileSync(`${worker}.log`, JSON.stringify(diagnostics, null, 2))
    assert.deepEqual(diagnostics.errors, [])
    assert.deepEqual(diagnostics.warnings, [])
  }
}

export async function testWorkerBundles(consumer, sdk, tracePackage) {
  for (const format of ['esm', 'cjs']) {
    const bridge = join(consumer, `otel-${format}.${format === 'cjs' ? 'cjs' : 'mjs'}`)
    writeFileSync(
      bridge,
      format === 'cjs'
        ? `module.exports = { ...require('@posthog/ai/otel'), OTLPTraceExporter: require('@opentelemetry/exporter-trace-otlp-http').OTLPTraceExporter }`
        : `export { PostHogSpanProcessor, PostHogTraceExporter } from '@posthog/ai/otel'; export { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'`
    )
    const entry = join(consumer, `worker-entry-${format}.mjs`)
    writeFileSync(
      entry,
      `
import { ${sdk === '0.200.0' ? 'BasicTracerProvider' : 'TracerProvider'} as TracerProvider } from '${tracePackage}'
import { PostHogSpanProcessor, PostHogTraceExporter, OTLPTraceExporter } from './${basename(bridge)}'
export default { async fetch() {
  const exported = []
  OTLPTraceExporter.prototype.export = function(spans, callback) {
    exported.push(...spans.map(span => ({ name: span.name, prompt: span.attributes['gen_ai.prompt'] })))
    callback({ code: 0 })
  }
  const processor = new PostHogSpanProcessor({ projectToken: 'phc_test' })
  const provider = new TracerProvider({ spanProcessors: [processor] })
  const tracer = provider.getTracer('workers-compatibility-test')
  tracer.startSpan('gen_ai.flush', { attributes: { 'gen_ai.prompt': 'data:image/png;base64,aGVsbG8=' } }).end()
  tracer.startSpan('http.request').end()
  await processor.forceFlush()
  const flushed = exported.slice()
  tracer.startSpan('gen_ai.shutdown').end()
  await provider.shutdown()
  const exporter = new PostHogTraceExporter({ projectToken: 'phc_test' })
  await exporter.shutdown()
  return Response.json({ flushed, exported })
} }
`
    )
    for (const bundler of ['esbuild', 'rollup', 'webpack']) {
      const worker = join(consumer, `worker-${bundler}-${format}.mjs`)
      await bundleWorker(bundler, entry, worker, consumer)
      const runtime = new Miniflare({
        modules: true,
        scriptPath: worker,
        modulesRoot: consumer,
        compatibilityDate: '2026-07-30',
        compatibilityFlags: ['nodejs_compat'],
        cf: false,
      })
      try {
        const response = await runtime.dispatchFetch('http://localhost/')
        assert.equal(response.status, 200, await response.clone().text())
        assert.deepEqual(await response.json(), {
          flushed: [{ name: 'gen_ai.flush', prompt: '[base64 image/png redacted]' }],
          exported: [{ name: 'gen_ai.flush', prompt: '[base64 image/png redacted]' }, { name: 'gen_ai.shutdown' }],
        })
        console.log(
          `${sdk} ${bundler} ${format}: Workers import, batching, filtering, redaction, flush and shutdown passed`
        )
      } finally {
        await runtime.dispose()
      }
    }
  }
}
