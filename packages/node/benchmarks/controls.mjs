import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cases, definitions, digest, expectedFlags, users, workloads } from './fixtures.mjs'
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
    'properties: { ...event.properties, sequence: event.properties.sequence % 16 }',
    'properties: { ...event.properties, plan: "free" }',
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
    assert.equal(base.suite.version, 2)
    assert.equal(base.suite.specification, 'sdk-benchmarks/v1')
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

test('full and smoke inventories match sdk-benchmarks/v1 counts, parameters and passes', () => {
  const singleCases = ['boolean', 'rollout', 'variant', 'property', 'regex', 'cohort', 'early', 'late', 'no-match']
  assert.deepEqual(cases, [...singleCases, 'inactive'])
  for (const smoke of [false, true]) {
    const inventory = workloads(smoke)
    const expected = [
      ...singleCases.map((kind, flag_index) => ({
        id: `flags.single.${kind}`,
        mode: 'single',
        flag_count: 10,
        flag_index,
        operations: smoke ? 160 : 16000,
        concurrency: 1,
        passes: ['timing', 'allocation'],
      })),
      ...[10, 100, 1000].map((flag_count, index) => ({
        id: `flags.all.${flag_count}`,
        mode: 'all',
        flag_count,
        operations: smoke ? 16 : [1600, 160, 160][index],
        concurrency: 1,
        passes: ['timing', 'allocation'],
      })),
      {
        id: 'flags.load.1000',
        mode: 'all',
        flag_count: 1000,
        operations: smoke ? 32 : 1600,
        concurrency: 8,
        passes: ['memory'],
      },
      {
        id: 'flags.refresh.1000',
        mode: 'refresh',
        flag_count: 1000,
        operations: smoke ? 4 : 40,
        concurrency: 1,
        passes: ['memory'],
      },
      ...[32, 4096].map((payload_bytes) => ({
        id: `capture.enqueue.${payload_bytes}`,
        mode: 'capture',
        payload_bytes,
        operations: smoke ? 200 : 1000,
        concurrency: 1,
        completion_boundary: 'prepared_enqueue',
        passes: ['timing', 'allocation'],
      })),
      ...['steady', 'burst'].flatMap((drain_strategy) =>
        [32, 4096].map((payload_bytes) => ({
          id: `capture.drain.${drain_strategy}.${payload_bytes}`,
          mode: 'drain',
          payload_bytes,
          operations: smoke ? 200 : 1000,
          concurrency: 1,
          drain_strategy,
          flush_every: drain_strategy === 'steady' ? 100 : smoke ? 200 : 1000,
          completion_boundary: 'completed_delivery',
          passes: ['timing', 'allocation', 'memory'],
        }))
      ),
    ]
    assert.equal(inventory.length, 20)
    assert.deepEqual(inventory, expected)
  }
})

test('receiver accepts reordered delivery and rejects balanced duplication, invalid sequences and identity mapping', async () => {
  const events = Array.from({ length: 32 }, (_, sequence) => ({
    event: 'benchmark',
    distinct_id: users[sequence % 16].distinctId,
    properties: { payload: 'x'.repeat(32), plan: 'pro', sequence },
  }))
  const send = (network, batch) =>
    network.fetch('http://benchmark.invalid/batch/', {
      method: 'POST',
      body: JSON.stringify({ batch }),
    })
  const network = transport(32, 32)
  await send(network, [...events].reverse())
  network.verifyDelivery(32)
  network.reset()
  await send(network, events.slice(0, 16))
  network.verifyDelivery(16)
  for (const batch of [
    [...events.slice(0, 16), ...events.slice(0, 16)],
    events.slice(1),
    events.map((event) => ({ ...event, properties: { ...event.properties, sequence: -1 } })),
    events.map((event) => ({ ...event, properties: { ...event.properties, sequence: 32 } })),
    events.map((event) => ({ ...event, properties: { ...event.properties, sequence: 0.5 } })),
    events.map((event) => ({ ...event, distinct_id: users[(event.properties.sequence + 1) % 16].distinctId })),
  ]) {
    network.reset()
    await send(network, batch)
    assert.throws(() => network.verifyDelivery(32), { code: 'ERR_ASSERTION' })
  }
})

