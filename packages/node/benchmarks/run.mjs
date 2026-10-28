import assert from 'node:assert/strict'
import { execFileSync, fork } from 'node:child_process'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { cpus, platform, arch, release } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { definitions, digest, users, workloads } from './fixtures.mjs'
import { classifyExit, samplingOptions } from './measurement.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, 'worker.mjs')
const heapLimitMb = 512
const maxWorkerTimeouts = 2

export async function runWorker(sdkDirectory, spec, pass, timeoutMs = 120000) {
  return new Promise((resolveResult) => {
    const child = fork(worker, [sdkDirectory, JSON.stringify(spec), pass], {
      execArgv: ['--expose-gc', `--max-old-space-size=${heapLimitMb}`],
      env: { ...process.env, NODE_OPTIONS: '', POSTHOG_CAPTURE_MODE: 'v0' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let stderr = ''
    let stdout = ''
    let message
    let spawnError
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (data) => {
      stdout = (stdout + data).slice(-65536)
    })
    child.stderr.on('data', (data) => {
      stderr = (stderr + data).slice(-65536)
    })
    child.on('message', (value) => {
      message = value
    })
    child.on('error', (error) => {
      spawnError = error.message
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0 && message && !timedOut) resolveResult({ status: 'ok', ...message, stderr, stdout })
      else
        resolveResult({
          status: classifyExit({ timedOut, signal, stderr }),
          code,
          signal,
          stderr,
          stdout,
          error: spawnError ?? 'Worker did not complete',
        })
    })
  })
}

function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
}

async function treeDigest(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const values = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) values.push([entry.name, await treeDigest(path)])
    else if (entry.isFile()) values.push([entry.name, digest(await readFile(path, 'utf8'))])
  }
  return digest(values)
}

export async function coreBuildIdentity(directory) {
  const require = createRequire(join(directory, 'package.json'))
  const entry = require.resolve('@posthog/core')
  return { entry, digest: await treeDigest(dirname(entry)) }
}

async function documentFor(directory, role, pairId, suite) {
  const root = git(directory, 'rev-parse', '--show-toplevel')
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'posthog-node')
  return {
    schema_version: 1,
    sdk: 'posthog-node',
    revision: {
      role,
      commit: git(directory, 'rev-parse', 'HEAD'),
      dirty: git(root, 'status', '--porcelain').length > 0,
    },
    suite,
    execution: {
      pair_id: pairId,
      runtime: 'node',
      runtime_version: process.version,
      v8_version: process.versions.v8,
      runtime_flags: ['--expose-gc', `--max-old-space-size=${heapLimitMb}`],
      os: platform(),
      arch: arch(),
      kernel: release(),
      cpu: cpus()[0]?.model,
      runner_class: process.env.RUNNER_NAME ? 'github-hosted-or-self-hosted' : 'local',
      runner_image: process.env.ImageVersion ?? null,
      dependency_lock_digest: digest(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')),
      build_digest: await treeDigest(join(directory, 'dist')),
      core_build: await coreBuildIdentity(directory),
      sdk_version: manifest.version,
      resource_limits: {
        v8_old_space_mb: heapLimitMb,
        process_rss_limit_bytes: null,
        worker_timeout_ms: 120000,
        max_worker_timeouts: maxWorkerTimeouts,
      },
    },
    benchmarks: [],
  }
}

function metric(id, unit, method, quality = 'measured') {
  return { id, unit, method, quality, direction: 'lower', status: 'ok', samples: [] }
}

