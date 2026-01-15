import { useState, useEffect, useRef } from 'preact/hooks'
import * as Preact from 'preact'
import { PostHog } from '../../../posthog-core'
import { createLogger } from '../../../utils/logger'
import { document as _document } from '../../../utils/globals'
import { StartFeedbackRecordingUI } from './StartFeedbackRecordingUI'
import { removeFeedbackRecordingUIFromDOM, retrieveFeedbackRecordingUIShadow } from '../feedback-recording-utils'

const logger = createLogger('[PostHog FeedbackManager]')

const document = _document as Document

export interface FeedbackRecordingUIProps {
    posthogInstance: PostHog
    handleStartRecording: () => Promise<string>
    onRecordingEnded: (feedbackId: string) => void
    onCancel?: () => void
}

export function FeedbackRecordingUI({
    posthogInstance,
    handleStartRecording,
    onRecordingEnded,
    onCancel,
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
            // Create audio element for playback (outside shadow DOM to avoid rrweb quirks)
            const audioElement = document.createElement('audio')
            audioElement.id = `posthog-feedback-audio-${feedbackId}`
            audioElement.style.display = 'none'
            audioElement.src = posthogInstance.requestRouter.endpointFor(
                'api',
                `/api/feedback/audio/${encodeURIComponent(feedbackId)}/download?token=${encodeURIComponent(posthogInstance.config?.token || '')}`
            )
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
                    handleCancel={() => {
                        removeFeedbackRecordingUIFromDOM()
                        onCancel?.()
                    }}
                    handleStart={handleStart}
                />
            )}
        </div>
    )
}

export const renderFeedbackRecordingUI = ({
    posthogInstance,
    handleStartRecording,
    onRecordingEnded,
    onCancel,
}: {
    posthogInstance: PostHog
    handleStartRecording: () => Promise<string>
    onRecordingEnded: (feedbackId: string) => Promise<void>
    onCancel?: () => void
}): void => {
    const { shadow } = retrieveFeedbackRecordingUIShadow()
    return Preact.render(
        <FeedbackRecordingUI
            posthogInstance={posthogInstance}
            handleStartRecording={handleStartRecording}
            onRecordingEnded={onRecordingEnded}
            onCancel={onCancel}
        />,
        shadow
    )
}
