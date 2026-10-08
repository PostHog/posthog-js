import { RRDocument } from 'rrdom-nodejs'
import { RRWebPluginCanvasWebRTCRecord } from '@posthog/rrweb-plugin-canvas-webrtc-record'
import type { Exception, SeverityLevel } from '@posthog/core/error-tracking'
import { severityLevels } from '@posthog/core/error-tracking'
type Levels = typeof severityLevels
const levels: Levels = ['fatal', 'error', 'warning', 'log', 'info', 'debug']
// @ts-expect-error This barrel must continue to expose severityLevels only as a type.
void severityLevels
void levels

const document = new RRDocument()
const element = document.createElement('div')
document.appendChild(element)
const selected: ReturnType<typeof document.querySelectorAll> = document.querySelectorAll('div')
void selected
const selectedByEngine: Element[] = document.nwsapi.select('div')
// @ts-expect-error The exposed selector engine must not become any.
document.nwsapi.select(123)
void selectedByEngine

const plugin = new RRWebPluginCanvasWebRTCRecord({
    signalSendCallback(signal: RTCSessionDescriptionInit) {
        void signal.sdp
    },
})
const peer = plugin.setupPeer()
const connected: boolean = peer.connected
peer.signal({ type: 'offer', sdp: 'test' })
peer.send(new Uint8Array([1]))
peer.on('stream', (stream) => {
    const id: string = stream.id
    void id
})
new RRWebPluginCanvasWebRTCRecord({ peer, signalSendCallback() {} })
// @ts-expect-error The public peer must not become any.
peer.send(123)
// @ts-expect-error The constructor must still require a complete peer.
new RRWebPluginCanvasWebRTCRecord({ peer: {}, signalSendCallback() {} })
void connected

const level: SeverityLevel = 'error'
const exception: Exception = { type: 'Error', value: 'test', mechanism: { handled: true } }
// @ts-expect-error Severity levels remain constrained.
const invalidLevel: SeverityLevel = 'invalid'
void level
void exception
void invalidLevel
