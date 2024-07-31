// Same as loader-globals.ts except includes all additional extension loaders

import './recorder'
import './surveys'
import './exception-autocapture'
import './tracing-headers'
import './web-vitals'

import { init_from_snippet } from '../posthog-core'

init_from_snippet()
