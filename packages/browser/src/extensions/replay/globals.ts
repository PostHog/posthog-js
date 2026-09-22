import { window } from '@posthog/browser-common/utils/globals'
import type { DeferredStylesheetStats, MutationCost, SnapshotCost } from '@posthog/browser-common/replay/rrweb-types'
import type { rrwebRecord } from './rrweb'
import type { RecordPlugin } from '@posthog/browser-common/replay/rrweb-types'
import type { NetworkRecordOptions } from '@posthog/browser-common'

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
