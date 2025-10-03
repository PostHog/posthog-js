import { VNode, cloneElement, createContext } from 'preact'
import { PostHog } from '../../posthog-core'
import {
    MultipleSurveyQuestion,
    Survey,
    SurveyAppearance,
    SurveyEventName,
    SurveyEventProperties,
    SurveyPosition,
    SurveyQuestion,
    SurveySchedule,
    SurveyType,
    SurveyWidgetType,
} from '../../posthog-surveys-types'
import { document as _document, window as _window, userAgent } from '../../utils/globals'
import {
    getSurveyInteractionProperty,
    getSurveySeenKey,
    SURVEY_LOGGER as logger,
    setSurveySeenOnLocalStorage,
    SURVEY_IN_PROGRESS_PREFIX,
} from '../../utils/survey-utils'
import { isArray, isNullish } from '@posthog/core'

import { detectDeviceType } from '../../utils/user-agent-utils'
import { propertyComparisons } from '../../utils/property-utils'
import { PropertyMatchType } from '../../types'
import { prepareStylesheet } from '../utils/stylesheet-loader'
// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document
import surveyStyles from './survey.css'
import { useContext } from 'preact/hooks'

export function getFontFamily(fontFamily?: string): string {
    if (fontFamily === 'inherit') {
        return 'inherit'
    }

    const defaultFontStack =
        'BlinkMacSystemFont, "Inter", "Segoe UI", "Roboto", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"'
    return fontFamily ? `${fontFamily}, ${defaultFontStack}` : `-apple-system, ${defaultFontStack}`
}

export function getSurveyResponseKey(questionId: string) {
    return `$survey_response_${questionId}`
}

const BLACK_TEXT_COLOR = '#020617' // Maps out to text-slate-950 from tailwind colors. Intended for text use outside interactive elements like buttons

// Keep in sync with defaultSurveyAppearance on the main app
export const defaultSurveyAppearance = {
    fontFamily: 'inherit',
    backgroundColor: '#eeeded',
    submitButtonColor: 'black',
    submitButtonTextColor: 'white',
    ratingButtonColor: 'white',
    ratingButtonActiveColor: 'black',
    borderColor: '#c9c6c6',
    placeholder: 'Start typing...',
    whiteLabel: false,
    displayThankYouMessage: true,
    thankYouMessageHeader: 'Thank you for your feedback!',
    position: SurveyPosition.Right,
    widgetType: SurveyWidgetType.Tab,
    widgetLabel: 'Feedback',
    widgetColor: 'black',
    zIndex: '2147483647',
    disabledButtonOpacity: '0.6',
    maxWidth: '300px',
    textSubtleColor: '#939393',
    boxPadding: '20px 24px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    borderRadius: '10px',
    shuffleQuestions: false,
    surveyPopupDelaySeconds: undefined,
    // Not customizable atm
    outlineColor: 'rgba(59, 130, 246, 0.8)',
    inputBackground: 'white',
    inputTextColor: BLACK_TEXT_COLOR,
    scrollbarThumbColor: 'var(--ph-survey-border-color)',
    scrollbarTrackColor: 'var(--ph-survey-background-color)',
} as const

