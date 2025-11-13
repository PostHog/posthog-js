import { FeedbackRecordingManager, generateFeedbackRecording } from '../../extensions/feedback-recording'
import * as FeedbackUI from '../../extensions/feedback-recording/components/FeedbackRecordingUI'
import { PostHog } from '../../posthog-core'
import { assignableWindow } from '../../utils/globals'
import { createPosthogInstance } from '../helpers/posthog-instance'
import { uuidv7 } from '../../uuidv7'
import { AudioRecorder } from '../../extensions/feedback-recording/audio-recorder'
import '@testing-library/jest-dom'

jest.mock('../../extensions/feedback-recording/components/FeedbackRecordingUI')

describe('FeedbackRecordingManager', () => {
    let instance: PostHog
    let manager: FeedbackRecordingManager
    let audioRecorderMock: jest.Mocked<AudioRecorder>
    let loadScriptMock: jest.Mock

    beforeEach(async () => {
        // mock the renderFeedbackRecordingUI function

        loadScriptMock = jest.fn()
        loadScriptMock.mockImplementation((_ph, _path, callback) => {
            assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
            assignableWindow.__PosthogExtensions__.generateFeedbackRecording = generateFeedbackRecording
            callback()
        })

        assignableWindow.__PosthogExtensions__ = {
            loadExternalDependency: loadScriptMock,
        }

        instance = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'test-token',
        })

        // Create a properly mocked AudioRecorder
        audioRecorderMock = {
            startRecording: jest.fn().mockResolvedValue(undefined),
            stopRecording: jest.fn().mockResolvedValue(null),
            cancelRecording: jest.fn().mockResolvedValue(undefined),
            isRecording: jest.fn().mockReturnValue(false),
            isSupported: jest.fn().mockReturnValue(true),
            getSupportedMimeTypes: jest.fn().mockReturnValue(['audio/webm']),
        } as unknown as jest.Mocked<AudioRecorder>

        manager = new FeedbackRecordingManager(instance, audioRecorderMock)

        // Mock instance methods
        jest.spyOn(instance, 'capture').mockImplementation(jest.fn())
        jest.spyOn(instance, 'startSessionRecording').mockImplementation(jest.fn())
        jest.spyOn(instance, 'get_session_id').mockReturnValue('mock-session-id')
    })

    it('should initialize with PostHog instance', () => {
        expect(manager).toBeInstanceOf(FeedbackRecordingManager)
        expect(manager.getCurrentFeedbackRecordingId()).toBeNull()
        expect(manager.isFeedbackRecordingActive()).toBe(false)
    })

    describe('renderFeedbackRecordingUI', () => {
        it('should call renderFeedbackRecordingUI with correct props', () => {
            //TODO: this should probably test the call made to Preact
        })
    })

    describe('launchFeedbackRecordingUI', () => {
        beforeEach(() => {
            // reset mocks
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

        describe('returning a callback which starts a recording', () => {
            it('calls the correct audio recording methods', async () => {
                await manager.launchFeedbackRecordingUI()

                const handleStartRecording = FeedbackUI.renderFeedbackRecordingUI.mock.lastCall[0].handleStartRecording

                await handleStartRecording()

                expect(audioRecorderMock.startRecording).toHaveBeenCalledTimes(1)
                expect(manager.isFeedbackRecordingActive()).toBe(true)
                expect(manager.getCurrentFeedbackRecordingId()).not.toBeNull()
            })

            it('captures an event when recording starts', async () => {
                await manager.launchFeedbackRecordingUI()

                const handleStartRecording = FeedbackUI.renderFeedbackRecordingUI.mock.lastCall[0].handleStartRecording

                const feedbackId = await handleStartRecording()

                expect(instance.capture).toHaveBeenCalledWith('$user_feedback_recording_started', {
                    $feedback_recording_id: feedbackId,
                })
            })
        })

        describe('onRecordingEnded can be used to stop and upload the recording', () => {
            it('returns a callback which stops a recording', async () => {
                const onRecordingEnded = jest.fn()

                await manager.launchFeedbackRecordingUI(onRecordingEnded)

                const handleStartRecording = FeedbackUI.renderFeedbackRecordingUI.mock.lastCall[0].handleStartRecording

                const feedbackId = await handleStartRecording()

                const stopCallback = FeedbackUI.renderFeedbackRecordingUI.mock.lastCall[0].onRecordingEnded

                await stopCallback(feedbackId)

                expect(audioRecorderMock.stopRecording).toHaveBeenCalledTimes(1)
                expect(onRecordingEnded).toHaveBeenCalledTimes(1)
                expect(manager.isFeedbackRecordingActive()).toBe(false)
                expect(manager.getCurrentFeedbackRecordingId()).toBeNull()
            })

            it('captures an event when recording stops', async () => {
                const onRecordingEnded = jest.fn()

                await manager.launchFeedbackRecordingUI(onRecordingEnded)

                const handleStartRecording = FeedbackUI.renderFeedbackRecordingUI.mock.lastCall[0].handleStartRecording

                const feedbackId = await handleStartRecording()

                const stopCallback = FeedbackUI.renderFeedbackRecordingUI.mock.lastCall[0].onRecordingEnded

                await stopCallback(feedbackId)

                expect(instance.capture).toHaveBeenCalledWith('$user_feedback_recording_stopped', {
                    $feedback_recording_id: feedbackId,
                })
            })
        })
    })

    describe('generateFeedbackRecording', () => {
        it('should create a new FeedbackRecordingManager instance', () => {
            const result = generateFeedbackRecording(instance)

            expect(result).toBeInstanceOf(FeedbackRecordingManager)
        })
    })
})
