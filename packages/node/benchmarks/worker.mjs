import { createWorkload } from './workload.mjs'
import { memory, sampleAllocations, settle, timeOperations } from './measurement.mjs'

const [sdkDirectory, serializedSpec, pass] = process.argv.slice(2)
const spec = JSON.parse(serializedSpec)
let workload
try {
  if (typeof global.gc !== 'function') throw new Error('Run benchmark workers with --expose-gc')
  workload = await createWorkload(spec, sdkDirectory)
  const warmupOperations = spec.mode === 'refresh' ? 2 : Math.min(spec.operations, spec.flag_count === 1000 ? 32 : 160)
  await workload.run(warmupOperations)
  await workload.verify()
  await settle()
  const result = { pass, operations: spec.operations, warmup_operations: warmupOperations, entry: workload.entry }
  if (pass === 'timing') {
    Object.assign(result, await timeOperations(() => workload.run(), spec.operations))
  } else if (pass === 'allocation') {
    Object.assign(result, await sampleAllocations(() => workload.run()))
  } else if (pass === 'memory') {
    result.before = memory()
    result.checkpoints = []
    let observedPeak = result.before.rss
    const start = process.hrtime.bigint()
    await workload.run(spec.operations, async (completed) => {
      const current = memory()
      observedPeak = Math.max(observedPeak, current.rss)
      if (spec.mode === 'refresh' && (completed % 5 === 0 || completed === spec.operations)) {
        await settle()
        result.checkpoints.push({ operations: completed, ...memory() })
      }
    })
    result.elapsed_ns = Number(process.hrtime.bigint() - start)
    result.after_work = memory()
    result.observed_peak_rss = Math.max(observedPeak, result.after_work.rss)
    // Node reports maxRSS in KiB on all supported platforms. This is a lifetime high-water mark.
    result.process_lifetime_peak_rss = process.resourceUsage().maxRSS * 1024
    await settle()
    result.after_settling = memory()
  } else {
    throw new Error(`Unknown measurement pass: ${pass}`)
  }
  result.validation = await workload.verify()
  await workload.close()
  workload = undefined
  process.send(result)
} catch (error) {
  console.error(error.stack ?? error)
  process.exitCode = 1
} finally {
  await workload?.close()
  process.disconnect()
}
