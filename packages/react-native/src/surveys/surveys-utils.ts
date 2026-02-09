import {
  Survey,
  SurveyQuestion,
  SurveyQuestionBranchingType,
  SurveyQuestionType,
  SurveyRatingDisplay,
  RatingSurveyQuestion,
  MultipleSurveyQuestion,
  SurveyAppearance,
  SurveyPosition,
  SurveyQuestionDescriptionContentType,
  SurveyMatchType,
  SurveySchedule,
} from '@posthog/core'

// Extended operator type to include numeric operators not in core SurveyMatchType
export type PropertyOperator = SurveyMatchType | 'gt' | 'lt'

export type PropertyFilters = {
  [propertyName: string]: {
    values: string[]
    operator: PropertyOperator
  }
}

export interface SurveyEventWithFilters {
  name: string
  propertyFilters?: PropertyFilters
}

const isValidRegex = (str: string): boolean => {
  try {
    new RegExp(str)
    return true
  } catch {
    return false
  }
}

export const isMatchingRegex = (value: string, pattern: string): boolean => {
  if (!isValidRegex(pattern)) {
    return false
  }
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

export const surveyValidationMap: Record<PropertyOperator, (targets: string[], values: string[]) => boolean> = {
  [SurveyMatchType.Icontains]: (targets, values) =>
    values.some((value) => targets.some((target) => value.toLowerCase().includes(target.toLowerCase()))),
  [SurveyMatchType.NotIcontains]: (targets, values) =>
    values.every((value) => targets.every((target) => !value.toLowerCase().includes(target.toLowerCase()))),
  [SurveyMatchType.Regex]: (targets, values) =>
    values.some((value) => targets.some((target) => isMatchingRegex(value, target))),
  [SurveyMatchType.NotRegex]: (targets, values) =>
    values.every((value) => targets.every((target) => !isMatchingRegex(value, target))),
  [SurveyMatchType.Exact]: (targets, values) => values.some((value) => targets.some((target) => value === target)),
  [SurveyMatchType.IsNot]: (targets, values) => values.every((value) => targets.every((target) => value !== target)),
  gt: (targets, values) =>
    values.some((value) => {
      const numValue = parseFloat(value)
      return !isNaN(numValue) && targets.some((t) => numValue > parseFloat(t))
    }),
  lt: (targets, values) =>
    values.some((value) => {
      const numValue = parseFloat(value)
      return !isNaN(numValue) && targets.some((t) => numValue < parseFloat(t))
    }),
}

export function matchPropertyFilters(
  propertyFilters: PropertyFilters | undefined,
  eventProperties: Record<string, unknown> | undefined
): boolean {
  if (!propertyFilters) {
    return true
  }

  return Object.entries(propertyFilters).every(([propertyName, filter]) => {
    const eventPropertyValue = eventProperties?.[propertyName]

    if (eventPropertyValue === undefined || eventPropertyValue === null) {
      return false
    }

    const values = [String(eventPropertyValue)]

    const comparisonFunction = surveyValidationMap[filter.operator]
    if (!comparisonFunction) {
      return false
    }

    return comparisonFunction(filter.values, values)
  })
}

function isInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value)
}

/**
 * Utility function to determine if a description should be rendered based on content type
 * Only renders text content, skips HTML content for React Native compatibility
 * Defaults to Text content type when not specified
 * @param description The description text
 * @param contentType The content type (text or html), defaults to Text if not provided
 * @returns True if the description should be rendered, false otherwise
 */
export function shouldRenderDescription(
  description?: string | null,
  contentType?: SurveyQuestionDescriptionContentType
): boolean {
  const effectiveContentType = contentType ?? SurveyQuestionDescriptionContentType.Text
  return Boolean(description && effectiveContentType === SurveyQuestionDescriptionContentType.Text)
}

export const defaultBackgroundColor = '#eeeded' as const
export const defaultDescriptionOpacity = 0.8
export const defaultRatingLabelOpacity = 0.7

// textColor and inputTextColor are optional overrides (auto-calculated if not provided)
export type SurveyAppearanceTheme = Omit<
  Required<SurveyAppearance>,
  'widgetSelector' | 'widgetType' | 'widgetColor' | 'widgetLabel' | 'shuffleQuestions' | 'textColor' | 'inputTextColor'