export const addSurveyCSSVariablesToElement = (
    element: HTMLElement,
    type: SurveyType,
    appearance?: SurveyAppearance | null
) => {
    const effectiveAppearance = { ...defaultSurveyAppearance, ...appearance }
    const hostStyle = element.style

    const surveyHasBottomBorder =
        ![SurveyPosition.Center, SurveyPosition.Left, SurveyPosition.Right].includes(effectiveAppearance.position) ||
        (type === SurveyType.Widget && appearance?.widgetType === SurveyWidgetType.Tab)

    hostStyle.setProperty('--ph-survey-font-family', getFontFamily(effectiveAppearance.fontFamily))
    hostStyle.setProperty('--ph-survey-box-padding', effectiveAppearance.boxPadding)
    hostStyle.setProperty('--ph-survey-max-width', effectiveAppearance.maxWidth)
    hostStyle.setProperty('--ph-survey-z-index', effectiveAppearance.zIndex)
    hostStyle.setProperty('--ph-survey-border-color', effectiveAppearance.borderColor)
    // Non-bottom surveys or tab surveys have the border bottom
    if (surveyHasBottomBorder) {
        hostStyle.setProperty('--ph-survey-border-radius', effectiveAppearance.borderRadius)
        hostStyle.setProperty('--ph-survey-border-bottom', '1.5px solid var(--ph-survey-border-color)')
    } else {
        hostStyle.setProperty('--ph-survey-border-bottom', 'none')
        hostStyle.setProperty(
            '--ph-survey-border-radius',
            `${effectiveAppearance.borderRadius} ${effectiveAppearance.borderRadius} 0 0`
        )
    }
    hostStyle.setProperty('--ph-survey-background-color', effectiveAppearance.backgroundColor)
    hostStyle.setProperty('--ph-survey-box-shadow', effectiveAppearance.boxShadow)
    hostStyle.setProperty('--ph-survey-disabled-button-opacity', effectiveAppearance.disabledButtonOpacity)
    hostStyle.setProperty('--ph-survey-submit-button-color', effectiveAppearance.submitButtonColor)
    hostStyle.setProperty(
        '--ph-survey-submit-button-text-color',
        appearance?.submitButtonTextColor || getContrastingTextColor(effectiveAppearance.submitButtonColor)
    )
    hostStyle.setProperty('--ph-survey-rating-bg-color', effectiveAppearance.ratingButtonColor)
    hostStyle.setProperty(
        '--ph-survey-rating-text-color',
        getContrastingTextColor(effectiveAppearance.ratingButtonColor)
    )
    hostStyle.setProperty('--ph-survey-rating-active-bg-color', effectiveAppearance.ratingButtonActiveColor)
    hostStyle.setProperty(
        '--ph-survey-rating-active-text-color',
        getContrastingTextColor(effectiveAppearance.ratingButtonActiveColor)
    )
    hostStyle.setProperty(
        '--ph-survey-text-primary-color',
        getContrastingTextColor(effectiveAppearance.backgroundColor)
    )
    hostStyle.setProperty('--ph-survey-text-subtle-color', effectiveAppearance.textSubtleColor)
    hostStyle.setProperty('--ph-widget-color', effectiveAppearance.widgetColor)
    hostStyle.setProperty('--ph-widget-text-color', getContrastingTextColor(effectiveAppearance.widgetColor))
    hostStyle.setProperty('--ph-widget-z-index', effectiveAppearance.zIndex)

    // Adjust input/choice background slightly if main background is white
    if (effectiveAppearance.backgroundColor === 'white') {
        hostStyle.setProperty('--ph-survey-input-background', '#f8f8f8')
    }

    hostStyle.setProperty('--ph-survey-input-background', effectiveAppearance.inputBackground)
    hostStyle.setProperty('--ph-survey-input-text-color', getContrastingTextColor(effectiveAppearance.inputBackground))
    hostStyle.setProperty('--ph-survey-scrollbar-thumb-color', effectiveAppearance.scrollbarThumbColor)
    hostStyle.setProperty('--ph-survey-scrollbar-track-color', effectiveAppearance.scrollbarTrackColor)
    hostStyle.setProperty('--ph-survey-outline-color', effectiveAppearance.outlineColor)
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

function getContrastingTextColor(color: string = defaultSurveyAppearance.backgroundColor) {
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
        return BLACK_TEXT_COLOR
    }
    const colorMatch = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/)
    if (colorMatch) {
        const r = parseInt(colorMatch[1])
        const g = parseInt(colorMatch[2])
        const b = parseInt(colorMatch[3])
        const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b))
        return hsp > 127.5 ? BLACK_TEXT_COLOR : 'white'
    }
    return BLACK_TEXT_COLOR
}

export function getSurveyStylesheet(posthog?: PostHog) {
    const stylesheet = prepareStylesheet(document, typeof surveyStyles === 'string' ? surveyStyles : '', posthog)
    stylesheet?.setAttribute('data-ph-survey-style', 'true')
    return stylesheet
}

