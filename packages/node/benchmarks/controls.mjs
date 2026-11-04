import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { definitions, digest, expectedFlags, users, workloads } from './fixtures.mjs'
import { classifyExit, memory, sampleAllocations, samplingOptions, settle, timeOperations } from './measurement.mjs'
import { appendSample, coreBuildIdentity, main, runWorker } from './run.mjs'
import { createWorkload, transport } from './workload.mjs'

const sdkDirectory = fileURLToPath(new URL('../', import.meta.url))

test('fixtures are deterministic and refreshes change actual evaluation results', () => {
  assert.equal(digest(definitions(1000)), digest(definitions(1000)))
  assert.notEqual(digest(definitions(1000)), digest(definitions(1000, 1)))
  assert.equal(expectedFlags(10, users[0])['boolean-0'], true)
  assert.equal(expectedFlags(10, users[0], 1)['boolean-0'], false)
  assert.equal(expectedFlags(10, users[0], 1)['cohort-5'], false)
})

test('all fixture cases evaluate through the built public entry and validate every user', async () => {
  for (const spec of workloads(true)) {
    const workload = await createWorkload(spec, sdkDirectory)
    try {
      await workload.run()
      const counts = await workload.verify()
      assert.deepEqual(counts.unexpected, [])
      if (spec.mode === 'refresh') assert.equal(counts.definitions, spec.operations + 1)
      if (spec.mode === 'capture' || spec.mode === 'drain') {
        assert.equal(counts.delivered, spec.operations)
        assert.equal(counts.invalidEvents, 0)
      }
    } finally {
      await workload.close()
    }
  }
})

test('transport rejects remote evaluation instead of returning a fast fake answer', async () => {
  const network = transport()
  await assert.rejects(network.fetch('http://benchmark.invalid/flags/?v=2'), /Unexpected/)
  assert.deepEqual(network.state.unexpected, ['/flags/'])
})

test('capture verification rejects lost payloads and identity redistribution with unchanged event counts', async () => {
  for (const mutation of [
    'properties: { ...event.properties, payload: "" }',
    `distinctId: ${JSON.stringify(users[0].distinctId)}`,
  ]) {
    const directory = await mkdtemp(join(tmpdir(), 'posthog-bench-capture-'))
    let workload
    try {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ main: 'index.cjs' }))
      await writeFile(
        join(directory, 'index.cjs'),
        `
                const { PostHog } = require(${JSON.stringify(sdkDirectory)});
                exports.PostHog = class extends PostHog {
                    capture(event) { super.capture({ ...event, ${mutation} }); }
                };
            `
      )
      const spec = workloads(true).find((item) => item.id === 'capture.enqueue.4096')
      workload = await createWorkload(spec, directory)
      await workload.run()
      await assert.rejects(workload.verify(), { code: 'ERR_ASSERTION' })
    } finally {
      await workload?.close()
      await rm(directory, { recursive: true, force: true })
    }
  }
})

