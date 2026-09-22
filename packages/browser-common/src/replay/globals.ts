import { window } from '../utils/globals'
import type { DeferredStylesheetStats, MutationCost, SnapshotCost } from './rrweb-types'
import type { rrwebRecord } from './rrweb'
import type { RecordPlugin } from './rrweb-types'
import type { NetworkRecordOptions } from '../index'

interface ReplayGlobals {
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

export const replayWindow = window as (Window & { __PosthogExtensions__?: ReplayGlobals }) | undefined
