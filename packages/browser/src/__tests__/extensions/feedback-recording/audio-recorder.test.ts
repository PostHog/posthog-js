import { AudioRecorder } from '../../../extensions/feedback-recording/audio-recorder'

interface MockMediaRecorderClass extends jest.MockedClass<typeof MediaRecorder> {
    isTypeSupported: jest.MockedFunction<typeof MediaRecorder.isTypeSupported>
}

describe('AudioRecorder', () => {
    let mockMediaStream: MediaStream
    let mockMediaRecorder: MediaRecorder
    let mockMediaDevices: MediaDevices
    let MockMediaRecorderClass: MockMediaRecorderClass

    beforeEach(() => {
        mockMediaStream = {
            getTracks: jest.fn(() => [{ stop: jest.fn() }]),
        } as unknown as MediaStream

        mockMediaRecorder = {
            start: jest.fn(),
            stop: jest.fn(),
            state: 'inactive',
            ondataavailable: null,
            onstop: null,
        } as unknown as MediaRecorder

        MockMediaRecorderClass = Object.assign(
            jest.fn().mockImplementation(() => mockMediaRecorder),
            {
                isTypeSupported: jest.fn() as jest.MockedFunction<typeof MediaRecorder.isTypeSupported>,
            }
        ) as MockMediaRecorderClass

        mockMediaDevices = {
            getUserMedia: jest.fn().mockResolvedValue(mockMediaStream),
        } as unknown as MediaDevices
    })

    describe('isSupported', () => {
        it('should return true when all APIs are available', () => {
            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)
            expect(recorder.isSupported()).toBe(true)
        })

        it('should return false when MediaRecorder is not available', () => {
            const recorder = new AudioRecorder({}, mockMediaDevices, undefined as any)
            expect(recorder.isSupported()).toBe(false)
        })
    })

    describe('getSupportedMimeTypes', () => {
        it('should return supported types in order of preference', () => {
            MockMediaRecorderClass.isTypeSupported
                .mockReturnValueOnce(true) // audio/webm
                .mockReturnValueOnce(false) // audio/mp4

            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)
            const supportedTypes = recorder.getSupportedMimeTypes()

            expect(supportedTypes).toEqual(['audio/webm'])
            expect(MockMediaRecorderClass.isTypeSupported).toHaveBeenCalledWith('audio/webm')
            expect(MockMediaRecorderClass.isTypeSupported).toHaveBeenCalledWith('audio/mp4')
        })

        it('should respect custom preferred types', () => {
            MockMediaRecorderClass.isTypeSupported.mockReturnValue(true)

            const recorder = new AudioRecorder(
                {
                    preferredMimeTypes: ['audio/ogg', 'audio/webm'],
                },
                mockMediaDevices,
                MockMediaRecorderClass
            )

            const supportedTypes = recorder.getSupportedMimeTypes()

            expect(supportedTypes).toEqual(['audio/ogg', 'audio/webm'])
        })

        it('should return empty array when not supported', () => {
            const recorder = new AudioRecorder({}, undefined as any, MockMediaRecorderClass)
            expect(recorder.getSupportedMimeTypes()).toEqual([])
        })
    })

    describe('startRecording', () => {
        it('should successfully start recording', async () => {
            MockMediaRecorderClass.isTypeSupported.mockReturnValue(true)

            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)
            await recorder.startRecording()

            expect(mockMediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
            expect(MockMediaRecorderClass).toHaveBeenCalledWith(mockMediaStream, { mimeType: 'audio/webm' })
            expect(mockMediaRecorder.start).toHaveBeenCalledWith(1000) // default chunk interval
        })

        it('should use custom chunk interval', async () => {
            MockMediaRecorderClass.isTypeSupported.mockReturnValue(true)

            const recorder = new AudioRecorder(
                {
                    chunkInterval: 500,
                },
                mockMediaDevices,
                MockMediaRecorderClass
            )
            await recorder.startRecording()

            expect(mockMediaRecorder.start).toHaveBeenCalledWith(500)
        })

        it('should throw error when not supported', async () => {
            const recorder = new AudioRecorder({}, undefined as any, MockMediaRecorderClass)

            await expect(recorder.startRecording()).rejects.toThrow('Audio recording not supported')
        })

        it('should handle getUserMedia failure', async () => {
            MockMediaRecorderClass.isTypeSupported.mockReturnValue(true)
            mockMediaDevices.getUserMedia = jest.fn().mockRejectedValue(new Error('Permission denied'))

            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)

            await expect(recorder.startRecording()).rejects.toThrow('Permission denied')
        })

        it('should not start new recording if already recording', async () => {
            MockMediaRecorderClass.isTypeSupported.mockReturnValue(true)

            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)

            // First start
            await recorder.startRecording()

            // Verify first recording started
            expect(mockMediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
            expect(MockMediaRecorderClass).toHaveBeenCalledTimes(1)
            expect(mockMediaRecorder.start).toHaveBeenCalledTimes(1)

            // Set the MediaRecorder state to 'recording' after it's been created
            Object.defineProperty(mockMediaRecorder, 'state', {
                value: 'recording',
                configurable: true,
            })

            // Second start should be ignored
            await recorder.startRecording()

            // Verify no additional calls were made - recording was ignored
            expect(mockMediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
            expect(MockMediaRecorderClass).toHaveBeenCalledTimes(1)
            expect(mockMediaRecorder.start).toHaveBeenCalledTimes(1)
        })
    })

    describe('stopRecording', () => {
        it('should stop recording and return audio blob', async () => {
            MockMediaRecorderClass.isTypeSupported.mockReturnValue(true)

            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)
            await recorder.startRecording()

            // Mock MediaRecorder state to be 'recording' so stopRecording doesn't exit early
            Object.defineProperty(mockMediaRecorder, 'state', {
                value: 'recording',
                configurable: true,
            })

            // Mock recorded chunks
            const mockChunk = new Blob(['audio data'], { type: 'audio/webm; codecs=opus' })
            ;(recorder as any)._audioChunks = [mockChunk]

            // Simulate stop
            const stopPromise = recorder.stopRecording()

            // Trigger onstop event
            if (mockMediaRecorder.onstop) {
                mockMediaRecorder.onstop({} as Event)
            }

            const result = await stopPromise

            expect(result).toEqual({
                blob: expect.any(Blob),
                mimeType: 'audio/webm; codecs=opus', // Should use actual chunk MIME type
                durationMs: expect.any(Number),
            })
            expect(mockMediaRecorder.stop).toHaveBeenCalled()
        })

        it('should return null if no active recording', async () => {
            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)
            const result = await recorder.stopRecording()
            expect(result).toBeNull()
        })

        it('should clean up resources after stopping', async () => {
            MockMediaRecorderClass.isTypeSupported.mockReturnValue(true)
            const stopTrackSpy = jest.fn()

            // Set up our mock stream that will be returned by getUserMedia
            const mockStreamWithSpy = {
                getTracks: jest.fn(() => [{ stop: stopTrackSpy }]),
            } as unknown as MediaStream

            mockMediaDevices.getUserMedia = jest.fn().mockResolvedValue(mockStreamWithSpy)

            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)
            await recorder.startRecording()

            // Mock MediaRecorder state to be 'recording' so stopRecording doesn't exit early
            Object.defineProperty(mockMediaRecorder, 'state', {
                value: 'recording',
                configurable: true,
            })

            // Start the stop process
            const stopPromise = recorder.stopRecording()

            // The onstop callback should be set by stopRecording()
            expect(mockMediaRecorder.onstop).toBeTruthy()

            // Manually trigger the onstop event with correct context
            mockMediaRecorder.onstop!.call(mockMediaRecorder, {} as Event)

            // Wait for the stop to complete
            await stopPromise

            // Now verify cleanup happened
            expect(stopTrackSpy).toHaveBeenCalled()
            expect(recorder.isRecording()).toBe(false)
        })
    })

    describe('cancelRecording', () => {
        it('should cancel recording and clean up', async () => {
            MockMediaRecorderClass.isTypeSupported.mockReturnValue(true)

            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)

            // Start recording first
            await recorder.startRecording()

            // Mock the state as recording
            Object.defineProperty(mockMediaRecorder, 'state', { value: 'recording' })

            await recorder.cancelRecording()

            expect(mockMediaRecorder.stop).toHaveBeenCalled()
        })

        it('should not call stop if not recording', async () => {
            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)
            await recorder.cancelRecording()

            expect(mockMediaRecorder.stop).not.toHaveBeenCalled()
        })
    })

    describe('isRecording', () => {
        it('should return true when recording', () => {
            Object.defineProperty(mockMediaRecorder, 'state', { value: 'recording' })

            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)
            ;(recorder as any)._mediaRecorder = mockMediaRecorder

            expect(recorder.isRecording()).toBe(true)
        })

        it('should return false when not recording', () => {
            const recorder = new AudioRecorder({}, mockMediaDevices, MockMediaRecorderClass)
            expect(recorder.isRecording()).toBe(false)
        })
    })
})