> & {
  textColor?: string
  inputTextColor?: string
}
export const defaultSurveyAppearance: SurveyAppearanceTheme = {
  backgroundColor: defaultBackgroundColor,
  submitButtonColor: 'black',
  submitButtonTextColor: 'white',
  ratingButtonColor: 'white',
  ratingButtonActiveColor: 'black',
  inputBackground: 'white',
  borderColor: '#c9c6c6',
  placeholder: 'Start typing...',
  displayThankYouMessage: true,
  thankYouMessageHeader: 'Thank you for your feedback!',
  position: SurveyPosition.Right,
  submitButtonText: 'Submit',
  autoDisappear: false,
  thankYouMessageDescription: '',
  thankYouMessageDescriptionContentType: SurveyQuestionDescriptionContentType.Text,
  thankYouMessageCloseButtonText: 'Close',
  surveyPopupDelaySeconds: 0,
}

export const getDisplayOrderQuestions = (survey: Survey): SurveyQuestion[] => {
  // retain the original questionIndex so we can correlate values in the webapp
  survey.questions.forEach((question: SurveyQuestion, idx: number) => {
    question.originalQuestionIndex = idx
  })

  // TODO: shuffle questions
  return survey.questions

  // if (!survey.appearance?.shuffleQuestions) {
  //   return survey.questions
  // }

  // return reverseIfUnshuffled(survey.questions, shuffle(survey.questions))
}

export const hasEvents = (survey: Survey): boolean => {
  return survey.conditions?.events?.values !== undefined && survey.conditions.events.values.length > 0
}

// export const hasActions = (survey: Survey): boolean => {
//   return survey.conditions?.actions?.values.length !== undefined && survey.conditions.actions.values.length > 0
// }

export const canActivateRepeatedly = (survey: Survey): boolean => {
  return (
    !!(survey.conditions?.events?.repeatedActivation && hasEvents(survey)) || survey.schedule === SurveySchedule.Always
  )
}

/**
 * Use the Fisher-yates algorithm to shuffle this array
 * https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
 */
// export const shuffle = <T>(array: T[]): T[] => {
//   return array
//     .map((a) => ({ sort: Math.floor(Math.random() * 10), value: a }))
//     .sort((a, b) => a.sort - b.sort)
//     .map((a) => a.value)
// }

// const reverseIfUnshuffled = <T>(unshuffled: T[], shuffled: T[]): T[] => {
//   if (unshuffled.length === shuffled.length && unshuffled.every((val, index) => val === shuffled[index])) {
//     return shuffled.reverse()
//   }

//   return shuffled
// }

export const getDisplayOrderChoices = (question: MultipleSurveyQuestion): string[] => {
  // TODO: shuffle choices
  return question.choices

  // if (!question.shuffleOptions) {
  //   return question.choices
  // }

  // const displayOrderChoices = question.choices
  // let openEndedChoice = ''
  // if (question.hasOpenChoice && displayOrderChoices.length > 0) {
  // if the question has an open-ended choice, its always the last element in the choices array.
  // openEndedChoice = displayOrderChoices.pop()!
  // }

  // const shuffledOptions = reverseIfUnshuffled(displayOrderChoices, shuffle(displayOrderChoices))

  // if (question.hasOpenChoice) {
  //   question.choices.push(openEndedChoice)
  //   shuffledOptions.push(openEndedChoice)
  // }

  // return shuffledOptions
}

/**
 * Get the rating bucket for a response value based on the scale
 * @param responseValue The numeric rating value
 * @param scale The scale of the rating (3, 5, 7, or 10)
 * @returns The bucket name for the rating
 */
function getRatingBucketForResponseValue(responseValue: number, scale: number): string {
  if (scale === 3) {
    if (responseValue < 1 || responseValue > 3) {
      console.warn('PostHog Debug: Rating response out of range for scale 3:', responseValue)
      return 'neutral' // Default to neutral for out-of-range values
    }

    return responseValue === 1 ? 'negative' : responseValue === 2 ? 'neutral' : 'positive'
  } else if (scale === 5) {
    if (responseValue < 1 || responseValue > 5) {
      console.warn('PostHog Debug: Rating response out of range for scale 5:', responseValue)
      return 'neutral' // Default to neutral for out-of-range values
    }

    return responseValue <= 2 ? 'negative' : responseValue === 3 ? 'neutral' : 'positive'
  } else if (scale === 7) {
    if (responseValue < 1 || responseValue > 7) {
      console.warn('PostHog Debug: Rating response out of range for scale 7:', responseValue)
      return 'neutral' // Default to neutral for out-of-range values
    }

    return responseValue <= 3 ? 'negative' : responseValue === 4 ? 'neutral' : 'positive'
  } else if (scale === 10) {
    if (responseValue < 0 || responseValue > 10) {
      console.warn('PostHog Debug: Rating response out of range for scale 10:', responseValue)
      return 'passives' // Default to passives for out-of-range values
    }

    return responseValue <= 6 ? 'detractors' : responseValue <= 8 ? 'passives' : 'promoters'
  }

  console.warn('PostHog Debug: Unsupported rating scale:', scale)
  return 'neutral' // Default fallback for unsupported scales
}

