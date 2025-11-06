import * as Preact from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { isNull } from '@posthog/core'
import { createLogger } from './utils/logger'
import { uuidv7 } from './uuidv7'
import { document as _document, window as _window } from './utils/globals'
import feedbackRecordingStyles from './feedback-recording.css'
import { RequestResponse } from './types'

const logger = createLogger('[PostHog FeedbackManager]')

const window = _window as Window & typeof globalThis
const document = _document as Document

export class FeedbackRecordingManager {
    private _feedback_recording_id: string | null = null
    private _mediaRecorder: MediaRecorder | null = null
    private _audioChunks: Blob[] = []
    private _stream: MediaStream | null = null

    constructor(private _instance: any) {} // PostHog instance

    getCurrentFeedbackRecordingId(): string | null {
        return this._feedback_recording_id
    }

    isFeedbackRecordingActive(): boolean {
        return !isNull(this._feedback_recording_id)
    }

    async startFeedbackRecording(onRecordingEnded?: (feedback_id: string, audioBlob?: Blob) => void): Promise<string> {
        if (this._feedback_recording_id) {
            logger.warn(
                `Feedback recording is already in progress with id ${this._feedback_recording_id}. Request to start a new recording will be ignored.`
            )
            return this._feedback_recording_id
        }
        this._feedback_recording_id = uuidv7()

        try {
            await this._startAudioRecording()
        } catch (error) {
            logger.warn('Failed to start audio recording:', error)
        }

        this.showFeedbackRecordingUI(onRecordingEnded || (() => {}))

        return this._feedback_recording_id
    }

    private async _startAudioRecording(): Promise<void> {
        // Check if audio recording is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            logger.info('Audio recording not supported in this browser')
            return
        }

        try {
            // Create off-screen audio element for rrweb capture
            this._createAudioElement()

            // eslint-disable-next-line compat/compat
            this._stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            this._audioChunks = []

            // eslint-disable-next-line compat/compat
            this._mediaRecorder = new MediaRecorder(this._stream)

            this._mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this._audioChunks.push(event.data)
                }
            }

            this._mediaRecorder.start(1000) // Collect data every second
            logger.info('Audio recording started')
        } catch (error) {
            logger.error('Failed to start audio recording:', error)
        }
    }

    private _stopAudioRecording(callback?: (audioBlob: Blob | null) => void): void {
        if (!this._mediaRecorder) {
            if (callback) callback(null)
            return
        }

        this._mediaRecorder.onstop = () => {
            const audioBlob = new Blob(this._audioChunks, { type: 'audio/webm' })
            this._audioChunks = []

            if (this._stream) {
                this._stream.getTracks().forEach((track) => track.stop())
                this._stream = null
            }

            this._mediaRecorder = null
            logger.info('Audio recording stopped')
            if (callback) callback(audioBlob)
        }

        this._mediaRecorder.stop()
    }

    private _uploadAudioBlob(feedbackId: string, audioBlob: Blob): void {
        const reader = new FileReader()
        reader.onload = () => {
            const base64Data = (reader.result as string).split(',')[1] // Remove data:audio/webm;base64, prefix

            const url = this._instance.requestRouter.endpointFor('feedback', '/feedback/audio/')

            this._instance._send_request({
                method: 'POST',
                url,
                data: {
                    feedback_id: feedbackId,
                    audio_data: base64Data,
                    audio_mime_type: audioBlob.type,
                    audio_size: audioBlob.size,
                },
                callback: (response: RequestResponse) => {
                    if (response.statusCode === 200) {
                        logger.info(`Audio upload successful for feedback ${feedbackId}`)
                    } else {
                        logger.error(`Audio upload failed for feedback ${feedbackId}:`, response.text)
                    }
                },
            })
        }
        reader.readAsDataURL(audioBlob)
    }

    private _createAudioElement(): void {
        // Create hidden audio element for rrweb to capture
        const audio = document.createElement('audio')
        audio.id = `posthog-feedback-audio-${this._feedback_recording_id}`
        audio.style.display = 'none'
        audio.src = '{template}' // Placeholder URL for server replacement
        audio.autoplay = true // Auto-start during rrweb replay
        document.body.appendChild(audio)
    }

    private _removeAudioElement(): void {
        const audioElement = document.getElementById(`posthog-feedback-audio-${this._feedback_recording_id}`)
        if (audioElement && audioElement.parentNode) {
            audioElement.parentNode.removeChild(audioElement)
        }
    }

    private _stopFeedbackRecording() {
        this._removeAudioElement()
        this._feedback_recording_id = null
    }

    showFeedbackRecordingUI(onRecordingEnded: (feedback_id: string) => void) {
        const feedback_id = this._feedback_recording_id

        const _onRecordingEnded = () => {
            // Stop audio recording and handle the blob internally
            this._stopAudioRecording((audioBlob) => {
                if (audioBlob) {
                    logger.info(`Audio recording completed, blob size: ${audioBlob.size} bytes`)
                    this._uploadAudioBlob(feedback_id!, audioBlob)
                }

                this._stopFeedbackRecording()
                removeFeedbackRecordingUIFromDOM()
                onRecordingEnded(feedback_id!)
            })
        }
        const { shadow } = retrieveFeedbackRecordingUIShadow()
        return Preact.render(<FeedbackRecordingUI onRecordingEnded={_onRecordingEnded} />, shadow)
    }
}

