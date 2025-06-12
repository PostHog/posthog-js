import { render } from 'preact'

import { createShadow, style } from '../../../src/extensions/surveys/surveys-utils.tsx'
import { List } from './list.tsx'

const shadow = createShadow(style({}), 'some_id')
render(<List />, shadow)
