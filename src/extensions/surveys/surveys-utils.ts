import { PostHog } from 'posthog-core'
import { Survey, SurveyAppearance } from '../../posthog-surveys-types'
import { window as _window } from '../../utils/globals'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis

export const style = (appearance: SurveyAppearance | null) => {
    const positions = {
        left: 'left: 30px;',
        right: 'right: 30px;',
        center: `
            left: 50%;
            transform: translateX(-50%);
          `,
    }
    return `
          .survey-form {
              position: fixed;
              margin: 0px;
              bottom: 0px;
              color: black;
              font-weight: normal;
              font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
              text-align: left;
              max-width: ${parseInt(appearance?.maxWidth || '290')}px;
              z-index: ${parseInt(appearance?.zIndex || '99999')};
              border: 1.5px solid ${appearance?.borderColor || '#c9c6c6'};
              border-bottom: 0px;
              width: 100%;
              ${positions[appearance?.position || 'right'] || 'right: 30px;'}
          }
          .form-submit[disabled] {
              opacity: 0.6;
              filter: grayscale(100%);
              cursor: not-allowed;
          }
          .survey-form {
              flex-direction: column;
              background: ${appearance?.backgroundColor || '#eeeded'};
              border-top-left-radius: 10px;
              border-top-right-radius: 10px;
              box-shadow: -6px 0 16px -8px rgb(0 0 0 / 8%), -9px 0 28px 0 rgb(0 0 0 / 5%), -12px 0 48px 16px rgb(0 0 0 / 3%);
          }
          .survey-form textarea {
              color: #2d2d2d;
              font-size: 14px;
              font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
              background: white;
              color: black;
              outline: none;
              padding-left: 10px;
              padding-right: 10px;
              padding-top: 10px;
              border-radius: 6px;
              border-color: ${appearance?.borderColor || '#c9c6c6'};
              margin-top: 14px; 
          }
          .form-submit {
              box-sizing: border-box;
              margin: 0;
              font-family: inherit;
              overflow: visible;
              text-transform: none;
              position: relative;
              display: inline-block;
              font-weight: 700;
              white-space: nowrap;
              text-align: center;
              border: 1.5px solid transparent;
              cursor: pointer;
              user-select: none;
              touch-action: manipulation;
              padding: 12px;
              font-size: 14px;
              border-radius: 6px;
              outline: 0;
              background: ${appearance?.submitButtonColor || 'black'} !important;
              text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.12);
              box-shadow: 0 2px 0 rgba(0, 0, 0, 0.045);
              width: 100%;
          }
          .form-cancel {
              float: right;
              border: none;
              background: none;
              cursor: pointer;
          }
          .cancel-btn-wrapper {
              position: absolute;
              width: 35px;
              height: 35px;
              border-radius: 100%;
              top: 0;
              right: 0;
              transform: translate(50%, -50%);
              background: white;
              border: 1.5px solid ${appearance?.borderColor || '#c9c6c6'};
              display: flex;
              justify-content: center;
              align-items: center;
          }
          .bolded { font-weight: 600; }
          .buttons {
              display: flex;
              justify-content: center;
          }
          .footer-branding {
              font-size: 11px;
              margin-top: 10px;
              text-align: center;
              display: flex;
              justify-content: center;
              gap: 4px;
              align-items: center;
              font-weight: 500;
              background: ${appearance?.backgroundColor || '#eeeded'};
              text-decoration: none;
          }
          .survey-box {
              padding: 20px 25px 10px;
              display: flex;
              flex-direction: column;
          }
          .survey-question {
              font-weight: 500;
              font-size: 14px;
              background: ${appearance?.backgroundColor || '#eeeded'};
          }
          .question-textarea-wrapper {
              display: flex;
              flex-direction: column;
          }
          .description {
              font-size: 13px;
              margin-top: 5px;
              opacity: .60;
              background: ${appearance?.backgroundColor || '#eeeded'};
          }
          .ratings-number {
              background-color: ${appearance?.ratingButtonColor || 'white'};
              font-size: 14px;
              padding: 8px 0px;
              border: none;
          }
          .ratings-number:hover {
              cursor: pointer;
          }
          .rating-options {
              margin-top: 14px;
          }
          .rating-options-number {
              display: grid;
              border-radius: 6px;
              overflow: hidden;
              border: 1.5px solid ${appearance?.borderColor || '#c9c6c6'};
          }
          .rating-options-number > .ratings-number {
              border-right: 1px solid ${appearance?.borderColor || '#c9c6c6'};
          }
          .rating-options-number > .ratings-number:last-of-type {
              border-right: 0px;
          }
          .rating-options-number .rating-active {
              background: ${appearance?.ratingButtonActiveColor || 'black'};
          }
          .rating-options-emoji {
              display: flex;
              justify-content: space-between;
          }
          .ratings-emoji {
              font-size: 16px;
              background-color: transparent;
              border: none;
              padding: 0px;
          }
          .ratings-emoji:hover {
              cursor: pointer;
          }
          .ratings-emoji.rating-active svg {
              fill: ${appearance?.ratingButtonActiveColor || 'black'};
          }
          .emoji-svg {
              fill: ${appearance?.ratingButtonColor || '#c9c6c6'};
          }
          .rating-text {
              display: flex;
              flex-direction: row;
              font-size: 11px;
              justify-content: space-between;
              margin-top: 6px;
              background: ${appearance?.backgroundColor || '#eeeded'};
              opacity: .60;
          }
          .multiple-choice-options {
              margin-top: 13px;
              font-size: 14px;
          }
          .multiple-choice-options .choice-option {
              display: flex;
              align-items: center;
              gap: 4px;
              font-size: 13px;
              cursor: pointer;
              margin-bottom: 5px;
              position: relative;
          }
          .multiple-choice-options > .choice-option:last-of-type {
              margin-bottom: 0px;
          }
          .multiple-choice-options input {
              cursor: pointer;
              position: absolute;
              opacity: 0;
          }
          .choice-check {
              position: absolute;
              right: 10px;
              background: white;
          }
          .choice-check svg {
              display: none;
          }
          .multiple-choice-options .choice-option:hover .choice-check svg {
              display: inline-block;
              opacity: .25;
          }
          .multiple-choice-options input:checked + label + .choice-check svg {
              display: inline-block;
              opacity: 100% !important;
          }
          .multiple-choice-options input:checked + label {
              font-weight: bold;
              border: 1.5px solid rgba(0,0,0);
          }
          .multiple-choice-options input:checked + label input {
              font-weight: bold;
          }
          .multiple-choice-options label {
              width: 100%;
              cursor: pointer;
              padding: 10px;
              border: 1.5px solid rgba(0,0,0,.25);
              border-radius: 4px;
              background: white;
          }
          .multiple-choice-options .choice-option-open label {
              padding-right: 30px;
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
              max-width: 100%;
          }
          .multiple-choice-options .choice-option-open label span {
              width: 100%;
          }
          .multiple-choice-options .choice-option-open input:disabled + label {
              opacity: 0.6;
          }
          .multiple-choice-options .choice-option-open label input {
              position: relative;
              opacity: 1;
              flex-grow: 1;
              border: 0;
              outline: 0;
          }
          .thank-you-message {
              position: fixed;
              bottom: 0px;
              z-index: ${parseInt(appearance?.zIndex || '99999')};
              box-shadow: -6px 0 16px -8px rgb(0 0 0 / 8%), -9px 0 28px 0 rgb(0 0 0 / 5%), -12px 0 48px 16px rgb(0 0 0 / 3%);
              font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
              border-top-left-radius: 10px;
              border-top-right-radius: 10px;
              padding: 20px 25px 10px;
              background: ${appearance?.backgroundColor || '#eeeded'};
              border: 1.5px solid ${appearance?.borderColor || '#c9c6c6'};
              text-align: center;
              max-width: ${parseInt(appearance?.maxWidth || '290')}px;
              min-width: 150px;
              width: 100%;
              ${positions[appearance?.position || 'right'] || 'right: 30px;'}
          }
          .thank-you-message-body {
              margin-top: 6px;
              font-size: 14px;
              background: ${appearance?.backgroundColor || '#eeeded'};
          }
          .thank-you-message-header {
              margin: 10px 0px 0px;
              background: ${appearance?.backgroundColor || '#eeeded'};
          }
          .thank-you-message-container .form-submit {
              margin-top: 20px;
              margin-bottom: 10px;
          }
          .thank-you-message-countdown {
              margin-left: 6px;
          }
          .bottom-section {
              margin-top: 14px;
          }
          `
}

