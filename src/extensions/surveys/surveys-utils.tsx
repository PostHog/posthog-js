import type { PostHogExtended } from '../../posthog-extended'
import { Survey, SurveyAppearance } from '../../posthog-surveys-types'
import { window as _window, document as _document } from '../../utils/globals'
import { createContext } from 'preact'
// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document

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
              max-width: ${parseInt(appearance?.maxWidth || '300')}px;
              z-index: ${parseInt(appearance?.zIndex || '99999')};
              border: 1.5px solid ${appearance?.borderColor || '#c9c6c6'};
              border-bottom: 0px;
              width: 100%;
              ${positions[appearance?.position || 'right'] || 'right: 30px;'}
          }
          .form-submit[disabled] {
              opacity: 0.6;
              filter: grayscale(50%);
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
              border-radius: 10px;
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
              padding-top: 5px;
              background: ${appearance?.backgroundColor || '#eeeded'};
          }
          .ratings-number {
              background-color: ${appearance?.ratingButtonColor || 'white'};
              font-size: 16px;
              font-weight: 600;
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
              max-width: ${parseInt(appearance?.maxWidth || '300')}px;
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

function nameToHex(name: string) {
    return {
        aliceblue: '#f0f8ff',
        antiquewhite: '#faebd7',
        aqua: '#00ffff',
        aquamarine: '#7fffd4',
        azure: '#f0ffff',
        beige: '#f5f5dc',
        bisque: '#ffe4c4',
        black: '#000000',
        blanchedalmond: '#ffebcd',
        blue: '#0000ff',
        blueviolet: '#8a2be2',
        brown: '#a52a2a',
        burlywood: '#deb887',
        cadetblue: '#5f9ea0',
        chartreuse: '#7fff00',
        chocolate: '#d2691e',
        coral: '#ff7f50',
        cornflowerblue: '#6495ed',
        cornsilk: '#fff8dc',
        crimson: '#dc143c',
        cyan: '#00ffff',
        darkblue: '#00008b',
        darkcyan: '#008b8b',
        darkgoldenrod: '#b8860b',
        darkgray: '#a9a9a9',
        darkgreen: '#006400',
        darkkhaki: '#bdb76b',
        darkmagenta: '#8b008b',
        darkolivegreen: '#556b2f',
        darkorange: '#ff8c00',
        darkorchid: '#9932cc',
        darkred: '#8b0000',
        darksalmon: '#e9967a',
        darkseagreen: '#8fbc8f',
        darkslateblue: '#483d8b',
        darkslategray: '#2f4f4f',
        darkturquoise: '#00ced1',
        darkviolet: '#9400d3',
        deeppink: '#ff1493',
        deepskyblue: '#00bfff',
        dimgray: '#696969',
        dodgerblue: '#1e90ff',
        firebrick: '#b22222',
        floralwhite: '#fffaf0',
        forestgreen: '#228b22',
        fuchsia: '#ff00ff',
        gainsboro: '#dcdcdc',
        ghostwhite: '#f8f8ff',
        gold: '#ffd700',
        goldenrod: '#daa520',
        gray: '#808080',
        green: '#008000',
        greenyellow: '#adff2f',
        honeydew: '#f0fff0',
        hotpink: '#ff69b4',
        'indianred ': '#cd5c5c',
        indigo: '#4b0082',
        ivory: '#fffff0',
        khaki: '#f0e68c',
        lavender: '#e6e6fa',
        lavenderblush: '#fff0f5',
        lawngreen: '#7cfc00',
        lemonchiffon: '#fffacd',
        lightblue: '#add8e6',
        lightcoral: '#f08080',
        lightcyan: '#e0ffff',
        lightgoldenrodyellow: '#fafad2',
        lightgrey: '#d3d3d3',
        lightgreen: '#90ee90',
        lightpink: '#ffb6c1',
        lightsalmon: '#ffa07a',
        lightseagreen: '#20b2aa',
        lightskyblue: '#87cefa',
        lightslategray: '#778899',
        lightsteelblue: '#b0c4de',
        lightyellow: '#ffffe0',
        lime: '#00ff00',
        limegreen: '#32cd32',
        linen: '#faf0e6',
        magenta: '#ff00ff',
        maroon: '#800000',
        mediumaquamarine: '#66cdaa',
        mediumblue: '#0000cd',
        mediumorchid: '#ba55d3',
        mediumpurple: '#9370d8',
        mediumseagreen: '#3cb371',
        mediumslateblue: '#7b68ee',
        mediumspringgreen: '#00fa9a',
        mediumturquoise: '#48d1cc',
        mediumvioletred: '#c71585',
        midnightblue: '#191970',
        mintcream: '#f5fffa',
        mistyrose: '#ffe4e1',
        moccasin: '#ffe4b5',
        navajowhite: '#ffdead',
        navy: '#000080',
        oldlace: '#fdf5e6',
        olive: '#808000',
        olivedrab: '#6b8e23',
        orange: '#ffa500',
        orangered: '#ff4500',
        orchid: '#da70d6',
        palegoldenrod: '#eee8aa',
        palegreen: '#98fb98',
        paleturquoise: '#afeeee',
        palevioletred: '#d87093',
        papayawhip: '#ffefd5',
        peachpuff: '#ffdab9',
        peru: '#cd853f',
        pink: '#ffc0cb',
        plum: '#dda0dd',
        powderblue: '#b0e0e6',
        purple: '#800080',
        red: '#ff0000',
        rosybrown: '#bc8f8f',
        royalblue: '#4169e1',
        saddlebrown: '#8b4513',
        salmon: '#fa8072',
        sandybrown: '#f4a460',
        seagreen: '#2e8b57',
        seashell: '#fff5ee',
        sienna: '#a0522d',
        silver: '#c0c0c0',
        skyblue: '#87ceeb',
        slateblue: '#6a5acd',
        slategray: '#708090',
        snow: '#fffafa',
        springgreen: '#00ff7f',
        steelblue: '#4682b4',
        tan: '#d2b48c',
        teal: '#008080',
        thistle: '#d8bfd8',
        tomato: '#ff6347',
        turquoise: '#40e0d0',
        violet: '#ee82ee',
        wheat: '#f5deb3',
        white: '#ffffff',
        whitesmoke: '#f5f5f5',
        yellow: '#ffff00',
        yellowgreen: '#9acd32',
    }[name.toLowerCase()]
}

function hex2rgb(c: string) {
    if (c[0] === '#') {
        const hexColor = c.replace(/^#/, '')
        const r = parseInt(hexColor.slice(0, 2), 16)
        const g = parseInt(hexColor.slice(2, 4), 16)
        const b = parseInt(hexColor.slice(4, 6), 16)
        return 'rgb(' + r + ',' + g + ',' + b + ')'
    }
    return 'rgb(255, 255, 255)'
}

export function getContrastingTextColor(color: string = defaultBackgroundColor) {
    let rgb
    if (color[0] === '#') {
        rgb = hex2rgb(color)
    }
    if (color.startsWith('rgb')) {
        rgb = color
    }
    // otherwise it's a color name
    const nameColorToHex = nameToHex(color)
    if (nameColorToHex) {
        rgb = hex2rgb(nameColorToHex)
    }
    if (!rgb) {
        return 'black'
    }
    const colorMatch = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/)
    if (colorMatch) {
        const r = parseInt(colorMatch[1])
        const g = parseInt(colorMatch[2])
        const b = parseInt(colorMatch[3])
        const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b))
        return hsp > 127.5 ? 'black' : 'white'
    }
    return 'black'
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

export const defaultBackgroundColor = '#eeeded'

export const createShadow = (styleSheet: string, surveyId: string) => {
    const div = document.createElement('div')
    div.className = `PostHogSurvey${surveyId}`
    const shadow = div.attachShadow({ mode: 'open' })
    if (styleSheet) {
        const styleElement = Object.assign(document.createElement('style'), {
            innerText: styleSheet,
        })
        shadow.appendChild(styleElement)
    }
    document.body.appendChild(div)
    return shadow
}

export const sendSurveyEvent = (
    responses: Record<string, string | number | string[] | null> = {},
    survey: Survey,
    posthog?: PostHogExtended
) => {
    if (!posthog) return
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

export const SurveyContext = createContext<{
    readOnly: boolean
    previewQuestionIndex: number
    textColor: string
}>({
    readOnly: false,
    previewQuestionIndex: 0,
    textColor: 'black',
})
