import { generateSurveys } from './extensions/surveys'

import { window } from './utils/globals'
import { h, render } from 'preact'

if (window) {
    console.log('render', render)
    ;(window as any).extendPostHogWithSurveys = generateSurveys
    // ;(window as any).render = render
    // ;(window as any).preact = { render, h }
}

export default generateSurveys
