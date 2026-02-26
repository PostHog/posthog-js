import LazyLoadedFeedbackRecording from '../../entrypoints/feedback-recording'
import * as FeedbackUI from '../../extensions/feedback-recording/components/FeedbackRecordingUI'
import { PostHog } from '../../posthog-core'
import { createMockPostHog } from '../helpers/posthog-instance'
import { assignableWindow } from '../../utils/globals'
import '@testing-library/jest-dom'

jest.mock('../../extensions/feedback-recording/components/FeedbackRecordingUI')

let mockAudioRecorder: any

jest.mock('../../extensions/feedback-recording/audio-recorder', () => ({
    AudioRecorder: jest.fn().mockImplementation(() => mockAudioRecorder),
}))

describe('LazyLoadedFeedbackRecording', () => {
    let instance: PostHog
    let recorder: LazyLoadedFeedbackRecording
    let originalFileReader: typeof FileReader

    beforeEach(() => {
        originalFileReader = global.FileReader

        mockAudioRecorder = {
            startRecording: jest.fn().mockResolvedValue(undefined),
            stopRecording: jest.fn().mockResolvedValue(null),
            cancelRecording: jest.fn().mockResolvedValue(undefined),
            isRecording: jest.fn().mockReturnValue(false),
            isSupported: jest.fn().mockReturnValue(true),
            getSupportedMimeTypes: jest.fn().mockReturnValue(['audio/webm']),
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

        recorder = new LazyLoadedFeedbackRecording(instance)
    })

    afterEach(() => {
        global.FileReader = originalFileReader
        jest.clearAllTimers()
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    it('should initialize with PostHog instance', () => {
        expect(recorder).toBeInstanceOf(LazyLoadedFeedbackRecording)
        expect(recorder.getCurrentFeedbackRecordingId()).toBeNull()
        expect(recorder.isFeedbackRecordingActive()).toBe(false)
    })

    describe('launchFeedbackRecordingUI', () => {
        it('should render UI with correct props', () => {
            const onRecordingEnded = jest.fn()
            const onCancel = jest.fn()
            recorder.launchFeedbackRecordingUI(onRecordingEnded, onCancel)

            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledTimes(1)
            expect(FeedbackUI.renderFeedbackRecordingUI).toHaveBeenCalledWith(
                expect.objectContaining({
                    posthogInstance: instance,
                    handleStartRecording: expect.any(Function),
                    onRecordingEnded: expect.any(Function),
                    onCancel: expect.any(Function),
                })
            )

            expect(recorder.isFeedbackRecordingActive()).toBe(false)
            expect(onRecordingEnded).not.toHaveBeenCalled()
        })

        describe('recording workflow', () => {
            let handleStartRecording: () => Promise<string>
            let stopCallback: (feedbackId: string) => Promise<void>
            let cancelCallback: () => void
            let feedbackId: string
            let onRecordingEnded: jest.Mock
            let onCancel: jest.Mock

            beforeEach(() => {
                jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(false)

                onRecordingEnded = jest.fn()
                onCancel = jest.fn()
                recorder.launchFeedbackRecordingUI(onRecordingEnded, onCancel)

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
                cancelCallback = (
                    FeedbackUI.renderFeedbackRecordingUI as jest.MockedFunction<
                        typeof FeedbackUI.renderFeedbackRecordingUI
                    >
                ).mock.lastCall![0].onCancel!
            })

            describe('start', () => {
                it('calls the correct audio recording methods when starting', async () => {
                    feedbackId = await handleStartRecording()

                    expect(mockAudioRecorder.startRecording).toHaveBeenCalledTimes(1)
                    expect(recorder.isFeedbackRecordingActive()).toBe(true)
                    expect(recorder.getCurrentFeedbackRecordingId()).toBe(feedbackId)
                })

                it('captures an event when recording starts', async () => {
                    feedbackId = await handleStartRecording()

                    expect(instance.capture).toHaveBeenCalledWith('$user_feedback_recording_started', {
                        $feedback_recording_id: feedbackId,
                    })
                })

                it('continues recording even if audio recording fails', async () => {
                    mockAudioRecorder.startRecording.mockRejectedValue(new Error('Audio not supported'))

                    feedbackId = await handleStartRecording()

                    expect(recorder.isFeedbackRecordingActive()).toBe(true)
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

                    expect(mockAudioRecorder.stopRecording).toHaveBeenCalledTimes(1)
                    expect(onRecordingEnded).toHaveBeenCalledTimes(1)
                    expect(recorder.isFeedbackRecordingActive()).toBe(false)
                    expect(recorder.getCurrentFeedbackRecordingId()).toBeNull()
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
                    mockAudioRecorder.stopRecording.mockResolvedValue({
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
                    mockAudioRecorder.stopRecording.mockResolvedValue({
                        blob: null,
                        mimeType: 'audio/webm',
                        durationMs: 0,
                    } as any)

                    feedbackId = await handleStartRecording()
                    await stopCallback(feedbackId)

                    expect(instance._send_request).not.toHaveBeenCalled()
                    expect(onRecordingEnded).toHaveBeenCalledTimes(1)
                    expect(recorder.isFeedbackRecordingActive()).toBe(false)
                })

                it('does not upload when audio blob is too large', async () => {
                    const largeMockBlob = { size: 11 * 1024 * 1024, type: 'audio/webm' } as Blob
                    mockAudioRecorder.stopRecording.mockResolvedValue({
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
                    mockAudioRecorder.stopRecording.mockResolvedValue({
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

            describe('cancel', () => {
                it('should reset state and call onCancel callback', async () => {
                    feedbackId = await handleStartRecording()
                    expect(recorder.isFeedbackRecordingActive()).toBe(true)

                    cancelCallback()

                    expect(onCancel).toHaveBeenCalledTimes(1)
                    expect(recorder.isFeedbackRecordingActive()).toBe(false)
                    expect(recorder.getCurrentFeedbackRecordingId()).toBeNull()
                })
            })

            describe('cleanup', () => {
                it('should cancel audio recording if in progress', async () => {
                    feedbackId = await handleStartRecording()

                    mockAudioRecorder.isRecording.mockReturnValue(true)

                    recorder.cleanup()

                    expect(mockAudioRecorder.cancelRecording).toHaveBeenCalled()
                })

                it('should clear feedback recording state', async () => {
                    feedbackId = await handleStartRecording()

                    expect(recorder.isFeedbackRecordingActive()).toBe(true)

                    recorder.cleanup()

                    expect(recorder.isFeedbackRecordingActive()).toBe(false)
                    expect(recorder.getCurrentFeedbackRecordingId()).toBeNull()
                })

                it('stops session recording when stopping if we started it', async () => {
                    jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(false)

                    feedbackId = await handleStartRecording()

                    recorder.cleanup()

                    expect(instance.stopSessionRecording).toHaveBeenCalled()
                })

                it('does not stop session recording if we did not start it', async () => {
                    jest.spyOn(instance, 'sessionRecordingStarted').mockReturnValue(true)

                    feedbackId = await handleStartRecording()

                    recorder.cleanup()

                    expect(instance.stopSessionRecording).not.toHaveBeenCalled()
                })
            })
        })
    })

    describe('initFeedbackRecording', () => {
        it('should register initFeedbackRecording on __PosthogExtensions__', () => {
            expect(assignableWindow.__PosthogExtensions__?.initFeedbackRecording).toBeDefined()
        })

        it('should create a new LazyLoadedFeedbackRecording instance', () => {
            const result = assignableWindow.__PosthogExtensions__?.initFeedbackRecording?.(instance)

            expect(result).toBeInstanceOf(LazyLoadedFeedbackRecording)
        })
    })
})
