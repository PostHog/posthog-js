// Same as loader-globals.ts except includes rrweb and surveys scripts.

import './loader-recorder'
import './loader-surveys'
import { init_from_snippet } from './posthog-core'

init_from_snippet()
