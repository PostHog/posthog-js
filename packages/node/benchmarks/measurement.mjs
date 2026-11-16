import { Session } from 'node:inspector/promises'
import { setImmediate } from 'node:timers/promises'

export const samplingInterval = 32768
export const samplingOptions = {
  samplingInterval,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
}

export async function settle() {
  await setImmediate()
  global.gc()
  await setImmediate()
  global.gc()
}

export function memory() {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage()
  return { rss, heap_used: heapUsed, external, array_buffers: arrayBuffers }
}

export async function timeOperations(run, operations) {
  const cpuStart = process.cpuUsage()
  const start = process.hrtime.bigint()
  await run()
  const elapsedNs = Number(process.hrtime.bigint() - start)
  const cpu = process.cpuUsage(cpuStart)
  return {
    elapsed_ns: elapsedNs,
    elapsed_time_per_op: elapsedNs / operations,
    process_cpu_time_per_op: ((cpu.user + cpu.system) * 1000) / operations,
  }
}

export async function sampleAllocations(run, options = samplingOptions) {
  const session = new Session()
  session.connect()
  try {
    await session.post('HeapProfiler.startSampling', options)
    await run()
    const { profile } = await session.post('HeapProfiler.stopSampling')
    // V8's sample sizes are already weighted estimates, not raw object sizes.
    return {
      estimated_bytes: profile.samples.reduce((sum, sample) => sum + sample.size, 0),
      sampled_allocations: profile.samples.length,
      sampling_interval_bytes: options.samplingInterval,
    }
  } finally {
    session.disconnect()
  }
}

export function classifyExit({ timedOut, signal, stderr }) {
  if (timedOut) return 'timeout'
  // SIGKILL/137 alone could be cancellation or any other resource limit.
  if (/FATAL ERROR:.*(?:heap out of memory|Allocation failed.*JavaScript heap)/i.test(stderr)) return 'oom'
  return 'error'
}
