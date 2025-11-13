import { document as _document } from '../../utils/globals'
import feedbackRecordingStyles from './feedback-recording.css'

const document = _document as Document

export const removeFeedbackRecordingUIFromDOM = () => {
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
