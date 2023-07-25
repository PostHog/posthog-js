import { version } from 'rrweb-v1/package.json'

// Same as loader-globals.ts except includes rrweb scripts.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import rrwebRecord from 'rrweb-v1/es/rrweb/packages/rrweb/src/record'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { getRecordConsolePlugin } from 'rrweb-v1/es/rrweb/packages/rrweb/src/plugins/console/record'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore

const win: Window & typeof globalThis = typeof window !== 'undefined' ? window : ({} as typeof window)

;(win as any).rrweb = { record: rrwebRecord, version: 'v1', rrwebVersion: version }
;(win as any).rrwebConsoleRecord = { getRecordConsolePlugin }

export default rrwebRecord
