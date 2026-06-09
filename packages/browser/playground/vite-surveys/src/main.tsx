import { render } from 'preact'

import { getSurveyStylesheet } from '../../../src/extensions/surveys/surveys-extension-utils'
import { List } from './list.tsx'

const host = document.createElement('div')
host.id = 'surveys-playground'
document.body.appendChild(host)

const shadow = host.attachShadow({ mode: 'open' })
const stylesheet = getSurveyStylesheet()
if (stylesheet) {
    shadow.appendChild(stylesheet)
}

render(<List />, shadow)
