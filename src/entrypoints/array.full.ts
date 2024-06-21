// Same as loader-globals.ts except includes rrweb scripts.

import './recorder'
import { init_from_snippet } from '../posthog-core'

init_from_snippet()
