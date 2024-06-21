// Same as loader-globals.ts except includes rrweb scripts.

import './recorder'
import './surveys'
import './exception-autocapture'
import './tracing-headers'

import { init_from_snippet } from '../posthog-core'

init_from_snippet()