async function withSdkWrapper(body, run) {
  const directory = await mkdtemp(join(tmpdir(), 'posthog-bench-lifecycle-'))
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ main: 'index.cjs' }))
    await writeFile(
      join(directory, 'index.cjs'),
      `
      const assert = require('node:assert/strict');
      const { PostHog } = require(${JSON.stringify(sdkDirectory)});
      ${body}
    `
    )
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('capture phases use native lifecycle, independent properties and exact explicit flush schedules', async () => {
  for (const smoke of [false, true]) {
    for (const spec of workloads(smoke).filter((item) => item.id.startsWith('capture.'))) {
      await withSdkWrapper(
        `
        exports.PostHog = class extends PostHog {
          constructor(key, options) {
            assert.equal(options.disableCompression, true);
            assert.equal(options.flushInterval, 0);
            assert.equal(options.flushAt, 100000);
            assert.equal(options.maxQueueSize, 100001);
            assert.equal(options.maxBatchSize, 100000);
            super(key, options);
            this.calls = [];
            this.flushes = [];
            globalThis.benchmarkLifecycleControl = this;
          }
          capture(event) {
            this.calls.push(event);
            super.capture(event);
          }
          async flush() {
            this.flushes.push(this.calls.length);
            await super.flush();
          }
        };
      `,
        async (directory) => {
          const workload = await createWorkload(spec, directory)
          const observed = globalThis.benchmarkLifecycleControl
          try {
            await workload.run(37)
            await workload.reset()
            observed.calls.length = 0
            observed.flushes.length = 0
            const checkpoints = []
            await workload.run(spec.operations, (completed) => {
              checkpoints.push(completed)
              // Steady flushes precede checkpoints; burst's final flush follows its last checkpoint.
              assert.equal(observed.flushes.length, spec.drain_strategy === 'steady' ? completed / 100 : 0)
            })
            const schedule =
              spec.mode === 'capture'
                ? []
                : spec.drain_strategy === 'burst'
                  ? [spec.operations]
                  : Array.from({ length: spec.operations / 100 }, (_, i) => (i + 1) * 100)
            assert.deepEqual(observed.flushes, schedule)
            assert.deepEqual(
              checkpoints,
              Array.from({ length: spec.operations / 100 }, (_, i) => (i + 1) * 100)
            )
            assert.equal(new Set(observed.calls.map((event) => event.properties)).size, spec.operations)
            for (let sequence = 0; sequence < spec.operations; sequence++) {
              assert.deepEqual(observed.calls[sequence], {
                event: 'benchmark',
                distinctId: users[sequence % 16].distinctId,
                properties: { payload: 'x'.repeat(spec.payload_bytes), plan: 'pro', sequence },
              })
            }
            const counts = await workload.verify()
            assert.equal(counts.captured, spec.operations)
            assert.equal(counts.delivered, spec.operations)
            assert.deepEqual(observed.flushes, spec.mode === 'capture' ? [spec.operations] : schedule)
          } finally {
            await workload.close()
            delete globalThis.benchmarkLifecycleControl
          }
        }
      )
    }
  }
})

test('completed-delivery verification fails without a rescuing flush', async () => {
  await withSdkWrapper(
    `
    exports.PostHog = class extends PostHog {
      async flush() {
        globalThis.benchmarkFlushCalls = (globalThis.benchmarkFlushCalls || 0) + 1;
        if (globalThis.benchmarkFlushCalls > 1) await super.flush();
      }
    };
  `,
    async (directory) => {
      const spec = workloads(true).find((item) => item.id === 'capture.drain.burst.32')
      const workload = await createWorkload(spec, directory)
      try {
        await workload.run()
        assert.equal(globalThis.benchmarkFlushCalls, 1)
        await assert.rejects(workload.verify(), /Delivered counts/)
        assert.equal(globalThis.benchmarkFlushCalls, 1)
      } finally {
        await workload.close()
        delete globalThis.benchmarkFlushCalls
      }
    }
  )
})