export const retrieveSurveyShadow = (
    survey: Pick<Survey, 'id' | 'appearance' | 'type'>,
    posthog?: PostHog,
    element?: Element
) => {
    const widgetClassName = getSurveyContainerClass(survey)
    const existingDiv = document.querySelector(`.${widgetClassName}`)

    if (existingDiv && existingDiv.shadowRoot) {
        return {
            shadow: existingDiv.shadowRoot,
            isNewlyCreated: false,
        }
    }

    // If it doesn't exist, create it
    const div = document.createElement('div')
    addSurveyCSSVariablesToElement(div, survey.type, survey.appearance)
    div.className = widgetClassName
    const shadow = div.attachShadow({ mode: 'open' })
    const stylesheet = getSurveyStylesheet(posthog)
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

interface SendSurveyEventArgs {
    responses: Record<string, string | number | string[] | null>
    survey: Survey
    surveySubmissionId: string
    isSurveyCompleted: boolean
    posthog?: PostHog
}

const getSurveyResponseValue = (responses: Record<string, string | number | string[] | null>, questionId?: string) => {
    if (!questionId) {
        return null
    }
    const response = responses[getSurveyResponseKey(questionId)]
    if (isArray(response)) {
        return [...response]
    }
    return response
}

export const sendSurveyEvent = ({
    responses,
    survey,
    surveySubmissionId,
    posthog,
    isSurveyCompleted,
}: SendSurveyEventArgs) => {
    if (!posthog) {
        logger.error('[survey sent] event not captured, PostHog instance not found.')
        return
    }
    setSurveySeenOnLocalStorage(survey)
    posthog.capture(SurveyEventName.SENT, {
        [SurveyEventProperties.SURVEY_NAME]: survey.name,
        [SurveyEventProperties.SURVEY_ID]: survey.id,
        [SurveyEventProperties.SURVEY_ITERATION]: survey.current_iteration,
        [SurveyEventProperties.SURVEY_ITERATION_START_DATE]: survey.current_iteration_start_date,
        [SurveyEventProperties.SURVEY_QUESTIONS]: survey.questions.map((question) => ({
            id: question.id,
            question: question.question,
            response: getSurveyResponseValue(responses, question.id),
        })),
        [SurveyEventProperties.SURVEY_SUBMISSION_ID]: surveySubmissionId,
        [SurveyEventProperties.SURVEY_COMPLETED]: isSurveyCompleted,
        sessionRecordingUrl: posthog.get_session_replay_url?.(),
        ...responses,
        $set: {
            [getSurveyInteractionProperty(survey, 'responded')]: true,
        },
    })
    if (isSurveyCompleted) {
        // Only dispatch PHSurveySent if the survey is completed, as that removes the survey from focus
        window.dispatchEvent(new CustomEvent('PHSurveySent', { detail: { surveyId: survey.id } }))
        clearInProgressSurveyState(survey)
    }
}

export const dismissedSurveyEvent = (survey: Survey, posthog?: PostHog, readOnly?: boolean) => {
    if (!posthog) {
        logger.error('[survey dismissed] event not captured, PostHog instance not found.')
        return
    }
    if (readOnly) {
        return
    }

    const inProgressSurvey = getInProgressSurveyState(survey)
    posthog.capture(SurveyEventName.DISMISSED, {
        [SurveyEventProperties.SURVEY_NAME]: survey.name,
        [SurveyEventProperties.SURVEY_ID]: survey.id,
        [SurveyEventProperties.SURVEY_ITERATION]: survey.current_iteration,
        [SurveyEventProperties.SURVEY_ITERATION_START_DATE]: survey.current_iteration_start_date,
        // check if the survey is partially completed
        [SurveyEventProperties.SURVEY_PARTIALLY_COMPLETED]:
            Object.values(inProgressSurvey?.responses || {}).filter((resp) => !isNullish(resp)).length > 0,
        sessionRecordingUrl: posthog.get_session_replay_url?.(),
        ...inProgressSurvey?.responses,
        [SurveyEventProperties.SURVEY_SUBMISSION_ID]: inProgressSurvey?.surveySubmissionId,
        [SurveyEventProperties.SURVEY_QUESTIONS]: survey.questions.map((question) => ({
            id: question.id,
            question: question.question,
            response: getSurveyResponseValue(inProgressSurvey?.responses || {}, question.id),
        })),
        $set: {
            [getSurveyInteractionProperty(survey, 'dismissed')]: true,
        },
    })
    // Clear in-progress state on dismissal
    clearInProgressSurveyState(survey)
    setSurveySeenOnLocalStorage(survey)
    window.dispatchEvent(new CustomEvent('PHSurveyClosed', { detail: { surveyId: survey.id } }))
}

// Use the Fisher-yates algorithm to shuffle this array
// https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
export const shuffle = (array: any[]) => {
    return array
        .map((a) => ({ sort: Math.floor(Math.random() * 10), value: a }))
        .sort((a, b) => a.sort - b.sort)
        .map((a) => a.value)
}

const reverseIfUnshuffled = (unshuffled: any[], shuffled: any[]): any[] => {
    if (unshuffled.length === shuffled.length && unshuffled.every((val, index) => val === shuffled[index])) {
        return shuffled.reverse()
    }

    return shuffled
}

export const getDisplayOrderChoices = (question: MultipleSurveyQuestion): string[] => {
    if (!question.shuffleOptions) {
        return question.choices
    }

    const displayOrderChoices = question.choices
    let openEndedChoice = ''
    if (question.hasOpenChoice) {
        // if the question has an open-ended choice, its always the last element in the choices array.
        openEndedChoice = displayOrderChoices.pop()!
    }

    const shuffledOptions = reverseIfUnshuffled(displayOrderChoices, shuffle(displayOrderChoices))

    if (question.hasOpenChoice) {
        question.choices.push(openEndedChoice)
        shuffledOptions.push(openEndedChoice)
    }

    return shuffledOptions
}

export const getDisplayOrderQuestions = (survey: Survey): SurveyQuestion[] => {
    if (!survey.appearance || !survey.appearance.shuffleQuestions || survey.enable_partial_responses) {
        return survey.questions
    }

    return reverseIfUnshuffled(survey.questions, shuffle(survey.questions))
}

export const hasEvents = (survey: Pick<Survey, 'conditions'>): boolean => {
    return survey.conditions?.events?.values?.length != undefined && survey.conditions?.events?.values?.length > 0
}

export const canActivateRepeatedly = (
    survey: Pick<Survey, 'schedule' | 'conditions' | 'id' | 'current_iteration'>
): boolean => {
    return (
        !!(survey.conditions?.events?.repeatedActivation && hasEvents(survey)) ||
        survey.schedule === SurveySchedule.Always ||
        isSurveyInProgress(survey)
    )
}

/**
 * getSurveySeen checks local storage for the surveySeen Key a
 * and overrides this value if the survey can be repeatedly activated by its events.
 * @param survey
 */
export const getSurveySeen = (survey: Survey): boolean => {
    const surveySeen = localStorage.getItem(getSurveySeenKey(survey))
    if (surveySeen) {
        // if a survey has already been seen,
        // we will override it with the event repeated activation value.
        return !canActivateRepeatedly(survey)
    }

    return false
}

const LAST_SEEN_SURVEY_DATE_KEY = 'lastSeenSurveyDate'

export const hasWaitPeriodPassed = (waitPeriodInDays: number | undefined): boolean => {
    const lastSeenSurveyDate = localStorage.getItem(LAST_SEEN_SURVEY_DATE_KEY)
    if (!waitPeriodInDays || !lastSeenSurveyDate) {
        return true
    }

    const today = new Date()
    const diff = Math.abs(today.getTime() - new Date(lastSeenSurveyDate).getTime())
    const diffDaysFromToday = Math.ceil(diff / (1000 * 3600 * 24))
    return diffDaysFromToday > waitPeriodInDays
}

interface SurveyContextProps {
    isPreviewMode: boolean
    previewPageIndex: number | undefined
    onPopupSurveyDismissed: () => void
    isPopup: boolean
    onPreviewSubmit: (res: string | string[] | number | null) => void
    surveySubmissionId: string
}

export const SurveyContext = createContext<SurveyContextProps>({
    isPreviewMode: false,
    previewPageIndex: 0,
    onPopupSurveyDismissed: () => {},
    isPopup: true,
    onPreviewSubmit: () => {},
    surveySubmissionId: '',
})

export const useSurveyContext = () => {
    return useContext(SurveyContext)
}

interface RenderProps {
    component: VNode<{ className: string }>
    children: string
    renderAsHtml?: boolean
    style?: React.CSSProperties
}

export const renderChildrenAsTextOrHtml = ({ component, children, renderAsHtml, style }: RenderProps) => {
    return renderAsHtml
        ? cloneElement(component, {
              dangerouslySetInnerHTML: { __html: children },
              style,
          })
        : cloneElement(component, {
              children,
              style,
          })
}

function defaultMatchType(matchType?: PropertyMatchType): PropertyMatchType {
    return matchType ?? 'icontains'
}

// use urlMatchType to validate url condition, fallback to contains for backwards compatibility
export function doesSurveyUrlMatch(survey: Pick<Survey, 'conditions'>): boolean {
    if (!survey.conditions?.url) {
        return true
    }
    // if we dont know the url, assume it is not a match
    const href = window?.location?.href
    if (!href) {
        return false
    }
    const targets = [survey.conditions.url]
    const matchType = defaultMatchType(survey.conditions?.urlMatchType)
    return propertyComparisons[matchType](targets, [href])
}

export function doesSurveyDeviceTypesMatch(survey: Survey): boolean {
    if (!survey.conditions?.deviceTypes || survey.conditions?.deviceTypes.length === 0) {
        return true
    }
    // if we dont know the device type, assume it is not a match
    if (!userAgent) {
        return false
    }

    const deviceType = detectDeviceType(userAgent)
    return propertyComparisons[defaultMatchType(survey.conditions?.deviceTypesMatchType)](
        survey.conditions.deviceTypes,
        [deviceType]
    )
}

export function doesSurveyMatchSelector(survey: Survey): boolean {
    if (!survey.conditions?.selector) {
        return true
    }
    return !!document?.querySelector(survey.conditions.selector)
}

interface InProgressSurveyState {
    surveySubmissionId: string
    lastQuestionIndex: number
    responses: Record<string, string | number | string[] | null>
}

const getInProgressSurveyStateKey = (survey: Pick<Survey, 'id' | 'current_iteration'>): string => {
    let key = `${SURVEY_IN_PROGRESS_PREFIX}${survey.id}`
    if (survey.current_iteration && survey.current_iteration > 0) {
        key = `${SURVEY_IN_PROGRESS_PREFIX}${survey.id}_${survey.current_iteration}`
    }
    return key
}

export const setInProgressSurveyState = (
    survey: Pick<Survey, 'id' | 'current_iteration'>,
    state: InProgressSurveyState
): void => {
    try {
        localStorage.setItem(getInProgressSurveyStateKey(survey), JSON.stringify(state))
    } catch (e) {
        logger.error('Error setting in-progress survey state in localStorage', e)
    }
}

export const getInProgressSurveyState = (
    survey: Pick<Survey, 'id' | 'current_iteration'>
): InProgressSurveyState | null => {
    try {
        const stateString = localStorage.getItem(getInProgressSurveyStateKey(survey))
        if (stateString) {
            return JSON.parse(stateString) as InProgressSurveyState
        }
    } catch (e) {
        logger.error('Error getting in-progress survey state from localStorage', e)
    }
    return null
}

export const isSurveyInProgress = (survey: Pick<Survey, 'id' | 'current_iteration'>): boolean => {
    const state = getInProgressSurveyState(survey)
    return !isNullish(state?.surveySubmissionId)
}

export const clearInProgressSurveyState = (survey: Pick<Survey, 'id' | 'current_iteration'>): void => {
    try {
        localStorage.removeItem(getInProgressSurveyStateKey(survey))
    } catch (e) {
        logger.error('Error clearing in-progress survey state from localStorage', e)
    }
}

export function getSurveyContainerClass(survey: Pick<Survey, 'id'>, asSelector = false): string {
    const className = `PostHogSurvey-${survey.id}`
    return asSelector ? `.${className}` : className
}
