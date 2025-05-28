import { record as rrwebRecord } from '@posthog/rrweb-record'
import { getRecordConsolePlugin } from '@posthog/rrweb-plugin-console-record'
import { assignableWindow } from '../utils/globals'
import { getRecordNetworkPlugin } from '../extensions/replay/external/network-plugin'
import { PostHog } from '../posthog-core'
import { window } from '../utils/globals'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.rrwebPlugins = { getRecordConsolePlugin, getRecordNetworkPlugin }
assignableWindow.__PosthogExtensions__.rrweb = { record: rrwebRecord, version: 'v2' }
assignableWindow.__PosthogExtensions__.__Replay__ = assignableWindow.__PosthogExtensions__.__Replay__ || {}
/**
 * called when the session id changes, attempts to add the replay URL to Intercom
 * relies on the Intercom script being loaded in the page
 * and available at window.Intercom
 */
assignableWindow.__PosthogExtensions__.__Replay__.addReplayUrlToIntercom = (posthog: PostHog) => {
    try {
        const replayUrl = posthog.get_session_replay_url()
        if (!replayUrl) {
            return
        }
        const intercom = (window as any).Intercom
        if (!intercom) {
            return
        }
        intercom('update', {
            posthogRecordingURL: replayUrl,
        })
        intercom('trackEvent', 'PostHog Recording URL', { sessionURL: replayUrl })
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[PostHog Recorder] Error adding replay URL to Intercom', e)
    }
}

// we used to put all of these items directly on window, and now we put it on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put them directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.rrweb = { record: rrwebRecord, version: 'v2' }
assignableWindow.rrwebConsoleRecord = { getRecordConsolePlugin }
assignableWindow.getRecordNetworkPlugin = getRecordNetworkPlugin

export default rrwebRecord
