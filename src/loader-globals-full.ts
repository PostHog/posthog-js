// Same as loader-globals.ts except includes rrweb scripts.
import { init_from_snippet } from './posthog-core'
import 'rrweb/dist/record/rrweb-record.min'
import 'rrweb/dist/plugins/console-record.min'

init_from_snippet()
