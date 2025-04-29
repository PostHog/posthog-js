import { VNode, cloneElement, createContext } from 'preact'
import { PostHog } from '../../posthog-core'
import {
    MultipleSurveyQuestion,
    Survey,
    SurveyAppearance,
    SurveyPosition,
    SurveyQuestion,
    SurveySchedule,
} from '../../posthog-surveys-types'
import { document as _document, window as _window, userAgent } from '../../utils/globals'
import { SURVEY_LOGGER as logger, SURVEY_SEEN_PREFIX } from '../../utils/survey-utils'

import { SurveyMatchType } from '../../posthog-surveys-types'
import { isMatchingRegex } from '../../utils/regex-utils'
import { detectDeviceType } from '../../utils/user-agent-utils'
// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document

export const SURVEY_DEFAULT_Z_INDEX = 2147483647

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

export function getContrastingTextColor(color: string = defaultBackgroundColor) {
    let rgb: string | undefined
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
    submitButtonTextColor: 'white',
    ratingButtonColor: 'white',
    ratingButtonActiveColor: 'black',
    borderColor: '#c9c6c6',
    placeholder: 'Start typing...',
    whiteLabel: false,
    displayThankYouMessage: true,
    thankYouMessageHeader: 'Thank you for your feedback!',
    position: SurveyPosition.Right,
}

export const defaultBackgroundColor = '#eeeded'

export const addSurveyCSSVariablesToElement = (element: HTMLDivElement, appearance?: SurveyAppearance | null) => {
    // --- Apply CSS Variables and Positioning ---
    const effectiveAppearance = { ...defaultSurveyAppearance, ...appearance }
    const hostStyle = element.style

    hostStyle.setProperty('--ph-survey-font-family', getFontFamily(effectiveAppearance.fontFamily))
    hostStyle.setProperty('--ph-survey-max-width', `${parseInt(effectiveAppearance.maxWidth || '300')}px`)
    hostStyle.setProperty(
        '--ph-survey-z-index',
        parseInt(effectiveAppearance.zIndex || SURVEY_DEFAULT_Z_INDEX.toString()).toString()
    )
    hostStyle.setProperty('--ph-survey-border-color', effectiveAppearance.borderColor || '#dcdcdc')
    hostStyle.setProperty('--ph-survey-background-color', effectiveAppearance.backgroundColor || defaultBackgroundColor)
    hostStyle.setProperty('--ph-survey-disabled-button-opacity', effectiveAppearance.disabledButtonOpacity || '0.6')
    hostStyle.setProperty('--ph-survey-submit-button-color', effectiveAppearance.submitButtonColor || 'black')
    hostStyle.setProperty(
        '--ph-survey-submit-button-text-color',
        getContrastingTextColor(effectiveAppearance.submitButtonColor || 'black')
    )
    hostStyle.setProperty('--ph-survey-rating-active-color', effectiveAppearance.ratingButtonActiveColor || 'black')
    hostStyle.setProperty(
        '--ph-survey-text-primary-color',
        getContrastingTextColor(effectiveAppearance.backgroundColor || defaultBackgroundColor)
    )

    // Adjust input/choice background slightly if main background is white
    if (effectiveAppearance.backgroundColor === 'white') {
        hostStyle.setProperty('--ph-survey-input-background', '#f8f8f8')
        hostStyle.setProperty('--ph-survey-choice-background', '#fdfdfd')
        hostStyle.setProperty('--ph-survey-choice-background-hover', '#f9f9f9')
    } else {
        hostStyle.setProperty('--ph-survey-input-background', 'white') // Default if not white
        hostStyle.setProperty('--ph-survey-choice-background', 'white') // Default if not white
        hostStyle.setProperty('--ph-survey-choice-background-hover', '#fcfcfc') // Default if not white
    }
}

export const createShadow = (survey: Pick<Survey, 'id' | 'appearance'>, element?: Element) => {
    const div = document.createElement('div')
    div.className = `PostHogSurvey-${survey.id}`

    addSurveyCSSVariablesToElement(div, survey.appearance)

    // --- Attach Shadow DOM and Styles ---
    const shadow = div.attachShadow({ mode: 'open' })

    // Append the host element to the document body or specified element
    ;(element ? element : document.body).appendChild(div)
    return shadow
}

export const sendSurveyEvent = (
    responses: Record<string, string | number | string[] | null> = {},
    survey: Survey,
    posthog?: PostHog
) => {
    if (!posthog) {
        logger.error('[survey sent] event not captured, PostHog instance not found.')
        return
    }
    localStorage.setItem(getSurveySeenKey(survey), 'true')

    posthog.capture('survey sent', {
        $survey_name: survey.name,
        $survey_id: survey.id,
        $survey_iteration: survey.current_iteration,
        $survey_iteration_start_date: survey.current_iteration_start_date,
        $survey_questions: survey.questions.map((question, index) => ({
            id: question.id,
            question: question.question,
            index,
        })),
        sessionRecordingUrl: posthog.get_session_replay_url?.(),
        ...responses,
        $set: {
            [getSurveyInteractionProperty(survey, 'responded')]: true,
        },
    })
    window.dispatchEvent(new CustomEvent('PHSurveySent', { detail: { surveyId: survey.id } }))
}

