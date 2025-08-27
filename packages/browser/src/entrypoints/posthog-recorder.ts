import { record as rrwebRecord } from '@posthog/rrweb-record'
import { getRecordConsolePlugin } from '@posthog/rrweb-plugin-console-record'
import { assignableWindow } from '../utils/globals'
import { getRecordNetworkPlugin } from '../extensions/replay/external/network-plugin'
import { LazyLoadedSessionRecording } from '../extensions/replay/external/lazy-loaded-session-recorder'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
// capture as a variable to try and help with bundling
const extensions = assignableWindow.__PosthogExtensions__
extensions.rrwebPlugins = { getRecordConsolePlugin, getRecordNetworkPlugin }
extensions.rrweb = { record: rrwebRecord, version: 'v2' }
extensions.initSessionRecording = (ph) => new LazyLoadedSessionRecording(ph)

// we used to put all of these items directly on window, and now we put it on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put them directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.rrweb = { record: rrwebRecord, version: 'v2' }
assignableWindow.rrwebConsoleRecord = { getRecordConsolePlugin }
assignableWindow.getRecordNetworkPlugin = getRecordNetworkPlugin

export default rrwebRecord
