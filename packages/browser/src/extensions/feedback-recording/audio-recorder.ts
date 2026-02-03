import { createLogger } from '../../utils/logger'
import { window as _window } from '../../utils/globals'
import { isFunction } from '@posthog/core'

const logger = createLogger('[PostHog AudioRecorder]')
const window = _window as Window & typeof globalThis

export interface AudioRecordingResult {
    blob: Blob
    mimeType: string
    durationMs: number
}

export interface AudioRecorderConfig {
    preferredMimeTypes?: string[]
    chunkInterval?: number
}

export class AudioRecorder {
    private _mediaRecorder: MediaRecorder | null = null
    private _audioChunks: Blob[] = []
    private _stream: MediaStream | null = null
    private _startTime: number = 0
    private _recordedMimeType: string = 'audio/webm'

    constructor(
        private _config: AudioRecorderConfig = {},
        // eslint-disable-next-line compat/compat
        private _mediaDevices: MediaDevices = navigator.mediaDevices,
        private _MediaRecorderClass = window.MediaRecorder
    ) {}

    /**
     * Check if audio recording is supported in this browser
     */
    isSupported(): boolean {
        return !!(
            this._mediaDevices &&
            this._MediaRecorderClass &&
            isFunction(this._MediaRecorderClass.isTypeSupported)
        )
    }

    /**
     * Get list of supported MIME types in order of preference
     */
    getSupportedMimeTypes(): string[] {
        if (!this.isSupported()) {
            return []
        }

        const preferredTypes = this._config.preferredMimeTypes || ['audio/webm', 'audio/mp4']
        const supportedTypes: string[] = []

        for (const mimeType of preferredTypes) {
            if (this._MediaRecorderClass.isTypeSupported(mimeType)) {
                supportedTypes.push(mimeType)
            }
        }

        return supportedTypes
    }

    /**
     * Start audio recording
     */
    async startRecording(): Promise<void> {
        if (!this.isSupported()) {
            logger.warn('Audio recording not supported in this browser')
            return
        }

        if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
            logger.warn('Audio recording already in progress')
            return
        }

        try {
            // this will request microphone access from the user
            this._stream = await this._mediaDevices.getUserMedia({ audio: true })
            this._audioChunks = []
            this._startTime = Date.now()

            const supportedTypes = this.getSupportedMimeTypes()
            this._recordedMimeType = supportedTypes.length > 0 ? supportedTypes[0] : 'audio/webm'

            this._mediaRecorder = new this._MediaRecorderClass(this._stream, {
                mimeType: this._recordedMimeType,
            })

            this._mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this._audioChunks.push(event.data)
                }
            }

            const chunkInterval = this._config.chunkInterval || 1000
            this._mediaRecorder.start(chunkInterval)

            logger.info(`Audio recording started with MIME type: ${this._recordedMimeType}`)
        } catch (error) {
            logger.error('Failed to start audio recording:', error)
            this._cleanup()
            throw error
        }
    }

    /**
     * Stop audio recording and return the result
     */
    async stopRecording(): Promise<AudioRecordingResult | null> {
        if (!this._mediaRecorder || this._mediaRecorder.state === 'inactive') {
            logger.warn('No active audio recording to stop')
            return null
        }

        // eslint-disable-next-line compat/compat
        return new Promise((resolve) => {
            if (!this._mediaRecorder) {
                resolve(null)
                return
            }

            this._mediaRecorder.onstop = () => {
                const endTime = Date.now()
                const durationMs = endTime - this._startTime

                // Use actual MIME type from chunks if available
                const actualMimeType = this._audioChunks.length > 0 ? this._audioChunks[0].type : this._recordedMimeType

                const blob = new Blob(this._audioChunks, { type: actualMimeType })

                const result: AudioRecordingResult = {
                    blob,
                    mimeType: actualMimeType,
                    durationMs,
                }

                logger.info(
                    `Audio recording stopped. Duration: ${durationMs}ms, Size: ${blob.size} bytes, Type: ${actualMimeType}`
                )

                this._cleanup()
                resolve(result)
            }

            this._mediaRecorder.stop()
        })
    }

    /**
     * Cancel ongoing recording without returning data
     */
    async cancelRecording(): Promise<void> {
        if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
            this._mediaRecorder.stop()
        }
        this._cleanup()
        logger.info('Audio recording cancelled')
    }

    /**
     * Check if currently recording
     */
    isRecording(): boolean {
        return this._mediaRecorder?.state === 'recording'
    }

    /**
     * Clean up resources
     */
    private _cleanup(): void {
        if (this._stream) {
            this._stream.getTracks().forEach((track) => track.stop())
            this._stream = null
        }

        this._mediaRecorder = null
        this._audioChunks = []
        this._startTime = 0
    }
}
