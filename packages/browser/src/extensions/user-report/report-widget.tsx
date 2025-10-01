import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { createLogger } from '../../utils/logger'
import { PostHog } from '../../posthog-core'
import { ReportDialogOptions } from './types'
import { window } from '../../utils/globals'
import { ScreenshotCapture } from './screenshot-capture'

const logger = createLogger('[UserReport.Widget]')

interface ReportWidgetProps {
    posthog: PostHog
    options?: ReportDialogOptions
    onClose: () => void
}

export const ReportWidget = ({ options, onClose }: ReportWidgetProps) => {
    const [description, setDescription] = useState('')
    const [isSubmitted, setIsSubmitted] = useState(false)
    const [screenshot, setScreenshot] = useState<string | undefined>(options?.screenshot)
    const [isCapturing, setIsCapturing] = useState(false)
    useEffect(() => {
        logger.info('Report widget mounted')

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                logger.info('ESC pressed, closing dialog')
                onClose()
            }
        }

        // Cleanup on unmount
        return () => {
            window?.removeEventListener('keydown', handleKeyDown)
        }
    }, [onClose])

    const handleBackdropClick = () => {
        logger.info('Backdrop clicked, closing dialog')
        onClose()
    }

    const handleModalClick = (e: MouseEvent) => {
        // Stop propagation to prevent backdrop click
        e.stopPropagation()
    }

    const handleSubmit = () => {
        if (!description.trim()) {
            logger.warn('Cannot submit empty report')
            return
        }

        logger.info('Submitting report', { description, hasScreenshot: !!screenshot })

        // TODO: Wire up API submission
        setIsSubmitted(true)

        // Auto-close after success
        setTimeout(() => {
            onClose()
        }, 2000)
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
                <div className="ph-report-modal">
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
                                        <img src={screenshot} alt="Screenshot" className="ph-report-screenshot-img" />
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
