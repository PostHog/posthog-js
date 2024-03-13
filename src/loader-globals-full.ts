// Same as loader-globals.ts except includes rrweb scripts.

import './loader-recorder-v2'
import { init_from_snippet } from './posthog-core'

init_from_snippet()
