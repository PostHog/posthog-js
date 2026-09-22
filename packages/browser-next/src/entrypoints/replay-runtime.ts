import {
    record,
    wasMaxDepthReached,
    resetMaxDepthState,
    getLastSnapshotCost,
    getMutationCost,
    getDeferredStylesheetStats,
    getDiscardedDurationSamples,
    getObserverInitFailures,
    resetSnapshotCostState,
} from '@posthog/rrweb-record'
import { getRecordConsolePlugin } from '@posthog/rrweb-plugin-console-record'
import { getRecordNetworkPlugin } from '@posthog/browser-common/replay/external/network-plugin'
import { LazyLoadedSessionRecording } from '@posthog/browser-common/replay/external/lazy-loaded-session-recorder'
import type { ReplayRuntime } from '@posthog/browser-common/replay/runtime'
import type { ReplayOptions, ReplayRecorderClient } from '@posthog/browser-common/replay/host'

const runtime: ReplayRuntime = {
    rrweb: {
        // The shared rrweb mirrors permit explicit undefined on optional fields.
        record: record as unknown as NonNullable<ReplayRuntime['rrweb']>['record'],
        version: 'v2',
        wasMaxDepthReached,
        resetMaxDepthState,
        getLastSnapshotCost,
        getMutationCost,
        getDeferredStylesheetStats,
        getDiscardedDurationSamples,
        getObserverInitFailures,
        resetSnapshotCostState,
    },
    rrwebPlugins: {
        getRecordConsolePlugin: getRecordConsolePlugin as NonNullable<
            ReplayRuntime['rrwebPlugins']
        >['getRecordConsolePlugin'],
        getRecordNetworkPlugin,
    },
}

export const createRecorder = (
    client: ReplayRecorderClient,
    options: () => ReplayOptions,
    visible: boolean
): LazyLoadedSessionRecording => new LazyLoadedSessionRecording(client, options, visible, runtime)
