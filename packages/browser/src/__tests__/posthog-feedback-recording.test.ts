import { PostHogFeedbackRecording } from '../posthog-feedback-recording'
import { generateFeedbackRecording } from '../extensions/feedback-recording'
import * as FeedbackUI from '../extensions/feedback-recording/components/FeedbackRecordingUI'
import { PostHog } from '../posthog-core'
import { RemoteConfig } from '../types'
import { assignableWindow } from '../utils/globals'
import { createMockPostHog } from './helpers/posthog-instance'

jest.mock('../extensions/feedback-recording/components/FeedbackRecordingUI')

let mockAudioRecorder: any

jest.mock('../extensions/feedback-recording/audio-recorder', () => ({
    AudioRecorder: jest.fn().mockImplementation(() => mockAudioRecorder),
}))

describe('PostHogFeedbackRecording', () => {
    let instance: PostHog
    let manager: PostHogFeedbackRecording
    let loadScriptMock: jest.Mock

    beforeEach(() => {
        mockAudioRecorder = {
            startRecording: jest.fn().mockResolvedValue(undefined),
            stopRecording: jest.fn().mockResolvedValue(null),
            cancelRecording: jest.fn().mockResolvedValue(undefined),
            isRecording: jest.fn().mockReturnValue(false),
            isSupported: jest.fn().mockReturnValue(true),
            getSupportedMimeTypes: jest.fn().mockReturnValue(['audio/webm']),
        }

        loadScriptMock = jest.fn()
        loadScriptMock.mockImplementation((_ph, _path, callback) => {
            assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
            assignableWindow.__PosthogExtensions__.generateFeedbackRecording = generateFeedbackRecording
            callback()
        })

        assignableWindow.__PosthogExtensions__ = {
            loadExternalDependency: loadScriptMock,
        }

        instance = createMockPostHog({
            config: {
                api_host: 'https://test.com',
                token: 'test-token',
                _experimental_disable_feedback_recording: false,
                disable_session_recording: false,
            } as any,
            capture: jest.fn(),
            startSessionRecording: jest.fn(),
            stopSessionRecording: jest.fn(),
            sessionRecordingStarted: jest.fn(),
            get_session_id: jest.fn().mockReturnValue('mock-session-id'),
            _send_request: jest.fn(),
            requestRouter: {
                endpointFor: jest.fn().mockReturnValue('https://test.com/api/feedback/audio'),
            } as any,
            sessionRecording: {} as any,
        })

        manager = new PostHogFeedbackRecording(instance)

        // Enable feedback recording via remote config for most tests
        manager.onRemoteConfig({ feedbackRecording: true } as RemoteConfig)
    })

    afterEach(() => {
        if (assignableWindow.__PosthogExtensions__) {
            delete assignableWindow.__PosthogExtensions__.generateFeedbackRecording
        }

        jest.clearAllTimers()
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    it('should initialize with PostHog instance', () => {
        expect(manager).toBeInstanceOf(PostHogFeedbackRecording)
        expect(manager.getCurrentFeedbackRecordingId()).toBeNull()
        expect(manager.isFeedbackRecordingActive()).toBe(false)
    })

    describe('onRemoteConfig', () => {
        it('should not enable feedback recording if disabled via config', () => {
            instance.config._experimental_disable_feedback_recording = true
            const newManager = new PostHogFeedbackRecording(instance)

            newManager.onRemoteConfig({ feedbackRecording: true } as RemoteConfig)

            // Even though server says enabled, config disables it
            // We can verify by trying to launch - it should not work
            expect(newManager.isFeedbackRecordingActive()).toBe(false)
        })

        it('should enable feedback recording when server returns true', () => {
            instance.config._experimental_disable_feedback_recording = false
            const newManager = new PostHogFeedbackRecording(instance)

            newManager.onRemoteConfig({ feedbackRecording: true } as RemoteConfig)

            // Manager should now allow launching
            expect(newManager.isFeedbackRecordingActive()).toBe(false) // Not active yet, but enabled
        })

        it('should not enable feedback recording when server returns false', () => {
            instance.config._experimental_disable_feedback_recording = false
            const newManager = new PostHogFeedbackRecording(instance)

            newManager.onRemoteConfig({ feedbackRecording: false } as RemoteConfig)

            expect(newManager.isFeedbackRecordingActive()).toBe(false)
        })

        it('should not enable feedback recording when server returns undefined', () => {
            instance.config._experimental_disable_feedback_recording = false
            const newManager = new PostHogFeedbackRecording(instance)

            newManager.onRemoteConfig({} as RemoteConfig)

            expect(newManager.isFeedbackRecordingActive()).toBe(false)
        })
    })

    describe('launchFeedbackRecordingUI - feature flag checks', () => {
        beforeEach(() => {
            jest.clearAllMocks()
        })

        it('should not launch UI when disabled via config', async () => {
            instance.config._experimental_disable_feedback_recording = true
            const newManager = new PostHogFeedbackRecording(instance)
            newManager.onRemoteConfig({ feedbackRecording: true } as RemoteConfig)

            await newManager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).not.toHaveBeenCalled()
        })

        it('should not launch UI when remote config not loaded yet', async () => {
            instance.config._experimental_disable_feedback_recording = false
            const newManager = new PostHogFeedbackRecording(instance)
            // Don't call onRemoteConfig - simulating remote config not loaded yet

            await newManager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).not.toHaveBeenCalled()
        })

        it('should not launch UI when not enabled server-side', async () => {
            instance.config._experimental_disable_feedback_recording = false
            const newManager = new PostHogFeedbackRecording(instance)
            newManager.onRemoteConfig({ feedbackRecording: false } as RemoteConfig)

            await newManager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).not.toHaveBeenCalled()
        })

        it('should not launch UI when session recording is disabled', async () => {
            instance.config._experimental_disable_feedback_recording = false
            instance.config.disable_session_recording = true
            const newManager = new PostHogFeedbackRecording(instance)
            newManager.onRemoteConfig({ feedbackRecording: true } as RemoteConfig)

            await newManager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).not.toHaveBeenCalled()
        })

        it('should not launch UI when session recording is not loaded', async () => {
            instance.config._experimental_disable_feedback_recording = false
            instance.config.disable_session_recording = false
            ;(instance as any).sessionRecording = undefined
            const newManager = new PostHogFeedbackRecording(instance)
            newManager.onRemoteConfig({ feedbackRecording: true } as RemoteConfig)

            await newManager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).not.toHaveBeenCalled()
        })

        it('should launch UI when enabled in both config and server-side', async () => {
            instance.config._experimental_disable_feedback_recording = false
            instance.config.disable_session_recording = false
            const newManager = new PostHogFeedbackRecording(instance)
            newManager.onRemoteConfig({ feedbackRecording: true } as RemoteConfig)

            await newManager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalled()
        })
    })

    describe('launchFeedbackRecordingUI - lazy loading', () => {
        beforeEach(() => {
            jest.clearAllMocks()
        })

        it('should handle loading state correctly', async () => {
            expect(assignableWindow.__PosthogExtensions__?.generateFeedbackRecording).toBeUndefined()

            await manager.launchFeedbackRecordingUI(jest.fn())

            expect(assignableWindow.__PosthogExtensions__?.generateFeedbackRecording).toBeDefined()
            expect(loadScriptMock).toHaveBeenCalledTimes(1)
            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalled()

            // Clean up UI active state so second launch can proceed
            manager.cleanup()

            // if called again, should not load again
            await manager.launchFeedbackRecordingUI(jest.fn())
            expect(loadScriptMock).toHaveBeenCalledTimes(1)
            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(2)
        })

        it('should not launch UI when loading fails', async () => {
            assignableWindow.__PosthogExtensions__ = {
                loadExternalDependency: jest.fn((_ph, _name, cb) => {
                    cb('Load failed')
                }),
            }

            const callback = jest.fn()
            await manager.launchFeedbackRecordingUI(callback)

            // UI should not be rendered when loading fails
            expect(FeedbackUI.renderFeedbackRecordingUI).not.toHaveBeenCalled()
        })

        it('should handle concurrent loading attempts', async () => {
            const promise1 = manager.launchFeedbackRecordingUI(jest.fn())
            const promise2 = manager.launchFeedbackRecordingUI(jest.fn())

            await Promise.all([promise1, promise2])

            expect(assignableWindow.__PosthogExtensions__?.loadExternalDependency).toHaveBeenCalledTimes(1)
        })
    })

    describe('launchFeedbackRecordingUI - UI active state', () => {
        beforeEach(() => {
            jest.clearAllMocks()
        })

        it('should prevent multiple simultaneous UIs from being launched', async () => {
            await manager.launchFeedbackRecordingUI(jest.fn())

            await manager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(1)
        })

        it('should not launch UI when recording is already in progress', async () => {
            await manager.launchFeedbackRecordingUI(jest.fn())

            // Start a recording to make it active
            const handleStartRecording = (
                FeedbackUI.renderFeedbackRecordingUI as jest.MockedFunction<typeof FeedbackUI.renderFeedbackRecordingUI>
            ).mock.lastCall![0].handleStartRecording
            await handleStartRecording()

            expect(manager.isFeedbackRecordingActive()).toBe(true)

            // Second launch should be ignored
            await manager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(1)
        })

        it('should allow launching UI again after recording completes', async () => {
            jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(false)

            await manager.launchFeedbackRecordingUI(jest.fn())

            const handleStartRecording = (
                FeedbackUI.renderFeedbackRecordingUI as jest.MockedFunction<typeof FeedbackUI.renderFeedbackRecordingUI>
            ).mock.lastCall![0].handleStartRecording
            const stopCallback = (
                FeedbackUI.renderFeedbackRecordingUI as jest.MockedFunction<typeof FeedbackUI.renderFeedbackRecordingUI>
            ).mock.lastCall![0].onRecordingEnded

            const feedbackId = await handleStartRecording()
            await stopCallback(feedbackId)

            await manager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(2)
        })

        it('should allow launching UI again after cancellation', async () => {
            await manager.launchFeedbackRecordingUI(jest.fn())

            const onCancel = (
                FeedbackUI.renderFeedbackRecordingUI as jest.MockedFunction<typeof FeedbackUI.renderFeedbackRecordingUI>
            ).mock.lastCall![0].onCancel
            onCancel?.()

            await manager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(2)
        })

        it('should allow launching UI again after cleanup', async () => {
            await manager.launchFeedbackRecordingUI(jest.fn())

            manager.cleanup()

            await manager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(2)
        })
    })
})