export function appendSample(benchmark, raw, repetition) {
  benchmark.runs.push({ repetition, ...raw })
  if (raw.status !== 'ok') {
    benchmark.status = raw.status
    return
  }
  const add = (id, unit, method, value, quality) => {
    assert.ok(Number.isFinite(value) && value >= 0, `Invalid ${id}: ${value}`)
    let existing = benchmark.metrics.find((item) => item.id === id)
    if (!existing) {
      existing = metric(id, unit, method, quality)
      benchmark.metrics.push(existing)
    }
    existing.samples.push({
      repetition,
      value,
      operations: raw.operations,
      ...(raw.elapsed_ns === undefined ? {} : { elapsed_ns: raw.elapsed_ns }),
    })
  }
  if (raw.pass === 'timing') {
    add('elapsed_time_per_op', 'ns/op', 'process.hrtime.bigint', raw.elapsed_time_per_op)
    add('process_cpu_time_per_op', 'ns/op', 'process.cpuUsage', raw.process_cpu_time_per_op)
  } else if (raw.pass === 'allocation') {
    add(
      'allocated_bytes_per_op',
      'bytes/op',
      'v8.HeapProfiler.startSampling',
      raw.estimated_bytes / raw.operations,
      'estimated'
    )
    if (!benchmark.metrics.some((item) => item.id === 'allocations_per_op')) {
      benchmark.metrics.push({
        id: 'allocations_per_op',
        unit: 'count/op',
        status: 'unsupported',
        reason: 'V8 samples do not expose total allocation count; sample count is not object count.',
      })
    }
  } else if (raw.pass === 'memory') {
    add('idle_process_rss', 'bytes', 'process.memoryUsage.rss', raw.before.rss)
    add('observed_workload_peak_rss', 'bytes', 'process.memoryUsage.rss.operation_checkpoints', raw.observed_peak_rss)
    add('process_lifetime_peak_rss', 'bytes', 'process.resourceUsage.maxRSS', raw.process_lifetime_peak_rss)
    add('post_settling_process_rss', 'bytes', 'process.memoryUsage.rss', raw.after_settling.rss)
    add('post_settling_heap_used', 'bytes', 'process.memoryUsage.heapUsed', raw.after_settling.heap_used)
  }
}

export async function main(args = process.argv.slice(2), executeWorker = runWorker) {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      output: { type: 'string' },
      repetitions: { type: 'string', default: '6' },
      smoke: { type: 'boolean', default: false },
      filter: { type: 'string' },
    },
  })
  assert.ok(
    values.base && values.head && values.output,
    'Usage: node run.mjs --base <built packages/node> --head <built packages/node> --output <directory> [--smoke] [--repetitions 6] [--filter flags.]'
  )
  const repetitions = Number(values.repetitions)
  assert.ok(
    Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 30,
    'repetitions must be an integer from 1 to 30'
  )
  const specs = workloads(values.smoke).filter((spec) => !values.filter || spec.id.startsWith(values.filter))
  assert.ok(specs.length, 'No matching workloads')
  const output = resolve(values.output)
  const pairId = randomUUID()
  const suite = {
    id: 'node-sdk-performance',
    version: 2,
    specification: 'sdk-benchmarks/v1',
    source_commit: git(here, 'rev-parse', 'HEAD'),
    source_digest: await treeDigest(here),
    profile: values.smoke ? 'smoke' : 'full',
    repetitions,
    allocation_sampling: samplingOptions,
    transport: 'public fetch adapter; in-process JSON; no network',
    settling: 'two explicit GC requests separated by event-loop turns',
    memory_sampling:
      'every 32 load evaluations, every refresh, every 100 captures, and final operation; no forced GC during work; lifetime high-water mark includes setup and warmup',
    warmup:
      'two refreshes; otherwise min(operations, 32 for 1000 flags or 160); verified then phase reset and generation 0 reload',
  }
  const directories = { base: resolve(values.base), head: resolve(values.head) }
  const documents = {}
  for (const role of ['base', 'head']) documents[role] = await documentFor(directories[role], role, pairId, suite)
  await mkdir(output, { recursive: true })
  const save = async () => {
    for (const role of ['base', 'head'])
      await writeFile(join(output, `${role}.json`), `${JSON.stringify(documents[role], null, 2)}\n`)
  }
  let failures = 0
  let timeouts = 0
  for (const spec of specs) {
    const records = {}
    for (const role of ['base', 'head']) {
      records[role] = {
        id: spec.id,
        parameters: spec,
        fixture_digest: digest({
          spec,
          definitions: spec.flag_count ? definitions(spec.flag_count) : null,
          users,
        }),
        status: 'ok',
        metrics: [],
        runs: [],
      }
      documents[role].benchmarks.push(records[role])
    }
    for (let repetition = 0; repetition < repetitions; repetition++) {
      for (const pass of spec.passes) {
        for (const role of repetition % 2 ? ['head', 'base'] : ['base', 'head']) {
          const raw = await executeWorker(directories[role], spec, pass)
          appendSample(records[role], { ...raw, pass }, repetition)
          if (raw.status !== 'ok') failures++
          if (raw.status === 'timeout') timeouts++
          console.error(`${spec.id} ${pass} ${repetition + 1}/${repetitions} ${role}: ${raw.status}`)
          await save()
        }
        if (timeouts >= maxWorkerTimeouts) return 1
      }
      if (records.base.status !== 'ok' || records.head.status !== 'ok') break
    }
  }
  return failures ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
