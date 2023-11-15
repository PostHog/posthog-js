import { generateSurveys } from './extensions/surveys'

import { _isUndefined } from './utils/type-utils'
import { window } from './utils/globals'

const win: Window & typeof globalThis = _isUndefined(window) ? ({} as typeof window) : window

;(win as any).extendPostHogWithSurveys = generateSurveys

export default generateSurveys
