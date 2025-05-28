import { record as rrwebRecord } from '@rrweb/record'
import { getRecordConsolePlugin } from '@rrweb/rrweb-plugin-console-record'
import { getRecordNetworkPlugin } from '../extensions/replay/external/network-plugin'
import { assignableWindow } from '../utils/globals'
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
            // eslint-disable-next-line no-console
            console.warn('[PostHog Recorder] No replay URL found')
            return
        }
        const intercom = (window as any).Intercom
        if (!intercom) {
            // eslint-disable-next-line no-console
            console.warn('[PostHog Recorder] No Intercom found')
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
