import { version } from 'rrweb/package.json'

// Same as loader-globals.ts except includes rrweb2 scripts.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import rrwebRecord from 'rrweb/es/rrweb/packages/rrweb/src/record'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { getRecordConsolePlugin } from 'rrweb/es/rrweb/packages/rrweb/src/plugins/console/record'

import { _isUndefined } from './utils/type-utils'

const win: Window & typeof globalThis = _isUndefined(window) ? ({} as typeof window) : window

;(win as any).rrweb = { record: rrwebRecord, version: 'v2', rrwebVersion: version }
;(win as any).rrwebConsoleRecord = { getRecordConsolePlugin }

export default rrwebRecord