const removeFeedbackRecordingUIFromDOM = () => {
    const existingDiv = document.querySelector('div.PostHogFeedbackRecordingWidget')
    if (existingDiv && existingDiv.parentNode) {
        existingDiv.parentNode.removeChild(existingDiv)
    }
}

export const retrieveFeedbackRecordingUIShadow = (element?: Element) => {
    const className = 'PostHogFeedbackRecordingWidget ph-no-capture'

    const div = document.createElement('div')
    div.className = className
    const shadow = div.attachShadow({ mode: 'open' })
    const stylesheet = getStylesheet()
    if (stylesheet) {
        const existingStylesheet = shadow.querySelector('style')
        if (existingStylesheet) {
            shadow.removeChild(existingStylesheet)
        }
        shadow.appendChild(stylesheet)
    }
    ;(element ? element : document.body).appendChild(div)
    return {
        shadow,
        isNewlyCreated: true,
    }
}

interface FeedbackRecordingUIProps {
    onRecordingEnded?: () => void
}

export function FeedbackRecordingUI({ onRecordingEnded }: FeedbackRecordingUIProps = {}) {
    const [seconds, setSeconds] = useState(0)

    useEffect(() => {
        const interval = setInterval(() => {
            setSeconds((prev) => prev + 1)
        }, 1000)

        return () => clearInterval(interval)
    }, [])

    const formatTime = (totalSeconds: number) => {
        const minutes = Math.floor(totalSeconds / 60)
        const seconds = totalSeconds % 60
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }

    const handleStop = () => {
        if (onRecordingEnded) {
            onRecordingEnded()
        }
    }

    return (
        <div className="feedback-recording-overlay">
            <div className="feedback-recording-border"></div>
            <div className="feedback-recording-toolbar">
                <button className="stop-button" onClick={handleStop}>
                    ⏹
                </button>
                <span className="timer">{formatTime(seconds)}</span>
            </div>
        </div>
    )
}

export const getStylesheet = () => {
    const stylesheet = prepareStylesheet(document)
    stylesheet?.setAttribute('data-ph-feedback-recording-ui-style', 'true')
    return stylesheet
}

//TODO: this is repeated code from extensions utils
export const prepareStylesheet = (document: Document) => {
    const stylesheet = document.createElement('style')
    stylesheet.innerText = typeof feedbackRecordingStyles === 'string' ? feedbackRecordingStyles : ''
    return stylesheet
}
