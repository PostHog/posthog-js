import { h, render } from 'preact'
import { PostHog } from '../../posthog-core'
import { createLogger } from '../../utils/logger'
import { ReportDialogOptions } from './types'
import { ReportWidget } from './report-widget'
import { document } from '../../utils/globals'
import reportStyles from './report.css'

const logger = createLogger('[UserReport]')

export class UserReportManager {
    private _posthog: PostHog
    private _container?: HTMLElement
    private _shadowRoot?: ShadowRoot
    private _isVisible: boolean = false

    constructor(posthog: PostHog) {
        this._posthog = posthog
        logger.info('UserReportManager initialized')
    }

    show(options?: ReportDialogOptions): void {
        if (this._isVisible) {
            logger.warn('Report dialog already visible')
            return
        }

        logger.info('Showing report dialog', options)
        this._isVisible = true
        this._render(options)
    }

    hide(): void {
        if (!this._isVisible) {
            return
        }

        logger.info('Hiding report dialog')
        this._isVisible = false
        this._cleanup()
    }

    private _render(options?: ReportDialogOptions): void {
        if (!document) {
            logger.error('Document is not available')
            return
        }

        // Create container
        this._container = document.createElement('div')
        this._container.className = 'PostHogUserReport'

        // Create shadow DOM for style isolation
        this._shadowRoot = this._container.attachShadow({ mode: 'open' })

        // Add styles
        const styleElement = document.createElement('style')
        styleElement.textContent = reportStyles
        this._shadowRoot.appendChild(styleElement)

        // Create mount point
        const mountPoint = document.createElement('div')
        this._shadowRoot.appendChild(mountPoint)

        // Render component
        render(
            h(ReportWidget, {
                posthog: this._posthog,
                options,
                onClose: () => this.hide(),
            }),
            mountPoint
        )

        // Add to DOM
        document.body.appendChild(this._container)

        logger.info('Report dialog rendered')
    }

    private _cleanup(): void {
        if (this._shadowRoot) {
            render(null, this._shadowRoot)
        }

        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container)
        }

        this._container = undefined
        this._shadowRoot = undefined
    }

    destroy(): void {
        logger.info('Destroying UserReportManager')
        this.hide()
    }
}
