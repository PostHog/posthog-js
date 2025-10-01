import { h } from 'preact'
import { useEffect } from 'preact/hooks'
import { createLogger } from '../../utils/logger'
import { PostHog } from '../../posthog-core'
import { ReportDialogOptions } from './types'
import { window } from '../../utils/globals'

const logger = createLogger('[UserReport.Widget]')

interface ReportWidgetProps {
    posthog: PostHog
    options?: ReportDialogOptions
    onClose: () => void
}

export const ReportWidget = ({ options, onClose }: ReportWidgetProps) => {
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

    const title = options?.title || 'Report an Issue'

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

                    {/* Body */}
                    <div className="ph-report-body">
                        <p>Body content will go here</p>
                    </div>

                    {/* Footer */}
                    <div className="ph-report-footer">
                        <button className="ph-report-button ph-report-button-cancel" onClick={onClose} type="button">
                            Cancel
                        </button>
                        <button className="ph-report-button ph-report-button-submit" type="button">
                            Submit Report
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
