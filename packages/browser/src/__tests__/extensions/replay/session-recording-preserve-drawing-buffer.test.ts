import { SessionRecording } from '../../../extensions/replay/session-recording'
import { forcePreserveDrawingBuffer } from '../../../extensions/replay/preserve-drawing-buffer'
import { SESSION_RECORDING_REMOTE_CONFIG } from '../../../constants'
import { createMockPostHog } from '../../helpers/posthog-instance'
import { PostHogConfig } from '../../../types'
import { isUndefined } from '@posthog/core'

jest.mock('../../../extensions/replay/preserve-drawing-buffer', () => ({
    forcePreserveDrawingBuffer: jest.fn(),
}))

describe('SessionRecording preserving canvas drawing buffers', () => {
    beforeEach(() => {
        jest.mocked(forcePreserveDrawingBuffer).mockClear()
    })

    const preserveDrawingBuffersFor = ({
        clientSide,
        serverSide,
        disableSessionRecording = false,
        optedOut = false,
    }: {
        clientSide?: boolean
        serverSide?: boolean
        disableSessionRecording?: boolean
        optedOut?: boolean
    }): boolean => {
        const instance = createMockPostHog({
            config: {
                token: 'test-token',
                api_host: 'https://test.com',
                disable_session_recording: disableSessionRecording,
                session_recording: isUndefined(clientSide) ? {} : { captureCanvas: { recordCanvas: clientSide } },
            } as PostHogConfig,
            sessionManager: {} as any,
            consent: { isOptedOut: () => optedOut } as any,
            get_property: (key: string) =>
                key === SESSION_RECORDING_REMOTE_CONFIG ? { canvasRecording: { enabled: serverSide } } : undefined,
        })

        // exercised through initialize(), the same entry point posthog.init() uses
        new SessionRecording(instance)['_preserveCanvasDrawingBuffers']()

        return jest.mocked(forcePreserveDrawingBuffer).mock.calls.length > 0
    }

    it('patches when canvas recording is asked for client side, with nothing persisted yet', () => {
        // the first-ever page load: no remote config has been stored, so this must not wait for one
        expect(preserveDrawingBuffersFor({ clientSide: true })).toBe(true)
    })

    it('patches when a persisted remote config has canvas recording on', () => {
        expect(preserveDrawingBuffersFor({ serverSide: true })).toBe(true)
    })

    it('does not patch when nothing has canvas recording on', () => {
        expect(preserveDrawingBuffersFor({})).toBe(false)
        expect(preserveDrawingBuffersFor({ clientSide: false })).toBe(false)
        expect(preserveDrawingBuffersFor({ serverSide: false })).toBe(false)
    })

    it('lets a client side false override a persisted remote config', () => {
        expect(preserveDrawingBuffersFor({ clientSide: false, serverSide: true })).toBe(false)
    })

    it('does not patch when session recording is disabled or consent was refused', () => {
        expect(preserveDrawingBuffersFor({ clientSide: true, disableSessionRecording: true })).toBe(false)
        expect(preserveDrawingBuffersFor({ serverSide: true, disableSessionRecording: true })).toBe(false)
        expect(preserveDrawingBuffersFor({ clientSide: true, optedOut: true })).toBe(false)
    })
})