export function getTextColor(el: HTMLElement) {
    const backgroundColor = window.getComputedStyle(el).backgroundColor
    if (backgroundColor === 'rgba(0, 0, 0, 0)') {
        return 'black'
    }
    const colorMatch = backgroundColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/)
    if (!colorMatch) return 'black'

    const r = parseInt(colorMatch[1])
    const g = parseInt(colorMatch[2])
    const b = parseInt(colorMatch[3])
    const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b))
    return hsp > 127.5 ? 'black' : 'white'
}

export const defaultSurveyAppearance: SurveyAppearance = {
    backgroundColor: '#eeeded',
    submitButtonColor: 'black',
    ratingButtonColor: 'white',
    ratingButtonActiveColor: 'black',
    borderColor: '#c9c6c6',
    placeholder: 'Start typing...',
    whiteLabel: false,
    displayThankYouMessage: true,
    thankYouMessageHeader: 'Thank you for your feedback!',
    position: 'right',
}

export const sendSurveyEvent = (
    responses: Record<string, string | number | string[] | null> = {},
    survey: Survey,
    posthog: PostHog
) => {
    localStorage.setItem(`seenSurvey_${survey.id}`, 'true')
    posthog.capture('survey sent', {
        $survey_name: survey.name,
        $survey_id: survey.id,
        $survey_questions: survey.questions.map((question) => question.question),
        sessionRecordingUrl: posthog.get_session_replay_url?.(),
        ...responses,
        $set: {
            [`$survey_responded/${survey.id}`]: true,
        },
    })
    window.dispatchEvent(new Event('PHSurveySent'))
}
