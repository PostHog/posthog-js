import { generateSurveys } from './extensions/surveys'

const win: Window & typeof globalThis = typeof window !== 'undefined' ? window : ({} as typeof window)

;(win as any).extendPostHogWithSurveys = generateSurveys

export default generateSurveys
