import { FeedbackRecordingManager, generateFeedbackRecording } from '../../extensions/feedback-recording'
import * as FeedbackUI from '../../extensions/feedback-recording/components/FeedbackRecordingUI'
import { PostHog } from '../../posthog-core'
import { assignableWindow } from '../../utils/globals'
import { createMockPostHog } from '../helpers/posthog-instance'
import { AudioRecorder } from '../../extensions/feedback-recording/audio-recorder'
import '@testing-library/jest-dom'

jest.mock('../../extensions/feedback-recording/components/FeedbackRecordingUI')

describe('FeedbackRecordingManager', () => {
    let instance: PostHog
    let manager: FeedbackRecordingManager
    let audioRecorderMock: jest.Mocked<AudioRecorder>
    let loadScriptMock: jest.Mock
    let originalFileReader: typeof FileReader

    beforeEach(() => {
        originalFileReader = global.FileReader
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
        })

        audioRecorderMock = {
            startRecording: jest.fn().mockResolvedValue(undefined),
            stopRecording: jest.fn().mockResolvedValue(null),
            cancelRecording: jest.fn().mockResolvedValue(undefined),
            isRecording: jest.fn().mockReturnValue(false),
            isSupported: jest.fn().mockReturnValue(true),
            getSupportedMimeTypes: jest.fn().mockReturnValue(['audio/webm']),
        } as unknown as jest.Mocked<AudioRecorder>

        manager = new FeedbackRecordingManager(instance, audioRecorderMock)
    })

    afterEach(() => {
        global.FileReader = originalFileReader

        if (assignableWindow.__PosthogExtensions__) {
            delete assignableWindow.__PosthogExtensions__.generateFeedbackRecording
        }

        jest.clearAllTimers()
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    it('should initialize with PostHog instance', () => {
        expect(manager).toBeInstanceOf(FeedbackRecordingManager)
        expect(manager.getCurrentFeedbackRecordingId()).toBeNull()
        expect(manager.isFeedbackRecordingActive()).toBe(false)
    })

    describe('launchFeedbackRecordingUI', () => {
        beforeEach(() => {
            jest.clearAllMocks()
        })

        it('should handle loading state correctly', async () => {
            expect(assignableWindow.__PosthogExtensions__?.generateFeedbackRecording).toBeUndefined()

            await manager.launchFeedbackRecordingUI(jest.fn())

            expect(assignableWindow.__PosthogExtensions__?.generateFeedbackRecording).toBeDefined()
            expect(loadScriptMock).toHaveBeenCalledTimes(1)
            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalled()

            // if called again, should not load again
            await manager.launchFeedbackRecordingUI(jest.fn())
            expect(loadScriptMock).toHaveBeenCalledTimes(1)
            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalled()
        })

        it('should successfully launch UI when no recording is active', async () => {
            expect(manager.isFeedbackRecordingActive()).toBe(false)

            const callback = jest.fn()
            await manager.launchFeedbackRecordingUI(callback)

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(1)

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledWith(
                expect.objectContaining({
                    posthogInstance: instance,
                    handleStartRecording: expect.any(Function),
                    onRecordingEnded: expect.any(Function),
                })
            )

            // the recording is launched via the UI
            expect(manager.isFeedbackRecordingActive()).toBe(false)
            expect(callback).not.toHaveBeenCalled()
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

        it('should not launch UI when recording is already in progress', async () => {
            const callback1 = jest.fn()
            const callback2 = jest.fn()

            // First launch should succeed
            await manager.launchFeedbackRecordingUI(callback1)

            // Start a recording to make it active
            const handleStartRecording = (
                FeedbackUI.renderFeedbackRecordingUI as jest.MockedFunction<typeof FeedbackUI.renderFeedbackRecordingUI>
            ).mock.lastCall![0].handleStartRecording
            await handleStartRecording()

            expect(manager.isFeedbackRecordingActive()).toBe(true)

            // Second launch should be ignored
            await manager.launchFeedbackRecordingUI(callback2)

            // Should only have called renderFeedbackRecordingUI once (from first launch)
            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(1)
        })

        describe('recording workflow', () => {
            let handleStartRecording: () => Promise<string>
            let stopCallback: (feedbackId: string) => Promise<void>
            let onCancel: (() => void) | undefined
            let feedbackId: string
            let onRecordingEnded: jest.Mock

            beforeEach(async () => {
                jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(false)

                onRecordingEnded = jest.fn()
                await manager.launchFeedbackRecordingUI(onRecordingEnded)

                handleStartRecording = (
                    FeedbackUI.renderFeedbackRecordingUI as jest.MockedFunction<
                        typeof FeedbackUI.renderFeedbackRecordingUI
                    >
                ).mock.lastCall![0].handleStartRecording
                stopCallback = (
                    FeedbackUI.renderFeedbackRecordingUI as jest.MockedFunction<
                        typeof FeedbackUI.renderFeedbackRecordingUI
                    >
                ).mock.lastCall![0].onRecordingEnded
                onCancel = (
                    FeedbackUI.renderFeedbackRecordingUI as jest.MockedFunction<
                        typeof FeedbackUI.renderFeedbackRecordingUI
                    >
                ).mock.lastCall![0].onCancel
            })

            describe('start', () => {
                it('calls the correct audio recording methods when starting', async () => {
                    feedbackId = await handleStartRecording()

                    expect(audioRecorderMock.startRecording).toHaveBeenCalledTimes(1)
                    expect(manager.isFeedbackRecordingActive()).toBe(true)
                    expect(manager.getCurrentFeedbackRecordingId()).toBe(feedbackId)
                })

                it('captures an event when recording starts', async () => {
                    feedbackId = await handleStartRecording()

                    expect(instance.capture).toHaveBeenCalledWith('$user_feedback_recording_started', {
                        $feedback_recording_id: feedbackId,
                    })
                })

                it('continues recording even if audio recording fails', async () => {
                    audioRecorderMock.startRecording.mockRejectedValue(new Error('Audio not supported'))

                    feedbackId = await handleStartRecording()

                    expect(manager.isFeedbackRecordingActive()).toBe(true)
                    expect(instance.startSessionRecording).toHaveBeenCalledWith(true)
                    expect(instance.capture).toHaveBeenCalledWith('$user_feedback_recording_started', {
                        $feedback_recording_id: feedbackId,
                    })
                })

                it('starts session recording if not already active', async () => {
                    jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(false)

                    feedbackId = await handleStartRecording()

                    expect(instance.startSessionRecording).toHaveBeenCalledWith(true)
                })

                it('does not start session recording if already active', async () => {
                    jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(true)

                    feedbackId = await handleStartRecording()

                    expect(instance.startSessionRecording).not.toHaveBeenCalled()
                })
            })

            describe('stop', () => {
                beforeEach(() => {
                    jest.spyOn(instance, '_send_request')
                })

                it('stops recording and calls callback when ended', async () => {
                    feedbackId = await handleStartRecording()
                    await stopCallback(feedbackId)

                    expect(audioRecorderMock.stopRecording).toHaveBeenCalledTimes(1)
                    expect(onRecordingEnded).toHaveBeenCalledTimes(1)
                    expect(manager.isFeedbackRecordingActive()).toBe(false)
                    expect(manager.getCurrentFeedbackRecordingId()).toBeNull()
                })

                it('captures an event when recording stops', async () => {
                    feedbackId = await handleStartRecording()
                    await stopCallback(feedbackId)

                    expect(instance.capture).toHaveBeenCalledWith('$user_feedback_recording_stopped', {
                        $feedback_recording_id: feedbackId,
                    })
                })

                it('uploads the audio when recording stops', async () => {
                    const mockBlob = new Blob(['audio data'], { type: 'audio/webm' })
                    audioRecorderMock.stopRecording.mockResolvedValue({
                        blob: mockBlob,
                        mimeType: 'audio/webm',
                        durationMs: 5000,
                    })

                    const mockFileReader = {
                        readAsDataURL: jest.fn(),
                        result: 'data:audio/webm;base64,rest_of_data',
                        onload: null as any,
                        onerror: null as any,
                    }
                    global.FileReader = jest.fn(() => mockFileReader) as any

                    feedbackId = await handleStartRecording()
                    await stopCallback(feedbackId)

                    if (mockFileReader.onload) {
                        mockFileReader.onload()
                    }

                    expect(instance._send_request).toHaveBeenCalledWith({
                        method: 'POST',
                        url: 'https://test.com/api/feedback/audio',
                        callback: expect.any(Function),
                        data: {
                            token: instance.config.token,
                            feedback_id: feedbackId,
                            audio_data: 'rest_of_data',
                            audio_mime_type: 'audio/webm',
                            audio_size: mockBlob.size,
                        },
                    })
                })

                it('does not upload when no audio blob is returned', async () => {
                    audioRecorderMock.stopRecording.mockResolvedValue({
                        blob: null,
                        mimeType: 'audio/webm',
                        durationMs: 0,
                    } as any)

                    feedbackId = await handleStartRecording()
                    await stopCallback(feedbackId)

                    expect(instance._send_request).not.toHaveBeenCalled()
                    expect(onRecordingEnded).toHaveBeenCalledTimes(1)
                    expect(manager.isFeedbackRecordingActive()).toBe(false)
                })

                it('does not upload when audio blob is too large', async () => {
                    const largeMockBlob = { size: 11 * 1024 * 1024, type: 'audio/webm' } as Blob
                    audioRecorderMock.stopRecording.mockResolvedValue({
                        blob: largeMockBlob,
                        mimeType: 'audio/webm',
                        durationMs: 5000,
                    })

                    feedbackId = await handleStartRecording()
                    await stopCallback(feedbackId)

                    expect(instance._send_request).not.toHaveBeenCalled()
                    expect(onRecordingEnded).toHaveBeenCalledTimes(1)
                })

                it('handles FileReader errors during upload', async () => {
                    const mockBlob = new Blob(['audio data'], { type: 'audio/webm' })
                    audioRecorderMock.stopRecording.mockResolvedValue({
                        blob: mockBlob,
                        mimeType: 'audio/webm',
                        durationMs: 5000,
                    })

                    const mockFileReader = {
                        readAsDataURL: jest.fn(),
                        result: 'data:audio/webm;base64,rest_of_data',
                        onload: null as any,
                        onerror: null as any,
                        error: new Error('FileReader failed'),
                    }
                    global.FileReader = jest.fn(() => mockFileReader) as any

                    feedbackId = await handleStartRecording()
                    await stopCallback(feedbackId)

                    if (mockFileReader.onerror) {
                        mockFileReader.onerror()
                    }

                    expect(instance._send_request).not.toHaveBeenCalled()
                    expect(onRecordingEnded).toHaveBeenCalledTimes(1)
                })

                it('stops session recording when stopping if we started it', async () => {
                    jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(false)

                    feedbackId = await handleStartRecording()
                    await stopCallback(feedbackId)

                    expect(instance.stopSessionRecording).toHaveBeenCalled()
                })

                it('does not stop session recording if we did not start it', async () => {
                    jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(true)

                    feedbackId = await handleStartRecording()
                    await stopCallback(feedbackId)

                    expect(instance.stopSessionRecording).not.toHaveBeenCalled()
                })
            })

            describe('cleanup', () => {
                it('should cancel audio recording if in progress', async () => {
                    feedbackId = await handleStartRecording()

                    audioRecorderMock.isRecording.mockReturnValue(true)

                    manager.cleanup()

                    expect(audioRecorderMock.cancelRecording).toHaveBeenCalled()
                })

                it('should clear feedback recording state', async () => {
                    feedbackId = await handleStartRecording()

                    expect(manager.isFeedbackRecordingActive()).toBe(true)

                    manager.cleanup()

                    expect(manager.isFeedbackRecordingActive()).toBe(false)
                    expect(manager.getCurrentFeedbackRecordingId()).toBeNull()
                })

                it('stops session recording when stopping if we started it', async () => {
                    jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(false)

                    feedbackId = await handleStartRecording()

                    manager.cleanup()

                    expect(instance.stopSessionRecording).toHaveBeenCalled()
                })

                it('does not stop session recording if we did not start it', async () => {
                    jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(true)

                    feedbackId = await handleStartRecording()

                    manager.cleanup()

                    expect(instance.stopSessionRecording).not.toHaveBeenCalled()
                })
            })

            describe('UI focus after completion', () => {
                it('should allow launching UI again after recording completes', async () => {
                    feedbackId = await handleStartRecording()
                    await stopCallback(feedbackId)

                    await manager.launchFeedbackRecordingUI(jest.fn())

                    expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(2)
                })

                it('should allow launching UI again after cancellation', async () => {
                    onCancel?.()

                    await manager.launchFeedbackRecordingUI(jest.fn())

                    expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(2)
                })
            })
        })
    })

    describe('cleanup without recording', () => {
        it('should clear UI active state when called before recording starts', async () => {
            await manager.launchFeedbackRecordingUI(jest.fn())

            manager.cleanup()

            await manager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(2)
        })
    })

    describe('UI focus management', () => {
        it('should prevent multiple simultaneous UIs from being launched', async () => {
            await manager.launchFeedbackRecordingUI(jest.fn())

            await manager.launchFeedbackRecordingUI(jest.fn())

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(1)
        })
    })

    describe('generateFeedbackRecording', () => {
        it('should create a new FeedbackRecordingManager instance', () => {
            const result = generateFeedbackRecording(instance)

            expect(result).toBeInstanceOf(FeedbackRecordingManager)
        })
    })
})
