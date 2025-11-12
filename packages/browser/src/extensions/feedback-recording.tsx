import * as Preact from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { isNull } from '@posthog/core'
import { createLogger } from '../utils/logger'
import { uuidv7 } from '../uuidv7'
import { document as _document, window as _window, assignableWindow } from '../utils/globals'
import feedbackRecordingStyles from './feedback-recording.css'
import { RequestResponse, UserFeedbackRecordingResult } from '../types'
import { PostHog } from '../posthog-core'

const logger = createLogger('[PostHog FeedbackManager]')

const MAX_AUDIO_SIZE = 10 * 1024 * 1024 // 10MB limit to match backend

const window = _window as Window & typeof globalThis
const document = _document as Document

export class FeedbackRecordingManager {
    private _feedbackRecordingId: string | null = null
    private _mediaRecorder: MediaRecorder | null = null
    private _audioChunks: Blob[] = []
    private _stream: MediaStream | null = null
    private _isLoaded: boolean = false
    private _isLoading: boolean = false

    constructor(private _instance: PostHog) {
        // Check if we're in the extension context (loaded from bundle)
        this._isLoaded = !!assignableWindow?.__PosthogExtensions__?.generateFeedbackRecording
    }

    getCurrentFeedbackRecordingId(): string | null {
        return this._feedbackRecordingId
    }

    isFeedbackRecordingActive(): boolean {
        return !isNull(this._feedbackRecordingId)
    }

    async launchFeedbackRecordingUI(onRecordingEnded?: (result: UserFeedbackRecordingResult) => void): Promise<void> {
        // Check for active recording first
        if (this._feedbackRecordingId) {
            logger.warn(
                `Feedback recording is already in progress with id ${this._feedbackRecordingId}. Request to start a new recording will be ignored.`
            )
            return
        }

        // Handle lazy loading if not loaded yet
        if (!this._isLoaded) {
            if (this._isLoading) {
                logger.info('Feedback recording is already loading...')
                return
            }

            await this._loadFeedbackRecording()
            if (!this._isLoaded) {
                logger.error('Failed to load feedback recording')
                return
            }
        }

        this._showFeedbackRecordingUI(onRecordingEnded || (() => {}))
    }

    private async _loadFeedbackRecording(): Promise<void> {
        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            logger.error('PostHog Extensions not found')
            return
        }

        if (phExtensions.generateFeedbackRecording) {
            // Already loaded
            this._isLoaded = true
            return
        }

        if (!phExtensions.loadExternalDependency) {
            logger.error('PostHog loadExternalDependency extension not found')
            return
        }

        this._isLoading = true

