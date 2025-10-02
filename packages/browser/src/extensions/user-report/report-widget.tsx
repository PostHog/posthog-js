import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { createLogger } from '../../utils/logger'
import { PostHog } from '../../posthog-core'
import { ReportDialogOptions } from './types'
import { window as _window } from '../../utils/globals'
import { ScreenshotCapture } from './screenshot-capture'
import { AnnotationOverlay } from './annotation-overlay'
import { addEventListener } from '../../utils'

const logger = createLogger('[UserReport.Widget]')

const window = _window as Window & typeof globalThis

interface ReportWidgetProps {
    posthog: PostHog
    options?: ReportDialogOptions
    onClose: () => void
}

export const ReportWidget = ({ posthog, options, onClose }: ReportWidgetProps) => {
    const [description, setDescription] = useState('')
    const [isSubmitted, setIsSubmitted] = useState(false)
    const [screenshot, setScreenshot] = useState<string | undefined>(options?.screenshot)
    const [isCapturing, setIsCapturing] = useState(false)
    const [escPressCount, setEscPressCount] = useState(0)
    const [showEscWarning, setShowEscWarning] = useState(false)

    useEffect(() => {
        logger.info('Report widget mounted')

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (screenshot) {
                    // When screenshot is present, require double ESC
                    setEscPressCount((prev) => prev + 1)

                    if (escPressCount === 0) {
                        // First ESC press - show warning
                        logger.info('First ESC press - showing warning')
                        setShowEscWarning(true)

                        // Hide warning after 2 seconds
                        setTimeout(() => setShowEscWarning(false), 2000)
                    } else {
                        // Second ESC press - close
                        logger.info('Second ESC press - closing dialog')
                        onClose()
                    }
                } else {
                    // No screenshot - close immediately
                    logger.info('ESC pressed, closing dialog')
                    onClose()
                }
            }
        }

        addEventListener(window, 'keydown', handleKeyDown as EventListener)

        // Reset ESC counter after 3 seconds of no presses
        const resetTimer = setTimeout(() => setEscPressCount(0), 3000)

        return () => {
            window?.removeEventListener('keydown', handleKeyDown)
            clearTimeout(resetTimer)
        }
    }, [onClose, screenshot, escPressCount])

    const handleBackdropClick = () => {
        logger.info('Backdrop clicked, closing dialog')
        onClose()
    }

    const handleModalClick = (e: MouseEvent) => {
        // Stop propagation to prevent backdrop click
        e.stopPropagation()
    }

    const dataUrlToFile = (dataUrl: string, filename: string): File => {
        // Extract base64 data from data URL
        const arr = dataUrl.split(',')
        const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png'
        const bstr = atob(arr[1])
        let n = bstr.length
        const u8arr = new Uint8Array(n)

        while (n--) {
            u8arr[n] = bstr.charCodeAt(n)
        }

        return new File([u8arr], filename, { type: mime })
    }

    const handleSubmit = () => {
        if (!description.trim()) {
            logger.warn('Cannot submit empty report')
            return
        }

        logger.info('Submitting report', { description, hasScreenshot: !!screenshot })

        try {
            // Convert screenshot data URL to File if present
            let screenshotFile: File | undefined = undefined
            if (screenshot) {
                screenshotFile = dataUrlToFile(screenshot, 'screenshot.png')
            }

            // Submit via PostHog feedback API
            posthog.captureFeedback('bug', description, {
                topic: 'user_report',
                attachments: screenshotFile ? [screenshotFile] : undefined,
                onComplete: (feedbackItemId, eventId) => {
                    logger.info('Report submitted successfully', { feedbackItemId, eventId })
                    setIsSubmitted(true)

                    // Auto-close after success
                    setTimeout(() => {
                        onClose()
                    }, 2000)
                },
            })
        } catch (error) {
            logger.error('Failed to submit report', error)
        }
    }

    const handleAttachScreenshot = () => {
        logger.info('Starting screenshot capture')
        setIsCapturing(true)
    }

    const handleScreenshotCaptured = (dataUrl: string) => {
        logger.info('Screenshot captured')
        setScreenshot(dataUrl)
        setIsCapturing(false)
    }

    const handleScreenshotCanceled = () => {
        logger.info('Screenshot capture canceled')
        setIsCapturing(false)
    }

    const handleRemoveScreenshot = () => {
        logger.info('Removing screenshot')
        setScreenshot(undefined)
    }

    const handleAnnotatedImageReady = (dataUrl: string) => {
        // Update screenshot with annotated version
        setScreenshot(dataUrl)
        logger.info('Annotated image ready')
    }

    const title = options?.title || 'Report an Issue'
    const placeholder =
        options?.description || `Describe the issue you encountered or the feature you'd like to suggest...`

    // Show capture overlay
    if (isCapturing) {
        return h(ScreenshotCapture, {
            onCapture: handleScreenshotCaptured,
            onCancel: handleScreenshotCanceled,
        })
    }

    if (isSubmitted) {
        return (
            <div className="ph-report-backdrop" onClick={handleBackdropClick}>
                <div className="ph-report-container" onClick={handleModalClick}>
                    <div className="ph-report-modal">
                        <div className="ph-report-success">
                            <div className="ph-report-success-icon">✓</div>
                            <h3 className="ph-report-success-title">Report Submitted</h3>
                            <p className="ph-report-success-message">
                                Thank you for your feedback! We'll review it soon.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="ph-report-backdrop" onClick={handleBackdropClick}>
            <div className="ph-report-container" onClick={handleModalClick}>
                <div className={`ph-report-modal ${screenshot ? 'ph-report-modal-large' : ''}`}>
                    {/* ESC Warning */}
                    {showEscWarning && <div className="ph-report-esc-warning">Press ESC again to close</div>}

                    {/* Header */}
                    <div className="ph-report-header">
                        <h2 className="ph-report-title">{title}</h2>
                        <button className="ph-report-close" onClick={onClose} aria-label="Close" type="button">
                            ×
                        </button>
                    </div>

                    {/* Body with Sidebar Layout */}
                    <div className="ph-report-body">
                        <div className="ph-report-sidebar-layout">
                            {/* Screenshot Section (Left) */}
                            <div className="ph-report-screenshot-section">
                                {screenshot ? (
                                    <div className="ph-report-screenshot-preview">
                                        <AnnotationOverlay
                                            screenshotDataUrl={screenshot}
                                            onAnnotatedImageReady={handleAnnotatedImageReady}
                                        />
                                        <button
                                            className="ph-report-screenshot-remove"
                                            onClick={handleRemoveScreenshot}
                                            type="button"
                                            aria-label="Remove screenshot"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ) : (
                                    <div className="ph-report-screenshot-placeholder">
                                        <div className="ph-report-screenshot-placeholder-content">
                                            <div className="ph-report-screenshot-placeholder-icon">📷</div>
                                            <button
                                                className="ph-report-button ph-report-button-capture"
                                                onClick={handleAttachScreenshot}
                                                type="button"
                                            >
                                                Capture Screenshot
                                            </button>
                                            <p className="ph-report-screenshot-placeholder-hint">
                                                Click and drag to select an area
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Form Section (Right) */}
                            <div className="ph-report-form-section">
                                <label className="ph-report-label">Describe the issue</label>
                                <textarea
                                    className="ph-report-textarea"
                                    placeholder={placeholder}
                                    value={description}
                                    onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="ph-report-footer">
                        <div className="ph-report-footer-left">
                            <p className="ph-report-privacy-footer">
                                This report includes your description, screenshot, browser info, and page URL.
                            </p>
                        </div>
                        <div className="ph-report-footer-right">
                            <button
                                className="ph-report-button ph-report-button-cancel"
                                onClick={onClose}
                                type="button"
                            >
                                Cancel
                            </button>
                            <button
                                className="ph-report-button ph-report-button-submit"
                                onClick={handleSubmit}
                                disabled={!description.trim()}
                                type="button"
                            >
                                Submit Report
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