test('refresh sweeps stay outside measured loops and phase reset restores generation zero', async () => {
  const spec = workloads(true).find((item) => item.mode === 'refresh')
  const workload = await createWorkload(spec, sdkDirectory)
  try {
    for (let generation = 1; generation <= 4; generation++) {
      await workload.run(1)
      assert.equal((await workload.verify()).generation, generation)
    }
    await workload.run(1) // odd generation makes the reset's result change observable
    await workload.reset()
    const reset = await workload.verify()
    assert.equal(reset.generation, 0)
    assert.equal(reset.definitions, 0)
    const positions = []
    await workload.run(spec.operations, (completed) => positions.push(completed))
    const measured = await workload.verify()
    assert.deepEqual(positions, [1, 2, 3, 4])
    assert.equal(measured.definitions, 4)
    assert.equal(measured.generation, 4)
    assert.equal(measured.evaluations - reset.evaluations, 16, 'Only final verification evaluates users')
  } finally {
    await workload.close()
  }
})

test('load checkpoints follow completed groups of 32 and include a partial final group', async () => {
  const spec = { ...workloads(true).find((item) => item.id === 'flags.load.1000'), operations: 70 }
  const workload = await createWorkload(spec, sdkDirectory)
  try {
    const positions = []
    await workload.run(spec.operations, (completed) => positions.push(completed))
    assert.deepEqual(positions, [32, 64, 70])
    await workload.verify()
  } finally {
    await workload.close()
  }
})

test('memory workers retain all deterministic checkpoints after phase reset', async () => {
  for (const spec of workloads(true).filter((item) => item.passes.includes('memory'))) {
    const raw = await runWorker(sdkDirectory, spec, 'memory')
    assert.equal(raw.status, 'ok', raw.stderr)
    const positions = spec.mode === 'refresh' ? [1, 2, 3, 4] : spec.mode === 'drain' ? [100, 200] : [32]
    assert.deepEqual(
      raw.checkpoints.map((point) => point.operations),
      positions
    )
    assert.equal(
      raw.observed_peak_rss,
      Math.max(raw.before.rss, raw.after_work.rss, ...raw.checkpoints.map((point) => point.rss))
    )
    assert.equal(raw.validation.evaluations, spec.mode === 'drain' ? 0 : 16)
    if (spec.mode === 'refresh') {
      assert.equal(raw.validation.generation, 4)
      assert.equal(raw.validation.definitions, 4)
    }
    if (spec.mode === 'drain') assert.equal(raw.validation.captured, 200)
  }
})

test('memory refresh worker only forces GC outside measured refreshes and checkpoints', async () => {
  await withSdkWrapper(
    `
    let collections = 0;
    const collect = global.gc;
    global.gc = (...args) => { collections++; return collect(...args); };
    let generation = 0;
    let startCollections = 0;
    exports.PostHog = class extends PostHog {
      constructor(key, options) {
        const fetch = options.fetch;
        super(key, { ...options, fetch: async (...args) => {
          const response = await fetch(...args);
          const json = response.json;
          return { ...response, json: async () => {
            const body = await json();
            const regex = body.flags[4].filters.groups[0].properties[0].value;
            generation = Number(regex.match(/refresh-([0-9]+)/)[1]);
            if (generation === 1) startCollections = collections;
            if (generation > 1) assert.equal(collections, startCollections, 'GC during measured refresh loop');
            return body;
          }};
        }});
      }
      async getAllFlags(...args) {
        if (generation === 4) assert.equal(collections, startCollections + 2, 'Only post-work settling precedes final sweep');
        return super.getAllFlags(...args);
      }
    };
  `,
    async (directory) => {
      const spec = workloads(true).find((item) => item.mode === 'refresh')
      const raw = await runWorker(directory, spec, 'memory')
      assert.equal(raw.status, 'ok', raw.stderr)
    }
  )
})

test('refresh correctness rejects fetched but stale definitions', async () => {
  await withSdkWrapper(
    `
    exports.PostHog = class extends PostHog {
      constructor(key, options) {
        let original;
        const fetch = options.fetch;
        super(key, { ...options, fetch: async (...args) => {
          const response = await fetch(...args);
          const json = response.json;
          return { ...response, json: async () => {
            const body = await json();
            original ??= body;
            return original;
          }};
        }});
      }
    };
  `,
    async (directory) => {
      const spec = workloads(true).find((item) => item.mode === 'refresh')
      const workload = await createWorkload(spec, directory)
      try {
        await workload.run(1)
        await assert.rejects(workload.verify(), { code: 'ERR_ASSERTION' })
      } finally {
        await workload.close()
      }
    }
  )
})
