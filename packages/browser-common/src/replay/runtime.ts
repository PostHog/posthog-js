import type { DeferredStylesheetStats, MutationCost, RecordPlugin, SnapshotCost } from './rrweb-types'
import type { rrwebRecord } from './rrweb'
import type { NetworkRecordOptions } from '../index'

/** Recorder runtime and optional plugins supplied by the loading SDK. */
export interface ReplayRuntime {
    rrweb?: {
        record: rrwebRecord
        version: string
        wasMaxDepthReached?: () => boolean
        resetMaxDepthState?: () => void
        // see rrweb-snapshot/src/snapshot-cost.ts
        getLastSnapshotCost?: () => SnapshotCost | null
        getMutationCost?: () => MutationCost
        getDeferredStylesheetStats?: () => DeferredStylesheetStats
        getDiscardedDurationSamples?: () => number
        // see rrweb/src/record/observer.ts
        getObserverInitFailures?: () => string[] | undefined
        resetSnapshotCostState?: () => void
    }
    rrwebPlugins?: {
        getRecordConsolePlugin: () => RecordPlugin
        getRecordNetworkPlugin?: (options: NetworkRecordOptions) => RecordPlugin
    }
}
