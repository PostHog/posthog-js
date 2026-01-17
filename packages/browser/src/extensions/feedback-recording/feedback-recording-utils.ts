import { document as _document } from '../../utils/globals'
import feedbackRecordingStyles from './feedback-recording.css'
import * as Preact from 'preact'
import { createLogger } from '../../utils/logger'

const document = _document as Document
const logger = createLogger('[PostHog FeedbackRecordingUtils]')
const FEEDBACK_RECORDING_WIDGET_CLASS = 'PostHogFeedbackRecordingWidget'

export const removeFeedbackRecordingUIFromDOM = () => {
    try {
        const existingDiv = document.querySelector(`.${FEEDBACK_RECORDING_WIDGET_CLASS}`)
        if (existingDiv?.shadowRoot) {
            Preact.render(null, existingDiv.shadowRoot)
        }
        existingDiv?.remove()
    } catch (error) {
        logger.warn('Failed to remove feedback recording UI from DOM:', error)
    }
}

export const retrieveFeedbackRecordingUIShadow = (element?: Element) => {
    const div = document.createElement('div')
    div.className = FEEDBACK_RECORDING_WIDGET_CLASS
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
