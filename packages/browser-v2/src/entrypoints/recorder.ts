// This file is kept only for backwards compatibility.
// In almost every case, if you are manually importing a file you should use posthog-recorder instead.

import { record as rrwebRecord, wasMaxDepthReached, resetMaxDepthState } from '@posthog/rrweb-record'
import { getRecordConsolePlugin } from '@posthog/rrweb-plugin-console-record'
import { getRecordNetworkPlugin } from '../extensions/replay/external/network-plugin'
import { assignableWindow } from '../utils/globals'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.rrwebPlugins = { getRecordConsolePlugin, getRecordNetworkPlugin }
assignableWindow.__PosthogExtensions__.rrweb = {
    record: rrwebRecord,
    version: 'v2',
    wasMaxDepthReached,
    resetMaxDepthState,
}

export default rrwebRecord
