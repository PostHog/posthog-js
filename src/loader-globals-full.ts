// Same as loader-globals.ts except includes rrweb scripts.

import './session-recording/loader-recorder'
import { init_from_snippet } from './posthog-core'

init_from_snippet()
