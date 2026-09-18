import { render } from 'preact'

import { retrieveSurveyShadow } from '@posthog/browser-common/surveys/surveys-extension-utils'
import { SurveyType } from '@posthog/browser-common'
import { List } from './list.tsx'

const { shadow } = retrieveSurveyShadow({ id: 'playground', type: SurveyType.Popover, appearance: {} })
render(<List />, shadow)