export const dismissedSurveyEvent = (survey: Survey, posthog?: PostHog, readOnly?: boolean) => {
    // TODO: state management and unit tests for this would be nice
    if (!posthog) {
        logger.error('[survey dismissed] event not captured, PostHog instance not found.')
        return
    }
    if (readOnly) {
        return
    }
    posthog.capture('survey dismissed', {
        $survey_name: survey.name,
        $survey_id: survey.id,
        $survey_iteration: survey.current_iteration,
        $survey_iteration_start_date: survey.current_iteration_start_date,
        sessionRecordingUrl: posthog.get_session_replay_url?.(),
        $set: {
            [getSurveyInteractionProperty(survey, 'dismissed')]: true,
        },
    })
    localStorage.setItem(getSurveySeenKey(survey), 'true')
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
    if (!survey.appearance || !survey.appearance.shuffleQuestions) {
        return survey.questions
    }

    return reverseIfUnshuffled(survey.questions, shuffle(survey.questions))
}

export const hasEvents = (survey: Pick<Survey, 'conditions'>): boolean => {
    return survey.conditions?.events?.values?.length != undefined && survey.conditions?.events?.values?.length > 0
}

export const canActivateRepeatedly = (survey: Pick<Survey, 'schedule' | 'conditions'>): boolean => {
    return (
        !!(survey.conditions?.events?.repeatedActivation && hasEvents(survey)) ||
        survey.schedule === SurveySchedule.Always
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

export const getSurveySeenKey = (survey: Survey): string => {
    let surveySeenKey = `${SURVEY_SEEN_PREFIX}${survey.id}`
    if (survey.current_iteration && survey.current_iteration > 0) {
        surveySeenKey = `${SURVEY_SEEN_PREFIX}${survey.id}_${survey.current_iteration}`
    }

    return surveySeenKey
}

const getSurveyInteractionProperty = (survey: Survey, action: string): string => {
    let surveyProperty = `$survey_${action}/${survey.id}`
    if (survey.current_iteration && survey.current_iteration > 0) {
        surveyProperty = `$survey_${action}/${survey.id}/${survey.current_iteration}`
    }

    return surveyProperty
}

export const hasWaitPeriodPassed = (
    lastSeenSurveyDate: string | null,
    waitPeriodInDays: number | undefined
): boolean => {
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
}

export const SurveyContext = createContext<SurveyContextProps>({
    isPreviewMode: false,
    previewPageIndex: 0,
    onPopupSurveyDismissed: () => {},
    isPopup: true,
    onPreviewSubmit: () => {},
})

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

const surveyValidationMap: Record<SurveyMatchType, (targets: string[], value: string) => boolean> = {
    icontains: (targets, value) => targets.some((target) => value.toLowerCase().includes(target.toLowerCase())),
    not_icontains: (targets, value) => targets.every((target) => !value.toLowerCase().includes(target.toLowerCase())),
    regex: (targets, value) => targets.some((target) => isMatchingRegex(value, target)),
    not_regex: (targets, value) => targets.every((target) => !isMatchingRegex(value, target)),
    exact: (targets, value) => targets.some((target) => value === target),
    is_not: (targets, value) => targets.every((target) => value !== target),
}

function defaultMatchType(matchType?: SurveyMatchType): SurveyMatchType {
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
    return surveyValidationMap[defaultMatchType(survey.conditions?.urlMatchType)](targets, href)
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
    return surveyValidationMap[defaultMatchType(survey.conditions?.deviceTypesMatchType)](
        survey.conditions.deviceTypes,
        deviceType
    )
}

export function doesSurveyMatchSelector(survey: Survey): boolean {
    if (!survey.conditions?.selector) {
        return true
    }
    return !!document?.querySelector(survey.conditions.selector)
}

export function getSurveyContainerClass(survey: Pick<Survey, 'id'>, asSelector = false): string {
    const className = `PostHogSurvey-${survey.id}`
    return asSelector ? `.${className}` : className
}

function nameToHex(name: string): string | undefined {
    // NOTE: Explicitly added return type and lowercase mapping
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
        'indianred ': '#cd5c5c', // Note: Trailing space in original?
        indianred: '#cd5c5c', // Added without space for safety
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

function hex2rgb(c: string): string {
    // NOTE: Defaulting to white if parse fails
    if (c?.[0] === '#') {
        const hexColor = c.replace(/^#/, '')
        if (hexColor.length === 6 || hexColor.length === 3) {
            // Handle 3-digit hex
            const fullHex =
                hexColor.length === 3
                    ? hexColor
                          .split('')
                          .map((char) => char + char)
                          .join('')
                    : hexColor
            const r = parseInt(fullHex.slice(0, 2), 16)
            const g = parseInt(fullHex.slice(2, 4), 16)
            const b = parseInt(fullHex.slice(4, 6), 16)
            if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                return 'rgb(' + r + ',' + g + ',' + b + ')'
            }
        }
    }
    return 'rgb(255, 255, 255)' // Default to white rgb
}
