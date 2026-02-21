import { record as rrwebRecord } from '@posthog/rrweb-record'
import { getRecordConsolePlugin } from '@posthog/rrweb-plugin-console-record'
import { assignableWindow } from '../utils/globals'
import { getRecordNetworkPlugin } from '../extensions/replay/external/network-plugin'
import { LazyLoadedSessionRecording } from '../extensions/replay/external/lazy-loaded-session-recorder'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.rrwebPlugins = { getRecordConsolePlugin, getRecordNetworkPlugin }
assignableWindow.__PosthogExtensions__.rrweb = { record: rrwebRecord, version: 'v2' }
assignableWindow.__PosthogExtensions__.initSessionRecording = (ph) => new LazyLoadedSessionRecording(ph)

export default rrwebRecord