test('build identity includes code loaded from the target core package', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'posthog-bench-core-'))
  try {
    const core = join(directory, 'node_modules/@posthog/core')
    await mkdir(join(core, 'dist'), { recursive: true })
    await writeFile(join(core, 'package.json'), JSON.stringify({ main: 'dist/index.js' }))
    await writeFile(join(core, 'dist/index.js'), 'module.exports = {}')
    await writeFile(join(core, 'dist/evaluation.js'), 'module.exports = 1')
    const before = await coreBuildIdentity(directory)
    assert.equal(before.entry, await realpath(join(core, 'dist/index.js')))
    await writeFile(join(core, 'dist/evaluation.js'), 'module.exports = 2')
    assert.notEqual((await coreBuildIdentity(directory)).digest, before.digest)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('allocation sampling includes short-lived objects collected during the measurement', async () => {
  async function churn() {
    for (let cycle = 0; cycle < 30; cycle++) {
      globalThis.benchmarkAllocationControl = Array.from({ length: 1000 }, (_, i) => Array(64).fill(i))
      globalThis.benchmarkAllocationControl = null
      global.gc()
    }
  }
  await settle()
  const liveOnly = await sampleAllocations(churn, {
    ...samplingOptions,
    includeObjectsCollectedByMajorGC: false,
    includeObjectsCollectedByMinorGC: false,
  })
  await settle()
  const all = await sampleAllocations(churn)
  // 30,000 arrays * 64 eight-byte slots = 15.36 MB before object headers.
  // Broad bounds test profiler semantics, not a performance regression threshold.
  assert.ok(all.estimated_bytes > 10_000_000 && all.estimated_bytes < 35_000_000, JSON.stringify(all))
  assert.ok(liveOnly.estimated_bytes < all.estimated_bytes / 4, JSON.stringify({ liveOnly, all }))
  assert.ok(all.sampled_allocations > 100)
  delete globalThis.benchmarkAllocationControl
})

test('CPU and retained-heap controls exercise the corresponding measurements', async () => {
  const timing = await timeOperations(async () => {
    const start = process.cpuUsage()
    while (true) {
      const cpu = process.cpuUsage(start)
      if (cpu.user + cpu.system > 25000) break
    }
  }, 1)
  assert.ok(timing.process_cpu_time_per_op >= 25_000_000)
  assert.ok(timing.elapsed_time_per_op > 0)
  await settle()
  const before = memory()
  globalThis.benchmarkRetainedControl = Array(2_000_000).fill(42)
  await settle()
  assert.ok(memory().heap_used - before.heap_used > 12_000_000)
  delete globalThis.benchmarkRetainedControl
  await settle()
})

test('worker isolates allocation instrumentation and records unavailable allocation counts', async () => {
  const spec = workloads(true).find((item) => item.id === 'flags.all.100')
  const raw = await runWorker(sdkDirectory, spec, 'allocation')
  assert.equal(raw.status, 'ok', raw.stderr)
  assert.equal(raw.elapsed_time_per_op, undefined)
  assert.ok(raw.entry.startsWith(sdkDirectory))
  const result = { status: 'ok', metrics: [], runs: [] }
  appendSample(result, raw, 0)
  assert.equal(result.metrics[0].quality, 'estimated')
  assert.equal(result.metrics.find((item) => item.id === 'allocations_per_op').status, 'unsupported')
})

test('public-entry controls detect added CPU work and temporary allocation churn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'posthog-bench-regression-'))
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ main: 'index.cjs' }))
    await writeFile(
      join(directory, 'index.cjs'),
      `
            const { PostHog } = require(${JSON.stringify(sdkDirectory)});
            exports.PostHog = class extends PostHog {
                async getFeatureFlag(...args) {
                    const value = await super.getFeatureFlag(...args);
                    const start = process.cpuUsage();
                    while (true) {
                        const cpu = process.cpuUsage(start);
                        if (cpu.user + cpu.system >= 1000) break;
                    }
                    globalThis.temporaryAllocation = Array(32768).fill(value);
                    globalThis.temporaryAllocation = null;
                    return value;
                }
            };
        `
    )
    const spec = workloads(true)[0]
    for (const pass of ['timing', 'allocation']) {
      const base = await runWorker(sdkDirectory, spec, pass)
      const changed = await runWorker(directory, spec, pass)
      assert.equal(base.status, 'ok', base.stderr)
      assert.equal(changed.status, 'ok', changed.stderr)
      const metric = pass === 'timing' ? 'process_cpu_time_per_op' : 'estimated_bytes'
      assert.ok(
        changed[metric] > base[metric] * 3,
        JSON.stringify({ metric, base: base[metric], changed: changed[metric] })
      )
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('failed workers are not represented as zero-cost samples', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'posthog-bench-broken-'))
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ main: 'index.cjs' }))
    await writeFile(join(directory, 'index.cjs'), 'throw new Error("broken target SDK")')
    const raw = await runWorker(directory, workloads(true)[0], 'timing')
    assert.equal(raw.status, 'error')
    assert.match(raw.stderr, /broken target SDK/)
    const result = { status: 'ok', metrics: [], runs: [] }
    appendSample(result, raw, 0)
    assert.equal(result.status, 'error')
    assert.deepEqual(result.metrics, [])
    await writeFile(join(directory, 'index.cjs'), 'while (true) {}')
    const timeout = await runWorker(directory, workloads(true)[0], 'timing', 100)
    assert.equal(timeout.status, 'timeout')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('OOM requires runtime evidence, not just SIGKILL', () => {
  assert.equal(classifyExit({ signal: 'SIGKILL', stderr: '' }), 'error')
  assert.equal(
    classifyExit({
      signal: 'SIGABRT',
      stderr: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
    }),
    'oom'
  )
  assert.equal(classifyExit({ timedOut: true, stderr: '' }), 'timeout')
})

test('repeated timeouts stop the suite and preserve both sides of the failed pair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'posthog-bench-timeouts-'))
  let calls = 0
  try {
    const code = await main(
      ['--base', sdkDirectory, '--head', sdkDirectory, '--output', directory, '--smoke'],
      async () => {
        calls++
        return { status: 'timeout', error: 'Worker did not complete' }
      }
    )
    assert.equal(code, 1)
    assert.equal(calls, 2)
    for (const role of ['base', 'head']) {
      const document = JSON.parse(await readFile(join(directory, `${role}.json`), 'utf8'))
      assert.equal(document.benchmarks.length, 1)
      assert.equal(document.benchmarks[0].status, 'timeout')
      assert.deepEqual(document.benchmarks[0].metrics, [])
      assert.equal(document.benchmarks[0].runs.length, 1)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('paired runner writes attributed documents with matching fixture identities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'posthog-bench-results-'))
  try {
    assert.equal(
      await main([
        '--base',
        sdkDirectory,
        '--head',
        sdkDirectory,
        '--output',
        directory,
        '--smoke',
        '--repetitions',
        '2',
        '--filter',
        'flags.all.10',
      ]),
      0
    )
    const base = JSON.parse(await readFile(join(directory, 'base.json'), 'utf8'))
    const head = JSON.parse(await readFile(join(directory, 'head.json'), 'utf8'))
    assert.equal(base.execution.pair_id, head.execution.pair_id)
    assert.equal(base.revision.role, 'base')
    assert.equal(head.revision.role, 'head')
    assert.equal(base.execution.build_digest, head.execution.build_digest)
    assert.equal(base.execution.core_build.digest, head.execution.core_build.digest)
    for (let i = 0; i < base.benchmarks.length; i++) {
      assert.equal(base.benchmarks[i].fixture_digest, head.benchmarks[i].fixture_digest)
      assert.equal(base.benchmarks[i].runs.length, 4)
      for (const metric of head.benchmarks[i].metrics.filter((item) => item.status === 'ok')) {
        assert.equal(metric.samples.length, 2)
        assert.ok(metric.samples.every((sample) => Number.isFinite(sample.value)))
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
