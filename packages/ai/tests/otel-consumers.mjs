import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

const tests = dirname(fileURLToPath(import.meta.url))
const root = resolve(tests, '../../..')
const directory = mkdtempSync(join(tmpdir(), 'posthog-otel-consumers-'))
const packageManager = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager
const pnpmEntry = process.env.npm_execpath
console.log(`Consumer artifacts: ${directory}`)

function run(command, args, cwd, log) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180000 })
  writeFileSync(join(directory, log), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''))
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed; see ${join(directory, log)}`)
  return result.stdout
}

function pnpm(args, cwd, log) {
  const script = pnpmEntry && /\.[cm]?js$/.test(pnpmEntry)
  return run(script ? process.execPath : pnpmEntry || 'pnpm', script ? [pnpmEntry, ...args] : args, cwd, log)
}

const dependencies = {}
for (const name of ['types', 'core', 'node', 'ai']) {
  const cwd = join(root, 'packages', name)
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  const tarball = join(directory, `${name}.tgz`)
  pnpm(['pack', '--out', tarball], cwd, `pack-${name}.log`)
  dependencies[manifest.name] = `file:${tarball}`
}

for (const [sdk, api] of [
  ['0.200.0', '1.9.0'],
  ['0.220.0', '1.9.0'],
  ['0.300.0', '1.10.0'],
]) {
  const consumer = join(directory, sdk)
  mkdirSync(consumer)
  const tracePackage = sdk === '0.200.0' ? '@opentelemetry/sdk-trace-base' : '@opentelemetry/sdk-trace'
  const absentPackage = sdk === '0.200.0' ? '@opentelemetry/sdk-trace' : '@opentelemetry/sdk-trace-base'
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        packageManager,
        dependencies: {
          ...dependencies,
          '@opentelemetry/api': api,
          '@opentelemetry/sdk-node': sdk,
          '@opentelemetry/exporter-trace-otlp-http': sdk,
          [tracePackage]: sdk === '0.200.0' ? '2.0.0' : sdk === '0.220.0' ? '2.9.0' : '3.0.0',
        },
        devDependencies: { typescript: '5.8.2', '@types/node': '22.19.1' },
      },
      null,
      2
    )
  )
  writeFileSync(
    join(consumer, 'pnpm-workspace.yaml'),
    `minimumReleaseAge: 10080\nautoInstallPeers: false\noverrides: ${JSON.stringify(dependencies)}\n`
  )
  pnpm(['install', '--ignore-scripts'], consumer, `install-${sdk}.log`)

  const source = `
import { PostHogSpanProcessor, PostHogTraceExporter } from '@posthog/ai/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { BatchSpanProcessor } from '${tracePackage}'
const processor = new PostHogSpanProcessor({ projectToken: 'phc_test' })
new NodeSDK({ spanProcessors: [processor] })
const exporter = new PostHogTraceExporter({ projectToken: 'phc_test' })
new BatchSpanProcessor(${sdk === '0.200.0' ? 'exporter' : '{ exporter }'})
`
  for (const extension of ['mts', 'cts']) {
    writeFileSync(join(consumer, `consumer.${extension}`), source)
    run(
      process.execPath,
      [
        join(consumer, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        'false',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        `consumer.${extension}`,
      ],
      consumer,
      `types-${sdk}-${extension}.log`
    )
  }

  // Observe the real upstream processor's export boundary without sending network traffic.
  const runtime = (format) => `
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { OTLPTraceExporter } = ${format === 'esm' ? "await import('@opentelemetry/exporter-trace-otlp-http')" : "require('@opentelemetry/exporter-trace-otlp-http')"}
const { NodeSDK } = require('@opentelemetry/sdk-node')
const { trace } = require('@opentelemetry/api')
const resolveFromAi = createRequire(require.resolve('@posthog/ai/otel'))
${sdk === '0.220.0' ? '' : `assert.throws(() => resolveFromAi.resolve('${absentPackage}'), { code: 'MODULE_NOT_FOUND' })`}
const exported = []
OTLPTraceExporter.prototype.export = function (spans, callback) {
  exported.push(...spans)
  setImmediate(() => callback({ code: 0 }))
}
const processor = new PostHogSpanProcessor({ projectToken: 'phc_test', host: 'http://127.0.0.1:1' })
const sdk = new NodeSDK({ spanProcessors: [processor] })
sdk.start()
const tracer = trace.getTracer('posthog-compatibility-test')
tracer.startSpan('gen_ai.compat', { attributes: { 'gen_ai.prompt': 'data:image/png;base64,aGVsbG8=' } }).end()
tracer.startSpan('http.request').end()
await processor.forceFlush()
assert.equal(exported.length, 1)
assert.equal(exported[0].name, 'gen_ai.compat')
assert.equal(exported[0].attributes['gen_ai.prompt'], '[base64 image/png redacted]')
tracer.startSpan('gen_ai.shutdown').end()
await sdk.shutdown()
assert.deepEqual(exported.map(span => span.name), ['gen_ai.compat', 'gen_ai.shutdown'])
console.log('${sdk}: types, loading, upstream batching, filtering, redaction, flush and shutdown passed')
`
  for (const format of ['cjs', 'esm']) {
    const script =
      format === 'cjs'
        ? `const { PostHogSpanProcessor } = require('@posthog/ai/otel'); (async () => { ${runtime(format)} })().catch(error => { console.error(error); process.exitCode = 1 })`
        : `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const { PostHogSpanProcessor } = await import('@posthog/ai/otel'); { ${runtime(format)} }`
    const filename = `runtime.${format === 'cjs' ? 'cjs' : 'mjs'}`
    writeFileSync(join(consumer, filename), script)
    console.log(run(process.execPath, [filename], consumer, `runtime-${sdk}-${format}.log`).trim())
  }

  const worker = join(consumer, 'worker.mjs')
  const bundle = await build({
    stdin: {
      contents: `
import { ${sdk === '0.200.0' ? 'BasicTracerProvider' : 'TracerProvider'} as TracerProvider } from '${tracePackage}'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
export default { async fetch() {
  const { PostHogSpanProcessor, PostHogTraceExporter } = await import('@posthog/ai/otel')
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
`,
      resolveDir: consumer,
      sourcefile: 'worker-entry.mjs',
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    external: ['node:*'],
    outfile: worker,
    metafile: true,
    logLevel: 'silent',
  })
  assert.ok(Object.keys(bundle.metafile.inputs).some((input) => input.includes(`${tracePackage}/`)))
  const workerRuntime = new Miniflare({
    modules: true,
    scriptPath: worker,
    modulesRoot: consumer,
    compatibilityDate: '2026-07-30',
    compatibilityFlags: ['nodejs_compat'],
    cf: false,
  })
  try {
    const response = await workerRuntime.dispatchFetch('http://localhost/')
    assert.equal(response.status, 200, await response.clone().text())
    assert.deepEqual(await response.json(), {
      flushed: [{ name: 'gen_ai.flush', prompt: '[base64 image/png redacted]' }],
      exported: [{ name: 'gen_ai.flush', prompt: '[base64 image/png redacted]' }, { name: 'gen_ai.shutdown' }],
    })
    console.log(`${sdk}: bundled Workers import, construction, filtering, redaction, flush and shutdown passed`)
  } finally {
    await workerRuntime.dispose()
  }
}