        // eslint-disable-next-line compat/compat
        return new Promise((resolve) => {
            phExtensions.loadExternalDependency!(this._instance, 'feedback-recording', (err) => {
                this._isLoading = false
                if (err || !phExtensions.generateFeedbackRecording) {
                    logger.error('Could not load feedback recording script', err)
                    this._isLoaded = false
                } else {
                    logger.info('Feedback recording loaded successfully')
                    this._isLoaded = true
                }
                resolve()
            })
        })
    }

    async _startFeedbackRecording(): Promise<string> {
        const feedbackId = uuidv7()
        this._feedbackRecordingId = feedbackId

        this._instance.capture('$user_feedback_recording_started', {
            $feedback_recording_id: feedbackId,
        })

        try {
            await this._startAudioRecording()
        } catch (error) {
            logger.warn('Failed to start audio recording:', error)
        }

        //TODO: at the moment always just start recording - we can mess with this later
        // by storing whether reocrding is already in progress so we know whether to stop it later
        this._instance.startSessionRecording(true)

        return feedbackId
    }

    private async _startAudioRecording(): Promise<void> {
        // Check if audio recording is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            //TODO: we could handle this better by notifying the caller/user
            // but at least we'll still record their screen!
            logger.info('Audio recording not supported in this browser')
            return
        }

        try {
            // eslint-disable-next-line compat/compat
            this._stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            this._audioChunks = []

            // Determine the best supported MIME type for this browser
            const supportedTypes = ['audio/webm', 'audio/mp4']
            let selectedMimeType = 'audio/webm' // fallback

            for (const mimeType of supportedTypes) {
                if (MediaRecorder.isTypeSupported(mimeType)) {
                    selectedMimeType = mimeType
                    break
                }
            }

            // eslint-disable-next-line compat/compat
            this._mediaRecorder = new MediaRecorder(this._stream, { mimeType: selectedMimeType })

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
            const mimeType = this._audioChunks.length > 0 ? this._audioChunks[0].type : 'audio/webm'
            const audioBlob = new Blob(this._audioChunks, { type: mimeType })
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

    private _handleStopped(feedbackRecordingId: string): UserFeedbackRecordingResult {
        this._instance.capture('$user_feedback_recording_stopped', {
            $feedback_recording_id: feedbackRecordingId,
        })

        return { feedback_id: feedbackRecordingId, session_id: this._instance.get_session_id() }
    }

    private _uploadAudioBlob(feedbackId: string, audioBlob: Blob): void {
        if (audioBlob.size > MAX_AUDIO_SIZE) {
            logger.error(`Audio blob too large: ${audioBlob.size} bytes (max: ${MAX_AUDIO_SIZE})`)
            return
        }

        const reader = new FileReader()
        reader.onload = () => {
            if (typeof reader.result !== 'string') {
                logger.error('FileReader result is not a string')
                return
            }
            const base64Data = reader.result.split(',')[1] // Remove data:audio/webm;base64, prefix

            const url = this._instance.requestRouter.endpointFor('api', `/api/feedback/audio`)

            this._instance._send_request({
                method: 'POST',
                url,
                data: {
                    token: this._instance.config.token,
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
        reader.onerror = () => {
            logger.error(`Failed to read audio blob for feedback ${feedbackId}:`, reader.error)
        }
        reader.readAsDataURL(audioBlob)
    }

    private _stopFeedbackRecording() {
        this._feedbackRecordingId = null
    }

    private _showFeedbackRecordingUI(onRecordingEnded: (result: UserFeedbackRecordingResult) => void) {
        const _onRecordingEnded = (feedbackId: string) => {
            // Stop audio recording and handle the blob internally
            this._stopAudioRecording((audioBlob) => {
                if (audioBlob) {
                    logger.info(`Audio recording completed, blob size: ${audioBlob.size} bytes`)
                    this._uploadAudioBlob(feedbackId, audioBlob)
                }

                this._stopFeedbackRecording()
                removeFeedbackRecordingUIFromDOM()
                onRecordingEnded(this._handleStopped(feedbackId))
            })
        }
        const { shadow } = retrieveFeedbackRecordingUIShadow()
        return Preact.render(
            <FeedbackRecordingUI
                posthogInstance={this._instance}
                handleStartRecording={() => this._startFeedbackRecording()}
                onRecordingEnded={_onRecordingEnded}
            />,
            shadow
        )
    }
}

const removeFeedbackRecordingUIFromDOM = () => {
    const existingDiv = document.querySelector('div.PostHogFeedbackRecordingWidget')
    if (existingDiv && existingDiv.parentNode) {
        existingDiv.parentNode.removeChild(existingDiv)
    }
}

export const retrieveFeedbackRecordingUIShadow = (element?: Element) => {
    const className = 'PostHogFeedbackRecordingWidget'

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
    posthogInstance: PostHog
    handleStartRecording: () => Promise<string>
    onRecordingEnded: (feedbackId: string) => void
}

export function FeedbackRecordingUI({
    posthogInstance,
    handleStartRecording,
    onRecordingEnded,
}: FeedbackRecordingUIProps) {
    const [seconds, setSeconds] = useState(0)
    const [isRecording, setRecording] = useState(false)
    const [feedbackId, setFeedbackId] = useState<string | null>(null)
    const audioElementRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null

        if (isRecording) {
            interval = setInterval(() => {
                setSeconds((prev) => prev + 1)
            }, 1000)
        }

        return () => {
            if (interval) {
                clearInterval(interval)
            }
        }
    }, [isRecording])

    // Manage audio element outside shadow DOM
    useEffect(() => {
        const cleanupAudioElement = () => {
            if (audioElementRef.current) {
                audioElementRef.current.remove()
                audioElementRef.current = null
            }
        }

        if (isRecording && feedbackId && !audioElementRef.current) {
            // Create audio element for playback (outside shadow DOM)
            const audioElement = document.createElement('audio')
            audioElement.id = `posthog-feedback-audio-${feedbackId}`
            audioElement.style.display = 'none'
            audioElement.src = `/api/feedback/audio/${encodeURIComponent(feedbackId)}/download?token=${encodeURIComponent(posthogInstance.config?.token || '')}`
            audioElement.autoplay = true
            audioElement.setAttribute('data-feedback-id', feedbackId)
            audioElement.setAttribute('data-posthog-recording', 'true')

            document.body.appendChild(audioElement)
            audioElementRef.current = audioElement
        } else if (!isRecording) {
            cleanupAudioElement()
        }

        // Cleanup on unmount or dependency change
        return cleanupAudioElement
    }, [isRecording, feedbackId, posthogInstance.config?.token])

    const formatTime = (totalSeconds: number) => {
        const minutes = Math.floor(totalSeconds / 60)
        const seconds = totalSeconds % 60
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }

    const handleStop = () => {
        if (onRecordingEnded && feedbackId) {
            onRecordingEnded(feedbackId)
        }
        setRecording(false)
        setSeconds(0)
    }

    const handleStart = async () => {
        try {
            const feedbackId = await handleStartRecording()
            setFeedbackId(feedbackId)
            setRecording(true)
            setSeconds(0)
        } catch (error) {
            logger.warn('Failed to start feedback recording:', error)
            setRecording(false)
            setSeconds(0)
        }
    }

    return (
        <div className={`feedback-recording-overlay${isRecording ? ' recording' : ''}`}>
            {isRecording ? (
                <div>
                    <div className="feedback-recording-border" />
                    <div className="feedback-recording-toolbar">
                        <div className="audio-indicator">
                            <div className="wave-bar"></div>
                            <div className="wave-bar"></div>
                            <div className="wave-bar"></div>
                            <div className="wave-bar"></div>
                        </div>
                        <button className="stop-button" onClick={handleStop}>
                            <div className="stop-icon"></div>
                        </button>
                        <span className="timer">{formatTime(seconds)}</span>
                    </div>
                </div>
            ) : (
                <StartFeedbackRecordingUI
                    handleCancel={() => removeFeedbackRecordingUIFromDOM()}
                    handleStart={handleStart}
                />
            )}
        </div>
    )
}

export function StartFeedbackRecordingUI({
    handleStart,
    handleCancel,
}: {
    handleStart?: () => void
    handleCancel?: () => void
} = {}) {
    return (
        <div className="feedback-recording-modal">
            <h2 className="feedback-recording-title">Record your screen</h2>
            <p className="feedback-recording-description">
                Record your screen to explain more about the issue you are facing. PostHog support will be able to watch
                this back and listen to audio - so feel free to talk us through the problem as you go!
            </p>
            <div className="feedback-recording-buttons">
                <button className="feedback-recording-button feedback-recording-button-start" onClick={handleStart}>
                    Start Recording
                </button>
                <button className="feedback-recording-button feedback-recording-button-cancel" onClick={handleCancel}>
                    Cancel
                </button>
            </div>
        </div>
    )
}

export const getStylesheet = () => {
    const stylesheet = prepareStylesheet(document)
    stylesheet?.setAttribute('data-ph-feedback-recording-ui-style', 'true')
    return stylesheet
}

// Extension generator function for the extension system
export function generateFeedbackRecording(posthog: PostHog): FeedbackRecordingManager {
    return new FeedbackRecordingManager(posthog)
}

//TODO: this is repeated code from extensions utils
export const prepareStylesheet = (document: Document) => {
    const stylesheet = document.createElement('style')
    stylesheet.innerText = typeof feedbackRecordingStyles === 'string' ? feedbackRecordingStyles : ''
    return stylesheet
}