/**
 * Determines the next question to show based on the survey's branching logic
 * @param survey The survey object
 * @param currentQuestionIndex The current question index
 * @param response The user's response to the current question
 * @returns The index of the next question or SurveyQuestionBranchingType.End if the survey should end
 */
export function getNextSurveyStep(
  survey: Survey,
  currentQuestionIndex: number,
  response: string | string[] | number | null
): number | typeof SurveyQuestionBranchingType.End {
  const question = survey.questions[currentQuestionIndex]
  const nextQuestionIndex = currentQuestionIndex + 1

  if (!question.branching?.type) {
    if (currentQuestionIndex === survey.questions.length - 1) {
      return SurveyQuestionBranchingType.End
    }

    return nextQuestionIndex
  }

  if (question.branching.type === SurveyQuestionBranchingType.End) {
    return SurveyQuestionBranchingType.End
  } else if (question.branching.type === SurveyQuestionBranchingType.SpecificQuestion) {
    if (isInteger(question.branching.index)) {
      return question.branching.index
    }
  } else if (question.branching.type === SurveyQuestionBranchingType.ResponseBased) {
    // Single choice
    if (question.type === SurveyQuestionType.SingleChoice) {
      // Look up the choiceIndex based on the response
      let selectedChoiceIndex = question.choices.indexOf(`${response}`)

      if (selectedChoiceIndex === -1 && question.hasOpenChoice) {
        // if the response is not found in the choices, it must be the open choice,
        // which is always the last choice
        selectedChoiceIndex = question.choices.length - 1
      }

      if (question.branching?.responseValues?.hasOwnProperty(selectedChoiceIndex)) {
        const nextStep = question.branching.responseValues[selectedChoiceIndex]

        // Specific question
        if (isInteger(nextStep)) {
          return nextStep
        }

        if (nextStep === SurveyQuestionBranchingType.End) {
          return SurveyQuestionBranchingType.End
        }

        return nextQuestionIndex
      }
    } else if (question.type === SurveyQuestionType.Rating) {
      if (!isInteger(response)) {
        console.warn('PostHog Debug: Expected integer response for rating question but received:', response)
        return nextQuestionIndex // Fail gracefully by continuing to next question
      }

      const ratingQuestion = question as RatingSurveyQuestion
      const ratingBucket = getRatingBucketForResponseValue(response as number, ratingQuestion.scale)

      if (question.branching?.responseValues?.hasOwnProperty(ratingBucket)) {
        const nextStep = question.branching.responseValues[ratingBucket]

        // Specific question
        if (isInteger(nextStep)) {
          return nextStep
        }

        if (nextStep === SurveyQuestionBranchingType.End) {
          return SurveyQuestionBranchingType.End
        }

        return nextQuestionIndex
      }
    }

    return nextQuestionIndex
  }

  console.warn('Falling back to next question index due to unexpected branching type')
  return nextQuestionIndex
}

export function getContrastingTextColor(color: string): 'black' | 'white' {
  let rgb: string | undefined
  if (color.startsWith('#')) {
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
    const r = parseInt(colorMatch[1], 10)
    const g = parseInt(colorMatch[2], 10)
    const b = parseInt(colorMatch[3], 10)
    const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b))
    return hsp > 127.5 ? 'black' : 'white'
  }
  return 'black'
}

function hex2rgb(c: string): string {
  if (c.startsWith('#')) {
    let hexColor = c.replace(/^#/, '')
    // Handle 3-character shorthand (e.g., #111 -> #111111, #abc -> #aabbcc)
    if (/^[0-9A-Fa-f]{3}$/.test(hexColor)) {
      hexColor = hexColor[0] + hexColor[0] + hexColor[1] + hexColor[1] + hexColor[2] + hexColor[2]
    }
    if (!/^[0-9A-Fa-f]{6}$/.test(hexColor)) {
      return 'rgb(255, 255, 255)'
    }
    const r = parseInt(hexColor.slice(0, 2), 16)
    const g = parseInt(hexColor.slice(2, 4), 16)
    const b = parseInt(hexColor.slice(4, 6), 16)
    return `rgb(${r},${g},${b})`
  }
  return 'rgb(255, 255, 255)'
}

function nameToHex(name: string): string | undefined {
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
