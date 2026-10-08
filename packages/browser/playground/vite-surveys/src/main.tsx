import { render } from 'preact'

import { retrieveSurveyShadow } from '../../../src/extensions/surveys/surveys-extension-utils.tsx'
import { SurveyType } from '../../../src/posthog-surveys-types'
import { List } from './list.tsx'

const { shadow } = retrieveSurveyShadow({ id: 'playground', type: SurveyType.Popover, appearance: {} })
render(<List />, shadow)
